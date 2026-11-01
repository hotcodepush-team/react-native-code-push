import type { CodegenTypes, TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

// Results and events cross as plain objects. `hot-code-push.ts` types them with `@hotcodepush/protocol`,
// so the shared types stay the one definition.
export interface Spec extends TurboModule {
  applyUpdate(): Promise<CodegenTypes.UnsafeObject>;
  checkForUpdate(): Promise<CodegenTypes.UnsafeObject>;
  clearUpdates(): Promise<void>;
  // Returns the retained `updateRolledBack` event once.
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

// Null in a host without our native module, such as Expo Go. The web resolves NativeHotCodePush.web.ts instead.
export default TurboModuleRegistry.get<Spec>('HotCodePush');
