import Foundation
import HotCodePushCore
import Network
import React

/// React Native loads the JavaScript its host is handed: a bundle is laid out by path under the store's `served`
/// directory, the host asks for the served one through `HotCodePush.bundleURL()`, and a switch is a reload of the host.
final class ReactNativeBundleLoader: BundleLoader {
    /// The bundle a reload the SDK asked for runs, `nil` for the embedded one.
    struct RequestedReload {
        let bundleId: String?
    }

    static let bundleFileName = "main.jsbundle"

    private static let reloadReason = "HotCodePush"
    private static let servedBundleIdKey = "hotcodepush.reactNative.servedBundleId"

    private let defaults = UserDefaults.standard
    private let lock = NSLock()
    private let monitor = NWPathMonitor()
    private let servedDirectory: URL

    private var isHostRunning = false
    private var isMetered = false
    private var requestedReload: RequestedReload?
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

    /// The host asks for its bundle, at the start and at every reload: until it is served one, the core's choice is persisted and never
    /// reloaded into. Answers the reload the SDK asked for, `nil` at the start and for a reload the SDK did not ask for.
    func beginBundleRequest() -> RequestedReload? {
        lock.lock()
        defer { lock.unlock() }
        isHostRunning = false
        let requested = requestedReload
        requestedReload = nil
        return requested
    }

    /// The host runs the bundle from now on, `nil` the embedded one: answers its file, none while the bundle's JavaScript is not on disk.
    func serveBundle(bundleId: String?) -> URL? {
        let url = bundleId.map(bundleFileURL(bundleId:)).flatMap { FileManager.default.fileExists(atPath: $0.path) ? $0 : nil }
        lock.lock()
        defer { lock.unlock() }
        runningBundleId = url == nil ? nil : bundleId
        isHostRunning = true
        return url
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

    /// A host that is not running yet is served the core's answer when it asks; a running one reloads into the bundle.
    func loadServedBundle(bundleId: String?) {
        persistServedBundle(bundleId: bundleId)
        lock.lock()
        let isReloadNeeded = isHostRunning
        if isReloadNeeded {
            requestedReload = RequestedReload(bundleId: bundleId)
        }
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
