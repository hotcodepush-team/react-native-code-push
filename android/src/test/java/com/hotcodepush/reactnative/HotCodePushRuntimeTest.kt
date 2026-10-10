package com.hotcodepush.reactnative

import android.content.Context
import android.content.ContextWrapper
import android.content.res.AssetManager
import com.facebook.react.bridge.JSBundleLoader
import com.facebook.react.bridge.JSBundleLoaderDelegate
import com.hotcodepush.core.Core
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.MockedConstruction
import org.mockito.Mockito.`when`
import org.mockito.Mockito.mock
import org.mockito.Mockito.mockConstruction
import org.mockito.Mockito.verify
import org.mockito.Mockito.verifyNoMoreInteractions
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File

/**
 * The bundle React Native loads, as its host asks the runtime at the start and at every reload, over a core whose start answers
 * the bundle its store names. A downloaded bundle is laid out and persisted through the SDK's own loader, where the core puts it.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class HotCodePushRuntimeTest {
    private val context = contextWithResourceFile()
    private val runtime = HotCodePushRuntime(context)
    private val bundleLoader = ReactNativeBundleLoader(context, File(context.filesDir, "hotcodepush")) {}
    private val embeddedBundleLoader = JSBundleLoader.createAssetLoader(context, EMBEDDED_BUNDLE_URL, true)

    @Test
    fun shouldServeTheBundleFileWhenTheCoresStoreNamesABundle() {
        val bundlePath = layOutBundle("b1")
        mockCoreWhoseStartAnswers("b1").use {
            assertEquals(bundlePath, askForBundle())
        }
    }

    @Test
    fun shouldServeTheEmbeddedBundleWhenTheCoresStoreNamesNone() {
        mockCoreWhoseStartAnswers(null).use {
            assertEquals(EMBEDDED_BUNDLE_URL, askForBundle())
        }
    }

    @Test
    fun shouldServeTheRunningBundleAndTellTheCoreNothingWhenTheHostReloadsWithoutTheSdkAskingForIt() {
        val bundlePath = layOutBundle("b1")
        mockCoreWhoseStartAnswers("b1").use { cores ->
            askForBundle()
            downloadForNextStart("b2")

            assertEquals(bundlePath, askForBundle())
            val core = cores.constructed().single()
            verify(core).handleAppStartBlocking(false)
            verifyNoMoreInteractions(core)
        }
    }

    /** The core the runtime creates, whose start answers the bundle its store names; the start is in the foreground, as Robolectric's process is. */
    private fun mockCoreWhoseStartAnswers(bundleId: String?): MockedConstruction<Core> =
        mockConstruction(Core::class.java) { core, _ -> `when`(core.handleAppStartBlocking(false)).thenReturn(bundleId) }

    /** React Native asks its host for the bundle and loads what the answer points at: the path it loads. */
    private fun askForBundle(): String = runtime.resolveBundleLoader(embeddedBundleLoader).loadScript(mock(JSBundleLoaderDelegate::class.java))

    /** A downloaded bundle's JavaScript where the core's download lays it out: answers the file's path. */
    private fun layOutBundle(bundleId: String): String {
        val bundleDirectory = bundleLoader.projectionDirectory(bundleId).also { it.mkdirs() }
        return File(bundleDirectory, ReactNativeBundleLoader.BUNDLE_FILE_NAME).also { it.writeText("") }.path
    }

    /** A release downloaded for the next start, laid out and persisted as the core does through the loader. */
    private fun downloadForNextStart(bundleId: String) {
        layOutBundle(bundleId)
        bundleLoader.persistServedBundle(bundleId)
    }

    private fun contextWithResourceFile(): Context {
        val resourceAssets = mock(AssetManager::class.java)
        `when`(resourceAssets.open("hotcodepush.json")).thenAnswer { RESOURCE_FILE.byteInputStream() }
        return object : ContextWrapper(RuntimeEnvironment.getApplication()) {
            override fun getAssets(): AssetManager = resourceAssets
        }
    }

    companion object {
        private const val EMBEDDED_BUNDLE_URL = "assets://index.android.bundle"
        private const val RESOURCE_FILE = """{"appId":"0b6d5c1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e","channelId":null,"builtAt":"2026-10-08T00:00:00.000Z","embeddedBundleManifest":null}"""
    }
}
