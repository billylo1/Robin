package org.evergreenlabs.robin.ui

import android.annotation.SuppressLint
import android.app.Dialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Typeface
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.compose.BackHandler
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.KeyboardArrowUp
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.graphics.drawable.toDrawable
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.evergreenlabs.robin.Analytics
import org.evergreenlabs.robin.AppGraph
import org.evergreenlabs.robin.R
import org.evergreenlabs.robin.ui.theme.RobinCream
import org.evergreenlabs.robin.ui.theme.RobinHeaderDark
import org.evergreenlabs.robin.ui.theme.RobinRed
import org.evergreenlabs.robin.ui.theme.RobinRedLight
import org.evergreenlabs.robin.xfilter.FilterSettings
import org.evergreenlabs.robin.xfilter.XFilterInjector
import org.evergreenlabs.robin.services.FeedRefreshIntervalStore
import java.net.URLDecoder
import java.util.Locale

private const val TAG = "XWebFeed"
private const val X_HOME = "https://x.com/home"
private const val NEAR_TOP_PX = 80
private const val SCROLL_TOP_BUTTON_PX = 400
private const val WARM_CROSSFADE_MS = 450

/** Reports scrollY from nested X containers (window scroll often stays at 0). */
private val SCROLL_PROBE_JS = """
(function(){
  if (window.__ROBIN_SCROLL_PROBE__) return;
  window.__ROBIN_SCROLL_PROBE__ = true;
  var last = -1;
  function report(y) {
    y = Math.max(0, Math.round(y || 0));
    if (y === last) return;
    last = y;
    try {
      if (window.RobinScroll && window.RobinScroll.post) {
        window.RobinScroll.post(y);
      }
    } catch (e) {}
  }
  function fromEvent(e) {
    var t = e && e.target;
    if (!t || t === document || t === window) {
      var r = document.scrollingElement || document.documentElement;
      report(r ? r.scrollTop : 0);
      return;
    }
    if (typeof t.scrollTop === 'number') report(t.scrollTop);
  }
  window.addEventListener('scroll', fromEvent, true);
  document.addEventListener('scroll', fromEvent, true);

  var lastInteract = 0;
  function interact() {
    var now = Date.now();
    if (now - lastInteract < 1000) return;
    lastInteract = now;
    try {
      if (window.RobinInteract && window.RobinInteract.post) {
        window.RobinInteract.post();
      }
    } catch (e) {}
  }
  ['pointerdown', 'touchstart', 'keydown', 'wheel', 'mousemove'].forEach(function (n) {
    window.addEventListener(n, interact, { capture: true, passive: true });
  });
})();
""".trimIndent()

private class ScrollBridge(private val onY: (Int) -> Unit) {
    private val main = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun post(y: Int) {
        main.post { onY(y) }
    }
}

private class InteractBridge(private val onInteract: () -> Unit) {
    private val main = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun post() {
        main.post { onInteract() }
    }
}

/** Called from filter-core when the boot gate lifts (`RobinBoot.ready()`). */
private class BootBridge(private val onReady: () -> Unit) {
    private val main = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun ready() {
        main.post { onReady() }
    }
}

/** Mobile Chrome — keeps X on the TopNavBar layout (same CSS path as iOS). */
private const val MOBILE_CHROME_USER_AGENT =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"

private fun isFeedHome(url: String?): Boolean {
    if (!isXHost(url)) return false
    return try {
        val path = android.net.Uri.parse(url).path.orEmpty()
        path.isEmpty() || path == "/" || path == "/home" || path.startsWith("/home/")
    } catch (_: Exception) {
        false
    }
}

/** Feed type / ordering / content filters that need a home reload to fully apply. */
private fun feedReloadFingerprint(s: FilterSettings): List<Boolean> = listOf(
    s.forceFollowing,
    s.preferLatest,
    s.hideLiveContent,
    s.hideComposeButton,
)

private fun isXHost(url: String?): Boolean {
    if (url.isNullOrBlank()) return false
    val host = android.net.Uri.parse(url).host?.lowercase(Locale.US).orEmpty()
    return host == "x.com" || host.endsWith(".x.com") ||
        host == "twitter.com" || host.endsWith(".twitter.com")
}

/** Google / Apple OAuth documents that belong in the in-app popup. */
private fun isOAuthPopupUrl(url: String?): Boolean {
    if (url.isNullOrBlank()) return false
    val host = android.net.Uri.parse(url).host?.lowercase(Locale.US).orEmpty()
    if (host.isEmpty()) return false
    if (host == "accounts.google.com" || host.endsWith(".google.com")) return true
    if (host == "appleid.apple.com" || host.endsWith(".apple.com")) return true
    if (host == "accounts.youtube.com") return true
    if (host.endsWith(".googleusercontent.com") || host.endsWith(".googleapis.com")) return true
    return false
}

