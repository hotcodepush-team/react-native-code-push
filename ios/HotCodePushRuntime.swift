import Foundation
import HotCodePushCore
import React

// The core ships prebuilt in Release, so the app's debug flag is read here, where the SDK compiles with the app.
#if DEBUG
private let isDebugBuild = true
#else
private let isDebugBuild = false
#endif

@objc public protocol HotCodePushEventSink: AnyObject {
    func emitEvent(_ eventName: String, payload: [String: Any])
}

// The core starts when React Native first asks for its bundle, so a pending switch or rollback is decided before any JavaScript runs.
// The Turbo Module of every later JavaScript instance talks to that one core.
@objc public final class HotCodePushRuntime: NSObject {
    @objc public static let shared = HotCodePushRuntime()

    private static let contentDidAppearNotification = Notification.Name("RCTContentDidAppearNotification")
    private static let notServedMessage = "React Native did not ask HotCodePush for its bundle, so over-the-air (OTA) updates are off in this run: Metro serves a debug build, and any other build needs `HotCodePush.bundleURL()` in the file that overrides `bundleURL()`, which `npx hotcodepush doctor` checks."

    private enum Method: String {
        case applyUpdate, checkForUpdate, clearUpdates, consumeUpdateRolledBack, downloadUpdate, getChannel, getDevice, getState
        case notifyReady, rollbackUpdate, setAttributes, setChannel, setRestartAllowed, showDebugScreen, sync
    }

    private let loader = ReactNativeBundleLoader(store: UserDefaultsStore(), storeDirectory: FileStore.defaultRootDirectory)
    private let lock = NSLock()

    private var core: Core?
    private var isStarted = false
    private var notConfiguredMessage = Configuration.missingMessage
    private var retainedUpdateRolledBackEvent: [String: Any]?
    private weak var eventSink: HotCodePushEventSink?

    override private init() {
        super.init()
    }

    // React Native asks at every start and every reload.
    func resolveBundleURL() -> URL? {
        return loader.serveBundle(bundleId: resolveServedBundleId()) ?? ReactNativeBundleLoader.embeddedBundleURL
    }

    // A reload the SDK did not ask for, such as `DevSettings.reload()`, react-native-restart or a development reload,
    // serves the running bundle without telling the core.
    private func resolveServedBundleId() -> String? {
        let requestedReload = loader.beginBundleRequest()
        if claimStart() {
            return createCore(isServedBySdk: true)?.handleAppStartBlocking()
        }
        if let requestedReload = requestedReload {
            return requestedReload.bundleId
        }
        return loader.runningBundleId
    }

    // A reload replaces the module, so only the latest one receives events.
    @objc public func attach(_ eventSink: HotCodePushEventSink) {
        self.eventSink = eventSink
        guard claimStart(), let core = createCore(isServedBySdk: false) else { return }
        Task { await core.handleAppStart() }
    }

    @objc public func detach(_ eventSink: HotCodePushEventSink) {
        if self.eventSink === eventSink { self.eventSink = nil }
    }

    @objc public func invoke(_ methodName: String, options: [String: Any], resolve: @escaping (Any?) -> Void, reject: @escaping (String) -> Void) {
        guard let method = Method(rawValue: methodName) else {
            reject("HotCodePush has no method named \(methodName)")
            return
        }
        if method == .consumeUpdateRolledBack {
            resolve(consumeUpdateRolledBack())
            return
        }
        guard let core = core else {
            reject(notConfiguredMessage)
            return
        }
        Task {
            do {
                resolve(try await self.perform(method, options: options, core: core))
            } catch {
                reject(error.localizedDescription)
            }
        }
    }

