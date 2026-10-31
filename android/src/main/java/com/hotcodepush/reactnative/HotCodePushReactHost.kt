package com.hotcodepush.reactnative

import android.content.Context
import com.facebook.react.ReactHost
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.JSBundleLoader
import com.facebook.react.bridge.ReactContext
import com.facebook.react.common.annotations.UnstableReactNativeAPI
import com.facebook.react.common.build.ReactBuildConfig
import com.facebook.react.defaults.DefaultComponentsRegistry
import com.facebook.react.defaults.DefaultReactHostDelegate
import com.facebook.react.defaults.DefaultTurboModuleManagerDelegate
import com.facebook.react.fabric.ComponentFactory
import com.facebook.react.runtime.BindingsInstaller
import com.facebook.react.runtime.JSRuntimeFactory
import com.facebook.react.runtime.ReactHostDelegate
import com.facebook.react.runtime.ReactHostImpl
import com.facebook.react.runtime.cxxreactpackage.CxxReactPackage
import com.facebook.react.runtime.hermes.HermesInstance

/**
 * A drop-in replacement for `DefaultReactHost.getDefaultReactHost` that asks the SDK for the bundle at every start and reload.
 * Import it in `MainApplication` in place of the React Native one. The parameters are the same.
 * Applying a release then reloads the JavaScript without restarting the process.
 */
object HotCodePushReactHost {
    private var reactHost: ReactHost? = null

    @OptIn(UnstableReactNativeAPI::class)
    @JvmStatic
    @JvmOverloads
    @Synchronized
    fun getDefaultReactHost(
        context: Context,
        packageList: List<ReactPackage>,
        jsMainModulePath: String = "index",
        jsBundleAssetPath: String = "index.android.bundle",
        jsBundleFilePath: String? = null,
        jsRuntimeFactory: JSRuntimeFactory? = null,
        useDevSupport: Boolean = ReactBuildConfig.DEBUG,
        cxxReactPackageProviders: List<(ReactContext) -> CxxReactPackage> = emptyList(),
        exceptionHandler: (Exception) -> Unit = { throw it },
        bindingsInstaller: BindingsInstaller? = null,
    ): ReactHost {
        reactHost?.let { return it }
        val embeddedBundleLoader = when {
            jsBundleFilePath == null -> JSBundleLoader.createAssetLoader(context, "assets://$jsBundleAssetPath", true)
            jsBundleFilePath.startsWith("assets://") -> JSBundleLoader.createAssetLoader(context, jsBundleFilePath, true)
            else -> JSBundleLoader.createFileLoader(jsBundleFilePath)
        }
        val turboModuleManagerDelegateBuilder = DefaultTurboModuleManagerDelegate.Builder()
        cxxReactPackageProviders.forEach { turboModuleManagerDelegateBuilder.addCxxReactPackage(it) }
        val runtime = HotCodePushRuntime.get(context)
        val delegate = ServedBundleReactHostDelegate(
            DefaultReactHostDelegate(
                jsMainModulePath = jsMainModulePath,
                jsBundleLoader = embeddedBundleLoader,
                reactPackages = packageList,
                jsRuntimeFactory = jsRuntimeFactory ?: HermesInstance(),
                bindingsInstaller = bindingsInstaller,
                turboModuleManagerDelegateBuilder = turboModuleManagerDelegateBuilder,
                exceptionHandler = exceptionHandler,
            ),
        ) { runtime.resolveBundleLoader(embeddedBundleLoader) }
        val componentFactory = ComponentFactory()
        DefaultComponentsRegistry.register(componentFactory)
        return ReactHostImpl(context, delegate, componentFactory, true, useDevSupport).also {
            it.addReactInstanceEventListener(object : ReactInstanceEventListener {
                override fun onReactContextInitialized(context: ReactContext) = runtime.observeFirstRender(context)
            })
            reactHost = it
        }
    }
}

@OptIn(UnstableReactNativeAPI::class)
private class ServedBundleReactHostDelegate(
    delegate: ReactHostDelegate,
    private val resolveBundleLoader: () -> JSBundleLoader,
) : ReactHostDelegate by delegate {
    override val jsBundleLoader: JSBundleLoader
        get() = resolveBundleLoader()
}
