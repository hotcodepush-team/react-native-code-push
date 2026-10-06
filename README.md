# React Native code push by HotCodePush

`@hotcodepush/react-native-code-push` is the React Native module that delivers over-the-air updates to your app: a code push reaches installed apps in seconds, without a store review. Learn more at [hotcodepush.com/react-native-code-push](https://hotcodepush.com/react-native-code-push).

## Installation

`npx hotcodepush init` installs the package and wires it into both native projects. By hand, until the package is published, install the preview build pkg.pr.new publishes for every commit on `main`, pinned to a commit, together with the CLI the native builds call:

```sh
npm install https://pkg.pr.new/hotcodepush-team/react-native-code-push/@hotcodepush/react-native-code-push@<sha>
npm install --save-dev https://pkg.pr.new/hotcodepush-team/cli/hotcodepush@<sha>
```

The module supports React Native 0.82 and later on the New Architecture, iOS 15.1 and Android 7.0 (API 24).

React Native runs the bundle its host hands it, so each app asks the SDK for it. On iOS, `AppDelegate.swift` returns `HotCodePush.bundleURL()` where it returned the embedded `main.jsbundle`:

```swift
import HotcodepushReactNativeCodePush

override func bundleURL() -> URL? {
#if DEBUG
  RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
  HotCodePush.bundleURL()
#endif
}
```

On Android, `MainApplication.kt` imports the SDK's `getDefaultReactHost` in place of React Native's; it takes the same parameters:

```kotlin
import com.hotcodepush.reactnative.HotCodePushReactHost.getDefaultReactHost
```

The SDK reads `hotcodepush.json` from the app's resources, which the build step, the CLI's `binary create`, writes on every native build that bundles the JavaScript. On iOS it is a Run Script phase after "Bundle React Native code and images":

```sh
set -e

WITH_ENVIRONMENT="$REACT_NATIVE_PATH/scripts/xcode/with-environment.sh"
HOTCODEPUSH_BINARY_CREATE="$REACT_NATIVE_PATH/../@hotcodepush/react-native-code-push/scripts/binary-create-xcode.sh"

/bin/sh -c "$WITH_ENVIRONMENT $HOTCODEPUSH_BINARY_CREATE"
```

On Android it is one line at the end of `android/app/build.gradle`:

```groovy
apply from: new File(["node", "--print", "require.resolve('@hotcodepush/react-native-code-push/package.json')"].execute(null, rootDir).text.trim(), "../android/hotcodepush.gradle")
```

The native cores are the pod `HotCodePushCore` and the Android library `com.hotcodepush:core-android`, each pinned to a commit until it is published. The Podfile pins the commit this package names under `hotcodepush.coreIos` in its `package.json`, inside the app target, then `pod install`:

```ruby
pod 'HotCodePushCore', :git => 'https://github.com/hotcodepush-team/core-ios.git', :commit => '<sha>'
```

On Android the Gradle file above adds JitPack, which builds the pinned commit, to the app's repositories.

A debug build asks Metro for its JavaScript, so live updates are off there and every result says `SKIPPED` with `DEBUG_BUILD`; a debug build on the simulator bundles nothing and carries no `hotcodepush.json` at all. Try an update in a release build.

## Usage

```tsx
import { HotCodePush, useUpdates } from '@hotcodepush/react-native-code-push';

const result = await HotCodePush.sync();
if (result.status === 'UPDATED') {
  console.log(`release #${result.release.number} installs ${result.installAt}`);
}

function ReleaseLabel() {
  const { isSyncing, state } = useUpdates();
  return (
    <Text>
      {isSyncing
        ? 'syncing…'
        : (state.currentRelease?.bundleVersion ?? 'embedded')}
    </Text>
  );
}
```

With `autoCheck` on, the default, the SDK checks on start, on resume and while the app stays in the foreground, and what follows a check is the download and install strategies' business; `sync()` is for the moment you want an update now. Applying an update reloads the JavaScript without restarting the app. An app that asks before downloading sets `downloadStrategy` to `manual` and calls `downloadUpdate()` on `updateAvailable`; one that protects a flow sets `installStrategy` to `manual` and calls `applyUpdate()` when it is ready.

## Documentation

The SDK reference — configuration, methods, events, types and reasons — is at [hotcodepush.com/docs/react-native](https://hotcodepush.com/docs/react-native).

## Development

```sh
nvm use
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

The native code compiles inside an app: `ci.yml` builds the [demo app](https://github.com/hotcodepush-team/react-native-code-push-demo) with the package from the commit on both platforms. The cores and their tests live in [core-ios](https://github.com/hotcodepush-team/core-ios) and [core-android](https://github.com/hotcodepush-team/core-android).

## License

See [LICENSE](./LICENSE). An app that ships the package ships the native cores' third-party code with it: FreeBSD's bspatch under the BSD 2-clause licence on both platforms and, on Android, the decompression of bzip2 1.0.8 under the bzip2 licence. The cores' `THIRD-PARTY-NOTICES`, in [core-ios](https://github.com/hotcodepush-team/core-ios/blob/main/THIRD-PARTY-NOTICES) and in [core-android](https://github.com/hotcodepush-team/core-android/blob/main/THIRD-PARTY-NOTICES), carry the notices, and an app's distribution reproduces them: the BSD 2-clause licence requires it of a binary, the bzip2 licence appreciates the acknowledgment.
