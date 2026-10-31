package com.hotcodepush.reactnative

import android.content.Context
import android.content.ContextWrapper
import android.content.res.AssetManager
import org.mockito.Mockito.`when`
import org.mockito.Mockito.mock
import org.robolectric.RuntimeEnvironment

private const val RESOURCE_FILE = """{"appId":"0b6d5c1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e","channelId":null,"builtAt":"2026-10-08T00:00:00.000Z","fingerprint":null,"embeddedBundleManifest":null,"embeddedBundleId":null}"""

internal fun contextWithResourceFile(): Context {
    val resourceAssets = mock(AssetManager::class.java)
    `when`(resourceAssets.open("hotcodepush.json")).thenAnswer { RESOURCE_FILE.byteInputStream() }
    return object : ContextWrapper(RuntimeEnvironment.getApplication()) {
        override fun getAssets(): AssetManager = resourceAssets
    }
}
