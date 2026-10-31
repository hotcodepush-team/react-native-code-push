import Foundation
import HotCodePushCore
import React

// React Native loads the JavaScript its host is handed, so a switch is a reload of the host.
// Bundles live under the `served` directory of the store, and a `nil` bundle ID means the embedded bundle.
final class ReactNativeBundleLoader: BundleLoader {
    struct RequestedReload {
        let bundleId: String?
    }

    static let bundleFileName = "main.jsbundle"

    private static let reloadReason = "HotCodePush"
    private static let servedBundleIdKey = "hotcodepush.servedBundleId"

    private let lock = NSLock()
    private let networkMonitor = NetworkMonitor()
    private let servedDirectory: URL
    private let store: KeyValueStore

    private var isHostRunning = false
    private var requestedReload: RequestedReload?
    private var _runningBundleId: String?

    // The store is the core's own, so the bundle for the next start lies beside the state it belongs to.
    init(store: KeyValueStore, storeDirectory: URL) {
        self.store = store
        servedDirectory = storeDirectory.appendingPathComponent("served", isDirectory: true)
    }

    static var embeddedBundleURL: URL? {
        return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
    }

    // Called at the start and at every reload. Until the host is served, the core's choice is persisted but never reloaded into.
    // Returns `nil` at the start and for a reload the SDK did not ask for.
    func beginBundleRequest() -> RequestedReload? {
        lock.lock()
        defer { lock.unlock() }
        isHostRunning = false
        let requested = requestedReload
        requestedReload = nil
        return requested
    }

    // Until the requested reload reaches the host, whatever renders is the instance the reload replaces.
    var isReloadPending: Bool {
        lock.lock()
        defer { lock.unlock() }
        return requestedReload != nil
    }

    // The bundle served last. A bundle request does not change it.
    var runningBundleId: String? {
        lock.lock()
        defer { lock.unlock() }
        return _runningBundleId
    }

    // Returns `nil` while the JavaScript of the bundle is not on disk.
    func serveBundle(bundleId: String?) -> URL? {
        let url = bundleId.map(bundleFileURL(bundleId:)).flatMap { FileManager.default.fileExists(atPath: $0.path) ? $0 : nil }
        lock.lock()
        defer { lock.unlock() }
        _runningBundleId = url == nil ? nil : bundleId
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
        store.set(bundleId, forKey: ReactNativeBundleLoader.servedBundleIdKey)
    }

    // A host that is not running yet gets the bundle when it asks. A running host reloads into it.
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
        return isHostRunning ? _runningBundleId : persistedBundleId()
    }

    func isConnectionMetered() -> Bool {
        return networkMonitor.isConnectionMetered()
    }

    private func bundleFileURL(bundleId: String) -> URL {
        return projectionDirectory(bundleId: bundleId).appendingPathComponent(ReactNativeBundleLoader.bundleFileName)
    }

    // The persisted bundle counts only while its JavaScript is on disk. Otherwise the embedded bundle runs.
    private func persistedBundleId() -> String? {
        guard let bundleId = store.string(forKey: ReactNativeBundleLoader.servedBundleIdKey),
              FileManager.default.fileExists(atPath: bundleFileURL(bundleId: bundleId).path) else {
            return nil
        }
        return bundleId
    }
}
