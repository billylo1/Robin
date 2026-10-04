# WebView filter (Android + iOS)

Primary mobile UI is an in-app `x.com` session with an injected filter core (Following by default, optional For You; hide ads / page chrome), adapted from [minimal-twitter](https://github.com/typefully/minimal-twitter) (MIT).

Desktop remains a normal browser + extension (out of scope).

## Shared filter core

Keep these trees in sync (same JS/CSS behavior):

| Platform | Path |
|----------|------|
| Android | [`android/app/src/main/assets/x-filter/`](../android/app/src/main/assets/x-filter/) |
| iOS | [`ios/Robin/Resources/x-filter/`](../ios/Robin/Resources/x-filter/) |

Host sets `window.__ROBIN_SETTINGS__` before `filter-core.js` runs. CSS id: `robin-x-filter-css`.

## Platform hosts

| | Android | iOS |
|--|---------|-----|
| Screen | `XWebFeedScreen` | `XWebFeedView` |
| Inject | `XFilterInjector` + document-start (`androidx.webkit`) | `XFilterInjector` + `WKUserScript` `.atDocumentStart` |
| Settings | `FilterSettingsStore` (DataStore) | `FilterSettingsStore` (UserDefaults) |
| Text size | `FontScaleStore` → `html` zoom | `FontScaleStore` → `html` `-webkit-text-size-adjust` (WKWebView text ignores `zoom`); on iOS-app-on-Mac also scales X's fixed px `line-height` rules |
| Sign out | clear cookies / `WebStorage` → login URL | `WKWebsiteDataStore` → login URL |
| Layout | Mobile Chrome UA (best-effort) | iPhone Safari UA + `preferredContentMode = .mobile` + document-start mobile identity spoof; on device viewport uses `device-width` (desktop ≥1000px breakpoints forced off); on Mac (`isiOSAppOnMac`) layout identity is frozen at 390px so X mounts the mobile shell |
| Boot cover | Native overlay + `RobinBoot.ready()` | Native overlay + `mtBoot` script message |
| Benchmark | `BenchmarkStore` (SharedPreferences) + ADB broadcast | `RobinBenchmarkStore` (UserDefaults) + ScriptMessageHandler |

X may still try **desktop** chrome on wide WebViews. iOS injects a force-mobile script (mobile UA / touch / pointer; blocks ≥1000px desktop breakpoints). **Phones/iPads** lay out to the real WebView width (landscape / tablet widen up to ~840px). **Mac Designed-for-iPhone/iPad** freezes `innerWidth` / viewport at phone size — a wide Mac WebView otherwise mounts desktop/hybrid DOM while Robin hides those rails, which blanks the feed. `hidePageHeader` hides mobile `TopNavBar` / desktop left/right rails and expands `primaryColumn`. Home tab forcing only clicks label-verified For You / Following controls.

### Boot gate (initial launch)

While filter-core settles the chosen home tab (Following or For You) / Latest / chrome hides, `html:not([data-mt-boot-ready="1"]) body` keeps the page invisible. Bootstrap removes `data-mt-boot-ready` on every full navigation; `applySettingsOnly` must not. When ready (or after a ~5s hard timeout / non-home / login CTA), JS sets `data-mt-boot-ready="1"` and notifies the host once (`webkit.messageHandlers.mtBoot` / `RobinBoot.ready()`). Hosts show a brief “Preparing feed…” cover over the WebView until that signal (native timeout ~5.5s as a backstop).

iOS arms the cover from the **pending main-frame URL** (captured in `decidePolicyFor`) as well as `webView.url`, because during back-to-home provisional navigation `webView.url` can still be the status page.

### Near-top auto-refresh (newer posts)

X’s mobile web does not reliably surface newer posts while Robin sits at the top of Following. Hosts auto-refresh when:

- The app returns to the foreground (`scenePhase` / `ON_RESUME`), or
- The user taps the Robin title while already near the top (`scrollY ≤ ~80`), or
- While foregrounded and near the top, a ~15s poll tick runs the same refresh path (no user action required)

Guards: feed home only, near top, not mid-load / boot cover, cooldown equal to the Settings **Auto-refresh** interval (Off / 30s / 1 min / 2 min / 5 min; default 5 min). Automatic triggers (poll, foreground return) also require the user to be idle: no touch, scroll, key, wheel, or pointer movement in the feed for ~20s (reported by the scroll probe via `mtInteract` / `RobinInteract`, plus a native touch listener on Android), and Settings not open. Title tap is user-initiated and skips the idle check. Off disables poll and foreground auto-refresh; title tap and the toolbar Refresh button still work.

Flow: warm hard-reload of `https://x.com/home` with cache bypass (`reloadIgnoringLocalCacheData` / `LOAD_NO_CACHE`). Soft “Show N posts” clicks stay in filter-core’s MutationObserver auto-click path — host-driven refresh no longer goes through `__ROBIN_SOFT_REFRESH_FEED__`, because SPA `reload()` often reused a cached document and left the same stale Following posts in place. Warm reloads snapshot the current feed (`WKWebView.takeSnapshot` / `WebView.draw` into a `Bitmap`), overlay that image on the WebView, load underneath, then crossfade the snapshot away (~0.45s) on boot-ready (5.5s fallback). The boot-gated blank document is never visible, so there is no white flash.

While near the top of Following, filter-core also **auto-clicks** X’s own “Show N posts” pill as soon as it appears (MutationObserver tick, 2.5s throttle) — same affordance as desktop/mobile web, without waiting for a native refresh. `hidePageHeader` often nests that control inside TopNavBar / sticky chrome that Robin hides; discovery ignores visibility and briefly clears those hides for the click, then restores chrome.

Title tap while scrolled down still only scrolls to top. The toolbar Refresh button always reloads (warm snapshot crossfade after first reveal).

**Mac (iOS app on Mac):** keep polling while `.inactive` as well (window often stays visible without being key). Stop only on `.background` / disappear.

### Leave-home chrome cleanup

`hidePageHeaderFallback` / `hideComposeButtonFallback` mark nodes with `data-mt-robin-hide` when applying inline `display: none`. On SPA leave-home, `clearRobinHides()` removes those styles so a shared timeline ancestor is not left blank after back from a post.

Opening a post snapshots the feed scroll offset, and the tapped row’s distance from the top of the viewport, on pointer-down — before the tap scrolls that row upward. Returning to home pins that snapshot for a short time so history restoration cannot leave the feed further down. A real drag, wheel, or key cancels the pin.
## Defaults

All filter toggles default **on**; page header hide **on**; compose button hide **on**; live / Spaces / broadcast promo hide **on** (`hideLiveContent`). Home feed defaults to **Following (by time)** (`forceFollowing`, `hideForYouTab`, `preferLatest` all true). Settings offers two modes: Following (by time) and For You (clears `forceFollowing` / `hideForYouTab`; `preferLatest` is Following-only). Font scale defaults to **1.0** (100%), max **2.0**.

On home, `hideLiveContent` adds `mt-hide-live` on `html` and hides live / broadcast / Spaces / event promo chips (including magenta “+N · Event” banners inside tweets) plus dedicated live promo rows, while leaving normal tweet bodies intact.

`preferLatest` applies only in **Following (by time)** mode. It watches the home feed request X sends. Following → Popular and Following → Recent both call the `HomeLatestTimeline` GraphQL op; only the `enableRanking` variable differs (`true` = Popular, `false` = Recent). `HomeTimeline` (For you) counts as ranked. When the feed is ranked, it follows Minimal Twitter’s click chain: open the Following sort control and choose **Recent** (desktop: Timeline options / Top Tweets). Until an unranked request is seen, `data-mt-defer-feed-chrome` keeps `TopNavBar` visible despite `hidePageHeader`.

Recent is ordered by *activity* time. Reposts show the original post’s age and reply threads show their older parent first, so visible timestamps can look out of order even when the feed is chronological.

## Login / SSO

Google and Apple sign-in use `window.open`. Hosts present a **real in-app child WebView** (`WKUIDelegate.createWebViewWith` / `WebChromeClient.onCreateWindow`) so `window.opener` works — do **not** fold into the main frame or hand off to Safari/Chrome. Filter scripts stay off the OAuth window; stock user agent on the popup.

## External links

Main-frame http(s) navigations stay in the WebView only for allowlisted hosts (x.com / twitter.com + Google/Apple OAuth CDNs). **`t.co` is not allowlisted** — X opens tweet links via `window.open(https://t.co/…)`, and hosts present an **in-app system browser sheet** (`SFSafariViewController` / Chrome Custom Tabs) instead of spawning the OAuth child WebView. Done / back returns to the feed. Other destinations (articles, link previews) behave the same. Custom schemes (`twitter://`, `x://`, `intent://` nags) stay blocked or rewritten in-app as before.

## Performance Benchmarking

Robin includes built-in in-app benchmarking instrumentation across Android and iOS to measure and protect WebView rendering performance (initial load time, fast scroll settle time, and layout reflow counts).

See [performance-benchmark.md](performance-benchmark.md) for full baseline data, regression thresholds, and execution steps (via in-app Settings UI, automated ADB broadcast, or headless synthetic engine).

