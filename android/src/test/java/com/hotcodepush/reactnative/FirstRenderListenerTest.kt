package com.hotcodepush.reactnative

import android.content.Context
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import com.facebook.react.bridge.UIManager
import com.facebook.react.common.annotations.UnstableReactNativeAPI
import com.facebook.react.uimanager.ReactRoot
import com.facebook.react.uimanager.common.UIManagerType
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.Mockito.mock
import org.mockito.Mockito.never
import org.mockito.Mockito.verify
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File
import java.util.concurrent.atomic.AtomicInteger

/**
 * The first render of a JavaScript instance, read from a window whose React root the test mounts views into, one dispatched
 * frame at a time. The loader is the SDK's own and records the reloads it asks for, which the test then runs as React Native does.
 */
@OptIn(UnstableReactNativeAPI::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class FirstRenderListenerTest {
    private val context: Context = RuntimeEnvironment.getApplication()
    private val decorView = FrameLayout(context)
    private val reactRoot = TestReactRoot(context)
    private val uiManager: UIManager = mock(UIManager::class.java)
    private var requestedReloads = 0
    private val loader = ReactNativeBundleLoader(context, File(context.filesDir, "hotcodepush")) { requestedReloads++ }
    private var renders = 0

    @Test
    fun shouldSignalWhenTheRootHoldsAViewMountedAtAFrameBeforeTheListenerExisted() {
        decorView.addView(reactRoot)
        reactRoot.addView(View(context))
        val listener = createListener()

        listener.didDispatchMountItems(uiManager)

        assertEquals(1, renders)
        verify(uiManager).removeUIManagerEventListener(listener)
    }

    @Test
    fun shouldSignalAtTheFirstFrameAfterTheAttachWhenTheRootWasRenderedBeforeItWasAttached() {
        reactRoot.addView(View(context))
        val listener = createListener()
        listener.didDispatchMountItems(uiManager)
        assertEquals(0, renders)

        decorView.addView(reactRoot)
        listener.didDispatchMountItems(uiManager)

        assertEquals(1, renders)
    }

    @Test
    fun shouldSignalNothingAndStopListeningWhenTheRootRendersWhileAReloadTheSdkAskedForIsPending() {
        loader.serveBundle(null)
        loader.loadServedBundle("b2")
        decorView.addView(reactRoot)
        reactRoot.addView(View(context))
        val listener = createListener()

        listener.didDispatchMountItems(uiManager)

        assertEquals(1, requestedReloads)
        assertEquals(0, renders)
        verify(uiManager).removeUIManagerEventListener(listener)
    }

    @Test
    fun shouldSignalOnlyTheNewInstancesRenderWhenTheReloadClearedTheRoot() {
        loader.serveBundle(null)
        decorView.addView(reactRoot)
        reactRoot.addView(View(context))
        loader.loadServedBundle("b2")
        reloadAsReactNativeDoes("b2")
        val listener = createListener()
        listener.didDispatchMountItems(uiManager)
        assertEquals(0, renders)
        verify(uiManager, never()).removeUIManagerEventListener(listener)

        reactRoot.addView(View(context))
        listener.didDispatchMountItems(uiManager)

        assertEquals(1, renders)
    }

    private fun createListener() = FirstRenderListener(loader, { decorView }) { renders++ }

    /** The replaced instance's views leave the root, then the host asks for the bundle of the new instance. */
    private fun reloadAsReactNativeDoes(bundleId: String) {
        reactRoot.removeAllViews()
        loader.beginBundleRequest()
        loader.serveBundle(bundleId)
    }
}

/** A React root as React Native's root view is one: a view group that is its own root view group. */
private class TestReactRoot(context: Context) : FrameLayout(context), ReactRoot {
    override fun getAppProperties(): Bundle? = null

    override fun getHeightMeasureSpec() = 0

    override fun getJSModuleName() = "App"

    override fun getRootViewGroup(): ViewGroup = this

    override fun getRootViewTag() = 1

    override fun getState() = AtomicInteger(ReactRoot.STATE_STARTED)

    @Deprecated("ReactRoot's own deprecation")
    override fun getSurfaceID(): String? = null

    override fun getUIManagerType() = UIManagerType.FABRIC

    override fun getWidthMeasureSpec() = 0

    override fun onStage(stage: Int) = Unit

    override fun runApplication() = Unit

    override fun setRootViewTag(rootViewTag: Int) = Unit

    override fun setShouldLogContentAppeared(shouldLogContentAppeared: Boolean) = Unit
}
