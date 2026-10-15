package org.evergreenlabs.robin.firebase

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.appcheck.FirebaseAppCheck

object FirebaseBootstrap {
    fun configure(context: Context) {
        // Content providers may initialize Firebase before Application.onCreate.
        if (FirebaseApp.getApps(context).isEmpty()) {
            FirebaseApp.initializeApp(context)
        }
        AppCheckInstaller.install(FirebaseAppCheck.getInstance())
    }
}
