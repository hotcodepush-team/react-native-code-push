package com.hotcodepush.reactnative

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.SharedPreferences
import android.content.pm.ApplicationInfo
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.ViewGroup
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.JSBundleLoader
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UIManager
import com.facebook.react.bridge.UIManagerListener
import com.facebook.react.common.annotations.UnstableReactNativeAPI
import com.facebook.react.uimanager.ReactRoot
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.common.UIManagerType
import com.hotcodepush.protocol.Clock
import com.hotcodepush.protocol.Configuration
import com.hotcodepush.protocol.Core
import com.hotcodepush.protocol.CoreListener
import com.hotcodepush.protocol.DeviceFacts
import com.hotcodepush.protocol.FileStore
import com.hotcodepush.protocol.KeyValueStore
import com.hotcodepush.protocol.OkHttpClientAdapter
import com.hotcodepush.protocol.RolledBackEvent
import com.hotcodepush.protocol.ScheduledTask
import com.hotcodepush.protocol.Scheduler
import com.hotcodepush.protocol.UpdateAvailableEvent
import com.hotcodepush.protocol.UpdateDownloadedEvent
import com.hotcodepush.protocol.UpdateFailedEvent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import java.io.File

/** What the runtime hands the Turbo Module: an event to emit to JavaScript. */
interface HotCodePushEventSink {
    fun emitEvent(eventName: String, payload: JSONObject)
}

/**
 * The SDK inside the process, one per app: it starts the core when React Native asks for its bundle, so the start's
 * verdict — the pending switch, the rollback of a release that never became ready — is in before any JavaScript runs,
 * and the Turbo Module of every JavaScript instance since talks to that one core.
 */
class HotCodePushRuntime private constructor(private val context: Context) : CoreListener {
    private val scheduler = HandlerScheduler()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @Volatile private var core: Core? = null

    @Volatile private var eventSink: HotCodePushEventSink? = null
    private var isStarted = false

    @Volatile private var loader: ReactNativeBundleLoader? = null
    private var retainedRolledBackEvent: JSONObject? = null

    // The host

    /** What React Native loads, asked at every start and reload: the served bundle's file, else the bundle the binary ships. */
    fun resolveBundleLoader(embeddedBundleLoader: JSBundleLoader): JSBundleLoader {
        start(isHostAsking = true)
        val bundleFile = loader?.resolveBundleFile() ?: return embeddedBundleLoader
        return JSBundleLoader.createFileLoader(bundleFile.path)
    }

    /**
     * A JavaScript instance was created, at the start and at every reload: the first mount that leaves a view inside a
     * React root is the first frame after the root view renders: the readiness signal `render`, and whatever
     * `readySignal` is, the moment the app is up in this run, which the core's own restarts wait for. The root itself is
     * mounted before any render, so an instance that renders nothing never signals it.
     */
    @OptIn(UnstableReactNativeAPI::class)
    fun observeFirstRender(reactContext: ReactContext) {
        val uiManager = UIManagerHelper.getUIManager(reactContext, UIManagerType.FABRIC) ?: return
        uiManager.addUIManagerEventListener(object : UIManagerListener {
            override fun didDispatchMountItems(uiManager: UIManager) = Unit

            override fun didMountItems(uiManager: UIManager) {
                val decorView = reactContext.currentActivity?.window?.decorView ?: return
                if (!containsRenderedReactRoot(decorView)) return
                uiManager.removeUIManagerEventListener(this)
                val core = core ?: return
                scope.launch { core.handleRendered() }
            }

            override fun didScheduleMountItems(uiManager: UIManager) = Unit

            override fun willDispatchViewUpdates(uiManager: UIManager) = Unit

            override fun willMountItems(uiManager: UIManager) = Unit
        })
    }

    private fun containsRenderedReactRoot(view: View): Boolean = when (view) {
        is ReactRoot -> view.rootViewGroup.childCount > 0
        is ViewGroup -> (0 until view.childCount).any { containsRenderedReactRoot(view.getChildAt(it)) }
        else -> false
    }

    // The Turbo Module

    /** The module of the JavaScript instance that runs now; a reload replaces it. */
    fun attach(eventSink: HotCodePushEventSink) {
        this.eventSink = eventSink
        start(isHostAsking = false)
    }

    fun detach(eventSink: HotCodePushEventSink) {
        if (this.eventSink === eventSink) this.eventSink = null
    }

