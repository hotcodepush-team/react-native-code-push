import type { GetStateResult, SyncResult } from '@hotcodepush/protocol';
import { useEffect, useState } from 'react';
import type { UseUpdatesResult } from './definitions';
import { HotCodePush, subscribeToRunningCycles } from './hot-code-push';

const EMBEDDED_STATE: GetStateResult = {
  currentRelease: null,
  embeddedBundleId: null,
  failedBundleIds: [],
  fallbackRelease: null,
  index: null,
  lastCheck: null,
  lastReportAt: null,
  nextRelease: null,
};

/**
 * The SDK's state for a component: `getState()` read on mount and again after each of the five events and each
 * cycle the app runs, with the download's progress in between. Until the first read it is the embedded state.
 */
export function useUpdates(): UseUpdatesResult {
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [runningCycleCount, setRunningCycleCount] = useState(0);
  const [state, setState] = useState(EMBEDDED_STATE);

  useEffect(() => {
    let isMounted = true;
    const refreshState = () =>
      void HotCodePush.getState().then(
        readState => {
          if (isMounted) {
            setState(readState);
          }
        },
        // An unconfigured build has no state to read; the embedded state stands.
        () => undefined,
      );
    const endDownload = () => {
      setDownloadProgress(null);
      refreshState();
    };
    const handles = [
      HotCodePush.addListener('downloadProgress', event =>
        setDownloadProgress(event.progress),
      ),
      HotCodePush.addListener('rolledBack', refreshState),
      HotCodePush.addListener('updateAvailable', refreshState),
      HotCodePush.addListener('updateDownloaded', endDownload),
      HotCodePush.addListener('updateFailed', endDownload),
    ];
    const unsubscribeFromRunningCycles = subscribeToRunningCycles(count => {
      setRunningCycleCount(count);
      refreshState();
    });
    return () => {
      isMounted = false;
      unsubscribeFromRunningCycles();
      for (const handle of handles) {
        void handle.then(({ remove }) => remove());
      }
    };
  }, []);

  return {
    downloadProgress,
    isSyncing: runningCycleCount > 0 || downloadProgress !== null,
    lastSync: resolveLastSync(state),
    state,
  };
}

/**
 * The last cycle's result as a sync's: a check alone ends where a sync that downloads nothing does.
 */
function resolveLastSync(state: GetStateResult): SyncResult | null {
  return state.lastCheck === null ? null : state.lastCheck.result;
}
