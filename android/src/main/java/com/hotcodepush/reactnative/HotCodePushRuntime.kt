package com.hotcodepush.reactnative

import android.app.Activity
import android.app.Application
import android.content.Context
import android.os.Bundle
import android.util.Log
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.JSBundleLoader
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactContext
import com.facebook.react.common.annotations.UnstableReactNativeAPI
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.common.UIManagerType
import com.hotcodepush.core.ActivityManagerProcessState
import com.hotcodepush.core.Configuration
import com.hotcodepush.core.Core
import com.hotcodepush.core.CoreListener
import com.hotcodepush.core.DeviceFacts
import com.hotcodepush.core.DownloadProgressEvent
import com.hotcodepush.core.FileStore
import com.hotcodepush.core.HandlerScheduler
import com.hotcodepush.core.SharedPreferencesStore
import com.hotcodepush.core.UpdateAvailableEvent
import com.hotcodepush.core.UpdateDownloadedEvent
import com.hotcodepush.core.UpdateFailedEvent
import com.hotcodepush.core.UpdateRolledBackEvent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject

interface HotCodePushEventSink {
    fun emitEvent(eventName: String, payload: JSONObject)
}

// The core starts when React Native first asks for its bundle, so a pending switch or rollback is decided before any JavaScript runs.
// The Turbo Module of every later JavaScript instance talks to that one core.
class HotCodePushRuntime internal constructor(private val context: Context) : CoreListener {
    private val scheduler = HandlerScheduler()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val loader = ReactNativeBundleLoader(SharedPreferencesStore(context), FileStore.defaultRootDirectory(context), ::reloadReactNative)

    @Volatile private var core: Core? = null

    @Volatile private var eventSink: HotCodePushEventSink? = null
    private var isStarted = false

    @Volatile private var notConfiguredMessage = Configuration.MISSING_MESSAGE
    private var retainedUpdateRolledBackEvent: JSONObject? = null

    // React Native asks at every start and every reload. Any failure falls back to the embedded bundle, so the host always starts.
    fun resolveBundleLoader(embeddedBundleLoader: JSBundleLoader): JSBundleLoader {
        val bundleFile = try {
            loader.serveBundle(resolveServedBundleId())
        } catch (failure: Throwable) {
            Log.e(TAG, START_FAILED_MESSAGE, failure)
            loader.serveBundle(null)
        }
        return bundleFile?.let { JSBundleLoader.createFileLoader(it.path) } ?: embeddedBundleLoader
    }

    // A reload the SDK did not ask for, such as `DevSettings.reload()`, react-native-restart or a development reload,
    // serves the running bundle without telling the core.
    private fun resolveServedBundleId(): String? {
        val requestedReload = loader.beginBundleRequest()
        if (claimStart()) return createCore(isServedBySdk = true)?.handleAppStartBlocking(isHeadless = !ActivityManagerProcessState.isInForeground())
        return if (requestedReload != null) requestedReload.bundleId else loader.runningBundleId
    }

    // Called for each new JavaScript instance. Its first render is the `render` readiness signal and, for any `readySignal`,
    // the moment the core's restarts wait for.
    @OptIn(UnstableReactNativeAPI::class)
    fun observeFirstRender(reactContext: ReactContext) {
        val uiManager = UIManagerHelper.getUIManager(reactContext, UIManagerType.FABRIC) ?: return
        uiManager.addUIManagerEventListener(FirstRenderListener(loader, { reactContext.currentActivity?.window?.decorView }, ::reportRendered))
    }

    private fun reportRendered() {
        val core = core ?: return
        scope.launch { core.handleRendered() }
    }

    // A reload replaces the module, so only the latest one receives events.
    fun attach(eventSink: HotCodePushEventSink) {
        this.eventSink = eventSink
        if (claimStart()) createCore(isServedBySdk = false)?.let { core -> scope.launch { core.handleAppStart() } }
    }

    fun detach(eventSink: HotCodePushEventSink) {
        if (this.eventSink === eventSink) this.eventSink = null
    }

    fun invoke(promise: Promise, body: suspend (Core) -> JSONObject?) {
        val core = core
        if (core == null) {
            promise.reject(HotCodePushModule.REJECTION_CODE, notConfiguredMessage)
            return
        }
        scope.launch {
            try {
                promise.resolve(body(core)?.toWritableMap())
            } catch (exception: Exception) {
                promise.reject(HotCodePushModule.REJECTION_CODE, exception.message, exception)
            }
        }
    }