    // The core starts once per process: from the first bundle request, which waits up to `Core.startTimeout`,
    // or from the module of a host that never asked and so runs JavaScript the SDK does not serve.
    private func claimStart() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard !isStarted else { return false }
        isStarted = true
        return true
    }

    private func createCore(isServedBySdk: Bool) -> Core? {
        let readConfiguration: Configuration?
        do {
            readConfiguration = try Configuration.read()
        } catch {
            notConfiguredMessage = Configuration.resolveRefusedMessage(error)
            readConfiguration = nil
        }
        guard var configuration = readConfiguration else {
            NSLog("[HotCodePush] %@", notConfiguredMessage)
            return nil
        }
        var device = DeviceFacts.current(sdkVersion: sdkVersion, isDebugBuild: isDebugBuild)
        // The SDK does not serve this run's JavaScript, so it counts as a debug build and `isEnabledInDebugBuilds` is off.
        if !isServedBySdk {
            configuration.isEnabledInDebugBuilds = false
            device.isDebugBuild = true
            NSLog("[HotCodePush] %@", HotCodePushRuntime.notServedMessage)
        }
        let events = CoreEvents(runtime: self)
        let core = Core(
            configuration: configuration,
            device: device,
            embedded: AppBundleEmbeddedBundle(manifest: configuration.embeddedBundleManifest, rootDirectory: Bundle.main.bundleURL),
            loader: loader,
            listener: events)
        self.core = core
        NotificationCenter.default.addObserver(self, selector: #selector(handleContentDidAppear), name: HotCodePushRuntime.contentDidAppearNotification, object: nil)
        core.observeAppLifecycle()
        return core
    }

    // The first frame after the root view renders is the `render` readiness signal and, for any `readySignal`, the moment the core's restarts wait for.
    // While a reload the SDK asked for is pending, the frame belongs to the replaced instance and signals nothing.
    @objc private func handleContentDidAppear() {
        guard !loader.isReloadPending else { return }
        Task { await core?.handleRendered() }
    }

    private func perform(_ method: Method, options: [String: Any], core: Core) async throws -> Any? {
        switch method {
        case .applyUpdate:
            return try Json.encodeObject(await core.applyUpdate())
        case .checkForUpdate:
            return try Json.encodeObject(await core.checkForUpdate())
        case .clearUpdates:
            await core.clearUpdates()
        case .consumeUpdateRolledBack:
            return consumeUpdateRolledBack()
        case .downloadUpdate:
            return try Json.encodeObject(await core.downloadUpdate(options: try HotCodePushRuntime.downloadUpdateOptions(from: options)))
        case .getChannel:
            return try Json.encodeObject(await core.getChannel())
        case .getDevice:
            return try Json.encodeObject(await core.getDevice())
        case .getState:
            return try Json.encodeObject(await core.getState())
        case .notifyReady:
            return try Json.encodeObject(await core.notifyReady())
        case .rollbackUpdate:
            try await core.rollbackUpdate(detail: options["reason"] as? String)
        case .setAttributes:
            try await core.setAttributes(try HotCodePushRuntime.attributeChanges(from: options))
        case .setChannel:
            try await core.setChannel(HotCodePushRuntime.channelChoice(from: options))
        case .setRestartAllowed:
            guard let isAllowed = options["isAllowed"] as? Bool else { throw PlainError("isAllowed must be a boolean") }
            await core.setRestartAllowed(isAllowed)
        case .showDebugScreen:
            await HotCodePushRuntime.presentDebugScreen(core: core)
        case .sync:
            return try Json.encodeObject(await core.sync(trigger: .manual, options: try HotCodePushRuntime.syncOptions(from: options)))
        }
        return nil
    }

    private static func attributeChanges(from options: [String: Any]) throws -> [String: String?] {
        var changes: [String: String?] = [:]
        for (key, value) in options {
            if value is NSNull {
                changes[key] = .some(nil)
            } else if let value = value as? String {
                changes[key] = value
            } else {
                throw PlainError("An attribute value is a string or null: \(key)")
            }
        }
        return changes
    }

    private static func channelChoice(from options: [String: Any]) -> ChannelChoice? {
        if let id = options["id"] as? String {
            return .id(id)
        }
        if let name = options["name"] as? String {
            return .name(name)
        }
        return nil
    }

    private static func downloadUpdateOptions(from options: [String: Any]) throws -> DownloadUpdateOptions {
        return DownloadUpdateOptions(
            applyStrategy: try option("applyStrategy", options, ApplyStrategy.init(rawValue:)),
            mandatoryApplyStrategy: try option("mandatoryApplyStrategy", options, MandatoryApplyStrategy.init(rawValue:)))
    }

    private static func syncOptions(from options: [String: Any]) throws -> SyncOptions {
        return SyncOptions(
            applyStrategy: try option("applyStrategy", options, ApplyStrategy.init(rawValue:)),
            downloadStrategy: try option("downloadStrategy", options, DownloadStrategy.init(rawValue:)),
            mandatoryApplyStrategy: try option("mandatoryApplyStrategy", options, MandatoryApplyStrategy.init(rawValue:)))
    }

    // A value outside the choices is a programming mistake, so the call rejects.
    private static func option<T>(_ name: String, _ options: [String: Any], _ parse: (String) -> T?) throws -> T? {
        guard let raw = options[name] as? String else { return nil }
        guard let value = parse(raw) else { throw PlainError("\(name) is not one of its choices: \(raw)") }
        return value
    }

    @MainActor
    private static func presentDebugScreen(core: Core) {
        guard let presenter = RCTPresentedViewController() else { return }
        DebugScreenViewController.present(core: core, from: presenter)
    }

    fileprivate func emit<T: Encodable>(_ eventName: String, _ event: T) {
        guard let payload = try? Json.encodeObject(event) else { return }
        eventSink?.emitEvent(eventName, payload: payload)
    }

    // Kept until the JavaScript of the next start listens, since the instance that saw the rollback is gone by then.
    fileprivate func retainUpdateRolledBack(_ event: UpdateRolledBackEvent) {
        let payload = try? Json.encodeObject(event)
        lock.lock()
        retainedUpdateRolledBackEvent = payload
        lock.unlock()
    }

    // Handed out once. The event is null when no rollback preceded this start.
    private func consumeUpdateRolledBack() -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }
        let event: Any = retainedUpdateRolledBackEvent ?? NSNull()
        retainedUpdateRolledBackEvent = nil
        return ["event": event]
    }

}

private final class CoreEvents: CoreListener {
    private weak var runtime: HotCodePushRuntime?

    init(runtime: HotCodePushRuntime) {
        self.runtime = runtime
    }

    func updateAvailable(_ event: UpdateAvailableEvent) {
        runtime?.emit("updateAvailable", event)
    }

    func updateDownloaded(_ event: UpdateDownloadedEvent) {
        runtime?.emit("updateDownloaded", event)
    }

    func updateFailed(_ event: UpdateFailedEvent) {
        runtime?.emit("updateFailed", event)
    }

    func downloadProgress(_ event: DownloadProgressEvent) {
        runtime?.emit("downloadProgress", event)
    }

    func updateRolledBack(_ event: UpdateRolledBackEvent) {
        runtime?.retainUpdateRolledBack(event)
    }
}
