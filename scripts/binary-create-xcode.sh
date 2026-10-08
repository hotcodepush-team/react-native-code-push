#!/bin/sh
# The build step of the Xcode build, run by the "Create HotCodePush binary" phase `hotcodepush init` adds after
# "Bundle React Native code and images": the CLI writes hotcodepush.json into the app and, in a store build, creates
# the binary. The phase holds one line; what it runs lives here.
set -e

DEST="$CONFIGURATION_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH"
PROJECT_ROOT="${PROJECT_ROOT:-$PROJECT_DIR/..}"

# A Debug configuration runs the development server's JavaScript, and what React Native embeds for a device there is a
# development bundle: the CLI is given an empty directory instead, so it writes the resource file without an embedded
# bundle and asks the API nothing, on a device and a simulator alike. `*Debug*` is React Native's match for DEV.
case "$CONFIGURATION" in
  *Debug*)
    EMBEDDED_ASSETS_PATH="$DERIVED_FILE_DIR/hotcodepush-no-bundle"
    mkdir -p "$EMBEDDED_ASSETS_PATH"
    ;;
  *)
    EMBEDDED_ASSETS_PATH="$DEST"
    ;;
esac

# The store build is an archive, which Xcode marks with DEPLOYMENT_POSTPROCESSING, the setting behind "Run script only
# when installing": it creates the binary under the version and build the device reports, from the built app's processed
# Info.plist, since Expo's prebuild writes them into the plist as literals and leaves MARKETING_VERSION and
# CURRENT_PROJECT_VERSION at the template's. A Run or a plain build writes the resource file alone.
if [ "$DEPLOYMENT_POSTPROCESSING" = "YES" ]; then
  INFO_PLIST="$TARGET_BUILD_DIR/$INFOPLIST_PATH"
  BINARY_VERSION=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$INFO_PLIST")
  BINARY_BUILD=$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "$INFO_PLIST")
  set -- binary create --binary-version "$BINARY_VERSION" --binary-build "$BINARY_BUILD"
else
  set -- resource-file write
fi

# Xcode's PATH has no Node; React Native's .xcode.env names the binary, and npx sits beside it.
PATH="$(dirname "$NODE_BINARY"):$PATH"
export PATH

cd "$PROJECT_ROOT"
npx hotcodepush "$@" \
  --platform ios \
  --embedded-bundle-path "$EMBEDDED_ASSETS_PATH" \
  --resource-file-path "$DEST/hotcodepush.json"
