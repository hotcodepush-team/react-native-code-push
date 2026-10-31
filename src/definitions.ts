import type { GetStateResult, SyncResult } from '@hotcodepush/protocol';

export type {
  ApplyMoment,
  ApplyStrategy,
  ApplyUpdateResult,
  CheckForUpdateResult,
  CheckStrategy,
  ConditionType,
  DownloadProgressEvent,
  DownloadStrategy,
  DownloadUpdateOptions,
  DownloadUpdateResult,
  FailedReason,
  GetChannelResult,
  GetDeviceResult,
  GetStateResult,
  HotCodePushEventName,
  HotCodePushEvents,
  MandatoryApplyStrategy,
  NotifyReadyResult,
  ReadySignal,
  Release,
  RollbackReason,
  RollbackUpdateOptions,
  SetAttributesOptions,
  SetChannelOptions,
  SetRestartAllowedOptions,
  SkippedReason,
  SyncOptions,
  SyncResult,
  SyncTrigger,
  UpdateAvailableEvent,
  UpdateDownloadedEvent,
  UpdateFailedEvent,
  UpdateRolledBackEvent,
} from '@hotcodepush/protocol';

export interface HotCodePushListenerHandle {
  remove: () => Promise<void>;
}

/**
 * What `useUpdates()` returns. It stays current through the five events and `getState()`.
 */
export interface UseUpdatesResult {
  /** Download progress from `0` to `1` while a pack downloads, otherwise `null`. */
  downloadProgress: number | null;
  /** Whether a cycle the app started through `HotCodePush` is running or a pack is downloading. */
  isSyncing: boolean;
  /** The result of the last cycle, including the cycles the SDK runs on its own. `null` before the first. */
  lastSync: SyncResult | null;
  state: GetStateResult;
}