    fun invoke(promise: Promise, body: suspend (Core) -> JSONObject?) {
        val core = core
        if (core == null) {
            promise.reject(HotCodePushModule.REJECTION_CODE, NOT_CONFIGURED_MESSAGE)
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
    fun takeRetainedRolledBackEvent(): JSONObject? = retainedRolledBackEvent.also { retainedRolledBackEvent = null }

    // The start

    /**
     * Once per process. A host that asks for its bundle waits for the core's start, which only reads and writes the
     * device's own store; a host that never asked runs JavaScript the SDK does not serve, so the core stays off.
     */
    private fun start(isHostAsking: Boolean) {
        val core = synchronized(this) {
            if (isStarted) return
            isStarted = true
            createCore(isHostAsking)
        } ?: return
        if (isHostAsking) {
            runBlocking { core.handleAppStart() }
        } else {
            scope.launch { core.handleAppStart() }
        }
    }

    private fun createCore(isServedBySdk: Boolean): Core? {
        val readConfiguration = readConfiguration(context)
        if (readConfiguration == null) {
            Log.e(TAG, NOT_CONFIGURED_MESSAGE)
            return null
        }
        if (!isServedBySdk) Log.w(TAG, NOT_SERVED_MESSAGE)
        val configuration = if (isServedBySdk) readConfiguration else readConfiguration.copy(enabledInDebugBuilds = false)
        val storeDirectory = File(context.filesDir, "hotcodepush")
        val loader = ReactNativeBundleLoader(context, storeDirectory, ::reloadReactNative)
        val core = Core(
            configuration = configuration,
            device = deviceFacts(context, isServedBySdk),
            store = SharedPreferencesStore(context.getSharedPreferences("${context.packageName}_preferences", Context.MODE_PRIVATE)),
            files = FileStore(storeDirectory),
            embedded = ApkEmbeddedBundle(context, configuration.embeddedBundleManifest),
            http = OkHttpClientAdapter(),
            loader = loader,
            listener = this,
            scheduler = scheduler,
            clock = Clock { System.currentTimeMillis() },
            scope = scope,
            temporaryDirectory = File(context.cacheDir, "hotcodepush"),
        )
        this.loader = loader
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

    // The listener

    override fun updateAvailable(event: UpdateAvailableEvent) {
        eventSink?.emitEvent("updateAvailable", event.toJson())
    }

    override fun updateDownloaded(event: UpdateDownloadedEvent) {
        eventSink?.emitEvent("updateDownloaded", event.toJson())
    }

    override fun updateFailed(event: UpdateFailedEvent) {
        eventSink?.emitEvent("updateFailed", event.toJson())
    }

    override fun downloadProgress(releaseId: String, downloadedBytes: Long, totalBytes: Long) {
        val progress = if (totalBytes > 0) downloadedBytes.toDouble() / totalBytes else 0.0
        eventSink?.emitEvent(
            "downloadProgress",
            JSONObject().put("releaseId", releaseId).put("downloadedBytes", downloadedBytes).put("totalBytes", totalBytes).put("progress", progress),
        )
    }

    /** Kept until the JavaScript of the start that follows the rollback listens: the instance that saw the rollback is gone by then. */
    @Synchronized
    override fun rolledBack(event: RolledBackEvent) {
        retainedRolledBackEvent = event.toJson()
    }

    companion object {
        const val SDK_VERSION = "0.0.0"

        private const val NOT_CONFIGURED_MESSAGE = "HotCodePush is not configured: hotcodepush.json is missing from the app's assets. Run `npx hotcodepush init` and build the app once."
        private const val NOT_SERVED_MESSAGE = "React Native did not ask HotCodePush for its bundle, so live updates are off in this run: Metro serves a debug build, and any other build needs HotCodePushReactHost.getDefaultReactHost in MainApplication, which `npx hotcodepush doctor` checks."
        private const val RELOAD_REASON = "HotCodePush"
        private const val TAG = "HotCodePush"

        @Volatile private var instance: HotCodePushRuntime? = null

        fun get(context: Context): HotCodePushRuntime =
            instance ?: synchronized(this) { instance ?: HotCodePushRuntime(context.applicationContext).also { instance = it } }

        private fun readConfiguration(context: Context): Configuration? = try {
            context.assets.open("hotcodepush.json").bufferedReader().use { Configuration.decode(it.readText()) }
        } catch (exception: Exception) {
            null
        }

        /** A run whose JavaScript the SDK does not serve counts as a debug build, which `enabledInDebugBuilds` then switches off. */
        private fun deviceFacts(context: Context, isServedBySdk: Boolean): DeviceFacts {
            val info = context.packageManager.getPackageInfo(context.packageName, 0)
            val versionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
            return DeviceFacts(
                platform = "android",
                binaryVersion = info.versionName ?: "",
                binaryBuild = versionCode.toString(),
                osVersion = Build.VERSION.RELEASE ?: "",
                sdkVersion = SDK_VERSION,
                isDebugBuild = !isServedBySdk || (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0,
            )
        }
    }
}

private class SharedPreferencesStore(private val preferences: SharedPreferences) : KeyValueStore {
    override fun getString(key: String): String? = preferences.getString(key, null)

    override fun putString(key: String, value: String?) {
        preferences.edit().apply { if (value == null) remove(key) else putString(key, value) }.apply()
    }

    override fun getInt(key: String): Int? = if (preferences.contains(key)) runCatching { preferences.getInt(key, 0) }.getOrNull() else null

    override fun putInt(key: String, value: Int?) {
        preferences.edit().apply { if (value == null) remove(key) else putInt(key, value) }.apply()
    }
}

private class HandlerScheduler : Scheduler {
    private val handler = Handler(Looper.getMainLooper())

    override fun schedule(afterSeconds: Double, block: () -> Unit): ScheduledTask {
        val runnable = Runnable(block)
        handler.postDelayed(runnable, (afterSeconds * 1000).toLong())
        return ScheduledTask { handler.removeCallbacks(runnable) }
    }
}

/** The two moments the runtime follows; the rest of the interface is noise it leaves empty. */
private abstract class ActivityLifecycleObserver : Application.ActivityLifecycleCallbacks {
    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit

    override fun onActivityDestroyed(activity: Activity) = Unit

    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit

    override fun onActivityStarted(activity: Activity) = Unit

    override fun onActivityStopped(activity: Activity) = Unit
}
