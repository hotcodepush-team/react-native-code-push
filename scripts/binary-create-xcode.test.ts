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

// The plist Xcode's Info.plist processing leaves in the app, converted to the binary format it writes; the values are invented.
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

// npx as the script finds it beside Node: it records the arguments, one per line, instead of running the CLI.
const RECORDING_NPX =
  '#!/bin/sh\nprintf "%s\\n" "$@" > "$(dirname "$0")/arguments"\n';

const SCRIPT_PATH = join(import.meta.dirname, 'binary-create-xcode.sh');

// The script runs inside Xcode, which runs on macOS alone, as does PlistBuddy.
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

  it('should pass the version and build of the processed Info.plist, which the device reports', () => {
    expect(runScript({ CONFIGURATION: 'Release' })).toEqual([
      'hotcodepush',
      'binary',
      'create',
      '--platform',
      'ios',
      '--path',
      appPath,
      '--binary-version',
      '2.4.1',
      '--binary-build',
      '57',
      '--out',
      join(appPath, 'hotcodepush.json'),
    ]);
  });

  it('should pass a directory without the bundle when the configuration is Debug on a device', () => {
    const embeddedAssetsPath = readOption(
      runScript({ CONFIGURATION: 'Debug', PLATFORM_NAME: 'iphoneos' }),
      '--path',
    );

    expect(embeddedAssetsPath).not.toBe(appPath);
    expect(readdirSync(embeddedAssetsPath)).toEqual([]);
  });

  it('should pass a directory without the bundle when the configuration is Debug on a simulator', () => {
    const embeddedAssetsPath = readOption(
      runScript({ CONFIGURATION: 'Debug', PLATFORM_NAME: 'iphonesimulator' }),
      '--path',
    );

    expect(embeddedAssetsPath).not.toBe(appPath);
    expect(readdirSync(embeddedAssetsPath)).toEqual([]);
  });

  function readOption(args: string[], flag: string): string {
    const value = args[args.indexOf(flag) + 1];
    if (value === undefined) {
      throw new Error(`binary create was run without ${flag}`);
    }
    return value;
  }

  /**
   * Runs the script with the build settings Xcode gives a phase of the app target, the template's version settings
   * among them, and returns the arguments it ran binary create with.
   */
  function runScript(buildSettings: Record<string, string>): string[] {
    execFileSync('/bin/sh', [SCRIPT_PATH], {
      env: {
        CONFIGURATION_BUILD_DIR: buildDirectoryPath,
        CURRENT_PROJECT_VERSION: '1',
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
