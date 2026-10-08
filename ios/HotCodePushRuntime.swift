import Foundation
import HotCodePushCore
import React
import UIKit

/// What the runtime hands the Turbo Module: an event to emit to JavaScript.
@objc public protocol HotCodePushEventSink: AnyObject {
    func emitEvent(_ eventName: String, payload: [String: Any])
}

/// The SDK inside the process, one per app: it starts the core when React Native asks for its bundle, so the start's
/// verdict — the pending switch, the rollback of a release that never became ready — is in before any JavaScript runs,
/// and the Turbo Module of every JavaScript instance since talks to that one core.
@objc public final class HotCodePushRuntime: NSObject {
    @objc public static let shared = HotCodePushRuntime()

    static let sdkVersion = "0.0.0"

    private static let contentDidAppearNotification = Notification.Name("RCTContentDidAppearNotification")
    private static let missingConfigurationMessage = "HotCodePush is not configured: hotcodepush.json is missing from the app's resources. Run `npx hotcodepush init` and build the app once."
    private static let notServedMessage = "React Native did not ask HotCodePush for its bundle, so live updates are off in this run: Metro serves a debug build, and any other build needs `HotCodePush.bundleURL()` in the AppDelegate, which `npx hotcodepush doctor` checks."

    private enum Method: String {
        case applyUpdate, checkForUpdate, clearUpdates, consumeUpdateRolledBack, downloadUpdate, getChannel, getDevice, getState
        case notifyReady, rollbackUpdate, setAttributes, setChannel, setRestartAllowed, showDebugScreen, sync
    }

    private let loader: ReactNativeBundleLoader
    private let lock = NSLock()
    private let storeDirectory: URL

    private var core: Core?
    private var events: CoreEvents?
    private var isStarted = false
    /// Why there is no core, which every method rejects with: the resource file is missing, or the core's reader refused it.
    private var notConfiguredMessage = HotCodePushRuntime.missingConfigurationMessage
    private var retainedUpdateRolledBackEvent: [String: Any]?
    private weak var eventSink: HotCodePushEventSink?

    override private init() {
        storeDirectory = HotCodePushRuntime.resolveStoreDirectory()
        loader = ReactNativeBundleLoader(storeDirectory: storeDirectory)
        super.init()
    }

    // MARK: The host

    /// What React Native loads, asked at every start and reload: the served bundle's file, else the `main.jsbundle` the binary ships.
    func resolveBundleURL() -> URL? {
        return loader.serveBundle(bundleId: resolveServedBundleId()) ?? ReactNativeBundleLoader.embeddedBundleURL
    }

    /// The bundle the new JavaScript instance runs: the start's answer, the bundle of a reload the SDK asked for, else the core's answer to the reload.
    private func resolveServedBundleId() -> String? {
        let requestedReload = loader.beginBundleRequest()
        if claimStart() {
            return createCore(isServedBySdk: true)?.handleAppStartBlocking()
        }
        guard let core = core else { return nil }
        if let requestedReload = requestedReload {
            return requestedReload.bundleId
        }
        return HotCodePushRuntime.reportReload(to: core)
    }

    /// A reload the SDK did not ask for — `DevSettings.reload()`, react-native-restart, a development reload — goes through the core's gate.
    /// The host waits for the answer as long as for the start's, then runs the embedded bundle until the core reloads it into its choice.
    private static func reportReload(to core: Core) -> String? {
        let answer = ReloadAnswer()
        Task.detached(priority: .userInitiated) {
            answer.resolve(await core.handleAppReload())
        }
        return answer.wait(timeout: Core.startTimeout)
    }

    // MARK: The Turbo Module

    /// The module of the JavaScript instance that runs now; a reload replaces it.
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

    // MARK: The start

