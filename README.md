# React Native code push by HotCodePush

`@hotcodepush/react-native-code-push` is the React Native module that delivers over-the-air (OTA) updates to your app: a code push reaches installed apps in seconds, without a store review.
Learn more at [hotcodepush.com/react-native-code-push](https://hotcodepush.com/react-native-code-push).

## Installation

`npx hotcodepush init` installs the package and wires it into both native projects.
By hand, until the package is on npm, install the preview build pkg.pr.new publishes for every commit on `main`, pinned to a commit, together with the CLI the native builds call:

```sh
npm install https://pkg.pr.new/hotcodepush-team/react-native-code-push/@hotcodepush/react-native-code-push@<sha>
npm install --save-dev https://pkg.pr.new/hotcodepush-team/cli/hotcodepush@<sha>
```

The module supports React Native 0.82 and later on the New Architecture, iOS 15.1 and Android 7.0 (API 24).
The manual wiring, `HotCodePush.bundleURL()` on iOS, the SDK's `getDefaultReactHost` on Android, the build phase and the Gradle line, is in the [docs](https://hotcodepush.com/docs/sdks/react-native).
The pod carries the iOS core, `HotCodePushCore`, as a prebuilt framework, so the Podfile needs no line for it.

Every native build writes `hotcodepush.json` into the app; an Xcode archive or a Gradle release build also registers the store build in HotCodePush, so it needs `npx hotcodepush login` or `HOTCODEPUSH_TOKEN`.
A debug build loads its JavaScript from Metro, so OTA updates are off there: try an update in a release build.

## Usage

```tsx
import { HotCodePush, useUpdates } from '@hotcodepush/react-native-code-push';

const result = await HotCodePush.sync();
if (result.status === 'downloaded') {
  console.log(
    `release #${result.release.number} applies at ${result.applyStrategy}`,
  );
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

With the default `checkStrategy` of `auto`, the SDK checks on start, on resume and in the foreground; `sync()` runs one cycle on demand.
Applying an update reloads the JavaScript without restarting the app.
Set `downloadStrategy` or `applyStrategy` to `manual` and call `downloadUpdate()` or `applyUpdate()` yourself to control when an update lands.

## Documentation

See [hotcodepush.com/docs/sdks/react-native](https://hotcodepush.com/docs/sdks/react-native) for the configuration, methods, events, types and reasons.

## Development

```sh
nvm use
npm ci
npm run build            # the TypeScript into dist/ and the iOS core into ios/Frameworks; run it before opening the native projects
npm test
npm run lint && npm run typecheck
npm run verify:android   # the Android library's build and Robolectric tests
npm run fmt              # run before every commit
```

The iOS code compiles only inside an app: CI builds the [demo app](https://github.com/hotcodepush-team/react-native-code-push-demo) with the package from the commit.
The cores and their tests live in [core-ios](https://github.com/hotcodepush-team/core-ios) and [core-android](https://github.com/hotcodepush-team/core-android).
`CLAUDE.md` holds the layout and the rules.

## License

See [LICENSE](./LICENSE).
An app that ships the module also ships the native cores' third-party code: FreeBSD's bspatch (BSD 2-clause) on both platforms and bzip2 1.0.8 on Android. Reproduce the notices from [core-ios](https://github.com/hotcodepush-team/core-ios/blob/main/THIRD-PARTY-NOTICES) and [core-android](https://github.com/hotcodepush-team/core-android/blob/main/THIRD-PARTY-NOTICES) in your app's distribution.
