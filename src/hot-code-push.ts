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
import NativeHotCodePush from './NativeHotCodePush';

type CycleListener = (runningCycleCount: number) => void;

/** A listener past the typed surface: `addListener` pairs each event name with its payload, the bridge carries objects. */
type EventListener = (event: object) => void;

type NativeEventName = Exclude<HotCodePushEventName, 'updateRolledBack'>;

type NativeSubscription = ReturnType<
  typeof NativeHotCodePush.onUpdateAvailable
>;

const cycleListeners = new Set<CycleListener>();
const subscriptions = new Set<NativeSubscription>();
const updateRolledBackListeners = new Set<EventListener>();

/** The `updateRolledBack` event the native side kept for this start, taken from it once; undefined until a listener asks. */
let keptUpdateRolledBackEvent: Promise<object | null> | undefined;
let runningCycleCount = 0;

/**
 * The SDK: the one surface `@hotcodepush/protocol` defines, over the native module.
 */
export const HotCodePush: HotCodePushApi = {
  addListener: async (eventName, listener) =>
    eventName === 'updateRolledBack'
      ? addUpdateRolledBackListener(listener as EventListener)
      : addNativeListener(
          eventName as NativeEventName,
          listener as EventListener,
        ),
  applyUpdate: () =>
    NativeHotCodePush.applyUpdate() as Promise<ApplyUpdateResult>,
  checkForUpdate: () =>
    trackCycle(
      NativeHotCodePush.checkForUpdate() as Promise<CheckForUpdateResult>,
    ),
  clearUpdates: () => NativeHotCodePush.clearUpdates(),
  downloadUpdate: options =>
    trackCycle(
      NativeHotCodePush.downloadUpdate(
        options ?? {},
      ) as Promise<DownloadUpdateResult>,
    ),
  getChannel: () => NativeHotCodePush.getChannel() as Promise<GetChannelResult>,
  getDevice: () => NativeHotCodePush.getDevice() as Promise<GetDeviceResult>,
  getState: () => NativeHotCodePush.getState() as Promise<GetStateResult>,
  notifyReady: () =>
    NativeHotCodePush.notifyReady() as Promise<NotifyReadyResult>,
  removeAllListeners: async () => {
    for (const subscription of subscriptions) {
      subscription.remove();
    }
    subscriptions.clear();
    updateRolledBackListeners.clear();
  },
  rollbackUpdate: options => NativeHotCodePush.rollbackUpdate(options ?? {}),
  setAttributes: options => NativeHotCodePush.setAttributes(options),
  setChannel: options => NativeHotCodePush.setChannel(options ?? {}),
  setRestartAllowed: options => NativeHotCodePush.setRestartAllowed(options),
  showDebugScreen: () => NativeHotCodePush.showDebugScreen(),
  sync: options =>
    trackCycle(NativeHotCodePush.sync(options ?? {}) as Promise<SyncResult>),
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
  updateRolledBackListeners.add(listener);
  keptUpdateRolledBackEvent ??=
    NativeHotCodePush.consumeUpdateRolledBack().then(
      result => (result as { event: object | null }).event,
    );
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

function subscribeToNativeEvent(
  eventName: NativeEventName,
  listener: EventListener,
): NativeSubscription {
  switch (eventName) {
    case 'downloadProgress':
      return NativeHotCodePush.onDownloadProgress(listener);
    case 'updateAvailable':
      return NativeHotCodePush.onUpdateAvailable(listener);
    case 'updateDownloaded':
      return NativeHotCodePush.onUpdateDownloaded(listener);
    case 'updateFailed':
      return NativeHotCodePush.onUpdateFailed(listener);
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
