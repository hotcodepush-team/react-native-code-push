# The size and cold-start baseline

What the package adds to an app, measured on the demo app and guarded from then on: the numbers are in `baseline.json`, the method is this page, the harness is the scripts beside it.

## What is measured

| Number                     | How                                                                                                                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Binary size added, Android | the release APK of the demo built with the package minus the same build without it, in bytes                                                                                                   |
| Binary size added, iOS     | the Release simulator `HotCodePushDemo.app` — every file summed — built with the package minus the same build without it, in bytes                                                             |
| Cold start added, Android  | from the activity's start (`ActivityTaskManager: START` in logcat) to the first paint, on the Pixel_9_Pro emulator; the median of five cold launches with the package minus the median without |
| Cold start added, iOS      | from the launch call to the first paint, on an iPhone simulator; the same medians                                                                                                              |

The first paint is the `[baseline] first paint` line both variants log on their first animation frame, at the error level, since an iOS release build drops what the console logs below it; it is read from logcat on Android and from the unified log on iOS.
The first launch after the install is not counted, since the system verifies and compiles the app on it.
A cold start names the package commit it was measured at, `packageCommit`, where the sizes have since been measured on a newer one.
Both numbers come from release builds, since a debug build asks Metro for its JavaScript and the SDK stays off in it.
The "without" variant is the demo with the package and every line `init` wired removed — the build step in Xcode and Gradle, the bundle the two apps ask the SDK for, the pinned pod — and the screen swapped for the same screen with nothing behind it.

The sizes are measured on builds whose build step runs offline, `HOTCODEPUSH_OFFLINE=1`, which the size script sets: `binary create` writes the resource file, creates no binary and asks no account, so the guard in CI holds no credential.
The cold starts are measured on builds made against a stack the CLI is logged in to, since a build without a channel checks for nothing at its start.

## Where the bytes sit

On the current baseline the Android release APK grows by about 760 KB.
About 310 KB of it is `libappmodules.so`, the Turbo Module's generated C++ once for each of the four ABIs the demo ships, of which an app bundle delivers one.
About 180 KB of it is `libhotcodepush_bspatch.so`, the core's native library that applies a delta pack's patches, FreeBSD's bspatch and the decompression of bzip2 1.0.8, once for each of the same four ABIs, of which an app bundle delivers one: 133 KB of files, and the padding that aligns each to a 16 KB page, since the APK stores them uncompressed.
The rest is in the two dex files, the package's JavaScript in the bundle and the resource file.
The package's code and the shared core's sit in `classes.dex`; `classes2.dex` is mostly OkHttp 5 and Okio, which take the place of the OkHttp 4 React Native brings, and is byte for byte what it was before the cores gained bspatch; the core verifies signatures with Android's own API, so no cryptography library ships.
The simulator app grows by about 3.6 MB, nearly all of it in the `HotCodePushDemo` binary: the module and the core are linked statically, and a simulator build is a two-slice fat binary, so a device build carries about half of that; the rest is the core's privacy-manifest bundle, about 12 KB of JavaScript and the resource file.

## Running it

```sh
npm run build && npm pack --pack-destination /tmp
node benchmarks/prepare-demo.mjs ../react-native-code-push-demo /tmp/baseline/with with /tmp/hotcodepush-react-native-code-push-0.0.0.tgz
node benchmarks/prepare-demo.mjs ../react-native-code-push-demo /tmp/baseline/without without
node benchmarks/measure-size.mjs /tmp/baseline/with
node benchmarks/measure-size.mjs /tmp/baseline/without
```

For the cold starts, set `HOTCODEPUSH_TOKEN` and let the "with" variant's `hotcodepush.json` name an app of that account, then:

```sh
node benchmarks/measure-cold-start.mjs /tmp/baseline/with --android emulator-5554 --ios <udid>
node benchmarks/measure-cold-start.mjs /tmp/baseline/without --android emulator-5554 --ios <udid>
```

Start the Android emulator headless, `emulator -avd Pixel_9_Pro -no-window -gpu host`: macOS drops a windowed emulator to background priority within minutes, which inflates the load average and every cold start with it.

The demo is `hotcodepush-team/react-native-code-push-demo` at the commit `baseline.json` names; a new baseline names the commit it was measured against.

## The guard

`baseline.yml` runs on every pull request to `main`: it checks the demo out at the pinned commit, packs the package from the pull request, prepares the "with" variant, rebuilds both sizes and fails when either grew more than 10 % over the committed number; the sizes land in the job summary. Sizes are deterministic on a runner, cold starts are not — an emulator's timing on a shared runner is noise — so the cold-start check runs locally by script, and a change that could move it reruns the script and commits the new numbers with its reason.
`ci.yml` prepares the same variant to compile the native code inside the demo on both platforms.

The same harness later measures the competitors for `/benchmarks`.
