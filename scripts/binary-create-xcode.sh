#!/bin/sh
# Run by the "Create HotCodePush binary" phase that `hotcodepush init` adds after "Bundle React Native code and images".
# The CLI writes hotcodepush.json into the app and, in a store build, creates the binary.
set -e

DEST="$CONFIGURATION_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH"
PROJECT_ROOT="${PROJECT_ROOT:-$PROJECT_DIR/..}"

# A Debug configuration runs Metro's JavaScript, and on a device React Native embeds only a development bundle.
# So the CLI gets an empty directory and writes the resource file without an embedded bundle or an API call. `*Debug*` matches DEV as React Native does.
case "$CONFIGURATION" in
  *Debug*)
    EMBEDDED_ASSETS_PATH="$DERIVED_FILE_DIR/hotcodepush-no-bundle"
    mkdir -p "$EMBEDDED_ASSETS_PATH"
    ;;
  *)
    EMBEDDED_ASSETS_PATH="$DEST"
    ;;
esac

# Xcode marks an archive, the store build, with DEPLOYMENT_POSTPROCESSING ("Run script only when installing").
# Version and build come from the processed Info.plist, since Expo's prebuild writes them there as literals and leaves MARKETING_VERSION and CURRENT_PROJECT_VERSION at the template values.
if [ "$DEPLOYMENT_POSTPROCESSING" = "YES" ]; then
  INFO_PLIST="$TARGET_BUILD_DIR/$INFOPLIST_PATH"
  BINARY_VERSION=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$INFO_PLIST")
  BINARY_BUILD=$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "$INFO_PLIST")
  set -- binary create --binary-version "$BINARY_VERSION" --binary-build "$BINARY_BUILD"
else
  set -- resource-file write
fi

# Xcode's PATH has no Node. React Native's .xcode.env names the Node binary, and npx sits beside it.
if [ -z "$NODE_BINARY" ]; then
  echo "error: HotCodePush found no Node to run its build step; name it in $PROJECT_DIR/.xcode.env: export NODE_BINARY=/path/to/node" >&2
  exit 1
fi
PATH="$(dirname "$NODE_BINARY"):$PATH"
export PATH

cd "$PROJECT_ROOT"
npx hotcodepush "$@" \
  --platform ios \
  --embedded-bundle-path "$EMBEDDED_ASSETS_PATH" \
  --resource-file-path "$DEST/hotcodepush.json"
