package com.hotcodepush.reactnative

import android.content.Context
import com.hotcodepush.core.EmbeddedBundle
import com.hotcodepush.core.EmbeddedBundleManifest
import com.hotcodepush.core.Hashing
import com.hotcodepush.core.PlainException
import java.io.File
import java.io.InputStream

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
