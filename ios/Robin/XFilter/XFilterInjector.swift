import Foundation
import WebKit

/// Loads Resources/x-filter and injects settings + CSS + JS into a WKWebView.
enum XFilterInjector {
    private static let cssResource = "filter-core"
    private static let jsResource = "filter-core"
    private static let subdirectory = "x-filter"

    static func buildBootstrapScript(
        settings: FilterSettings = .default,
        fontScale: Double = 1
    ) -> String {
        let css = loadResource(named: cssResource, extension: "css")
        let js = loadResource(named: jsResource, extension: "js")
        let cssJSON = jsonStringLiteral(css)
        let settingsJSON = settings.toJSONObjectLiteral(fontScale: fontScale)
        return """
        (function(){
          try {
            // Never touch Google/Apple (or other) auth documents — spoofing breaks SSO.
            var h = (location.hostname || '').toLowerCase();
            var onX = h === 'x.com' || h.endsWith('.x.com')
              || h === 'twitter.com' || h.endsWith('.twitter.com');
            if (!onX) return;

            // Login / SSO flows break under viewport spoof + boot gate — leave them alone.
            var path = (location.pathname || '').toLowerCase();
            var href = (location.href || '').toLowerCase();
            if (path.indexOf('/i/flow/') === 0 || href.indexOf('/i/flow/') !== -1) {
              try {
                document.documentElement.setAttribute('data-mt-boot-ready', '1');
              } catch (eAuth) {}
              return;
            }

            // Mobile identity for X's shell. Phones/iPads use real width (landscape
            // widen); Mac freezes layout at 390 so X mounts the mobile shell — see
            // forceMobileLayoutScript. Tab forcing only clicks label-verified tabs.
            \(Self.forceMobileLayoutScript)
            window.__ROBIN_SETTINGS__ = \(settingsJSON);
            // WKWebView text ignores html zoom (glyphs stay put, line boxes grow);
            // scale text with -webkit-text-size-adjust instead.
            window.__ROBIN_TEXT_SIZE_ADJUST__ = true;
            // Mac text-size-adjust leaves fixed px line-heights unscaled.
            window.__ROBIN_SCALE_LINE_HEIGHT__ = \(ProcessInfo.processInfo.isiOSAppOnMac);
            if (!document.getElementById('robin-x-filter-css')) {
              var s = document.createElement('style');
              s.id = 'robin-x-filter-css';
              s.textContent = \(cssJSON);
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
              // Full navigations re-run bootstrap; mask until filter boot settles.
              // Skip if filter already installed (Android may evaluate bootstrap twice).
              if (!window.__ROBIN_FILTER_INSTALLED__) {
                root.removeAttribute('data-mt-boot-ready');
              }
              var cfg = window.__ROBIN_SETTINGS__ || {};
              root.classList.toggle('mt-hide-page-header', !!cfg.hidePageHeader);
              root.classList.toggle('mt-hide-compose', !!cfg.hideComposeButton);
              var p = location.pathname || '';
              var home = p === '/' || p === '/home' || p.indexOf('/home') === 0;
              if (home) root.setAttribute('data-mt-home', '1');
              // Prefer Latest needs TopNavBar; defer CSS hide until filter confirms it.
              if (home && cfg.hidePageHeader && cfg.forceFollowing && cfg.preferLatest) {
                root.setAttribute('data-mt-defer-feed-chrome', '1');
              }
            }
          } catch (e) {}
          \(js)
        })();
        """
    }

