# React Native code push by HotCodePush

[![npm](https://img.shields.io/npm/v/@hotcodepush/react-native-code-push)](https://www.npmjs.com/package/@hotcodepush/react-native-code-push)
[![CI](https://github.com/hotcodepush-team/react-native-code-push/actions/workflows/ci.yml/badge.svg)](https://github.com/hotcodepush-team/react-native-code-push/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/@hotcodepush/react-native-code-push)](./LICENSE)

`@hotcodepush/react-native-code-push` is the React Native module that delivers over-the-air (OTA) updates to your app. Ship a JavaScript fix with one command, reach every installed app within seconds, and roll it back from the console if something goes wrong. No store review, no new build.
Learn more at [hotcodepush.com/react-native-code-push](https://hotcodepush.com/react-native-code-push).

<a href="https://hotcodepush.com/">
  <img alt="Ship updates in seconds. Over-the-air updates for React Native, Expo, Capacitor and Cordova. Get started." src="https://hotcodepush.com/assets/banners/readme-banner-ember.png" width="100%" />
</a>

## Features

- ⚡️ **One command to release.** `npx hotcodepush release create --platform ios` bundles, signs and publishes.
- 📺 **Channels.** Staging, beta and production, each with its own release log, and promotion between them.
- 🚀 **Staged rollouts.** Start at 5 percent, widen in steps, and let the automatic pause stop a release that fails on devices.
- 🛟 **Rollback.** One command or one click sends every device back to the release before.
- 🔁 **Delta updates.** A device downloads what changed, built on the platform from the bundle it runs.
- 🔒 **Code signing.** The app runs only bundles signed with your key, which never leaves your machine or your CI.
- 🎯 **Conditions.** Target a release by binary version, OS version, device attributes or a list of devices.
- 🖥️ **Console, CLI and GitHub Action.** Watch devices arrive on a release in the console, release from the terminal, or from a workflow step.
- 🤖 **Built for agents.** An MCP server and agent skills let Claude Code or Cursor set up, release and debug for you.
- 🌐 **Open source.** The module, the CLI, the clients and the Action are MIT licensed.

## Compatibility

| Module | React Native                     | iOS            | Android                |
| ------ | -------------------------------- | -------------- | ---------------------- |
| 0.x    | 0.82 and later, New Architecture | 15.1 and later | 7.0 (API 24) and later |

## Demo

[react-native-code-push-demo](https://github.com/hotcodepush-team/react-native-code-push-demo) is a React Native app with the module wired in, built on both platforms and released through the GitHub Action on every merge.

## Guides

- [Quickstart](https://hotcodepush.com/docs/quickstart), the first release end to end
- [Migrate from CodePush](https://hotcodepush.com/docs/migrate/codepush), with the mapping of every command and option
- [Release from CI](https://hotcodepush.com/docs/ci), GitHub Actions, GitLab, Bitrise, Codemagic and more

## Installation

### AI-assisted setup (recommended)

Paste this prompt into the agent or assistant you use:

```text
Set up HotCodePush OTA updates in this project, following https://hotcodepush.com/docs/quickstart.md. If you can run commands, install the agent skills with `npx skills add hotcodepush-team/skills`, then run hotcodepush-init and hotcodepush-release. If you cannot run commands, read that page and give me the steps to do it myself.
```

An agent that runs commands installs the module, creates the app and the channel, and ships the first update. An assistant without a shell reads the quickstart and hands you the steps. [Agent skills](https://hotcodepush.com/docs/ai/skills) explains what the agent does.

### Set up with the CLI

```sh
npx hotcodepush init
```

`init` signs you in, picks or creates the app, installs the module, writes `hotcodepush.json`, wires both native projects and offers a signing key. Build the app once in release, an Xcode archive or a Gradle release variant, so the store build registers itself. Then change something and ship it:

```sh
npx hotcodepush release create --platform ios
npx hotcodepush release create --platform android
```

The installed app downloads the release at its next start and runs it from the start after that.
A debug build loads its JavaScript from Metro, so OTA updates are off there.

Prefer to wire it yourself? The [installation guide](https://hotcodepush.com/docs/sdks/react-native/installation) has the five steps by hand: the package and the pod, `hotcodepush.json`, the two host edits, the build step and the check with `doctor`.

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

With the default `checkStrategy` of `auto`, the SDK checks on start, on resume and in the foreground, and `sync()` runs one cycle on demand.
Applying an update reloads the JavaScript without restarting the app.
Set `downloadStrategy` or `applyStrategy` to `manual` and call `downloadUpdate()` or `applyUpdate()` yourself to control when an update lands.

## Documentation

See [hotcodepush.com/docs/sdks/react-native](https://hotcodepush.com/docs/sdks/react-native) for the configuration, methods, events, types and reasons.

## Development

See [CLAUDE.md](./CLAUDE.md) for the layout and the commands, and [CONTRIBUTING.md](https://github.com/hotcodepush-team/.github/blob/main/CONTRIBUTING.md) for the rules of a change.
The iOS code compiles only inside an app, so CI builds the [demo app](https://github.com/hotcodepush-team/react-native-code-push-demo) with the module from the commit. The native cores live in [core-ios](https://github.com/hotcodepush-team/core-ios) and [core-android](https://github.com/hotcodepush-team/core-android).

## License

See [LICENSE](./LICENSE).
An app that ships the module also ships the native cores' third-party code: FreeBSD's bspatch (BSD 2-clause) on both platforms and bzip2 1.0.8 on Android. Reproduce the notices from [core-ios](https://github.com/hotcodepush-team/core-ios/blob/main/THIRD-PARTY-NOTICES) and [core-android](https://github.com/hotcodepush-team/core-android/blob/main/THIRD-PARTY-NOTICES) in your app's distribution.