/**
 * Hosts allowed inside the X WebView (feed + OAuth). Everything else opens
 * in the user’s default browser.
 *
 * Note: `t.co` is intentionally excluded — short links open in the default browser
 * (X opens them via window.open / createWebView).
 */
private fun isAllowedWebViewUrl(url: String): Boolean {
    val lower = url.lowercase(Locale.US)
    if (lower.startsWith("about:") || lower.startsWith("blob:")) return true
    val uri = try {
        android.net.Uri.parse(url)
    } catch (_: Exception) {
        return false
    }
    val scheme = uri.scheme?.lowercase(Locale.US).orEmpty()
    if (scheme != "http" && scheme != "https") return false
    val host = uri.host?.lowercase(Locale.US).orEmpty()
    if (host.isEmpty()) return true
    val allowedExact = setOf(
        "x.com", "twitter.com", "api.x.com", "api.twitter.com",
        "mobile.twitter.com", "mobile.x.com",
        "accounts.google.com", "appleid.apple.com", "accounts.youtube.com",
    )
    if (host in allowedExact) return true
    val allowedSuffixes = listOf(
        ".x.com", ".twitter.com",
        ".google.com", ".googleusercontent.com", ".googleapis.com", ".gstatic.com",
        ".apple.com", ".cdn-apple.com",
    )
    for (suffix in allowedSuffixes) {
        if (host.endsWith(suffix) || host == suffix.removePrefix(".")) return true
    }
    return false
}

/** Opens http(s) in a Custom Tab (falls back to the default browser). */
private fun openInDefaultBrowser(context: android.content.Context?, url: String) {
    if (context == null || url.isBlank()) return
    val uri = android.net.Uri.parse(url)
    try {
        val colorScheme = CustomTabColorSchemeParams.Builder()
            .setToolbarColor(RobinRed.toArgb())
            .build()
        val customTabs = CustomTabsIntent.Builder()
            .setDefaultColorSchemeParams(colorScheme)
            .setShareState(CustomTabsIntent.SHARE_STATE_ON)
            .setShowTitle(true)
            .build()
        customTabs.intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        customTabs.launchUrl(context, uri)
    } catch (e: ActivityNotFoundException) {
        Log.w(TAG, "Custom Tabs unavailable; falling back to ACTION_VIEW: $url", e)
        try {
            val intent = Intent(Intent.ACTION_VIEW, uri).apply {
                addCategory(Intent.CATEGORY_BROWSABLE)
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            context.startActivity(intent)
        } catch (e2: Exception) {
            Log.w(TAG, "openInDefaultBrowser failed: $url", e2)
        }
    } catch (e: Exception) {
        Log.w(TAG, "openInDefaultBrowser failed: $url", e)
    }
}

/**
 * X mobile shell uses `x-safari-https://…` to bounce into Chrome/Safari.
 * Rewrite to plain https (keeps path/query/fragment).
 */
private fun rewrittenSafariSchemeUrl(url: String): String? {
    val lower = url.lowercase(Locale.US)
    val from = when {
        lower.startsWith("x-safari-https:") -> "x-safari-https:"
        lower.startsWith("x-safari-http:") -> "x-safari-http:"
        else -> return null
    }
    val to = if (from.endsWith("https:")) "https:" else "http:"
    return to + url.substring(from.length)
}

/**
 * Parse `intent://…#Intent;…;end` into an https URL we can load in-app.
 * Prefer S.browser_fallback_url; else rebuild from scheme + host/path.
 */
private fun rewrittenIntentUrl(url: String): String? {
    if (!url.lowercase(Locale.US).startsWith("intent:")) return null
    try {
        val intent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME)
        val fallback = intent.getStringExtra("browser_fallback_url")
            ?: intent.getStringExtra("S.browser_fallback_url")
        if (!fallback.isNullOrBlank() &&
            (fallback.startsWith("http://") || fallback.startsWith("https://"))
        ) {
            return fallback
        }
        val data = intent.data
        if (data != null) {
            val scheme = data.scheme?.lowercase(Locale.US).orEmpty()
            if (scheme == "http" || scheme == "https") return data.toString()
        }
        // intent://host/path#Intent;scheme=https;end → https://host/path
        val fragmentScheme = intent.scheme?.lowercase(Locale.US)
        if (fragmentScheme == "http" || fragmentScheme == "https") {
            val rest = url.removePrefix("intent:").substringBefore("#Intent")
            return "$fragmentScheme:$rest"
        }
    } catch (e: Exception) {
        Log.w(TAG, "intent parse failed: $url", e)
    }
    // Manual fallback_url scrape if Intent.parseUri missed encoded extras.
    val marker = "S.browser_fallback_url="
    val idx = url.indexOf(marker)
    if (idx >= 0) {
        val raw = url.substring(idx + marker.length).substringBefore(';')
        return try {
            URLDecoder.decode(raw, Charsets.UTF_8.name())
        } catch (_: Exception) {
            raw
        }
    }
    return null
}

