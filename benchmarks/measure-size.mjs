#!/usr/bin/env node
// Prints as JSON the size in bytes of a prepared demo variant: the release APK and the Release simulator `.app`.
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [target] = process.argv.slice(2);
if (!target) {
  console.error('usage: measure-size.mjs <prepared demo>');
  process.exit(2);
}

// Offline, the build step writes the resource file, creates no binary and needs no account.
const env = { ...process.env, HOTCODEPUSH_OFFLINE: '1' };
const sizes = {};
execFileSync('./gradlew', ['assembleRelease', '--console=plain', '-q'], {
  cwd: join(target, 'android'),
  env,
  stdio: ['ignore', 'ignore', 'inherit'],
});
sizes.android = {
  releaseApkBytes: statSync(
    join(target, 'android/app/build/outputs/apk/release/app-release.apk'),
  ).size,
};
const derivedData = join(target, 'ios/build');
execFileSync(
  'xcodebuild',
  [
    '-workspace',
    join(target, 'ios/HotCodePushDemo.xcworkspace'),
    '-scheme',
    'HotCodePushDemo',
    '-configuration',
    'Release',
    '-sdk',
    'iphonesimulator',
    '-destination',
    'generic/platform=iOS Simulator',
    '-derivedDataPath',
    derivedData,
    'CODE_SIGNING_ALLOWED=NO',
    '-quiet',
    'build',
  ],
  { env, stdio: ['ignore', 'ignore', 'inherit'] },
);
sizes.ios = {
  simulatorAppBytes: directorySize(
    join(
      derivedData,
      'Build/Products/Release-iphonesimulator/HotCodePushDemo.app',
    ),
  ),
};
console.log(JSON.stringify(sizes));

function directorySize(directory) {
  return readdirSync(directory, { withFileTypes: true }).reduce(
    (total, entry) => {
      const path = join(directory, entry.name);
      return (
        total +
        (entry.isDirectory() ? directorySize(path) : statSync(path).size)
      );
    },
    0,
  );
}
