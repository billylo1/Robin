package org.evergreenlabs.robin

import android.content.Context
import android.util.Log
import com.aptabase.Aptabase
import com.aptabase.InitOptions

/**
 * Optional Aptabase analytics. Empty [BuildConfig.APTABASE_APP_KEY] ⇒ no-op (forks stay off).
 */
object Analytics {
    private const val TAG = "Analytics"
    @Volatile
    private var enabled = false

    fun init(context: Context) {
        val appKey = BuildConfig.APTABASE_APP_KEY.trim()
        if (appKey.isEmpty() || appKey.contains("YOUR_", ignoreCase = true)) {
            Log.i(TAG, "Aptabase disabled (optional; set aptabase.appKey to enable)")
            enabled = false
            return
        }
        val host = BuildConfig.APTABASE_HOST.trim().trimEnd('/')
        val options = if (host.isNotEmpty()) InitOptions(host = host) else null
        if (appKey.startsWith("A-SH-", ignoreCase = true) && host.isEmpty()) {
            Log.w(TAG, "Aptabase A-SH key requires aptabase.host — leaving disabled")
            enabled = false
            return
        }
        try {
            if (options != null) {
                Aptabase.instance.initialize(context.applicationContext, appKey, options)
            } else {
                Aptabase.instance.initialize(context.applicationContext, appKey)
            }
            enabled = true
            Log.i(TAG, "Aptabase enabled")
            track("app_started")
        } catch (e: Exception) {
            enabled = false
            Log.e(TAG, "Aptabase init failed", e)
        }
    }

    fun track(event: String, props: Map<String, Any>? = null) {
        if (!enabled) return
        try {
            if (props.isNullOrEmpty()) {
                Aptabase.instance.trackEvent(event)
            } else {
                Aptabase.instance.trackEvent(event, props)
            }
        } catch (e: Exception) {
            Log.w(TAG, "trackEvent($event) failed", e)
        }
    }
}
