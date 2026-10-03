import type { RolledBackEvent } from '@hotcodepush/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type NativeModule from './NativeHotCodePush';
import type * as Sdk from './hot-code-push';

vi.mock('./NativeHotCodePush', () => ({
  default: {
    consumeRolledBack: vi.fn(),
    onUpdateAvailable: vi.fn(),
    rollback: vi.fn(),
    setChannel: vi.fn(),
    sync: vi.fn(),
  },
}));

const ROLLED_BACK_EVENT: RolledBackEvent = {
  from: {
    bundleId: '0f8fad5b-d9cb-469f-a165-70867728950e',
    bundleVersion: '1.4.2',
    id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    isMandatory: false,
    number: 43,
  },
  reason: 'READY_TIMEOUT',
  to: null,
};

describe('HotCodePush', () => {
  let HotCodePush: typeof Sdk.HotCodePush;
  let NativeHotCodePush: typeof NativeModule;
  let subscribeToRunningCycles: typeof Sdk.subscribeToRunningCycles;

  // A test is a start of the app: the module is loaded anew, as a JavaScript instance loads it.
  beforeEach(async () => {
    vi.resetModules();
    NativeHotCodePush = (await import('./NativeHotCodePush')).default;
    ({ HotCodePush, subscribeToRunningCycles } =
      await import('./hot-code-push'));
  });

  describe('addListener', () => {
    it('should hand the rolledBack event the native side kept to the listener', async () => {
      vi.mocked(NativeHotCodePush.consumeRolledBack).mockResolvedValue({
        event: ROLLED_BACK_EVENT,
      });
      const listener = vi.fn();

      await HotCodePush.addListener('rolledBack', listener);
      await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));

      expect(listener).toHaveBeenCalledWith(ROLLED_BACK_EVENT);
    });

    it('should hand the rolledBack event to every listener when several listen', async () => {
      vi.mocked(NativeHotCodePush.consumeRolledBack)
        .mockResolvedValueOnce({ event: ROLLED_BACK_EVENT })
        .mockResolvedValue({ event: null });
      const firstListener = vi.fn();
      const secondListener = vi.fn();

      await HotCodePush.addListener('rolledBack', firstListener);
      await HotCodePush.addListener('rolledBack', secondListener);
      await Promise.resolve();

      expect(firstListener).toHaveBeenCalledWith(ROLLED_BACK_EVENT);
      expect(secondListener).toHaveBeenCalledWith(ROLLED_BACK_EVENT);
    });

    it('should call no rolledBack listener when the native side kept no event', async () => {
      vi.mocked(NativeHotCodePush.consumeRolledBack).mockResolvedValue({
        event: null,
      });
      const listener = vi.fn();

      await HotCodePush.addListener('rolledBack', listener);
      await Promise.resolve();

      expect(listener).not.toHaveBeenCalled();
    });

    it('should call no rolledBack listener when it was removed before the event arrived', async () => {
      let resolveConsume: (result: object) => void = () => undefined;
      vi.mocked(NativeHotCodePush.consumeRolledBack).mockReturnValue(
        new Promise(resolve => {
          resolveConsume = resolve;
        }),
      );
      const listener = vi.fn();

      const handle = await HotCodePush.addListener('rolledBack', listener);
      await handle.remove();
      resolveConsume({ event: ROLLED_BACK_EVENT });
      await Promise.resolve();

      expect(listener).not.toHaveBeenCalled();
    });

    it('should subscribe to the native event and remove the subscription with the handle', async () => {
      const subscription = { remove: vi.fn() };
      vi.mocked(NativeHotCodePush.onUpdateAvailable).mockReturnValue(
        subscription as unknown as ReturnType<
          typeof NativeHotCodePush.onUpdateAvailable
        >,
      );
      const listener = vi.fn();

      const handle = await HotCodePush.addListener('updateAvailable', listener);
      await handle.remove();

      expect(NativeHotCodePush.onUpdateAvailable).toHaveBeenCalledWith(
        listener,
      );
      expect(subscription.remove).toHaveBeenCalledTimes(1);
    });
  });

  describe('sync', () => {
    it('should count the cycle as running until its result arrives', async () => {
      let resolveSync: (result: object) => void = () => undefined;
      vi.mocked(NativeHotCodePush.sync).mockReturnValue(
        new Promise(resolve => {
          resolveSync = resolve;
        }),
      );
      const counts: number[] = [];
      const unsubscribe = subscribeToRunningCycles(count => counts.push(count));

      const syncing = HotCodePush.sync();
      resolveSync({ release: null, status: 'UP_TO_DATE' });
      await syncing;
      unsubscribe();

      expect(counts).toEqual([0, 1, 0]);
    });

    it('should count the cycle as ended when it rejects', async () => {
      vi.mocked(NativeHotCodePush.sync).mockRejectedValue(
        new Error('HotCodePush is not configured'),
      );
      const counts: number[] = [];
      const unsubscribe = subscribeToRunningCycles(count => counts.push(count));

      await expect(HotCodePush.sync()).rejects.toThrow('not configured');
      unsubscribe();

      expect(counts).toEqual([0, 1, 0]);
    });

    it('should pass an empty object when called without options', async () => {
      vi.mocked(NativeHotCodePush.sync).mockResolvedValue({
        release: null,
        status: 'UP_TO_DATE',
      });

      await HotCodePush.sync();

      expect(NativeHotCodePush.sync).toHaveBeenCalledWith({});
    });
  });

  describe('setChannel', () => {
    it('should pass an empty object when the runtime choice is cleared', async () => {
      await HotCodePush.setChannel(null);

      expect(NativeHotCodePush.setChannel).toHaveBeenCalledWith({});
    });
  });
});
