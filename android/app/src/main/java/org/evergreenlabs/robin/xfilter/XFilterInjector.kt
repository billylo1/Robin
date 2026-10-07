package org.evergreenlabs.robin.xfilter

import android.content.Context
import android.util.Log
import android.webkit.WebView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.io.BufferedReader
import java.io.InputStreamReader
import java.nio.charset.StandardCharsets
import org.evergreenlabs.robin.R

/**
 * Loads assets/x-filter and injects settings + CSS + JS into a WebView.
 */
object XFilterInjector {
    private const val TAG = "XFilterInjector"
    private const val CSS_ASSET = "x-filter/filter-core.css"
    private const val JS_ASSET = "x-filter/filter-core.js"

    fun buildBootstrapScript(
        context: Context,
        settings: FilterSettings = FilterSettings.Default,
        fontScale: Float = 1f,
    ): String {
        val css = readAsset(context, CSS_ASSET)
        val js = readAsset(context, JS_ASSET)
        val cssJson = jsonStringLiteral(css)
        val settingsJson = settings.toJsonObjectLiteral(fontScale)
        return """
            (function(){
              try {
                var h = (location.hostname || '').toLowerCase();
                var onX = h === 'x.com' || h.endsWith('.x.com')
                  || h === 'twitter.com' || h.endsWith('.twitter.com');
                if (!onX) return;

                // Login / SSO flows break under boot gate + chrome hides — leave them alone.
                var path = (location.pathname || '').toLowerCase();
                var href = (location.href || '').toLowerCase();
                if (path.indexOf('/i/flow/') === 0 || href.indexOf('/i/flow/') !== -1) {
                  try {
                    document.documentElement.setAttribute('data-mt-boot-ready', '1');
                  } catch (eAuth) {}
                  return;
                }

                window.__ROBIN_SETTINGS__ = $settingsJson;
                if (!document.getElementById('robin-x-filter-css')) {
                  var s = document.createElement('style');
                  s.id = 'robin-x-filter-css';
                  s.textContent = $cssJson;
                  var p = document.head || document.documentElement;
                  if (p) {
                    p.appendChild(s);
                  } else {
                    document.addEventListener('DOMContentLoaded', function(){
                      var p2 = document.head || document.documentElement;
                      if (p2 && !document.getElementById('robin-x-filter-css')) p2.appendChild(s);
                    });
                  }
                }
                var root = document.documentElement;
                if (root) {
                  // Android WebView paint path (see filter-core.css). iOS does not set this.
                  root.classList.add('mt-android-webview');
                  // Full navigations re-run bootstrap; mask until filter boot settles.
                  // Skip if filter already installed (may evaluate bootstrap twice).
                  if (!window.__ROBIN_FILTER_INSTALLED__) {
                    root.removeAttribute('data-mt-boot-ready');
                  }
                  var cfg = window.__ROBIN_SETTINGS__ || {};
                  root.classList.toggle('mt-hide-page-header', !!cfg.hidePageHeader);
                  root.classList.add('mt-hide-compose');
                  var p = location.pathname || '';
                  var home = p === '/' || p === '/home' || p.indexOf('/home') === 0;
                  if (home) root.setAttribute('data-mt-home', '1');
                  if (home && cfg.hidePageHeader && cfg.forceFollowing && cfg.preferLatest) {
                    root.setAttribute('data-mt-defer-feed-chrome', '1');
                  }
                }
              } catch (e) {}
              $js
            })();
        """.trimIndent()
    }

    /**
     * Prefer document-start injection when the system WebView supports it;
     * otherwise fall back to evaluateJavascript on page events.
     */
    fun install(
        webView: WebView,
        context: Context,
        settings: FilterSettings = FilterSettings.Default,
        fontScale: Float = 1f,
    ) {
        val script = buildBootstrapScript(context, settings, fontScale)
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            try {
                WebViewCompat.addDocumentStartJavaScript(
                    webView,
                    script,
                    setOf(
                        "https://x.com",
                        "https://*.x.com",
                        "https://twitter.com",
                        "https://*.twitter.com",
                    ),
                )
                Log.i(TAG, "Installed document-start x-filter script")
                webView.setTag(R.id.robin_x_filter_script, null)
                return
            } catch (e: Exception) {
                Log.w(TAG, "DOCUMENT_START_SCRIPT failed; will evaluate on load", e)
            }
        } else {
            Log.i(TAG, "DOCUMENT_START_SCRIPT unsupported; will evaluate on load")
        }
        webView.setTag(R.id.robin_x_filter_script, script)
    }

    fun applySettingsOnly(
        webView: WebView,
        settings: FilterSettings,
        fontScale: Float = 1f,
    ) {
        val json = settings.toJsonObjectLiteral(fontScale)
        webView.evaluateJavascript(
            """
            window.__ROBIN_SETTINGS__ = $json;
            (function(){
              var href = (location.href || '').toLowerCase();
              var path = (location.pathname || '').toLowerCase();
              if (path.indexOf('/i/flow/') === 0 || href.indexOf('/i/flow/') !== -1) {
                try {
                  document.documentElement.setAttribute('data-mt-boot-ready', '1');
                } catch (e) {}
                return;
              }
              window.__ROBIN_USER_PICKED_TAB__ = 0;
              var cfg = window.__ROBIN_SETTINGS__ || {};
              var s = document.getElementById('robin-x-filter-css');
              if (s) s.disabled = !cfg.hidePromoted;
              var root = document.documentElement;
              if (!root) return;
              root.classList.add('mt-android-webview');
              var p = location.pathname || '';
              var home = p === '/' || p === '/home' || p.indexOf('/home') === 0;
              if (home) root.setAttribute('data-mt-home', '1');
              else root.removeAttribute('data-mt-home');
              root.classList.toggle('mt-hide-page-header', !!cfg.hidePageHeader);
              root.classList.add('mt-hide-compose');
              root.classList.toggle('mt-hide-live', !!cfg.hideLiveContent);
              if (home && cfg.hidePageHeader && cfg.forceFollowing && cfg.preferLatest && !window.__ROBIN_LATEST_OK__) {
                root.setAttribute('data-mt-defer-feed-chrome', '1');
              } else {
                root.removeAttribute('data-mt-defer-feed-chrome');
              }
              var scale = cfg.fontScale;
              if (typeof scale !== 'number' || !(scale > 0)) scale = 1;
              if (scale === 1) root.style.removeProperty('zoom');
              else root.style.zoom = String(scale);
            })();
            if (typeof window.__ROBIN_ON_SETTINGS__ === 'function') window.__ROBIN_ON_SETTINGS__();
            """.trimIndent(),
            null,
        )
    }

    fun evaluateIfNeeded(webView: WebView) {
        val script = webView.getTag(R.id.robin_x_filter_script) as? String ?: return
        webView.evaluateJavascript(script, null)
    }

    private fun readAsset(context: Context, path: String): String {
        context.assets.open(path).use { input ->
            BufferedReader(InputStreamReader(input, StandardCharsets.UTF_8)).use { reader ->
                return reader.readText()
            }
        }
    }

    private fun jsonStringLiteral(raw: String): String {
        val sb = StringBuilder(raw.length + 16)
        sb.append('"')
        for (ch in raw) {
            when (ch) {
                '\\' -> sb.append("\\\\")
                '"' -> sb.append("\\\"")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                else -> {
                    if (ch.code < 0x20) {
                        sb.append("\\u%04x".format(ch.code))
                    } else {
                        sb.append(ch)
                    }
                }
            }
        }
        sb.append('"')
        return sb.toString()
    }
}
