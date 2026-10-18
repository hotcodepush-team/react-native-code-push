import type {
  ApplyUpdateResult,
  CheckForUpdateResult,
  DownloadUpdateResult,
  GetChannelResult,
  GetDeviceResult,
  GetStateResult,
  HotCodePushApi,
  HotCodePushEventName,
  HotCodePushListenerHandle,
  NotifyReadyResult,
  SyncResult,
} from '@hotcodepush/protocol';
import type { Spec } from './NativeHotCodePush';
import NativeHotCodePush from './NativeHotCodePush';

type CycleListener = (runningCycleCount: number) => void;

/** A listener past the typed surface: `addListener` pairs each event name with its payload, the bridge carries objects. */
type EventListener = (event: object) => void;

type NativeEventName = Exclude<HotCodePushEventName, 'updateRolledBack'>;

type NativeSubscription = ReturnType<Spec['onUpdateAvailable']>;

const NATIVE_MODULE_MISSING_MESSAGE =
  'Live updates need a development or release build; they are not available on the web or in Expo Go.';

const cycleListeners = new Set<CycleListener>();
const subscriptions = new Set<NativeSubscription>();
const updateRolledBackListeners = new Set<EventListener>();

/** The `updateRolledBack` event the native side kept for this start, taken from it once; undefined until a listener asks. */
let keptUpdateRolledBackEvent: Promise<object | null> | undefined;
let runningCycleCount = 0;

/**
 * The SDK: the one surface `@hotcodepush/protocol` defines, over the native module. Without it, on the web and in
 * Expo Go, every method rejects with the one error that names the build live updates need.
 */
export const HotCodePush: HotCodePushApi = {
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
