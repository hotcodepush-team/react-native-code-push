package com.hotcodepush.reactnative

import com.facebook.react.bridge.JSBundleLoader
import com.facebook.react.bridge.JSBundleLoaderDelegate
import com.hotcodepush.core.Core
import com.hotcodepush.core.SharedPreferencesStore
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
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class HotCodePushRuntimeTest {
    private val context = contextWithResourceFile()
    private val runtime = HotCodePushRuntime(context)
    private val bundleLoader = ReactNativeBundleLoader(context, SharedPreferencesStore(context), File(context.filesDir, "hotcodepush")) {}
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

    // The Robolectric process is in the foreground, so the start is not headless.
    private fun mockCoreWhoseStartAnswers(bundleId: String?): MockedConstruction<Core> =
        mockConstruction(Core::class.java) { core, _ -> `when`(core.handleAppStartBlocking(false)).thenReturn(bundleId) }

    private fun askForBundle(): String = runtime.resolveBundleLoader(embeddedBundleLoader).loadScript(mock(JSBundleLoaderDelegate::class.java))

    private fun layOutBundle(bundleId: String): String {
        val bundleDirectory = bundleLoader.projectionDirectory(bundleId).also { it.mkdirs() }
        return File(bundleDirectory, ReactNativeBundleLoader.BUNDLE_FILE_NAME).also { it.writeText("") }.path
    }

    private fun downloadForNextStart(bundleId: String) {
        layOutBundle(bundleId)
        bundleLoader.persistServedBundle(bundleId)
    }

    companion object {
        private const val EMBEDDED_BUNDLE_URL = "assets://index.android.bundle"
    }
}