    @Synchronized
    fun takeRetainedUpdateRolledBackEvent(): JSONObject? = retainedUpdateRolledBackEvent.also { retainedUpdateRolledBackEvent = null }

    // The core starts once per process: from the first bundle request, which waits up to `Core.START_TIMEOUT`,
    // or from the module of a host that never asked and so runs JavaScript the SDK does not serve.
    @Synchronized
    private fun claimStart(): Boolean {
        if (isStarted) return false
        isStarted = true
        return true
    }

    private fun createCore(isServedBySdk: Boolean): Core? {
        val readConfiguration = try {
            Configuration.read(context)
        } catch (refusal: Exception) {
            notConfiguredMessage = Configuration.resolveRefusedMessage(refusal)
            null
        }
        if (readConfiguration == null) {
            Log.e(TAG, notConfiguredMessage)
            return null
        }
        if (!isServedBySdk) Log.w(TAG, NOT_SERVED_MESSAGE)
        // A run whose JavaScript the SDK does not serve counts as a debug build, and `isEnabledInDebugBuilds` is off.
        val configuration = if (isServedBySdk) readConfiguration else readConfiguration.copy(isEnabledInDebugBuilds = false)
        val device = DeviceFacts.current(context, SDK_VERSION).let { if (isServedBySdk) it else it.copy(isDebugBuild = true) }
        val core = Core(
            context = context,
            configuration = configuration,
            device = device,
            embedded = ApkEmbeddedBundle(context, configuration.embeddedBundleManifest),
            loader = loader,
            listener = this,
            scope = scope,
            scheduler = scheduler,
        )
        this.core = core
        observeAppLifecycle(core)
        return core
    }

    private fun observeAppLifecycle(core: Core) {
        (context.applicationContext as? Application)?.registerActivityLifecycleCallbacks(object : ActivityLifecycleObserver() {
            override fun onActivityPaused(activity: Activity) {
                scope.launch { core.handleAppPause() }
            }

            override fun onActivityResumed(activity: Activity) {
                scope.launch { core.handleAppResume() }
            }
        })
    }

    private fun reloadReactNative() {
        (context.applicationContext as? ReactApplication)?.reactHost?.reload(RELOAD_REASON)
    }

    override fun updateAvailable(event: UpdateAvailableEvent) {
        eventSink?.emitEvent("updateAvailable", event.toJson())
    }

    override fun updateDownloaded(event: UpdateDownloadedEvent) {
        eventSink?.emitEvent("updateDownloaded", event.toJson())
    }

    override fun updateFailed(event: UpdateFailedEvent) {
        eventSink?.emitEvent("updateFailed", event.toJson())
    }

    override fun downloadProgress(event: DownloadProgressEvent) {
        eventSink?.emitEvent("downloadProgress", event.toJson())
    }

    // Kept until the JavaScript of the next start listens, since the instance that saw the rollback is gone by then.
    @Synchronized
    override fun updateRolledBack(event: UpdateRolledBackEvent) {
        retainedUpdateRolledBackEvent = event.toJson()
    }

    companion object {
        private const val NOT_SERVED_MESSAGE = "React Native did not ask HotCodePush for its bundle, so over-the-air (OTA) updates are off in this run: Metro serves a debug build, and any other build needs HotCodePushReactHost.getDefaultReactHost in MainApplication, which `npx hotcodepush doctor` checks."
        private const val RELOAD_REASON = "HotCodePush"
        private const val START_FAILED_MESSAGE = "HotCodePush could not answer which bundle React Native runs, so the embedded bundle runs."
        private const val TAG = "HotCodePush"

        @Volatile private var instance: HotCodePushRuntime? = null

        fun get(context: Context): HotCodePushRuntime =
            instance ?: synchronized(this) { instance ?: HotCodePushRuntime(context.applicationContext).also { instance = it } }
    }
}

private abstract class ActivityLifecycleObserver : Application.ActivityLifecycleCallbacks {
    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit

    override fun onActivityDestroyed(activity: Activity) = Unit

    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit

    override fun onActivityStarted(activity: Activity) = Unit

    override fun onActivityStopped(activity: Activity) = Unit
}
