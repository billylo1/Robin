package org.evergreenlabs.robin.firebase

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory

/**
 * Debug App Check: seed a pre-registered debug secret, then install the debug provider.
 * Token is registered in Firebase Console as "Robin Android Debug Token" for robin-evergreen.
 */
internal object AppCheckInstaller {
    private const val DEBUG_TOKEN = "0F3D60D9-B3A2-4900-890B-E4706A01C0DC"
    private const val PREFS_PREFIX = "com.google.firebase.appcheck.debug.store."
    private const val PREFS_SECRET_KEY = "com.google.firebase.appcheck.debug.DEBUG_SECRET"

    fun install(appCheck: FirebaseAppCheck) {
        val app = FirebaseApp.getInstance()
        seedRegisteredDebugToken(app)
        appCheck.installAppCheckProviderFactory(
            DebugAppCheckProviderFactory.getInstance(),
        )
    }

    private fun seedRegisteredDebugToken(app: FirebaseApp) {
        val prefs = app.applicationContext.getSharedPreferences(
            PREFS_PREFIX + app.persistenceKey,
            Context.MODE_PRIVATE,
        )
        val existing = prefs.getString(PREFS_SECRET_KEY, null)
        if (existing == DEBUG_TOKEN) return
        prefs.edit()
            .putString(PREFS_SECRET_KEY, DEBUG_TOKEN)
            .apply()
    }
}
