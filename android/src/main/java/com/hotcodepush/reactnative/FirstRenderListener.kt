package com.hotcodepush.reactnative

import android.view.View
import android.view.ViewGroup
import com.facebook.react.bridge.UIManager
import com.facebook.react.bridge.UIManagerListener
import com.facebook.react.common.annotations.UnstableReactNativeAPI
import com.facebook.react.uimanager.ReactRoot

// The first render is the first frame that finds a view inside a React root, since the root itself mounts before any render.
// While a reload the SDK asked for is pending, the render belongs to the replaced instance and signals nothing.
//
// The check runs at every dispatched frame, not at a mount. The first mount can come before React Native reports the instance,
// and a mount before the root view is attached runs at the attach, which no mount listener hears.
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

    // ReactRoot is Java up to React Native 0.82 and Kotlin from 0.83, which has no property for this getter.
    private fun containsRenderedReactRoot(view: View): Boolean = when (view) {
        is ReactRoot -> view.getRootViewGroup().childCount > 0
        is ViewGroup -> (0 until view.childCount).any { containsRenderedReactRoot(view.getChildAt(it)) }
        else -> false
    }
}
