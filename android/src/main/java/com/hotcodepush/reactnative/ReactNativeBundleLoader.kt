package com.hotcodepush.reactnative

import android.content.Context
import com.hotcodepush.core.BundleLoader
import com.hotcodepush.core.EmbeddedBundle
import com.hotcodepush.core.EmbeddedBundleManifest
import com.hotcodepush.core.Hashing
import com.hotcodepush.core.KeyValueStore
import com.hotcodepush.core.NetworkMonitor
import com.hotcodepush.core.PlainException
import java.io.File
import java.io.InputStream

// React Native loads the JavaScript its host is handed, so a switch is a reload of the host.
// Bundles live under the `served` directory of the store, and a `null` bundle ID means the embedded bundle.
class ReactNativeBundleLoader(
    context: Context,
    // The core's own store, so the bundle for the next start lies beside the state it belongs to.
    private val store: KeyValueStore,
    storeDirectory: File,
    private val reloadReactNative: () -> Unit,
) : BundleLoader {
    class RequestedReload(val bundleId: String?)

    private val networkMonitor = NetworkMonitor(context)
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

    override fun isConnectionMetered(): Boolean = networkMonitor.isConnectionMetered()

    private fun bundleFile(bundleId: String) = File(projectionDirectory(bundleId), BUNDLE_FILE_NAME)

    // The persisted bundle counts only while its JavaScript is on disk. Otherwise the embedded bundle runs.
    private fun persistedBundleId(): String? = store.getString(SERVED_BUNDLE_ID_KEY)?.takeIf { bundleFile(it).isFile }

    companion object {
        const val BUNDLE_FILE_NAME = "index.android.bundle"

        private const val SERVED_BUNDLE_ID_KEY = "hotcodepush.servedBundleId"
    }
}

// The JavaScript lives among the assets and the images among the resources.
// The build may recompress an image, so a resource counts only while its bytes still match the manifest hash.
class ApkEmbeddedBundle(private val context: Context, manifest: EmbeddedBundleManifest?) : EmbeddedBundle {
    private val pathsBySha256 = manifest?.files.orEmpty().associate { it.sha256 to it.path }

    override fun has(sha256: String): Boolean = open(sha256)?.use { true } ?: false

    override fun copyFile(sha256: String, destination: File) {
        val input = open(sha256) ?: throw PlainException("No embedded file with hash $sha256")
        input.use { source -> destination.outputStream().use { source.copyTo(it) } }
    }

    private fun open(sha256: String): InputStream? {
        val path = pathsBySha256[sha256] ?: return null
        val resource = ResourcePath.parse(path) ?: return runCatching { context.assets.open(path) }.getOrNull()
        val bytes = readResource(resource) ?: return null
        return if (Hashing.sha256Hex(bytes) == sha256) bytes.inputStream() else null
    }

    private fun readResource(resource: ResourcePath): ByteArray? {
        val id = context.resources.getIdentifier(resource.name, resource.type, context.packageName)
        if (id == 0) return null
        return runCatching { context.resources.openRawResource(id).use { it.readBytes() } }.getOrNull()
    }
}

// A bundle path that the React Native bundler writes as an Android resource, such as `drawable-mdpi/logo.png` or `raw/sound.mp3`.
private class ResourcePath(val type: String, val name: String) {
    companion object {
        private val RESOURCE_TYPES = setOf("drawable", "raw")

        fun parse(path: String): ResourcePath? {
            val segments = path.split('/')
            if (segments.size != 2) return null
            val type = segments[0].substringBefore('-')
            return if (type in RESOURCE_TYPES) ResourcePath(type, segments[1].substringBeforeLast('.')) else null
        }
    }
}
