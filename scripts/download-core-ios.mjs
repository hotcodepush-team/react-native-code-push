import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// A podspec cannot download the core XCFramework the pod vendors, so every build fetches the release asset
// pinned under hotcodepush.coreIos in package.json, checks its checksum and unpacks it into the ignored ios/Frameworks.

const packageDirectory = join(dirname(fileURLToPath(import.meta.url)), '..');
const frameworksDirectory = join(packageDirectory, 'ios/Frameworks');
const checksumFile = join(frameworksDirectory, 'HotCodePushCore.checksum');

const { url, checksum } =
  JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8'))
    .hotcodepush?.coreIos ?? {};
if (!url || !/^[0-9a-f]{64}$/.test(checksum ?? '')) {
  throw new Error(
    'package.json names no hotcodepush.coreIos with a url and a checksum',
  );
}

if (
  existsSync(checksumFile) &&
  readFileSync(checksumFile, 'utf8') === checksum
) {
  process.exit(0);
}

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

const archiveFile = join(tmpdir(), `HotCodePushCore-${checksum}.zip`);
writeFileSync(archiveFile, archive);
rmSync(frameworksDirectory, { recursive: true, force: true });
mkdirSync(frameworksDirectory, { recursive: true });
execFileSync('unzip', ['-q', archiveFile, '-d', frameworksDirectory]);
rmSync(archiveFile);
writeFileSync(checksumFile, checksum);
