import Foundation
import HotCodePushCore
import Network
import React

/// React Native loads the JavaScript its host is handed: a bundle is laid out by path under the store's `served`
/// directory, the host asks for the served one through `HotCodePush.bundleURL()`, and a switch is a reload of the host.
final class ReactNativeBundleLoader: BundleLoader {
    static let bundleFileName = "main.jsbundle"

    private static let reloadReason = "HotCodePush"
    private static let servedBundleIdKey = "hotcodepush.reactNative.servedBundleId"

    private let defaults = UserDefaults.standard
    private let lock = NSLock()
    private let monitor = NWPathMonitor()
    private let servedDirectory: URL

    private var isHostRunning = false
    private var isMetered = false
    private var runningBundleId: String?

    init(storeDirectory: URL) {
        servedDirectory = storeDirectory.appendingPathComponent("served", isDirectory: true)
        monitor.pathUpdateHandler = { [weak self] path in
            self?.isMetered = path.isExpensive || path.isConstrained
        }
        monitor.start(queue: DispatchQueue.global(qos: .utility))
    }

    static var embeddedBundleURL: URL? {
        return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
    }

    /// What the host runs from now on: the served bundle as persisted, else the embedded one. Called each time React Native starts or reloads.
    func resolveBundleURL() -> URL? {
        lock.lock()
        defer { lock.unlock() }
        isHostRunning = true
        runningBundleId = persistedBundleId()
        return runningBundleId.map(bundleFileURL(bundleId:)) ?? ReactNativeBundleLoader.embeddedBundleURL
    }

    func projectionDirectory(bundleId: String) -> URL {
        return servedDirectory.appendingPathComponent(bundleId, isDirectory: true)
    }

    func deleteProjection(bundleId: String) {
        try? FileManager.default.removeItem(at: projectionDirectory(bundleId: bundleId))
    }

    func persistServedBundle(bundleId: String?) {
        if let bundleId = bundleId {
            defaults.set(bundleId, forKey: ReactNativeBundleLoader.servedBundleIdKey)
        } else {
            defaults.removeObject(forKey: ReactNativeBundleLoader.servedBundleIdKey)
        }
    }

    /// A host that has not asked for its bundle yet reads the persisted choice when it does; a running one reloads into it.
    func loadServedBundle(bundleId: String?) {
        persistServedBundle(bundleId: bundleId)
        lock.lock()
        let isReloadNeeded = isHostRunning
        lock.unlock()
        guard isReloadNeeded else { return }
        DispatchQueue.main.async {
            RCTTriggerReloadCommandListeners(ReactNativeBundleLoader.reloadReason)
        }
    }

    func servedBundleId() -> String? {
        lock.lock()
        defer { lock.unlock() }
        return isHostRunning ? runningBundleId : persistedBundleId()
    }

    func isConnectionMetered() -> Bool {
        return isMetered
    }

    private func bundleFileURL(bundleId: String) -> URL {
        return projectionDirectory(bundleId: bundleId).appendingPathComponent(ReactNativeBundleLoader.bundleFileName)
    }

    /// The persisted bundle counts only while its JavaScript is on disk; anything else is the embedded bundle.
    private func persistedBundleId() -> String? {
        guard let bundleId = defaults.string(forKey: ReactNativeBundleLoader.servedBundleIdKey),
              FileManager.default.fileExists(atPath: bundleFileURL(bundleId: bundleId).path) else {
            return nil
        }
        return bundleId
    }
}

/// The files compiled into the binary, `main.jsbundle` and `assets/` in the app bundle, addressed by the embedded manifest's hashes;
/// none in a build that bundled no JavaScript, whose resource file carries no manifest.
final class AppBundleEmbeddedBundle: EmbeddedBundle {
    private let pathsBySha256: [String: String]

    init(manifest: EmbeddedBundleManifest?) {
        var paths: [String: String] = [:]
        for file in manifest?.files ?? [] {
            paths[file.sha256] = file.path
        }
        pathsBySha256 = paths
    }

    func has(sha256: String) -> Bool {
        guard let path = pathsBySha256[sha256] else { return false }
        return FileManager.default.fileExists(atPath: fileURL(path: path).path)
    }

    func copyFile(sha256: String, to destination: URL) throws {
        guard let path = pathsBySha256[sha256] else { throw PlainError("No embedded file with hash \(sha256)") }
        try FileManager.default.copyItem(at: fileURL(path: path), to: destination)
    }

    private func fileURL(path: String) -> URL {
        return Bundle.main.bundleURL.appendingPathComponent(path)
    }
}
