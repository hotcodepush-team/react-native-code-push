import type {
  ApplyUpdateResult,
  CheckForUpdateResult,
  DownloadUpdateOptions,
  DownloadUpdateResult,
  GetChannelResult,
  GetDeviceResult,
  GetStateResult,
  HotCodePushEventName,
  HotCodePushEvents,
  NotifyReadyResult,
  RollbackUpdateOptions,
  SetAttributesOptions,
  SetChannelOptions,
  SetRestartAllowedOptions,
  SyncOptions,
  SyncResult,
} from '@hotcodepush/protocol';
import type { Spec } from './NativeHotCodePush';
import NativeHotCodePush from './NativeHotCodePush';
import type { HotCodePushListenerHandle } from './definitions';

type CycleListener = (runningCycleCount: number) => void;

// The bridge carries plain objects, so listeners lose their typed payload below `addListener`.
type EventListener = (event: object) => void;

type NativeEventName = Exclude<HotCodePushEventName, 'updateRolledBack'>;

type NativeSubscription = ReturnType<Spec['onUpdateAvailable']>;

const NATIVE_MODULE_MISSING_MESSAGE =
  'Over-the-air (OTA) updates need a development or release build; they are not available on the web or in Expo Go.';

const cycleListeners = new Set<CycleListener>();
const subscriptions = new Set<NativeSubscription>();
const updateRolledBackListeners = new Set<EventListener>();

// The native side hands out the kept event only once, so the first listener caches it for the others.
let keptUpdateRolledBackEvent: Promise<object | null> | undefined;
let runningCycleCount = 0;

/**
 * The methods of the HotCodePush React Native SDK.
 * `addListener` returns a handle whose `remove()` stops the listener.
 */
export interface HotCodePush {
  /**
   * Runs one update cycle: fetch the index, evaluate it, download and verify, apply, report.
   * It is the cycle the SDK runs on its own at start, resume and interval, and it stops at any `manual` strategy.
   * A call while a cycle runs joins that cycle.
   */
  sync(options?: SyncOptions): Promise<SyncResult>;
  /** Runs `sync()` with `downloadStrategy: 'manual'`: it checks for an update but downloads nothing. */
  checkForUpdate(): Promise<CheckForUpdateResult>;
  /**
   * Runs `sync()` with `downloadStrategy: 'auto'`.
   * It re-checks the index, downloads and verifies the update, and applies it as the apply strategies say.
   */
  downloadUpdate(
    options?: DownloadUpdateOptions,
  ): Promise<DownloadUpdateResult>;
  /** Applies the downloaded update now, whatever the strategy says, and reloads the app. */
  applyUpdate(): Promise<ApplyUpdateResult>;
  /** Ends the readiness gate when `readySignal` is `manual`. Safe to call at any time with any setting. */
  notifyReady(): Promise<NotifyReadyResult>;
  /**
   * Rolls back the running release now and reloads the app.
   * The bundle is marked as failed on this device, and the rollback is reported as `app_requested`.
   */
  rollbackUpdate(options?: RollbackUpdateOptions): Promise<void>;
  /**
   * Clears all downloaded updates and the list of failed bundles, then reloads the app.
   * The channel and the attributes stay.
   */
  clearUpdates(): Promise<void>;
  /**
   * Holds or allows the restart the SDK performs on its own.
   * With `isAllowed: false`, the restart after an `immediate` apply, a `next_resume` apply or a mandatory release waits until `isAllowed: true` runs it.
   * Restarts the app asks for (`applyUpdate()`, `rollbackUpdate()`, `clearUpdates()`) are never held.
   * Not persisted: every start begins allowed.
   */
  setRestartAllowed(options: SetRestartAllowedOptions): Promise<void>;
  /** Returns a snapshot of the SDK state. */
  getState(): Promise<GetStateResult>;
  /** Returns the channel in effect and its source. */
  getChannel(): Promise<GetChannelResult>;
  /** Switches the device to a channel by name or ID. `null` clears the runtime choice. */
  setChannel(options: SetChannelOptions): Promise<void>;
  /** Returns the device facts that the device report carries. */
  getDevice(): Promise<GetDeviceResult>;
  /** Merges string attributes for `attribute` conditions. A `null` value removes the key. */
  setAttributes(options: SetAttributesOptions): Promise<void>;
  /** Opens the SDK's native debug screen. */
  showDebugScreen(): Promise<void>;
  addListener<EventName extends HotCodePushEventName>(
    eventName: EventName,
    listener: (event: HotCodePushEvents[EventName]) => void,
  ): Promise<HotCodePushListenerHandle>;
  removeAllListeners(): Promise<void>;
}

