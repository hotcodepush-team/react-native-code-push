package com.hotcodepush.reactnative

import android.content.Context
import android.content.SharedPreferences
import com.hotcodepush.core.KeyValueStore
import com.hotcodepush.core.SharedPreferencesStore
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.Mockito.RETURNS_SELF
import org.mockito.Mockito.`when`
import org.mockito.Mockito.inOrder
import org.mockito.Mockito.mock
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ReactNativeBundleLoaderTest {
    private val context: Context = RuntimeEnvironment.getApplication()

    @Test
    fun shouldCommitTheServedBundleUnderItsKeyBeforeThePersistReturns() {
        val editor = mock(SharedPreferences.Editor::class.java, RETURNS_SELF)
        val preferences = mock(SharedPreferences::class.java).also { `when`(it.edit()).thenReturn(editor) }

        createLoader(SharedPreferencesStore(preferences)).persistServedBundle("b1")

        val writes = inOrder(editor)
        writes.verify(editor).putString("hotcodepush.servedBundleId", "b1")
        writes.verify(editor).commit()
    }

    @Test
    fun shouldAnswerTheBundleTheLastRunPersistedWhenTheNextStartAsks() {
        val lastRunLoader = createLoader(SharedPreferencesStore(context))
        File(lastRunLoader.projectionDirectory("b1").also { it.mkdirs() }, ReactNativeBundleLoader.BUNDLE_FILE_NAME).writeText("")
        lastRunLoader.persistServedBundle("b1")

        assertEquals("b1", createLoader(SharedPreferencesStore(context)).servedBundleId())
    }

    private fun createLoader(store: KeyValueStore) = ReactNativeBundleLoader(store, File(context.filesDir, "hotcodepush")) {}
}
