import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The SDK version a device reports is package.json's version, written into each platform's sources by every build and
// never committed, so no release can leave it behind.

const packageDirectory = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(
  readFileSync(join(packageDirectory, 'package.json'), 'utf8'),
);
const header = '// Written from package.json by scripts/write-sdk-version.mjs.';

writeFileSync(
  join(packageDirectory, 'ios/SdkVersion.swift'),
  `${header}\nlet sdkVersion = ${JSON.stringify(version)}\n`,
);
writeFileSync(
  join(
    packageDirectory,
    'android/src/main/java/com/hotcodepush/reactnative/SdkVersion.kt',
  ),
  `${header}\npackage com.hotcodepush.reactnative\n\ninternal const val SDK_VERSION = ${JSON.stringify(version)}\n`,
);
