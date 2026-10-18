import Foundation

/// What the app's scene or app delegate hands React Native as its JavaScript: its `bundleURL()` returns `HotCodePush.bundleURL()`.
@objc public final class HotCodePush: NSObject {
    /// The bundle React Native runs: the release the SDK serves, else the `main.jsbundle` the binary ships.
    @objc public static func bundleURL() -> URL? {
        return HotCodePushRuntime.shared.resolveBundleURL()
    }
}
