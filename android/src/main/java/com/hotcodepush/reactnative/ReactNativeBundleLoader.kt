package com.hotcodepush.reactnative

import com.hotcodepush.core.BundleLoader
import com.hotcodepush.core.KeyValueStore
import java.io.File

// React Native loads the JavaScript its host is handed, so a switch is a reload of the host.
// Bundles live under the `served` directory of the store, and a `null` bundle ID means the embedded bundle.
class ReactNativeBundleLoader(
    // The core's own store, so the bundle for the next start lies beside the state it belongs to.
    private val store: KeyValueStore,
    storeDirectory: File,
    private val reloadReactNative: () -> Unit,
) : BundleLoader {
    class RequestedReload(val bundleId: String?)

    private val servedDirectory = File(storeDirectory, "served")

    private var isHostRunning = false
    private var requestedReload: RequestedReload? = null

    // The bundle served last. A bundle request does not change it.
    @get:Synchronized
    var runningBundleId: String? = null
        private set

    // Called at the start and at every reload. Until the host is served, the core's choice is persisted but never reloaded into.
    // Returns `null` at the start and for a reload the SDK did not ask for.
    @Synchronized
    fun beginBundleRequest(): RequestedReload? {
        isHostRunning = false
        return requestedReload.also { requestedReload = null }
    }

    // Until the requested reload reaches the host, whatever renders is the instance the reload replaces.
    @get:Synchronized
    val isReloadPending: Boolean
        get() = requestedReload != null

    // Returns `null` while the JavaScript of the bundle is not on disk.
    @Synchronized
    fun serveBundle(bundleId: String?): File? {
        val file = bundleId?.let(::bundleFile)?.takeIf { it.isFile }
        runningBundleId = if (file == null) null else bundleId
        isHostRunning = true
        return file
    }

    override fun projectionDirectory(bundleId: String): File = File(servedDirectory, bundleId)

    override fun deleteProjection(bundleId: String) {
        projectionDirectory(bundleId).deleteRecursively()
    }

    override fun persistServedBundle(bundleId: String?) {
        store.putString(SERVED_BUNDLE_ID_KEY, bundleId)
    }

    // A host that is not running yet gets the bundle when it asks. A running host reloads into it.
    override fun loadServedBundle(bundleId: String?) {
        persistServedBundle(bundleId)
        val isReloadNeeded = synchronized(this) {
            if (isHostRunning) requestedReload = RequestedReload(bundleId)
            isHostRunning
        }
        if (isReloadNeeded) reloadReactNative()
    }

    @Synchronized
    override fun servedBundleId(): String? = if (isHostRunning) runningBundleId else persistedBundleId()

    private fun bundleFile(bundleId: String) = File(projectionDirectory(bundleId), BUNDLE_FILE_NAME)

    // The persisted bundle counts only while its JavaScript is on disk. Otherwise the embedded bundle runs.
    private fun persistedBundleId(): String? = store.getString(SERVED_BUNDLE_ID_KEY)?.takeIf { bundleFile(it).isFile }

    companion object {
        const val BUNDLE_FILE_NAME = "index.android.bundle"

        private const val SERVED_BUNDLE_ID_KEY = "hotcodepush.servedBundleId"
    }
}
