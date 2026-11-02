import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Gradle cannot check a release asset's checksum before it resolves the core from it.
// So every build fetches the release asset that package.json pins under hotcodepush.coreAndroid, checks its checksum and unpacks it into the ignored local Maven repository that android/build.gradle and android/hotcodepush.gradle name.

const packageDirectory = join(dirname(fileURLToPath(import.meta.url)), '..');
const libsDirectory = join(packageDirectory, 'android/libs');
const mavenDirectory = join(libsDirectory, 'm2');
const checksumFile = join(libsDirectory, 'core-android.checksum');

const { version, checksum } =
  JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8'))
    .hotcodepush?.coreAndroid ?? {};
if (!version || !/^[0-9a-f]{64}$/.test(checksum ?? '')) {
  throw new Error(
    'package.json names no hotcodepush.coreAndroid with a version and a checksum',
  );
}

const [, gradleVersion] =
  readFileSync(join(packageDirectory, 'android/build.gradle'), 'utf8').match(
    /'com\.hotcodepush:core-android:([^']+)'/,
  ) ?? [];
if (gradleVersion !== version) {
  throw new Error(
    `android/build.gradle names core-android ${gradleVersion}, package.json pins ${version}`,
  );
}

if (
  existsSync(checksumFile) &&
  readFileSync(checksumFile, 'utf8') === checksum
) {
  process.exit(0);
}

const url = `https://github.com/hotcodepush-team/core-android/releases/download/${version}/core-android-${version}-maven.zip`;
const response = await fetch(url);
if (!response.ok) {
  throw new Error(`${url} answered ${response.status}`);
}
const archive = Buffer.from(await response.arrayBuffer());
const actualChecksum = createHash('sha256').update(archive).digest('hex');
if (actualChecksum !== checksum) {
  throw new Error(
    `${url} has the checksum ${actualChecksum}, package.json pins ${checksum}`,
  );
}

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'core-android-'));
try {
  const archiveFile = join(temporaryDirectory, 'core-android.zip');
  writeFileSync(archiveFile, archive);
  rmSync(libsDirectory, { recursive: true, force: true });
  mkdirSync(mavenDirectory, { recursive: true });
  execFileSync('unzip', ['-q', archiveFile, '-d', mavenDirectory]);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
writeFileSync(checksumFile, checksum);
