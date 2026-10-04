package org.evergreenlabs.robin

import android.content.Context
import org.evergreenlabs.robin.services.AppChrome
import org.evergreenlabs.robin.services.BenchmarkStore
import org.evergreenlabs.robin.services.FeedRefreshIntervalStore
import org.evergreenlabs.robin.services.FontScaleStore
import org.evergreenlabs.robin.xfilter.FilterSettingsStore

/** Manual DI for WebView-shell singletons. */
object AppGraph {
    lateinit var chrome: AppChrome
        private set
    lateinit var fontScale: FontScaleStore
        private set
    lateinit var feedRefreshInterval: FeedRefreshIntervalStore
        private set
    lateinit var filterSettings: FilterSettingsStore
        private set
    lateinit var benchmark: BenchmarkStore
        private set

    val isInitialized: Boolean get() = ::chrome.isInitialized

    fun init(context: Context) {
        if (isInitialized) return
        val app = context.applicationContext
        chrome = AppChrome()
        fontScale = FontScaleStore(app)
        feedRefreshInterval = FeedRefreshIntervalStore(app)
        filterSettings = FilterSettingsStore(app)
        benchmark = BenchmarkStore(app)
    }
}
