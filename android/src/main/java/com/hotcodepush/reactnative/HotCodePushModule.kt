package com.hotcodepush.reactnative

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.hotcodepush.core.ChannelChoice
import com.hotcodepush.core.DebugScreen
import com.hotcodepush.core.DownloadStrategy
import com.hotcodepush.core.InstallStrategy
import com.hotcodepush.core.MandatoryInstallStrategy
import com.hotcodepush.core.PlainException
import com.hotcodepush.core.SyncOptions
import com.hotcodepush.core.SyncTrigger
import org.json.JSONObject

/** The Turbo Module `HotCodePush`: the JavaScript surface over [HotCodePushRuntime]. */
class HotCodePushModule(reactContext: ReactApplicationContext) : NativeHotCodePushSpec(reactContext), HotCodePushEventSink {
    private val runtime = HotCodePushRuntime.get(reactContext)

    init {
        runtime.attach(this)
    }

    /** A reload replaces this instance with the module of the new JavaScript. */
    override fun invalidate() {
        runtime.detach(this)
        super.invalidate()
    }

    override fun applyUpdate(promise: Promise) = runtime.invoke(promise) { it.applyUpdate().toJson() }

    override fun checkForUpdate(promise: Promise) = runtime.invoke(promise) { it.checkForUpdate().toJson() }

    override fun clearUpdates(promise: Promise) = runtime.invoke(promise) {
        it.clearUpdates()
        null
    }

    override fun consumeRolledBack(promise: Promise) {
        promise.resolve(JSONObject().put("event", runtime.takeRetainedRolledBackEvent() ?: JSONObject.NULL).toWritableMap())
    }

    override fun downloadUpdate(promise: Promise) = runtime.invoke(promise) { it.downloadUpdate().toJson() }

    override fun getChannel(promise: Promise) = runtime.invoke(promise) { it.channel().toJson() }

    override fun getDevice(promise: Promise) = runtime.invoke(promise) { it.deviceResult().toJson() }

    override fun getState(promise: Promise) = runtime.invoke(promise) { it.getState().toJson() }

    override fun notifyReady(promise: Promise) = runtime.invoke(promise) { it.notifyReady().toJson() }

    override fun rollbackUpdate(options: ReadableMap, promise: Promise) {
        val reason = options.getStringOrNull("reason")
        runtime.invoke(promise) {
            it.rollbackUpdate(reason)
            null
        }
    }

    override fun setAttributes(options: ReadableMap, promise: Promise) {
        val changes = mutableMapOf<String, String?>()
        val keys = options.keySetIterator()
        while (keys.hasNextKey()) {
            val key = keys.nextKey()
            when (options.getType(key)) {
                ReadableType.Null -> changes[key] = null
                ReadableType.String -> changes[key] = options.getString(key)
                else -> {
                    promise.reject(REJECTION_CODE, "An attribute value is a string or null: $key")
                    return
                }
            }
        }
        runtime.invoke(promise) {
            it.setAttributes(changes)
            null
        }
    }

    override fun setChannel(options: ReadableMap, promise: Promise) {
        val choice = options.getStringOrNull("id")?.let { ChannelChoice.Id(it) } ?: options.getStringOrNull("name")?.let { ChannelChoice.Name(it) }
        runtime.invoke(promise) {
            it.setChannel(choice)
            null
        }
    }

    override fun setRestartAllowed(options: ReadableMap, promise: Promise) {
        if (!options.hasKey("allowed") || options.getType("allowed") != ReadableType.Boolean) {
            promise.reject(REJECTION_CODE, "allowed must be a boolean")
            return
        }
        val allowed = options.getBoolean("allowed")
        runtime.invoke(promise) {
            it.setRestartAllowed(allowed)
            null
        }
    }

    /** Opens the shared core's debug screen over the app's activity. */
    override fun showDebugScreen(promise: Promise) = runtime.invoke(promise) { core ->
        DebugScreen.show(reactApplicationContext.currentActivity ?: reactApplicationContext, core)
        null
    }

    override fun sync(options: ReadableMap, promise: Promise) {
        val syncOptions = try {
            syncOptions(options)
        } catch (exception: PlainException) {
            promise.reject(REJECTION_CODE, exception.message)
            return
        }
        runtime.invoke(promise) { it.sync(SyncTrigger.MANUAL, syncOptions).toJson() }
    }

    override fun emitEvent(eventName: String, payload: JSONObject) {
        // React Native hands the module its emitter callback after init; an event before that has no JavaScript listening yet.
        if (mEventEmitterCallback == null) return
        val value = payload.toWritableMap()
        when (eventName) {
            "downloadProgress" -> emitOnDownloadProgress(value)
            "updateAvailable" -> emitOnUpdateAvailable(value)
            "updateDownloaded" -> emitOnUpdateDownloaded(value)
            "updateFailed" -> emitOnUpdateFailed(value)
        }
    }

    /** Each stage's strategy for this call; a value outside its choices is a programming mistake and rejects the call. */
    private fun syncOptions(options: ReadableMap) = SyncOptions(
        downloadStrategy = option("downloadStrategy", options, DownloadStrategy::fromWire),
        installStrategy = option("installStrategy", options, InstallStrategy::fromWire),
        mandatoryInstallStrategy = option("mandatoryInstallStrategy", options, MandatoryInstallStrategy::fromWire),
    )

    private fun <T> option(name: String, options: ReadableMap, parse: (String?) -> T?): T? {
        val raw = options.getStringOrNull(name) ?: return null
        return parse(raw) ?: throw PlainException("$name is not one of its choices: $raw")
    }

    private fun ReadableMap.getStringOrNull(key: String): String? =
        if (hasKey(key) && getType(key) == ReadableType.String) getString(key) else null

    companion object {
        const val NAME = NativeHotCodePushSpec.NAME
        const val REJECTION_CODE = "HotCodePush"
    }
}

/** A result or an event as the bridge carries it. */
internal fun JSONObject.toWritableMap() = Arguments.makeNativeMap(toMap())

private fun JSONObject.toMap(): Map<String, Any?> = keys().asSequence().associateWith { toBridgeValue(get(it)) }

private fun toBridgeValue(value: Any?): Any? = when (value) {
    JSONObject.NULL -> null
    is JSONObject -> value.toMap()
    is org.json.JSONArray -> (0 until value.length()).map { toBridgeValue(value.get(it)) }
    is Long -> value.toDouble()
    else -> value
}
