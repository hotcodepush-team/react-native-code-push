import type { GetStateResult, SyncResult } from '@hotcodepush/protocol';

export type {
  ApplyResult,
  CheckResult,
  ConditionType,
  DownloadProgressEvent,
  DownloadResult,
  DownloadStrategy,
  FailedReason,
  GetChannelResult,
  GetDeviceResult,
  GetStateResult,
  HotCodePushApi,
  HotCodePushEventName,
  HotCodePushEvents,
  HotCodePushListenerHandle,
  InstallMoment,
  InstallStrategy,
  MandatoryInstallStrategy,
  NotifyReadyResult,
  ReadySignal,
  Release,
  RollbackReason,
  RollbackUpdateOptions,
  RolledBackEvent,
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
} from '@hotcodepush/protocol';

/**
 * What `useUpdates()` returns, kept current from the five events and `getState()`.
 */
export interface UseUpdatesResult {
  /** The download's progress from `0` to `1` while a pack downloads, `null` otherwise. */
  downloadProgress: number | null;
  /** A cycle the app started through `HotCodePush` is running, or a pack is downloading. */
  isSyncing: boolean;
  /** The result of the last cycle, the SDK's own included; `null` before the first. */
  lastSync: SyncResult | null;
  state: GetStateResult;
}
