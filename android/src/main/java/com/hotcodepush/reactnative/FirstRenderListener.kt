package com.hotcodepush.reactnative

import android.view.View
import android.view.ViewGroup
import com.facebook.react.bridge.UIManager
import com.facebook.react.bridge.UIManagerListener
import com.facebook.react.common.annotations.UnstableReactNativeAPI
import com.facebook.react.uimanager.ReactRoot

/**
 * The first render of one JavaScript instance: the first frame that finds a view inside a React root. The root itself is
 * mounted before any render, so an instance that renders nothing never signals it, and an instance that renders while a
 * reload the SDK asked for is pending is the one the reload replaces, whose render signals nothing.
 *
 * The root is checked at every frame React Native dispatches its mounting work, never at a mount alone: the first mount
 * can come before React Native reports the instance to the runtime, and a mount made before the root view is attached
 * runs at the attach, which no mount listener hears. A reload clears the root before it creates the next instance.
 */
@OptIn(UnstableReactNativeAPI::class)
internal class FirstRenderListener(
    private val loader: ReactNativeBundleLoader,
    private val readDecorView: () -> View?,
    private val onRendered: () -> Unit,
) : UIManagerListener {
    override fun didDispatchMountItems(uiManager: UIManager) {
        val decorView = readDecorView() ?: return
        if (!containsRenderedReactRoot(decorView)) return
        uiManager.removeUIManagerEventListener(this)
        if (loader.isReloadPending) return
        onRendered()
    }

    override fun didMountItems(uiManager: UIManager) = Unit

    override fun didScheduleMountItems(uiManager: UIManager) = Unit

    override fun willDispatchViewUpdates(uiManager: UIManager) = Unit

    override fun willMountItems(uiManager: UIManager) = Unit

    // The getter called as a method: ReactRoot is Java until React Native 0.82 and Kotlin from 0.83, which has no property for it.
    private fun containsRenderedReactRoot(view: View): Boolean = when (view) {
        is ReactRoot -> view.getRootViewGroup().childCount > 0
        is ViewGroup -> (0 until view.childCount).any { containsRenderedReactRoot(view.getChildAt(it)) }
        else -> false
    }
}
