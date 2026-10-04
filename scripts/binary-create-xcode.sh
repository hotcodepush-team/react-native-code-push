#!/bin/sh
# The build step of the Xcode build, run by the "Create HotCodePush binary" phase `hotcodepush init` adds after
# "Bundle React Native code and images": the CLI's `binary create` writes hotcodepush.json into the app
# and registers the binary. The phase holds one line; what it runs lives here.
set -e

DEST="$CONFIGURATION_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH"
PROJECT_ROOT="${PROJECT_ROOT:-$PROJECT_DIR/..}"

# Xcode's PATH has no Node; React Native's .xcode.env names the binary, and npx sits beside it.
PATH="$(dirname "$NODE_BINARY"):$PATH"
export PATH

cd "$PROJECT_ROOT"
npx hotcodepush binary create \
  --platform ios \
  --path "$DEST" \
  --binary-version "$MARKETING_VERSION" \
  --binary-build "$CURRENT_PROJECT_VERSION" \
  --out "$DEST/hotcodepush.json"
