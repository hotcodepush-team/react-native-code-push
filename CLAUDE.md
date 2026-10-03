# CLAUDE.md

The HotCodePush React Native SDK: `@hotcodepush/react-native-code-push`, the Turbo Module that delivers live updates to React Native apps on iOS and Android.
Stack: TypeScript for the JavaScript surface and the Codegen spec, Swift and Objective-C++ on iOS, Kotlin on Android, React Native 0.82 and newer on the New Architecture only.

The plan is the private `handbook` repo, checked out beside this one: `../handbook/docs/`.
`sdk-api.md` is the SDK's specification — the methods, the configuration, the state keys, the wire shapes and the reason catalog; `architecture.md`'s _The device protocol_ and _Packs_ are the behaviour behind them.
When code and plan disagree, stop and surface it; never improvise.

## Layout

```
src/                                               NativeHotCodePush.ts (the Codegen spec), hot-code-push.ts (the API object), use-updates.ts (the hook), definitions.ts
ios/                                               the Turbo Module (Objective-C++), the runtime and the bundle loader (Swift) over HotCodePushProtocol
android/src/main/java/com/hotcodepush/reactnative  the Turbo Module, the runtime, the bundle loader and the React host over com.hotcodepush:protocol-android
android/hotcodepush.gradle                         the embed task the app's build.gradle applies
scripts/embed-xcode.sh                             the embed step the app's Xcode phase runs
benchmarks/                                        the size and cold-start baseline, measured on the demo
```

The native cores live in `protocol-ios` and `protocol-android`, consumed at pinned commits: the pod through the app's Podfile by `:git` and `:commit`, the commit named in `package.json` under `hotcodepush.protocolIos`, and the Android library through JitPack by commit in `android/build.gradle`; a core change lands there first and arrives here as a bump of both pins.
This package keeps what is React Native's: which bundle the host loads, the reload, the readiness signal and the bridge. Nothing of the protocol lives here.

## How the SDK meets React Native

- **The host asks for its bundle.** React Native fixes the JavaScript it loads when its host is created, so the app hands that question to the SDK: `HotCodePush.bundleURL()` in `AppDelegate.swift`, `HotCodePushReactHost.getDefaultReactHost` in `MainApplication.kt`. Both are asked again on every reload.
- **The core starts on that first question**, and the host waits for it: the start's verdict — the pending switch, the rollback of a release that never became ready — is in before any JavaScript runs, so a start never loads one bundle and reloads into another.
- **A host that never asked** runs JavaScript the SDK does not serve — Metro in a debug build, or an app that is not wired. The core then runs with `enabledInDebugBuilds` off, and every result is `SKIPPED` with `DEBUG_BUILD`.
- **A switch is a reload of the host**, `RCTTriggerReloadCommandListeners` and `ReactHost.reload`: the JavaScript restarts, the process stays.
- **Readiness is the first frame after the root view renders**, observed natively: `RCTContentDidAppearNotification` on iOS, the `CONTENT_APPEARED` marker on Android. A bundle whose root renders nothing never becomes ready.
- **A bundle is laid out as React Native's own build lays it out**: `main.jsbundle` with `assets/` on iOS, `index.android.bundle` with its `drawable-*` directories on Android, under the store's `served/<bundleId>`.
- **`rolledBack` is kept natively** until the JavaScript of the start that follows the rollback listens; the other four events go to whichever module instance is alive.
- **Android's React host** mirrors `DefaultReactHost.getDefaultReactHost` with one difference, a delegate whose bundle loader is resolved per instance; it uses the same unstable React Native API that function uses, so a React Native upgrade is checked against it.

## Commands

| Command             | Does                           |
| ------------------- | ------------------------------ |
| `npm run lint`      | ESLint, Prettier and SwiftLint |
| `npm run typecheck` | TypeScript                     |
| `npm test`          | Vitest over the JavaScript     |
| `npm run build`     | the TypeScript into `dist/`    |

Run `npm run fmt` before every commit.
The native code has no standalone build: it compiles inside an app, and `ci.yml` builds the demo with the package from the commit.

## Dependencies during the build phase

Consumers pin the preview builds pkg.pr.new publishes from `ci.yml` on every push and pull request, never npm: `npm install https://pkg.pr.new/hotcodepush-team/react-native-code-push/@hotcodepush/react-native-code-push@<sha>`.
A consumer pins a commit and bumps it deliberately — never `@main`, whose moving content breaks `npm ci` against the lockfile's integrity hash.
The shared types come from `@hotcodepush/protocol` the same way, pinned to a commit in `package.json`; a protocol change is a bump of that sha.

## Rules

- The SDK never sees an API DTO: its contract is the channel index, the bundle manifest and the events endpoint, additive only.
- Safety is on by default and cannot be switched off: the readiness gate, the local blocklist, the automatic rollback.
- Nothing a device does not need to decide lives here: rollout, conditions, revocation and the cap are evaluated from the index, never configured.
- Statuses and reasons are `SCREAMING_SNAKE_CASE` from the one catalog; a method throws a plain error only for a programming mistake.
- Results are one shape per method and never throw for an outcome an app should handle.
- The Codegen spec carries plain objects; `@hotcodepush/protocol` types them one layer up, so the shared types stay the one definition.

## Agent workspace

- `.claude/skills/` holds the developer skills copied from `hotcodepush-team/.github`, pinned in `skills-lock.json`.
- Commits are conventional commits; `main` is trunk, CI is the gate, and a commit that lands an issue says `Closes #<n>`.
