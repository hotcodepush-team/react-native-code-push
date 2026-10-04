import Foundation

/// When a reload the SDK asks for may reach React Native.
///
/// React Native starts the first surface of an instance once its bundle has run, through a start that hops to the main
/// queue and then to a background queue. A reload in that window moves the surface to a new instance, and the old
/// start still lands there, before the new bundle has run: React Native aborts with "AppRegistryBinding::startSurface
/// failed. Global was not installed". So a reload asked for while an instance starts is held until React Native shows
/// that instance's first content, the one signal it offers that the surface has started.
final class ReloadGate {
    private enum HostState {
        /// The host has not asked for its bundle: the bundle it asks for is the switch, no reload needed.
        case notAsked
        /// The host asked, and the instance it loads has not shown content yet.
        case starting
        /// The instance showed its first content: a reload goes straight through.
        case running
        /// A reload went to React Native: the host asks again and reads the persisted choice then.
        case reloading
    }

    private let lock = NSLock()
    private let reload: () -> Void

    private var hostState = HostState.notAsked
    private var isReloadHeld = false

    /// `reload` hands the reload to React Native; it runs once per reload the gate lets through.
    init(reload: @escaping () -> Void) {
        self.reload = reload
    }

    /// Whether the host has asked for its bundle in this process.
    var hasHostAsked: Bool {
        lock.lock()
        defer { lock.unlock() }
        return hostState != .notAsked
    }

    /// The host asks for its bundle, at the start and at every reload, and loads the persisted choice.
    func handleHostAsking() {
        lock.lock()
        hostState = .starting
        isReloadHeld = false
        lock.unlock()
    }

    /// A switch to the persisted bundle: held while the instance starts, a reload once it runs, and nothing otherwise,
    /// since the host's next ask reads the persisted choice.
    func requestReload() {
        lock.lock()
        let isReloadDue = hostState == .running
        if hostState == .starting {
            isReloadHeld = true
        }
        if isReloadDue {
            hostState = .reloading
        }
        lock.unlock()
        if isReloadDue { reload() }
    }

    /// The instance's first content: its surface has started, so a held reload goes now, once however often it was
    /// asked for. Returns whether the content shows the bundle the core serves, which it does not when a reload was
    /// held or is under way: the core has switched away from the bundle this instance runs.
    func handleContentDidAppear() -> Bool {
        lock.lock()
        let isReloadDue = releaseHeldReload()
        let isServedBundle = !isReloadDue && hostState != .reloading
        if hostState == .starting {
            hostState = .running
        }
        lock.unlock()
        if isReloadDue { reload() }
        return isServedBundle
    }

    /// The core rolled the running release back. A release that never renders gives React Native no signal at all, so
    /// its rollback releases the held reload. This relies on the core's order: `Core.reloadApp` calls
    /// `BundleLoader.loadServedBundle` and then `CoreListener.rolledBack` in one step, so the reload is held when this
    /// arrives. A core that reported the rollback first would leave that reload held until content that never comes.
    func handleRolledBack() {
        lock.lock()
        let isReloadDue = releaseHeldReload()
        lock.unlock()
        if isReloadDue { reload() }
    }

    /// Takes the held reload, if any, as the one reload under way; called with the lock held.
    private func releaseHeldReload() -> Bool {
        guard hostState == .starting, isReloadHeld else { return false }
        hostState = .reloading
        isReloadHeld = false
        return true
    }
}
