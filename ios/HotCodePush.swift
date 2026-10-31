import Foundation

/// Serves React Native the JavaScript bundle to run.
/// Return `HotCodePush.bundleURL()` from the `bundleURL()` of your app or scene delegate.
@objc public final class HotCodePush: NSObject {
    /// Returns the bundle of the release the SDK serves, otherwise the embedded `main.jsbundle`.
    @objc public static func bundleURL() -> URL? {
        return HotCodePushRuntime.shared.resolveBundleURL()
    }
}
