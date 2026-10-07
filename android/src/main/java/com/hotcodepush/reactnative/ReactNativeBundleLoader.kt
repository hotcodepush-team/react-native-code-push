package com.hotcodepush.reactnative

import android.content.Context
import android.net.ConnectivityManager
import com.hotcodepush.core.BundleLoader
import com.hotcodepush.core.EmbeddedBundle
import com.hotcodepush.core.EmbeddedBundleManifest
import com.hotcodepush.core.Hashing
import com.hotcodepush.core.PlainException
import java.io.File
import java.io.InputStream

/**
 * React Native loads the JavaScript its host is handed: a bundle is laid out by path under the store's `served`
 * directory, the host asks for the served one through [HotCodePushReactHost], and a switch is a reload of the host.
 */
class ReactNativeBundleLoader(private val context: Context, storeDirectory: File, private val reloadReactNative: () -> Unit) : BundleLoader {
    /** The bundle a reload the SDK asked for runs, `null` for the embedded one. */
    class RequestedReload(val bundleId: String?)

    private val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
    private val servedDirectory = File(storeDirectory, "served")

    private var isHostRunning = false
    private var requestedReload: RequestedReload? = null
    private var runningBundleId: String? = null

    /**
     * The host asks for its bundle, at the start and at every reload: until it is served one, the core's choice is persisted and
     * never reloaded into. Answers the reload the SDK asked for, `null` at the start and for a reload the SDK did not ask for.
     */
    @Synchronized
    fun beginBundleRequest(): RequestedReload? {
        isHostRunning = false
        return requestedReload.also { requestedReload = null }
    }

    /** The host runs the bundle from now on, `null` the embedded one: answers its file, none while the bundle's JavaScript is not on disk. */
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
        preferences.edit().apply { if (bundleId == null) remove(SERVED_BUNDLE_ID_KEY) else putString(SERVED_BUNDLE_ID_KEY, bundleId) }.apply()
    }

    /** A host that is not running yet is served the core's answer when it asks; a running one reloads into the bundle. */
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

    override fun isConnectionMetered(): Boolean =
        (context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager)?.isActiveNetworkMetered ?: false

    private fun bundleFile(bundleId: String) = File(projectionDirectory(bundleId), BUNDLE_FILE_NAME)

    /** The persisted bundle counts only while its JavaScript is on disk; anything else is the embedded bundle. */
    private fun persistedBundleId(): String? = preferences.getString(SERVED_BUNDLE_ID_KEY, null)?.takeIf { bundleFile(it).isFile }

    companion object {
        const val BUNDLE_FILE_NAME = "index.android.bundle"

        private const val PREFERENCES_NAME = "hotcodepush.reactNative"
        private const val SERVED_BUNDLE_ID_KEY = "servedBundleId"
    }
}

/**
 * The files compiled into the APK, addressed by the embedded manifest's hashes: the JavaScript among the assets,
 * the images among the resources. The build may recompress an image, so a resource counts only when its bytes still hash to the manifest's value.
 * None in a build that bundled no JavaScript, whose resource file carries no manifest.
 */
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

/** A bundle path React Native's bundler writes as an Android resource, `drawable-mdpi/logo.png` or `raw/sound.mp3`. */
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
