import Foundation
import HotCodePushProtocol
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
    private static let notConfiguredMessage = "HotCodePush is not configured: hotcodepush.json is missing from the app's resources. Run `npx hotcodepush init` and build the app once."
    private static let notServedMessage = "React Native did not ask HotCodePush for its bundle, so live updates are off in this run: Metro serves a debug build, and any other build needs `HotCodePush.bundleURL()` in the AppDelegate, which `npx hotcodepush doctor` checks."

    private enum Method: String {
        case applyUpdate, checkForUpdate, clearUpdates, consumeRolledBack, downloadUpdate, getChannel, getDevice, getState
        case notifyReady, rollbackUpdate, setAttributes, setChannel, setRestartAllowed, showDebugScreen, sync
    }

    private let lock = NSLock()

    private var core: Core?
    private var events: CoreEvents?
    private var isStarted = false
    private var loader: ReactNativeBundleLoader?
    private var retainedRolledBackEvent: [String: Any]?
    private weak var eventSink: HotCodePushEventSink?

    // MARK: The host

    func resolveBundleURL() -> URL? {
        start(isHostAsking: true)
        return loader?.resolveBundleURL() ?? ReactNativeBundleLoader.embeddedBundleURL
    }

    // MARK: The Turbo Module

    /// The module of the JavaScript instance that runs now; a reload replaces it.
    @objc public func attach(_ eventSink: HotCodePushEventSink) {
        self.eventSink = eventSink
        start(isHostAsking: false)
    }

    @objc public func detach(_ eventSink: HotCodePushEventSink) {
        if self.eventSink === eventSink { self.eventSink = nil }
    }

    @objc public func invoke(_ methodName: String, options: [String: Any], resolve: @escaping (Any?) -> Void, reject: @escaping (String) -> Void) {
        guard let method = Method(rawValue: methodName) else {
            reject("HotCodePush has no method named \(methodName)")
            return
        }
        if method == .consumeRolledBack {
            resolve(consumeRolledBack())
            return
        }
        guard let core = core else {
            reject(HotCodePushRuntime.notConfiguredMessage)
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

    /// Once per process. A host that asks for its bundle waits for the core's start, which only reads and writes the
    /// device's own store; a host that never asked runs JavaScript the SDK does not serve, so the core stays off.
    private func start(isHostAsking: Bool) {
        lock.lock()
        let isFirstCall = !isStarted
        isStarted = true
        lock.unlock()
        guard isFirstCall else { return }
        guard var configuration = HotCodePushRuntime.readConfiguration() else {
            NSLog("[HotCodePush] %@", HotCodePushRuntime.notConfiguredMessage)
            return
        }
        if !isHostAsking {
            configuration.enabledInDebugBuilds = false
            NSLog("[HotCodePush] %@", HotCodePushRuntime.notServedMessage)
        }
        let storeDirectory = HotCodePushRuntime.storeDirectory()
        let events = CoreEvents(runtime: self)
        let loader = ReactNativeBundleLoader(storeDirectory: storeDirectory)
        let core = Core(
            configuration: configuration,
            device: HotCodePushRuntime.deviceFacts(isServedBySdk: isHostAsking),
            store: UserDefaultsStore(),
            files: FileStore(rootDirectory: storeDirectory),
            embedded: AppBundleEmbeddedBundle(manifest: configuration.embeddedBundleManifest),
            http: UrlSessionHttpClient(),
            loader: loader,
            listener: events)
        self.events = events
        self.loader = loader
        self.core = core
        observeAppLifecycle()
        if isHostAsking {
            HotCodePushRuntime.waitForStart(of: core)
        } else {
            Task { await core.handleAppStart() }
        }
    }

    private static func waitForStart(of core: Core) {
        let semaphore = DispatchSemaphore(value: 0)
        Task.detached(priority: .userInitiated) {
            await core.handleAppStart()
            semaphore.signal()
        }
        semaphore.wait()
    }

    private func observeAppLifecycle() {
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(handleContentDidAppear), name: HotCodePushRuntime.contentDidAppearNotification, object: nil)
        center.addObserver(self, selector: #selector(handleDidEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        center.addObserver(self, selector: #selector(handleWillEnterForeground), name: UIApplication.willEnterForegroundNotification, object: nil)
    }

    /// The first frame after the root view renders: the readiness signal `render`, and whatever `readySignal` is, the
    /// moment the app is up in this run, which the core's own restarts wait for. Every reload renders a new root.
    @objc private func handleContentDidAppear() {
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
        case .consumeRolledBack:
            return consumeRolledBack()
        case .downloadUpdate:
            return try HotCodePushRuntime.jsObject(await core.downloadUpdate())
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
            await core.setChannel(HotCodePushRuntime.channelChoice(from: options))
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

    /// Each stage's strategy for this call; a value outside its choices is a programming mistake and rejects the call.
    private static func syncOptions(from options: [String: Any]) throws -> SyncOptions {
        return SyncOptions(
            downloadStrategy: try option("downloadStrategy", options, DownloadStrategy.init(rawValue:)),
            installStrategy: try option("installStrategy", options, InstallStrategy.init(rawValue:)),
            mandatoryInstallStrategy: try option("mandatoryInstallStrategy", options, MandatoryInstallStrategy.init(rawValue:)))
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
    fileprivate func retainRolledBack(_ event: RolledBackEvent) {
        let payload = try? HotCodePushRuntime.jsObject(event)
        lock.lock()
        retainedRolledBackEvent = payload
        lock.unlock()
    }

    /// The kept `rolledBack` event, handed out once; `null` when no rollback preceded this start.
    private func consumeRolledBack() -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }
        let event: Any = retainedRolledBackEvent ?? NSNull()
        retainedRolledBackEvent = nil
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

    private static func readConfiguration() -> Configuration? {
        guard let url = Bundle.main.url(forResource: "hotcodepush", withExtension: "json"), let data = try? Data(contentsOf: url) else {
            return nil
        }
        do {
            return try Configuration.decode(data)
        } catch {
            NSLog("[HotCodePush] hotcodepush.json could not be read: %@", String(describing: error))
            return nil
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

    private static func storeDirectory() -> URL {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return support.appendingPathComponent("hotcodepush", isDirectory: true)
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

    func rolledBack(_ event: RolledBackEvent) {
        runtime?.retainRolledBack(event)
    }
}