/**
 * Returns a loadable http(s) URL if [url] is a bounce scheme, else null.
 * Caller should load the result in the WebView and return true from shouldOverride.
 */
private fun rewrittenInAppUrl(url: String): String? {
    rewrittenSafariSchemeUrl(url)?.let { return it }
    rewrittenIntentUrl(url)?.let { return it }
    return null
}

/**
 * Handle navigation inside a WebView: rewrite bounce schemes, keep allowlisted
 * http(s) in-app, hand off other web links to Custom Tabs, never hand
 * off to the X app for OAuth nags.
 * @return true if the navigation was consumed (override).
 */
private fun handleWebNavigation(
    view: WebView?,
    url: String?,
    isForMainFrame: Boolean = true,
): Boolean {
    if (url.isNullOrBlank()) return false
    val lower = url.lowercase(Locale.US)

    rewrittenInAppUrl(url)?.let { rewritten ->
        if (!isAllowedWebViewUrl(rewritten)) {
            Log.i(TAG, "rewrite → browser: $url → $rewritten")
            openInDefaultBrowser(view?.context, rewritten)
            return true
        }
        Log.i(TAG, "rewrite $url → $rewritten")
        view?.loadUrl(rewritten)
        return true
    }

    if (lower.startsWith("http://") || lower.startsWith("https://") ||
        lower.startsWith("about:") || lower.startsWith("blob:")
    ) {
        if (isForMainFrame &&
            (lower.startsWith("http://") || lower.startsWith("https://")) &&
            !isAllowedWebViewUrl(url)
        ) {
            Log.i(TAG, "open external: $url")
            openInDefaultBrowser(view?.context, url)
            return true
        }
        return false
    }

    Log.i(TAG, "blocked external scheme: $url")
    return true
}

