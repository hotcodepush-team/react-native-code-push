# The size and cold-start baseline

What the package adds to an app, measured on the demo app and guarded from then on: the numbers are in `baseline.json`, the method is this page, the harness is the scripts beside it.

## What is measured

| Number                     | How                                                                                                                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Binary size added, Android | the release APK of the demo built with the package minus the same build without it, in bytes                                                                                                   |
| Binary size added, iOS     | the Release simulator `HotCodePushDemo.app` — every file summed — built with the package minus the same build without it, in bytes                                                             |
| Cold start added, Android  | from the activity's start (`ActivityTaskManager: START` in logcat) to the first paint, on the Pixel_9_Pro emulator; the median of five cold launches with the package minus the median without |
| Cold start added, iOS      | from the launch call to the first paint, on an iPhone simulator; the same medians                                                                                                              |

The first paint is the `[baseline] first paint` line both variants log on their first animation frame, read from the JavaScript console: logcat on Android, the unified log on iOS.
Both numbers come from release builds, since a debug build asks Metro for its JavaScript and the SDK stays off in it.
The "without" variant is the demo with the package and every line `init` wired removed — the build step in Xcode and Gradle, the bundle the two apps ask the SDK for, the pinned pod — and the screen swapped for the same screen with nothing behind it.

The sizes are measured with the build step unwired in the "with" variant too, `--no-binary-create`: the step needs a login, the resource file it writes weighs a few kilobytes against a binary of tens of megabytes, and the guard in CI holds no credential.
The cold starts are measured with the build step in place, against a stack the CLI is logged in to, since an app without its resource file starts no SDK.

## Where the bytes sit

On the current baseline the Android release APK grows by about 578 KB.
About 310 KB of it is `libappmodules.so`, the Turbo Module's generated C++ once for each of the four ABIs the demo ships, of which an app bundle delivers one; about 270 KB is `classes2.dex`, the package's code and the shared core's, with OkHttp 5 and Okio in place of the OkHttp 4 React Native brings; the rest is the package's JavaScript in the bundle.
The simulator app grows by about 3.6 MB, nearly all of it in the `HotCodePushDemo` binary: the module and the core are linked statically, and a simulator build is a two-slice fat binary, so a device build carries about half of that; the rest is the core's privacy-manifest bundle and about 12 KB of JavaScript.

## Running it

```sh
npm run build && npm pack --pack-destination /tmp
node benchmarks/prepare-demo.mjs ../react-native-code-push-demo /tmp/baseline/with with /tmp/hotcodepush-react-native-code-push-0.0.0.tgz --no-binary-create
node benchmarks/prepare-demo.mjs ../react-native-code-push-demo /tmp/baseline/without without
node benchmarks/measure-size.mjs /tmp/baseline/with
node benchmarks/measure-size.mjs /tmp/baseline/without
```

For the cold starts, prepare the "with" variant again without `--no-binary-create`, with `HOTCODEPUSH_TOKEN` set and `hotcodepush.json` naming an app of that account, then:

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
