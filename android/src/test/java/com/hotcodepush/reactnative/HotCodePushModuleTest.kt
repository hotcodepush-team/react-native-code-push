package com.hotcodepush.reactnative

import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.hotcodepush.core.Core
import com.hotcodepush.core.PlainException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.Mockito.`when`
import org.mockito.Mockito.mock
import org.mockito.Mockito.mockConstruction
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class HotCodePushModuleTest {
    @Test
    fun shouldRejectTheSyncWhenItsApplyStrategyIsNotOneOfItsChoices() {
        mockConstruction(Core::class.java).use {
            val module = HotCodePushModule(reactContext())
            val rejection = CompletableFuture<List<Any?>>()
            val promise = mock(Promise::class.java) { invocation ->
                if (invocation.method.name == "reject") rejection.complete(invocation.arguments.toList())
                null
            }

            module.sync(JavaOnlyMap.of("applyStrategy", "soon"), promise)

            val (code, message, exception) = rejection.get(CALL_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            assertEquals(HotCodePushModule.REJECTION_CODE, code)
            assertEquals("applyStrategy is not one of its choices: soon", message)
            assertTrue(exception is PlainException)
        }
    }

    // The runtime reads the resource file through the application context.
    private fun reactContext(): ReactApplicationContext {
        val context = contextWithResourceFile()
        return mock(ReactApplicationContext::class.java).also { `when`(it.applicationContext).thenReturn(context) }
    }

    companion object {
        // Calls run in a coroutine on the IO dispatcher.
        private const val CALL_TIMEOUT_SECONDS = 5L
    }
}