@Composable
private fun FeedBootCover(visible: Boolean) {
    AnimatedVisibility(
        visible = visible,
        enter = fadeIn(animationSpec = tween(durationMillis = 220)),
        exit = fadeOut(animationSpec = tween(durationMillis = 220)),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background),
            contentAlignment = Alignment.Center,
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                CircularProgressIndicator()
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    text = stringResource(R.string.preparing_feed),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/**
 * Clears X cookies / site storage and opens the login flow.
 *
 * The boot cover already hides the live SPA. Do not navigate to about:blank —
 * that races with cookie wipe and can leave Android WebView stuck on a blank
 * document with a partial progress bar.
 */
private fun signOutOfX(webView: WebView?) {
    Analytics.track("sign_out")
    webView?.stopLoading()
    WebStorage.getInstance().deleteAllData()
    val cookies = CookieManager.getInstance()
    cookies.removeAllCookies {
        cookies.flush()
        webView?.post {
            webView.clearCache(true)
            webView.clearFormData()
            webView.clearHistory()
            // /i/flow/login skips filter bootstrap (auth passthrough).
            webView.loadUrl("https://x.com/i/flow/login")
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun XWebFeedScreen(
    modifier: Modifier = Modifier,
) {
    val chrome = AppGraph.chrome
    val filterStore = AppGraph.filterSettings
    val filterSettings by filterStore.settings.collectAsStateWithLifecycle(
        initialValue = FilterSettings.Default,
    )
    val fontScale by AppGraph.fontScale.scale.collectAsStateWithLifecycle()
    val refreshIntervalSeconds by AppGraph.feedRefreshInterval.seconds.collectAsStateWithLifecycle()
    var webViewRef by remember { mutableStateOf<WebView?>(null) }
    var progress by remember { mutableFloatStateOf(0f) }
    var canGoBack by remember { mutableStateOf(false) }
    var pageUrl by remember { mutableStateOf<String?>(null) }
    var showScrollTop by remember { mutableStateOf(false) }
    var lastScrollY by remember { mutableIntStateOf(0) }
    /** Covers the WebView until filter-core calls RobinBoot.ready() (or timeout). */
    val showBootCoverState = remember { mutableStateOf(true) }
    var showBootCover by showBootCoverState
    val suppressNextHomeBootCoverState = remember { mutableStateOf(false) }
    var lastFeedRefreshAtMs by remember { mutableLongStateOf(0L) }
    var wasPaused by remember { mutableStateOf(false) }
    val lifecycleOwner = LocalLifecycleOwner.current
    val scope = rememberCoroutineScope()
    var warmReloadJob by remember { mutableStateOf<Job?>(null) }
    /** Frozen old feed shown over the WebView during a warm reload; crossfaded out on boot. */
    var warmSnapshot by remember { mutableStateOf<ImageBitmap?>(null) }
    val warmSnapshotAlpha = remember { Animatable(1f) }
    var lastInteractionAtMs by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var isResumed by remember {
        mutableStateOf(lifecycleOwner.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))
    }
    val infoPresented by chrome.infoPresented.collectAsStateWithLifecycle()
    // WebViewClient is created once in factory — keep latest values for page-load re-apply.
    val liveFilterSettings = remember { mutableStateOf(filterSettings) }
    val liveFontScale = remember { mutableFloatStateOf(fontScale) }
    liveFilterSettings.value = filterSettings
    liveFontScale.floatValue = fontScale
    /** Snapshot of feed-affecting settings when Settings opened. */
    var filterSettingsWhenInfoOpened by remember { mutableStateOf<FilterSettings?>(null) }
    /** True after Settings changed Following / ordering / feed filters until home reloads. */
    var pendingFeedSettingsReload by remember { mutableStateOf(false) }

    val showBackButton = canGoBack && !isFeedHome(pageUrl)

    fun scrollWebToTop() {
        val wv = webViewRef ?: return
        wv.scrollTo(0, 0)
        wv.evaluateJavascript(
            """
            (function(){
              var r = document.scrollingElement || document.documentElement;
              if (r && r.scrollTo) r.scrollTo({ top: 0, behavior: 'smooth' });
              else { document.documentElement.scrollTop = 0; document.body.scrollTop = 0; }
              var nodes = document.querySelectorAll('div');
              for (var i = 0; i < Math.min(nodes.length, 80); i++) {
                var el = nodes[i];
                if (el.scrollTop > 0) el.scrollTop = 0;
              }
            })();
            """.trimIndent(),
            null,
        )
        lastScrollY = 0
        showScrollTop = false
    }

    fun hardReloadFeed(warm: Boolean, markRefresh: Boolean = true) {
        val wv = webViewRef ?: return
        if (markRefresh) lastFeedRefreshAtMs = System.currentTimeMillis()
        warmReloadJob?.cancel()
        warmReloadJob = null

        fun doLoad() {
            // reload() can reuse a cached document; force a network home load.
            val previous = wv.settings.cacheMode
            wv.settings.cacheMode = WebSettings.LOAD_NO_CACHE
            wv.loadUrl(X_HOME)
            wv.post { wv.settings.cacheMode = previous }
        }

        if (warm && wv.width > 0 && wv.height > 0) {
            // Freeze the old feed over the WebView, load underneath, and let
            // RobinBoot.ready() crossfade the snapshot away — the blank document
            // and boot-gated body are never visible.
            val bmp = Bitmap.createBitmap(wv.width, wv.height, Bitmap.Config.ARGB_8888)
            wv.draw(Canvas(bmp))
            suppressNextHomeBootCoverState.value = true
            warmReloadJob = scope.launch {
                warmSnapshotAlpha.snapTo(1f)
                warmSnapshot = bmp.asImageBitmap()
                doLoad()
                delay(5_500)
                if (warmSnapshot != null) {
                    suppressNextHomeBootCoverState.value = false
                    warmSnapshotAlpha.animateTo(0f, tween(WARM_CROSSFADE_MS, easing = LinearOutSlowInEasing))
                    warmSnapshot = null
                }
            }
        } else {
            warmSnapshot = null
            doLoad()
        }
    }

    fun flushPendingFeedSettingsReloadIfNeeded() {
        if (!pendingFeedSettingsReload) return
        if (infoPresented) return
        if (!isFeedHome(pageUrl)) return
        if (showBootCover) return
        if (warmSnapshot != null) return
        pendingFeedSettingsReload = false
        hardReloadFeed(warm = true, markRefresh = false)
    }

    fun clearWarmSnapshot() {
        warmReloadJob?.cancel()
        warmReloadJob = null
        warmSnapshot = null
        suppressNextHomeBootCoverState.value = false
    }

    fun canRefreshFeedNow(): Boolean {
        if (showBootCover) return false
        if (warmSnapshot != null) return false
        if (!isFeedHome(pageUrl)) return false
        if (lastScrollY > NEAR_TOP_PX) return false
        if (progress in 0f..<1f && progress > 0f) return false
        if (refreshIntervalSeconds > 0) {
            val now = System.currentTimeMillis()
            if (lastFeedRefreshAtMs > 0L &&
                now - lastFeedRefreshAtMs < refreshIntervalSeconds * 1000L
            ) {
                return false
            }
        }
        return webViewRef != null
    }

    fun noteUserInteraction() {
        lastInteractionAtMs = System.currentTimeMillis()
    }

    /** Automatic refreshes wait until the user has left the feed alone. */
    fun userIsIdle(): Boolean {
        if (infoPresented) return false
        return System.currentTimeMillis() - lastInteractionAtMs >= FeedRefreshIntervalStore.IDLE_MS
    }

    fun requestNearTopAutoRefresh(userInitiated: Boolean = false) {
        if (!userInitiated && refreshIntervalSeconds <= 0) return
        if (!canRefreshFeedNow()) return
        if (!userInitiated && !userIsIdle()) return
        // Pill auto-click already handles “Show N posts” when X paints it.
        // Host-driven refresh must force a network fetch.
        hardReloadFeed(warm = true)
    }

    /** Back-to-top only — native header stays visible. */
    fun onWebScroll(scrollY: Int) {
        lastScrollY = scrollY
        showScrollTop = scrollY >= SCROLL_TOP_BUTTON_PX
        noteUserInteraction()
    }

    fun onTitleTap() {
        if (lastScrollY <= NEAR_TOP_PX) {
            requestNearTopAutoRefresh(userInitiated = true)
        } else {
            scrollWebToTop()
        }
    }

    LaunchedEffect(filterSettings, fontScale) {
        webViewRef?.let { XFilterInjector.applySettingsOnly(it, filterSettings, fontScale) }
    }

    LaunchedEffect(infoPresented) {
        if (infoPresented) return@LaunchedEffect
        val opened = filterSettingsWhenInfoOpened
        filterSettingsWhenInfoOpened = null
        if (opened != null &&
            feedReloadFingerprint(filterSettings) != feedReloadFingerprint(opened)
        ) {
            pendingFeedSettingsReload = true
        }
        flushPendingFeedSettingsReloadIfNeeded()
    }

    LaunchedEffect(pageUrl, showBootCover, warmSnapshot, pendingFeedSettingsReload) {
        flushPendingFeedSettingsReloadIfNeeded()
    }

    // Slightly longer than filter-core's 5s hard reveal.
    LaunchedEffect(showBootCover) {
        if (!showBootCover) return@LaunchedEffect
        delay(5_500)
        if (showBootCover) showBootCover = false
    }

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_PAUSE -> {
                    wasPaused = true
                    isResumed = false
                    clearWarmSnapshot()
                }
                Lifecycle.Event.ON_RESUME -> {
                    isResumed = true
                    if (wasPaused) {
                        wasPaused = false
                        requestNearTopAutoRefresh()
                    }
                }
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            warmReloadJob?.cancel()
            warmReloadJob = null
            lifecycleOwner.lifecycle.removeObserver(observer)
        }
    }

    // While foregrounded near the top, periodically self-refresh (same path as resume/title).
    LaunchedEffect(isResumed, refreshIntervalSeconds) {
        if (!isResumed || refreshIntervalSeconds <= 0) return@LaunchedEffect
        while (true) {
            delay(FeedRefreshIntervalStore.POLL_TICK_MS)
            requestNearTopAutoRefresh()
        }
    }

    BackHandler(enabled = canGoBack) {
        webViewRef?.goBack()
    }

    val headerBg = if (isSystemInDarkTheme()) RobinHeaderDark else RobinCream
    val headerAccent = if (isSystemInDarkTheme()) RobinRedLight else RobinRed
    Column(modifier = modifier.fillMaxSize()) {
        // Compact custom header (TopAppBar paints through status bars and reads too tall).
        Column(modifier = Modifier.background(headerBg)) {
            Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(44.dp)
                    .padding(horizontal = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (showBackButton) {
                    IconButton(
                        onClick = { webViewRef?.goBack() },
                        modifier = Modifier.size(40.dp),
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = stringResource(R.string.back),
                            tint = headerAccent,
                        )
                    }
                }
                TextButton(
                    onClick = { onTitleTap() },
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp),
                    modifier = Modifier
                        .weight(1f)
                        .height(40.dp),
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Image(
                            painter = painterResource(R.drawable.ic_robin_mark),
                            contentDescription = null,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier
                                .size(24.dp)
                                .clip(RoundedCornerShape(5.dp)),
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(
                            text = stringResource(R.string.x_web_feed_title),
                            color = headerAccent,
                            style = MaterialTheme.typography.titleMedium,
                        )
                    }
                }
                if (showScrollTop) {
                    IconButton(
                        onClick = { scrollWebToTop() },
                        modifier = Modifier.size(40.dp),
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.KeyboardArrowUp,
                            contentDescription = stringResource(R.string.back_to_top),
                            tint = MaterialTheme.colorScheme.onSurface,
                        )
                    }
                }
                IconButton(
                    onClick = { hardReloadFeed(warm = !showBootCover) },
                    modifier = Modifier.size(40.dp),
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Refresh,
                        contentDescription = stringResource(R.string.refresh),
                        tint = MaterialTheme.colorScheme.onSurface,
                    )
                }
                IconButton(
                    onClick = {
                        Analytics.track("settings_opened")
                        filterSettingsWhenInfoOpened = filterSettings
                        chrome.setInfoPresented(true)
                    },
                    modifier = Modifier.size(40.dp),
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Settings,
                        contentDescription = stringResource(R.string.settings),
                        tint = MaterialTheme.colorScheme.onSurface,
                    )
                }
            }
        }
        if (progress in 0f..<1f && !showBootCover && warmSnapshot == null) {
            LinearProgressIndicator(
                progress = { progress },
                modifier = Modifier.fillMaxWidth(),
            )
        }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
        ) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { ctx ->
                WebView(ctx).apply {
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT,
                    )
                    if (org.evergreenlabs.robin.BuildConfig.DEBUG) {
                        WebView.setWebContentsDebuggingEnabled(true)
                    }
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    settings.cacheMode = WebSettings.LOAD_DEFAULT
                    settings.mediaPlaybackRequiresUserGesture = false
                    // Google/Apple SSO uses window.open — must allow and handle it.
                    settings.setSupportMultipleWindows(true)
                    settings.javaScriptCanOpenWindowsAutomatically = true
                    // Mobile Chrome UA so X serves TopNavBar layout (same CSS path as iOS).
                    settings.userAgentString = MOBILE_CHROME_USER_AGENT

                    CookieManager.getInstance().setAcceptCookie(true)
                    CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)

                    addJavascriptInterface(ScrollBridge { onWebScroll(it) }, "RobinScroll")
                    addJavascriptInterface(InteractBridge { noteUserInteraction() }, "RobinInteract")
                    setOnTouchListener { _, event ->
                        if (event.actionMasked == MotionEvent.ACTION_DOWN) noteUserInteraction()
                        false
                    }
                    addJavascriptInterface(
                        BootBridge {
                            showBootCoverState.value = false
                            suppressNextHomeBootCoverState.value = false
                            if (warmSnapshot != null) {
                                warmReloadJob?.cancel()
                                warmReloadJob = scope.launch {
                                    warmSnapshotAlpha.animateTo(
                                        targetValue = 0f,
                                        animationSpec = tween(
                                            durationMillis = WARM_CROSSFADE_MS,
                                            easing = LinearOutSlowInEasing,
                                        ),
                                    )
                                    warmSnapshot = null
                                }
                            }
                        },
                        "RobinBoot",
                    )

                    webChromeClient = object : WebChromeClient() {
                        override fun onProgressChanged(view: WebView?, newProgress: Int) {
                            progress = newProgress / 100f
                        }

                        override fun onCreateWindow(
                            view: WebView?,
                            isDialog: Boolean,
                            isUserGesture: Boolean,
                            resultMsg: Message?,
                        ): Boolean {
                            // Real popup WebView so Google/Apple keep window.opener (no external browser).
                            val host = view ?: return false
                            val context = host.context

                            // Ignore "open in X app" / Chrome bounce window.open nags (parity with iOS).
                            val hitUrl = host.hitTestResult.extra
                            if (!hitUrl.isNullOrBlank()) {
                                rewrittenInAppUrl(hitUrl)?.let { rewritten ->
                                    if (!isAllowedWebViewUrl(rewritten)) {
                                        Log.i(TAG, "popup nag → browser: $rewritten")
                                        openInDefaultBrowser(context, rewritten)
                                    } else {
                                        Log.i(TAG, "popup nag rewrite → $rewritten")
                                        host.loadUrl(rewritten)
                                    }
                                    return false
                                }
                                val scheme = android.net.Uri.parse(hitUrl).scheme?.lowercase(Locale.US).orEmpty()
                                if (scheme.isNotEmpty() &&
                                    scheme != "http" && scheme != "https" &&
                                    scheme != "about" && scheme != "blob"
                                ) {
                                    Log.i(TAG, "ignored popup scheme: $hitUrl")
                                    return false
                                }
                                // window.open from link taps: X uses https://t.co/…
                                // Only Google/Apple OAuth needs a real child WebView.
                                if (scheme == "http" || scheme == "https") {
                                    when {
                                        isOAuthPopupUrl(hitUrl) -> { /* fall through */ }
                                        isXHost(hitUrl) -> {
                                            Log.i(TAG, "popup → main webview: $hitUrl")
                                            host.loadUrl(hitUrl)
                                            return false
                                        }
                                        else -> {
                                            Log.i(TAG, "popup → external browser: $hitUrl")
                                            openInDefaultBrowser(context, hitUrl)
                                            return false
                                        }
                                    }
                                }
                            }

                            val density = context.resources.displayMetrics.density
                            fun dp(v: Int) = (v * density).toInt()

                            val popup = WebView(context).apply {
                                settings.javaScriptEnabled = true
                                settings.domStorageEnabled = true
                                settings.setSupportMultipleWindows(false)
                                // Stock UA — Google often rejects embedded/spoofed mobile UAs.
                                settings.userAgentString = WebSettings.getDefaultUserAgent(context)
                                CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
                            }
                            val dialog = Dialog(context, android.R.style.Theme_DeviceDefault_Light_NoActionBar)
                            val root = LinearLayout(context).apply {
                                orientation = LinearLayout.VERTICAL
                                setBackgroundColor(Color.WHITE)
                                layoutParams = ViewGroup.LayoutParams(
                                    ViewGroup.LayoutParams.MATCH_PARENT,
                                    ViewGroup.LayoutParams.MATCH_PARENT,
                                )
                            }
                            // Compact Close on the right (matches iOS AuthPopupViewController).
                            val toolbar = FrameLayout(context).apply {
                                setPadding(dp(12), dp(10), dp(12), dp(6))
                            }
                            val close = TextView(context).apply {
                                text = "Close"
                                setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
                                setTypeface(typeface, Typeface.BOLD)
                                setTextColor(Color.WHITE)
                                background = android.graphics.drawable.GradientDrawable().apply {
                                    setColor(0xFF2196F3.toInt())
                                    cornerRadius = 999f * density
                                }
                                setPadding(dp(12), dp(5), dp(12), dp(5))
                                gravity = Gravity.CENTER
                            }
                            toolbar.addView(
                                close,
                                FrameLayout.LayoutParams(
                                    FrameLayout.LayoutParams.WRAP_CONTENT,
                                    dp(28),
                                    Gravity.END or Gravity.CENTER_VERTICAL,
                                ),
                            )
                            root.addView(
                                toolbar,
                                LinearLayout.LayoutParams(
                                    LinearLayout.LayoutParams.MATCH_PARENT,
                                    LinearLayout.LayoutParams.WRAP_CONTENT,
                                ),
                            )
                            root.addView(
                                popup,
                                LinearLayout.LayoutParams(
                                    LinearLayout.LayoutParams.MATCH_PARENT,
                                    0,
                                    1f,
                                ),
                            )
                            var ssoFinished = false
                            var sawOAuthProvider = false
                            fun destroyPopupQuietly() {
                                try {
                                    popup.stopLoading()
                                    popup.destroy()
                                } catch (_: Exception) {
                                }
                            }
                            fun hasXSessionCookie(): Boolean {
                                val raw = CookieManager.getInstance().getCookie("https://x.com").orEmpty()
                                return raw.contains("auth_token=") || raw.contains("twid=")
                            }
                            /** After GIS window.close, wait for opener JS to set the X session. */
                            fun pollForSessionThenGoHome() {
                                var attempts = 0
                                val poll = object : Runnable {
                                    override fun run() {
                                        CookieManager.getInstance().flush()
                                        if (hasXSessionCookie()) {
                                            Log.i(TAG, "session cookie ready — loading home")
                                            host.loadUrl(X_HOME)
                                            return
                                        }
                                        // Opener may have already navigated to the feed.
                                        if (isFeedHome(host.url)) {
                                            Log.i(TAG, "host already on feed after GIS")
                                            return
                                        }
                                        attempts++
                                        if (attempts < 24) {
                                            host.postDelayed(this, 400)
                                        } else {
                                            Log.w(
                                                TAG,
                                                "no X session after GIS; host=${host.url}",
                                            )
                                        }
                                    }
                                }
                                host.postDelayed(poll, 250)
                            }
                            /**
                             * Google Identity Services (`gis_transform`) posts the id_token to
                             * `window.opener` then `window.close()`. Navigating/reloading the
                             * host WebView here aborts that handshake.
                             *
                             * The popup Dialog must be shown *before* WebViewTransport delivery so
                             * the child is window-attached and `window.opener` is non-null (same
                             * lesson as the original in-app child WebView / iOS AuthPopup fix).
                             */
                            fun finishSso(reason: String) {
                                if (ssoFinished) return
                                ssoFinished = true
                                CookieManager.getInstance().flush()
                                val hasSession = hasXSessionCookie()
                                Log.i(
                                    TAG,
                                    "SSO finish ($reason) hasSession=$hasSession host=${host.url} " +
                                        "cookies=${CookieManager.getInstance().getCookie("https://x.com")?.take(100)}",
                                )
                                if (dialog.isShowing) {
                                    dialog.dismiss()
                                } else {
                                    destroyPopupQuietly()
                                }
                                when {
                                    hasSession -> host.post { host.loadUrl(X_HOME) }
                                    reason == "popup-x-host" -> host.post { host.loadUrl(X_HOME) }
                                    else -> pollForSessionThenGoHome()
                                }
                            }
                            fun dismissAuthUi() {
                                if (ssoFinished) return
                                if (dialog.isShowing) {
                                    dialog.dismiss()
                                } else {
                                    destroyPopupQuietly()
                                }
                            }
                            fun onPopupUrl(url: String?, finished: Boolean) {
                                if (url.isNullOrBlank() || ssoFinished) return
                                Log.i(TAG, "popup ${if (finished) "finish" else "start"} $url")
                                if (isOAuthPopupUrl(url)) {
                                    sawOAuthProvider = true
                                }
                                if (finished && sawOAuthProvider && isXHost(url)) {
                                    finishSso("popup-x-host")
                                }
                            }
                            popup.webChromeClient = object : WebChromeClient() {
                                override fun onCloseWindow(window: WebView?) {
                                    Log.i(TAG, "popup onCloseWindow sawOAuth=$sawOAuthProvider")
                                    if (sawOAuthProvider) {
                                        finishSso("window.close")
                                    } else {
                                        dismissAuthUi()
                                    }
                                }
                            }
                            popup.webViewClient = object : WebViewClient() {
                                override fun shouldOverrideUrlLoading(
                                    v: WebView?,
                                    request: WebResourceRequest?,
                                ): Boolean = handleWebNavigation(
                                    v,
                                    request?.url?.toString(),
                                    request?.isForMainFrame ?: true,
                                )

                                override fun onPageStarted(v: WebView?, url: String?, favicon: Bitmap?) {
                                    onPopupUrl(url, finished = false)
                                }

                                override fun onPageFinished(v: WebView?, url: String?) {
                                    onPopupUrl(url, finished = true)
                                }
                            }
                            close.setOnClickListener {
                                if (sawOAuthProvider) {
                                    finishSso("close-button")
                                } else {
                                    dismissAuthUi()
                                }
                            }
                            dialog.setContentView(root)
                            dialog.setOnDismissListener {
                                destroyPopupQuietly()
                            }
                            dialog.window?.setLayout(
                                ViewGroup.LayoutParams.MATCH_PARENT,
                                ViewGroup.LayoutParams.MATCH_PARENT,
                            )
                            dialog.window?.setBackgroundDrawable(Color.WHITE.toDrawable())
                            // Show before transport so the child WebView is attached — required
                            // for window.opener (GIS posts the id_token to the opener).
                            dialog.show()

                            val transport = resultMsg?.obj as? WebView.WebViewTransport ?: return false
                            transport.webView = popup
                            resultMsg.sendToTarget()
                            return true
                        }
                    }
                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(
                            view: WebView?,
                            request: WebResourceRequest?,
                        ): Boolean = handleWebNavigation(
                            view,
                            request?.url?.toString(),
                            request?.isForMainFrame ?: true,
                        )

                        override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                            pageUrl = url
                            if (isFeedHome(url)) {
                                if (suppressNextHomeBootCoverState.value) {
                                    // Warm reload: keep suppress until RobinBoot.ready().
                                    // X often fires multiple onPageStarted (redirects);
                                    // clearing on the first one re-shows the spinner cover.
                                } else {
                                    showBootCoverState.value = true
                                    warmSnapshot = null
                                }
                            }
                            if (isXHost(url)) {
                                view?.let { XFilterInjector.evaluateIfNeeded(it) }
                            }
                        }

                        override fun onPageFinished(view: WebView?, url: String?) {
                            pageUrl = url
                            view?.let {
                                it.evaluateJavascript(SCROLL_PROBE_JS, null)
                                if (isXHost(url)) {
                                    XFilterInjector.evaluateIfNeeded(it)
                                    XFilterInjector.applySettingsOnly(
                                        it,
                                        liveFilterSettings.value,
                                        liveFontScale.floatValue,
                                    )
                                }
                                // After login, drop history so system back cannot return to login.
                                if (isFeedHome(url)) {
                                    it.clearHistory()
                                }
                                canGoBack = it.canGoBack()
                            }
                            progress = 1f
                        }

                        override fun doUpdateVisitedHistory(
                            view: WebView?,
                            url: String?,
                            isReload: Boolean,
                        ) {
                            super.doUpdateVisitedHistory(view, url, isReload)
                            pageUrl = url ?: view?.url
                            canGoBack = view?.canGoBack() == true
                        }
                    }

                    XFilterInjector.install(
                        this,
                        ctx.applicationContext,
                        FilterSettings.Default,
                        AppGraph.fontScale.scale.value,
                    )
                    loadUrl(X_HOME)
                    webViewRef = this
                }
            },
                update = { view ->
                    webViewRef = view
                    canGoBack = view.canGoBack()
                    pageUrl = view.url
                    // Settings / font scale are applied via LaunchedEffect — avoid
                    // re-toggling zoom/classes on every recomposition (paint churn).
                },
                onRelease = { view ->
                    view.stopLoading()
                    view.destroy()
                    if (webViewRef === view) webViewRef = null
                },
            )

            warmSnapshot?.let { snapshot ->
                Image(
                    bitmap = snapshot,
                    contentDescription = null,
                    contentScale = ContentScale.FillBounds,
                    modifier = Modifier
                        .fillMaxSize()
                        .alpha(warmSnapshotAlpha.value),
                )
            }

            FeedBootCover(visible = showBootCover)
        }
    }

    if (infoPresented) {
        InfoSheet(
            onDismiss = { chrome.setInfoPresented(false) },
            onSignOut = {
                clearWarmSnapshot()
                showBootCoverState.value = true
                signOutOfX(webViewRef)
            },
        )
    }
}
