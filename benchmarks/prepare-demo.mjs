#!/usr/bin/env node
// Copies the demo app into a scratch directory as one of the two variants the baseline compares:
// `with` installs the package tarball, `without` removes the package and every line `init` wired
// and swaps the screen for the same screen with nothing behind it. Both log the first paint.
// `--no-embed` unwires the embed step of the `with` variant, so its release build needs no login:
// the resource file it would write weighs nothing against the binary, and the sizes are measured without it.
import { execFileSync } from 'node:child_process';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [source, target, variant, ...rest] = process.argv.slice(2);
const tarball = rest.find(argument => !argument.startsWith('--'));
const isEmbedUnwired = variant === 'without' || rest.includes('--no-embed');
if (
  !source ||
  !target ||
  !['with', 'without'].includes(variant) ||
  (variant === 'with' && !tarball)
) {
  console.error(
    'usage: prepare-demo.mjs <demo> <target> with <package.tgz> [--no-embed] | without',
  );
  process.exit(2);
}

const PACKAGE_NAME = '@hotcodepush/react-native-code-push';
const excluded = new Set([
  '.git',
  '.gradle',
  'DerivedData',
  'Pods',
  'build',
  'node_modules',
]);
rmSync(target, { recursive: true, force: true });
cpSync(source, target, {
  recursive: true,
  filter: path => !excluded.has(path.split('/').pop()),
});

const firstPaintMarker =
  "requestAnimationFrame(() => console.log('[baseline] first paint'));";
if (isEmbedUnwired) {
  editFile('android/app/build.gradle', text =>
    removeLines(text, 'hotcodepush.gradle'),
  );
  editFile('ios/HotCodePushDemo.xcodeproj/project.pbxproj', removeEmbedPhase);
}
if (variant === 'with') {
  editFile('App.tsx', text =>
    text.replace(
      '  useEffect(() => {\n',
      `  useEffect(() => {\n    ${firstPaintMarker}\n`,
    ),
  );
  run('npm', ['install', tarball, '--no-audit', '--no-fund']);
} else {
  run('npm', ['uninstall', PACKAGE_NAME, '--no-audit', '--no-fund']);
  editFile('ios/HotCodePushDemo/AppDelegate.swift', text =>
    removeLines(text, 'import HotcodepushReactNativeCodePush').replace(
      'HotCodePush.bundleURL()',
      'Bundle.main.url(forResource: "main", withExtension: "jsbundle")',
    ),
  );
  editFile(
    'android/app/src/main/java/com/hotcodepush/demo/reactnative/MainApplication.kt',
    text =>
      text.replace(
        'com.hotcodepush.reactnative.HotCodePushReactHost.getDefaultReactHost',
        'com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost',
      ),
  );
  editFile('ios/Podfile', text =>
    removeLines(text, "pod 'HotCodePushProtocol'"),
  );
  writeFileSync(
    join(target, 'App.tsx'),
    `// The demo without the package: the same screen, nothing behind it — the baseline's control.
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

const VERSION = 'v1';

export default function App() {
  useEffect(() => {
    ${firstPaintMarker}
  }, []);

  return (
    <View style={styles.screen}>
      <Text style={styles.eyebrow}>Bundle version</Text>
      <Text style={styles.version}>{VERSION}</Text>
      <Row label="Current release" value="embedded" />
      <Row label="Device id" value="none" />
      <Row label="Last sync" value="none yet" />
      <Row label="Last rollback" value="none" />
      <Pressable accessibilityRole="button" style={styles.button}>
        <Text style={styles.buttonText}>Sync now</Text>
      </Pressable>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    backgroundColor: '#f2572b',
    borderRadius: 12,
    marginTop: 32,
    paddingVertical: 16,
  },
  buttonText: { color: '#ffffff', fontSize: 17, fontWeight: '600' },
  eyebrow: {
    color: '#6b6f76',
    fontSize: 13,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  label: { color: '#6b6f76', fontSize: 13 },
  row: {
    borderBottomColor: '#e6e7ea',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 14,
  },
  screen: {
    backgroundColor: '#ffffff',
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 96,
  },
  value: { color: '#111318', fontSize: 17, marginTop: 4 },
  version: {
    color: '#111318',
    fontSize: 64,
    fontWeight: '700',
    marginBottom: 24,
  },
});
`,
  );
}
run('npm', ['install', '--no-audit', '--no-fund']);
if (process.platform === 'darwin') {
  run('pod', ['install'], join(target, 'ios'));
}
console.log(`${variant}: ${target}`);

function editFile(relativePath, edit) {
  const filePath = join(target, relativePath);
  writeFileSync(filePath, edit(readFileSync(filePath, 'utf8')));
}

function removeLines(text, needle) {
  return text
    .split('\n')
    .filter(line => !line.includes(needle))
    .join('\n');
}

// The phase `init` added, out of the project again: its entry in the target's phases and its own object.
function removeEmbedPhase(project) {
  return removeLines(
    project.replace(
      /\t\t[0-9A-F]{24} \/\* Embed HotCodePush \*\/ = \{[\s\S]*?\n\t\t\};\n/,
      '',
    ),
    '/* Embed HotCodePush */,',
  );
}

function run(command, args, cwd = target) {
  execFileSync(command, args, {
    cwd,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}
