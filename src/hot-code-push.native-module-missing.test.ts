import { describe, expect, it, vi } from 'vitest';
import { HotCodePush } from './hot-code-push';

// Expo Go carries no native module of ours: React Native's registry answers the module's name with null
vi.mock('react-native', () => ({
  TurboModuleRegistry: { get: () => null },
}));

describe('HotCodePush', () => {
  it.each(Object.keys(HotCodePush) as (keyof typeof HotCodePush)[])(
    'should reject %s with the build live updates need when the native module is missing',
    async methodName => {
      const method = HotCodePush[methodName] as () => Promise<unknown>;

      await expect(method()).rejects.toThrow(
        'Live updates need a development or release build; they are not available on the web or in Expo Go.',
      );
    },
  );
});
