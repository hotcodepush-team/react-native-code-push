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

/** A listener past the typed surface: `addListener` pairs each event name with its payload, the bridge carries objects. */
type EventListener = (event: object) => void;

type NativeEventName = Exclude<HotCodePushEventName, 'updateRolledBack'>;

type NativeSubscription = ReturnType<Spec['onUpdateAvailable']>;

const NATIVE_MODULE_MISSING_MESSAGE =
  'Over-the-air (OTA) updates need a development or release build; they are not available on the web or in Expo Go.';

const cycleListeners = new Set<CycleListener>();
const subscriptions = new Set<NativeSubscription>();
const updateRolledBackListeners = new Set<EventListener>();

/** The `updateRolledBack` event the native side kept for this start, taken from it once; undefined until a listener asks. */
let keptUpdateRolledBackEvent: Promise<object | null> | undefined;
let runningCycleCount = 0;

/**
 * The React Native SDK over the option, result and event types of `@hotcodepush/protocol`; every listener is
 * answered with a handle whose `remove()` stops it.
 */
export interface HotCodePush {
  /**
   * One cycle under the strategies, the same the SDK runs on its own at start,
   * resume and interval, stopping at a `manual` gate for the app: fetch the
   * index, evaluate it locally, download and verify, apply, report. A second
   * call while one runs joins the running one.
   */
  sync(options?: SyncOptions): Promise<SyncResult>;
  /** `sync()` with `downloadStrategy` pinned to `manual`: fetch and evaluate, download nothing. */
  checkForUpdate(): Promise<CheckForUpdateResult>;
  /** `sync()` with `downloadStrategy` pinned to `auto`: re-check the index, a conditional GET, download and verify, apply per the apply strategies. */
  downloadUpdate(
    options?: DownloadUpdateOptions,
  ): Promise<DownloadUpdateResult>;
  /** Applies the downloaded update now, whatever the strategy says, and reloads the app. */
  applyUpdate(): Promise<ApplyUpdateResult>;
  /** Ends the readiness gate when `readySignal` is `manual`; safe to call at any time on any setting. */
  notifyReady(): Promise<NotifyReadyResult>;
  /** Rolls the running release back now, marks its bundle as failed on this device, reports `APP_REQUESTED`, reloads. */
  rollbackUpdate(options?: RollbackUpdateOptions): Promise<void>;
  /** Clears every downloaded update and the list of failed bundles, keeps the channel and the attributes, reloads. */
  clearUpdates(): Promise<void>;
  /** Restart gating: `isAllowed: false` holds the one restart the SDK would perform on its own — after an `immediate` apply, a `next-resume` apply or a mandatory release alike — until `isAllowed: true` runs it. A restart the app asks for itself, `applyUpdate()`, `rollbackUpdate()` or `clearUpdates()`, is never held. Not persisted: every start begins allowed. */
  setRestartAllowed(options: SetRestartAllowedOptions): Promise<void>;
  /** The SDK's state, a snapshot. */
  getState(): Promise<GetStateResult>;
  /** The channel in effect with its source. */
  getChannel(): Promise<GetChannelResult>;
  /** Switches the device to a channel by name or by id; `null` clears the runtime choice. */
  setChannel(options: SetChannelOptions): Promise<void>;
  /** The facts of the device report. */
  getDevice(): Promise<GetDeviceResult>;
  /** Merges string attributes the app sets for `attribute` conditions; a `null` value removes a key. */
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
 * The SDK over the native module. Without it, on the web and in Expo Go, every method rejects with the one error that
 * names the build OTA updates need.
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

/**
 * Tells the listener how many cycles the app started through `HotCodePush` are running, now and on every change;
 * the SDK fires no event for a cycle's start or end, so `useUpdates()` reads its own calls here.
 */
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

/**
 * `updateRolledBack` belongs to the start that follows the rollback, before any listener exists: the native side
 * keeps the event, the first listener takes it from there, and every listener of this start receives it.
 */
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

/** The native module, which a development or release build carries; the web and Expo Go have none. */
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