    /// Document-start: mobile UA / pointer spoof so X prefers the mobile shell.
    /// On Mac (Designed for iPhone/iPad), freeze layout identity at phone width —
    /// a wide WebView otherwise mounts desktop/hybrid DOM while Robin hides those
    /// rails, producing a blank primary column. On device, use real `device-width`
    /// so landscape / tablet feeds can widen (desktop ≥1000px breakpoints stay off).
    private static var forceMobileLayoutScript: String {
        let freezeMac = ProcessInfo.processInfo.isiOSAppOnMac
        return """
        (function(){
          if (window.__ROBIN_FORCE_MOBILE__) return;
          window.__ROBIN_FORCE_MOBILE__ = true;
          try {
            function def(obj, prop, val) {
              try {
                Object.defineProperty(obj, prop, {
                  get: function(){ return val; },
                  configurable: true
                });
              } catch (e) {}
            }
            def(navigator, 'maxTouchPoints', 5);
            def(navigator, 'platform', 'iPhone');
            var ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
            def(navigator, 'userAgent', ua);
            def(navigator, 'appVersion', ua);
            var freezeMac = \(freezeMac);
            var W = 390;
            var H = 844;
            function layoutW() {
              if (freezeMac) return W;
              try {
                if (window.visualViewport && visualViewport.width)
                  return Math.round(visualViewport.width);
              } catch (e0) {}
              return Math.round(
                window.innerWidth ||
                (document.documentElement && document.documentElement.clientWidth) ||
                W
              );
            }
            if (freezeMac) {
              def(window, 'innerWidth', W);
              def(window, 'innerHeight', H);
              def(window, 'outerWidth', W);
              def(window, 'outerHeight', H);
              try {
                def(screen, 'width', W);
                def(screen, 'height', H);
                def(screen, 'availWidth', W);
                def(screen, 'availHeight', H);
              } catch (e1) {}
            }
            var orig = window.matchMedia.bind(window);
            window.matchMedia = function(query) {
              var q = String(query || '').toLowerCase();
              function mql(matches) {
                return {
                  matches: matches,
                  media: query,
                  onchange: null,
                  addListener: function(){},
                  removeListener: function(){},
                  addEventListener: function(){},
                  removeEventListener: function(){},
                  dispatchEvent: function(){ return false; }
                };
              }
              var lw = layoutW();
              var max = q.match(/max-width:\\s*(\\d+)/);
              if (max) return mql(lw <= parseInt(max[1], 10));
              var min = q.match(/min-width:\\s*(\\d+)/);
              if (min) {
                var minW = parseInt(min[1], 10);
                // Never claim desktop shell breakpoints; keep mobile/tablet chrome.
                if (minW >= 1000) return mql(false);
                return mql(lw >= minW);
              }
              if (q.indexOf('pointer: fine') !== -1 || q.indexOf('hover: hover') !== -1) return mql(false);
              if (q.indexOf('pointer: coarse') !== -1 || q.indexOf('hover: none') !== -1) return mql(true);
              try { return orig(query); } catch (e) { return mql(false); }
            };
            function ensureViewport() {
              var head = document.head || document.documentElement;
              if (!head) return;
              var meta = document.querySelector('meta[name="viewport"]');
              if (!meta) {
                meta = document.createElement('meta');
                meta.setAttribute('name', 'viewport');
                head.appendChild(meta);
              }
              meta.setAttribute(
                'content',
                freezeMac
                  ? ('width=' + W + ', initial-scale=1, maximum-scale=1, user-scalable=no')
                  : 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no'
              );
            }
            ensureViewport();
            new MutationObserver(ensureViewport).observe(document.documentElement, {childList:true, subtree:true});
          } catch (e) {}
        })();
        """
    }

    /// Document-start user script for x.com / twitter.com navigations in this web view.
    static func makeUserScript(
        settings: FilterSettings = .default,
        fontScale: Double = 1
    ) -> WKUserScript {
        WKUserScript(
            source: buildBootstrapScript(settings: settings, fontScale: fontScale),
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false
        )
    }

    static func applySettingsOnly(
        to webView: WKWebView,
        settings: FilterSettings,
        fontScale: Double = 1
    ) {
        let json = settings.toJSONObjectLiteral(fontScale: fontScale)
        let script = """
        window.__ROBIN_SETTINGS__ = \(json);
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
          var p = location.pathname || '';
          var home = p === '/' || p === '/home' || p.indexOf('/home') === 0;
          if (home) root.setAttribute('data-mt-home', '1');
          else root.removeAttribute('data-mt-home');
          root.classList.toggle('mt-hide-page-header', !!cfg.hidePageHeader);
          root.classList.toggle('mt-hide-compose', !!cfg.hideComposeButton);
          root.classList.toggle('mt-hide-live', !!cfg.hideLiveContent);
          if (home && cfg.hidePageHeader && cfg.forceFollowing && cfg.preferLatest && !window.__ROBIN_LATEST_OK__) {
            root.setAttribute('data-mt-defer-feed-chrome', '1');
          } else {
            root.removeAttribute('data-mt-defer-feed-chrome');
          }
          var scale = cfg.fontScale;
          if (typeof scale !== 'number' || !(scale > 0)) scale = 1;
          root.style.removeProperty('zoom');
          root.style.setProperty('-webkit-text-size-adjust', Math.round(scale * 100) + '%', 'important');
          if (window.__ROBIN_APPLY_FONT_SCALE__) window.__ROBIN_APPLY_FONT_SCALE__();
        })();
        if (typeof window.__ROBIN_ON_SETTINGS__ === 'function') window.__ROBIN_ON_SETTINGS__();
        """
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    static func loadResource(named name: String, extension ext: String) -> String {
        let url =
            Bundle.main.url(forResource: name, withExtension: ext, subdirectory: subdirectory)
            ?? Bundle.main.url(forResource: name, withExtension: ext)
        guard let url, let data = try? Data(contentsOf: url),
              let text = String(data: data, encoding: .utf8)
        else {
            assertionFailure("Missing x-filter resource \(name).\(ext)")
            return ""
        }
        return text
    }

    private static func jsonStringLiteral(_ raw: String) -> String {
        var out = "\""
        for ch in raw {
            switch ch {
            case "\\": out += "\\\\"
            case "\"": out += "\\\""
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default:
                if ch.unicodeScalars.first!.value < 0x20 {
                    out += String(format: "\\u%04x", ch.unicodeScalars.first!.value)
                } else {
                    out.append(ch)
                }
            }
        }
        out += "\""
        return out
    }
}
