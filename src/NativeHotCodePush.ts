import type { CodegenTypes, TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * The Turbo Module as Codegen reads it. Every result and every event crosses as a plain object and is typed
 * one layer up by `@hotcodepush/protocol`, so the shared types stay the one definition of the results and events.
 */
export interface Spec extends TurboModule {
  applyUpdate(): Promise<CodegenTypes.UnsafeObject>;
  checkForUpdate(): Promise<CodegenTypes.UnsafeObject>;
  clearUpdates(): Promise<void>;
  /** The `updateRolledBack` event the native side kept for the start that follows the rollback, handed out once. */
  consumeUpdateRolledBack(): Promise<CodegenTypes.UnsafeObject>;
  downloadUpdate(
    options: CodegenTypes.UnsafeObject,
  ): Promise<CodegenTypes.UnsafeObject>;
  getChannel(): Promise<CodegenTypes.UnsafeObject>;
  getDevice(): Promise<CodegenTypes.UnsafeObject>;
  getState(): Promise<CodegenTypes.UnsafeObject>;
  notifyReady(): Promise<CodegenTypes.UnsafeObject>;
  rollbackUpdate(options: CodegenTypes.UnsafeObject): Promise<void>;
  setAttributes(options: CodegenTypes.UnsafeObject): Promise<void>;
  setChannel(options: CodegenTypes.UnsafeObject): Promise<void>;
  setRestartAllowed(options: CodegenTypes.UnsafeObject): Promise<void>;
  showDebugScreen(): Promise<void>;
  sync(options: CodegenTypes.UnsafeObject): Promise<CodegenTypes.UnsafeObject>;

  readonly onDownloadProgress: CodegenTypes.EventEmitter<CodegenTypes.UnsafeObject>;
  readonly onUpdateAvailable: CodegenTypes.EventEmitter<CodegenTypes.UnsafeObject>;
  readonly onUpdateDownloaded: CodegenTypes.EventEmitter<CodegenTypes.UnsafeObject>;
  readonly onUpdateFailed: CodegenTypes.EventEmitter<CodegenTypes.UnsafeObject>;
}

// null in a host that carries no native module of ours, Expo Go; the web resolves NativeHotCodePush.web.ts
export default TurboModuleRegistry.get<Spec>('HotCodePush');
