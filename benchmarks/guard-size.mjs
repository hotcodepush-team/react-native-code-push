#!/usr/bin/env node
// Compares a fresh "with" measurement against the committed baseline and fails above the tolerance;
// prints the table the job summary shows.
import { readFileSync } from 'node:fs';

const [baselinePath, measuredPath] = process.argv.slice(2);
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const measured = JSON.parse(readFileSync(measuredPath, 'utf8'));
const tolerance = 0.1;

const rows = [
  [
    'Android release APK',
    baseline.android.releaseApkBytes.with,
    measured.android.releaseApkBytes,
  ],
  [
    'iOS simulator app',
    baseline.ios.simulatorAppBytes.with,
    measured.ios.simulatorAppBytes,
  ],
];
let failed = false;
console.log('| Binary | Baseline | Now | Change |');
console.log('|---|---|---|---|');
for (const [name, before, now] of rows) {
  const change = (now - before) / before;
  const grew = change > tolerance;
  failed ||= grew;
  console.log(
    `| ${name} | ${before} | ${now} | ${(change * 100).toFixed(1)} %${grew ? ' — over the 10 % tolerance' : ''} |`,
  );
}
if (failed) {
  console.error(
    'A binary grew more than 10 % over the baseline; rerun the measurement and commit the new baseline with the reason, or shrink the change.',
  );
  process.exit(1);
}