    /// Whether the caller starts the core, once per process: the host at its first question for its bundle, which waits for the start's
    /// answer at most `Core.startTimeout`, or the module of a host that never asked, which runs JavaScript the SDK does not serve.
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
            readConfiguration = try HotCodePushRuntime.readConfiguration()
        } catch {
            notConfiguredMessage = "HotCodePush is not configured: the app's hotcodepush.json was refused: \(HotCodePushRuntime.describeRefusal(error)). Check the project's hotcodepush.json and build the app again."
            readConfiguration = nil
        }
        guard var configuration = readConfiguration else {
            NSLog("[HotCodePush] %@", notConfiguredMessage)
            return nil
        }
        if !isServedBySdk {
            configuration.enabledInDebugBuilds = false
            NSLog("[HotCodePush] %@", HotCodePushRuntime.notServedMessage)
        }
        let events = CoreEvents(runtime: self)
        let core = Core(
            configuration: configuration,
            device: HotCodePushRuntime.deviceFacts(isServedBySdk: isServedBySdk),
            store: UserDefaultsStore(),
            files: FileStore(rootDirectory: storeDirectory),
            embedded: AppBundleEmbeddedBundle(manifest: configuration.embeddedBundleManifest),
            http: UrlSessionHttpClient(),
            loader: loader,
            listener: events)
        self.events = events
        self.core = core
        observeAppLifecycle()
        return core
    }

    private func observeAppLifecycle() {
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(handleContentDidAppear), name: HotCodePushRuntime.contentDidAppearNotification, object: nil)
        center.addObserver(self, selector: #selector(handleDidEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        center.addObserver(self, selector: #selector(handleWillEnterForeground), name: UIApplication.willEnterForegroundNotification, object: nil)
    }

    /// The first frame after the root view renders: the readiness signal `render`, and whatever `readySignal` is, the
    /// moment the app is up in this run, which the core's own restarts wait for. Every reload renders a new root; a frame
    /// while a reload the SDK asked for is pending is the replaced instance's and signals nothing.
    @objc private func handleContentDidAppear() {
        guard !loader.isReloadPending else { return }
        Task { await core?.handleRendered() }
    }

    @objc private func handleDidEnterBackground() {
        Task { await core?.handleAppPause() }
    }

    @objc private func handleWillEnterForeground() {
        Task { await core?.handleAppResume() }
    }

    // MARK: Methods

    private func perform(_ method: Method, options: [String: Any], core: Core) async throws -> Any? {
        switch method {
        case .applyUpdate:
            return try HotCodePushRuntime.jsObject(await core.applyUpdate())
        case .checkForUpdate:
            return try HotCodePushRuntime.jsObject(await core.checkForUpdate())
        case .clearUpdates:
            await core.clearUpdates()
        case .consumeUpdateRolledBack:
            return consumeUpdateRolledBack()
        case .downloadUpdate:
            return try HotCodePushRuntime.jsObject(await core.downloadUpdate(options: try HotCodePushRuntime.downloadUpdateOptions(from: options)))
        case .getChannel:
            return try HotCodePushRuntime.jsObject(await core.channel())
        case .getDevice:
            return try HotCodePushRuntime.jsObject(await core.deviceResult())
        case .getState:
            return try HotCodePushRuntime.jsObject(await core.getState())
        case .notifyReady:
            return try HotCodePushRuntime.jsObject(await core.notifyReady())
        case .rollbackUpdate:
            try await core.rollbackUpdate(detail: options["reason"] as? String)
        case .setAttributes:
            try await core.setAttributes(try HotCodePushRuntime.attributeChanges(from: options))
        case .setChannel:
            try await core.setChannel(HotCodePushRuntime.channelChoice(from: options))
        case .setRestartAllowed:
            guard let allowed = options["allowed"] as? Bool else { throw PlainError("allowed must be a boolean") }
            await core.setRestartAllowed(allowed)
        case .showDebugScreen:
            await HotCodePushRuntime.presentDebugScreen(core: core)
        case .sync:
            return try HotCodePushRuntime.jsObject(await core.sync(trigger: .manual, options: try HotCodePushRuntime.syncOptions(from: options)))
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

    /// The apply strategies for this call; a value outside its choices is a programming mistake and rejects the call.
    private static func downloadUpdateOptions(from options: [String: Any]) throws -> DownloadUpdateOptions {
        return DownloadUpdateOptions(
            applyStrategy: try option("applyStrategy", options, ApplyStrategy.init(rawValue:)),
            mandatoryApplyStrategy: try option("mandatoryApplyStrategy", options, MandatoryApplyStrategy.init(rawValue:)))
    }

    /// Each stage's strategy for this call; a value outside its choices is a programming mistake and rejects the call.
    private static func syncOptions(from options: [String: Any]) throws -> SyncOptions {
        return SyncOptions(
            applyStrategy: try option("applyStrategy", options, ApplyStrategy.init(rawValue:)),
            downloadStrategy: try option("downloadStrategy", options, DownloadStrategy.init(rawValue:)),
            mandatoryApplyStrategy: try option("mandatoryApplyStrategy", options, MandatoryApplyStrategy.init(rawValue:)))
    }

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

    // MARK: Events

    fileprivate func emit<T: Encodable>(_ eventName: String, _ event: T) {
        guard let payload = try? HotCodePushRuntime.jsObject(event) else { return }
        eventSink?.emitEvent(eventName, payload: payload)
    }

    fileprivate func emitDownloadProgress(releaseId: String, downloadedBytes: Int, totalBytes: Int) {
        let progress = totalBytes > 0 ? Double(downloadedBytes) / Double(totalBytes) : 0
        eventSink?.emitEvent("downloadProgress", payload: ["releaseId": releaseId, "downloadedBytes": downloadedBytes, "totalBytes": totalBytes, "progress": progress])
    }

    /// Kept until the JavaScript of the start that follows the rollback listens: the instance that saw the rollback is gone by then.
    fileprivate func retainUpdateRolledBack(_ event: UpdateRolledBackEvent) {
        let payload = try? HotCodePushRuntime.jsObject(event)
        lock.lock()
        retainedUpdateRolledBackEvent = payload
        lock.unlock()
    }

    /// The kept `updateRolledBack` event, handed out once; `null` when no rollback preceded this start.
    private func consumeUpdateRolledBack() -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }
        let event: Any = retainedUpdateRolledBackEvent ?? NSNull()
        retainedUpdateRolledBackEvent = nil
        return ["event": event]
    }

    private static func jsObject<T: Encodable>(_ value: T) throws -> [String: Any] {
        let data = try Json.encoder.encode(value)
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw PlainError("The result could not be encoded")
        }
        return object
    }

    // MARK: The platform's facts

    /// The resource file as the core reads it, `nil` when the build wrote none; the reader's refusal is thrown.
    private static func readConfiguration() throws -> Configuration? {
        guard let url = Bundle.main.url(forResource: "hotcodepush", withExtension: "json"), let data = try? Data(contentsOf: url) else {
            return nil
        }
        return try Configuration.decode(data)
    }

    /// The reader's own words: a decoding error describes itself in its context, which its `localizedDescription` leaves out.
    private static func describeRefusal(_ error: Error) -> String {
        switch error as? DecodingError {
        case .dataCorrupted(let context), .keyNotFound(_, let context), .typeMismatch(_, let context), .valueNotFound(_, let context):
            return context.debugDescription
        default:
            return String(describing: error)
        }
    }

    /// A run whose JavaScript the SDK does not serve counts as a debug build, which `enabledInDebugBuilds` then switches off.
    private static func deviceFacts(isServedBySdk: Bool) -> DeviceFacts {
        let info = Bundle.main.infoDictionary ?? [:]
        #if DEBUG
        let isDebugBuild = true
        #else
        let isDebugBuild = !isServedBySdk
        #endif
        return DeviceFacts(
            platform: "ios",
            binaryVersion: info["CFBundleShortVersionString"] as? String ?? "",
            binaryBuild: info["CFBundleVersion"] as? String ?? "",
            osVersion: UIDevice.current.systemVersion,
            sdkVersion: sdkVersion,
            isDebugBuild: isDebugBuild)
    }

    private static func resolveStoreDirectory() -> URL {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return support.appendingPathComponent("hotcodepush", isDirectory: true)
    }
}

/// The reload's answer handed from the core's task to the host's waiting thread.
private final class ReloadAnswer: @unchecked Sendable {
    private let semaphore = DispatchSemaphore(value: 0)
    private var bundleId: String?

    func resolve(_ bundleId: String?) {
        self.bundleId = bundleId
        semaphore.signal()
    }

    /// The answer, `nil` for the embedded bundle and when none came within the timeout; the signal orders the write before the read.
    func wait(timeout: TimeInterval) -> String? {
        guard semaphore.wait(timeout: .now() + timeout) == .success else { return nil }
        return bundleId
    }
}

/// The core's five events on their way to JavaScript.
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

    func downloadProgress(releaseId: String, downloadedBytes: Int, totalBytes: Int) {
        runtime?.emitDownloadProgress(releaseId: releaseId, downloadedBytes: downloadedBytes, totalBytes: totalBytes)
    }

    func updateRolledBack(_ event: UpdateRolledBackEvent) {
        runtime?.retainUpdateRolledBack(event)
    }
}
