import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const APP_NAME = 'Demo.app';

// The processed Info.plist that Xcode leaves in the app, which beforeEach converts to the binary format. The values are made up.
const PROCESSED_INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleShortVersionString</key>
  <string>2.4.1</string>
  <key>CFBundleVersion</key>
  <string>57</string>
</dict>
</plist>
`;

// Stands in for the npx beside Node and records the arguments, one per line, instead of running the CLI.
const RECORDING_NPX =
  '#!/bin/sh\nprintf "%s\\n" "$@" > "$(dirname "$0")/arguments"\n';

const SCRIPT_PATH = join(import.meta.dirname, 'binary-create-xcode.sh');

// Xcode and PlistBuddy run only on macOS.
describe.skipIf(process.platform !== 'darwin')('binary-create-xcode.sh', () => {
  let appPath: string;
  let buildDirectoryPath: string;

  beforeEach(() => {
    buildDirectoryPath = mkdtempSync(join(tmpdir(), 'binary-create-xcode-'));
    appPath = join(buildDirectoryPath, APP_NAME);
    mkdirSync(appPath);
    writeFileSync(join(appPath, 'Info.plist'), PROCESSED_INFO_PLIST);
    execFileSync('plutil', [
      '-convert',
      'binary1',
      join(appPath, 'Info.plist'),
    ]);
    writeFileSync(join(appPath, 'main.jsbundle'), '');
    mkdirSync(join(buildDirectoryPath, 'bin'));
    writeFileSync(join(buildDirectoryPath, 'bin', 'npx'), RECORDING_NPX, {
      mode: 0o755,
    });
  });

  afterEach(() => {
    rmSync(buildDirectoryPath, { force: true, recursive: true });
  });

  it('should run binary create when the build is an archive', () => {
    expect(
      runScript({ CONFIGURATION: 'Release', DEPLOYMENT_POSTPROCESSING: 'YES' }),
    ).toEqual([
      'hotcodepush',
      'binary',
      'create',
      '--binary-version',
      '2.4.1',
      '--binary-build',
      '57',
      '--platform',
      'ios',
      '--embedded-bundle-path',
      appPath,
      '--resource-file-path',
      join(appPath, 'hotcodepush.json'),
    ]);
  });

  it('should run resource-file write when the build is not an archive', () => {
    expect(
      runScript({ CONFIGURATION: 'Release', DEPLOYMENT_POSTPROCESSING: 'NO' }),
    ).toEqual([
      'hotcodepush',
      'resource-file',
      'write',
      '--platform',
      'ios',
      '--embedded-bundle-path',
      appPath,
      '--resource-file-path',
      join(appPath, 'hotcodepush.json'),
    ]);
  });

  it('should pass the version and build of the processed Info.plist, which the device reports, when the build is an archive', () => {
    const args = runScript({
      CONFIGURATION: 'Release',
      DEPLOYMENT_POSTPROCESSING: 'YES',
    });

    expect(readOption(args, '--binary-version')).toBe('2.4.1');
    expect(readOption(args, '--binary-build')).toBe('57');
  });

  it('should pass a directory without the bundle when the configuration is Debug on a device', () => {
    const embeddedAssetsPath = readOption(
      runScript({ CONFIGURATION: 'Debug', PLATFORM_NAME: 'iphoneos' }),
      '--embedded-bundle-path',
    );

    expect(embeddedAssetsPath).not.toBe(appPath);
    expect(readdirSync(embeddedAssetsPath)).toEqual([]);
  });

  it('should pass a directory without the bundle when the configuration is Debug on a simulator', () => {
    const embeddedAssetsPath = readOption(
      runScript({ CONFIGURATION: 'Debug', PLATFORM_NAME: 'iphonesimulator' }),
      '--embedded-bundle-path',
    );

    expect(embeddedAssetsPath).not.toBe(appPath);
    expect(readdirSync(embeddedAssetsPath)).toEqual([]);
  });

  function readOption(args: string[], flag: string): string {
    const value = args[args.indexOf(flag) + 1];
    if (value === undefined) {
      throw new Error(`the CLI was run without ${flag}`);
    }
    return value;
  }

  // Uses the build settings Xcode gives an app target phase in a plain build, including the template version settings.
  function runScript(buildSettings: Record<string, string>): string[] {
    execFileSync('/bin/sh', [SCRIPT_PATH], {
      env: {
        CONFIGURATION_BUILD_DIR: buildDirectoryPath,
        CURRENT_PROJECT_VERSION: '1',
        DEPLOYMENT_POSTPROCESSING: 'NO',
        DERIVED_FILE_DIR: join(buildDirectoryPath, 'DerivedSources'),
        INFOPLIST_PATH: join(APP_NAME, 'Info.plist'),
        MARKETING_VERSION: '1.0',
        NODE_BINARY: join(buildDirectoryPath, 'bin', 'node'),
        PATH: '/usr/bin:/bin',
        PLATFORM_NAME: 'iphoneos',
        PROJECT_ROOT: buildDirectoryPath,
        TARGET_BUILD_DIR: buildDirectoryPath,
        UNLOCALIZED_RESOURCES_FOLDER_PATH: APP_NAME,
        ...buildSettings,
      },
    });
    return readFileSync(join(buildDirectoryPath, 'bin', 'arguments'), 'utf8')
      .trimEnd()
      .split('\n');
  }
});
