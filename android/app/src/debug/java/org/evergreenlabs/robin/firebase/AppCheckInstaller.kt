package org.evergreenlabs.robin.firebase

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory
import org.evergreenlabs.robin.BuildConfig

/**
 * Debug App Check: if an App Check debug token is configured in local.properties (appcheck.debugToken)
 * or via environment variable APP_CHECK_DEBUG_TOKEN, seed it into the debug store.
 * Otherwise, DebugAppCheckProviderFactory dynamically generates a debug secret and logs it to Logcat
 * for registration in the Firebase Console.
 */
internal object AppCheckInstaller {
    private const val PREFS_PREFIX = "com.google.firebase.appcheck.debug.store."
    private const val PREFS_SECRET_KEY = "com.google.firebase.appcheck.debug.DEBUG_SECRET"

    fun install(appCheck: FirebaseAppCheck) {
        val app = FirebaseApp.getInstance()
        val configuredToken = BuildConfig.APP_CHECK_DEBUG_TOKEN.trim()
        if (configuredToken.isNotEmpty()) {
            seedRegisteredDebugToken(app, configuredToken)
        }
        appCheck.installAppCheckProviderFactory(
            DebugAppCheckProviderFactory.getInstance(),
        )
    }

    private fun seedRegisteredDebugToken(app: FirebaseApp, token: String) {
        val prefs = app.applicationContext.getSharedPreferences(
            PREFS_PREFIX + app.persistenceKey,
            Context.MODE_PRIVATE,
        )
        val existing = prefs.getString(PREFS_SECRET_KEY, null)
        if (existing == token) return
        prefs.edit()
            .putString(PREFS_SECRET_KEY, token)
            .apply()
    }
}