/**
 * The HotCodePush React Native SDK.
 * On the web and in Expo Go, which have no native module, every method rejects with one error.
 */
export const HotCodePush: HotCodePush = {
  addListener: async (eventName, listener) =>
    eventName === 'updateRolledBack'
      ? addUpdateRolledBackListener(listener as EventListener)
      : addNativeListener(
          eventName as NativeEventName,
          listener as EventListener,
        ),
  applyUpdate: async () =>
    requireNativeModule().applyUpdate() as Promise<ApplyUpdateResult>,
  checkForUpdate: async () =>
    trackCycle(
      requireNativeModule().checkForUpdate() as Promise<CheckForUpdateResult>,
    ),
  clearUpdates: async () => requireNativeModule().clearUpdates(),
  downloadUpdate: async options =>
    trackCycle(
      requireNativeModule().downloadUpdate(
        options ?? {},
      ) as Promise<DownloadUpdateResult>,
    ),
  getChannel: async () =>
    requireNativeModule().getChannel() as Promise<GetChannelResult>,
  getDevice: async () =>
    requireNativeModule().getDevice() as Promise<GetDeviceResult>,
  getState: async () =>
    requireNativeModule().getState() as Promise<GetStateResult>,
  notifyReady: async () =>
    requireNativeModule().notifyReady() as Promise<NotifyReadyResult>,
  removeAllListeners: async () => {
    requireNativeModule();
    for (const subscription of subscriptions) {
      subscription.remove();
    }
    subscriptions.clear();
    updateRolledBackListeners.clear();
  },
  rollbackUpdate: async options =>
    requireNativeModule().rollbackUpdate(options ?? {}),
  setAttributes: async options => requireNativeModule().setAttributes(options),
  setChannel: async options => requireNativeModule().setChannel(options ?? {}),
  setRestartAllowed: async options =>
    requireNativeModule().setRestartAllowed(options),
  showDebugScreen: async () => requireNativeModule().showDebugScreen(),
  sync: async options =>
    trackCycle(
      requireNativeModule().sync(options ?? {}) as Promise<SyncResult>,
    ),
};

// The SDK fires no event when a cycle starts or ends, so `useUpdates()` counts the cycles the app starts here.
export function subscribeToRunningCycles(listener: CycleListener): () => void {
  cycleListeners.add(listener);
  listener(runningCycleCount);
  return () => {
    cycleListeners.delete(listener);
  };
}

function addNativeListener(
  eventName: NativeEventName,
  listener: EventListener,
): HotCodePushListenerHandle {
  const subscription = subscribeToNativeEvent(eventName, listener);
  subscriptions.add(subscription);
  return {
    remove: async () => {
      subscription.remove();
      subscriptions.delete(subscription);
    },
  };
}

// The event belongs to the start after the rollback, when no listener exists yet.
// The native side keeps it until the first listener asks, and every listener of this start receives it.
function addUpdateRolledBackListener(
  listener: EventListener,
): HotCodePushListenerHandle {
  keptUpdateRolledBackEvent ??= requireNativeModule()
    .consumeUpdateRolledBack()
    .then(result => (result as { event: object | null }).event);
  updateRolledBackListeners.add(listener);
  void keptUpdateRolledBackEvent.then(event => {
    if (event !== null && updateRolledBackListeners.has(listener)) {
      listener(event);
    }
  });
  return {
    remove: async () => {
      updateRolledBackListeners.delete(listener);
    },
  };
}

function requireNativeModule(): Spec {
  if (NativeHotCodePush === null) {
    throw new Error(NATIVE_MODULE_MISSING_MESSAGE);
  }
  return NativeHotCodePush;
}

function subscribeToNativeEvent(
  eventName: NativeEventName,
  listener: EventListener,
): NativeSubscription {
  const nativeModule = requireNativeModule();
  switch (eventName) {
    case 'downloadProgress':
      return nativeModule.onDownloadProgress(listener);
    case 'updateAvailable':
      return nativeModule.onUpdateAvailable(listener);
    case 'updateDownloaded':
      return nativeModule.onUpdateDownloaded(listener);
    case 'updateFailed':
      return nativeModule.onUpdateFailed(listener);
  }
}

async function trackCycle<Result>(cycle: Promise<Result>): Promise<Result> {
  setRunningCycleCount(runningCycleCount + 1);
  try {
    return await cycle;
  } finally {
    setRunningCycleCount(runningCycleCount - 1);
  }
}

function setRunningCycleCount(count: number): void {
  runningCycleCount = count;
  for (const listener of cycleListeners) {
    listener(count);
  }
}
