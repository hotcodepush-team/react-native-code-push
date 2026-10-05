import type {
  ApplyResult,
  CheckResult,
  DownloadResult,
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

type NativeEventName = Exclude<HotCodePushEventName, 'rolledBack'>;

type NativeSubscription = ReturnType<
  typeof NativeHotCodePush.onUpdateAvailable
>;

const cycleListeners = new Set<CycleListener>();
const rolledBackListeners = new Set<EventListener>();
const subscriptions = new Set<NativeSubscription>();

/** The `rolledBack` event the native side kept for this start, taken from it once; undefined until a listener asks. */
let keptRolledBackEvent: Promise<object | null> | undefined;
let runningCycleCount = 0;

/**
 * The SDK: the one surface `@hotcodepush/protocol` defines, over the native module.
 */
export const HotCodePush: HotCodePushApi = {
  addListener: async (eventName, listener) =>
    eventName === 'rolledBack'
      ? addRolledBackListener(listener as EventListener)
      : addNativeListener(
          eventName as NativeEventName,
          listener as EventListener,
        ),
  applyUpdate: () => NativeHotCodePush.applyUpdate() as Promise<ApplyResult>,
  checkForUpdate: () =>
    trackCycle(NativeHotCodePush.checkForUpdate() as Promise<CheckResult>),
  clearUpdates: () => NativeHotCodePush.clearUpdates(),
  downloadUpdate: () =>
    trackCycle(NativeHotCodePush.downloadUpdate() as Promise<DownloadResult>),
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
    rolledBackListeners.clear();
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
 * `rolledBack` belongs to the start that follows the rollback, before any listener exists: the native side keeps
 * the event, the first listener takes it from there, and every listener of this start receives it.
 */
function addRolledBackListener(
  listener: EventListener,
): HotCodePushListenerHandle {
  rolledBackListeners.add(listener);
  keptRolledBackEvent ??= NativeHotCodePush.consumeRolledBack().then(
    result => (result as { event: object | null }).event,
  );
  void keptRolledBackEvent.then(event => {
    if (event !== null && rolledBackListeners.has(listener)) {
      listener(event);
    }
  });
  return {
    remove: async () => {
      rolledBackListeners.delete(listener);
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
