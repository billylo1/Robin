# Android / iOS WebView filter

See [`docs/webview-filter.md`](../docs/webview-filter.md) for the shared Android + iOS design.

Android assets live in `app/src/main/assets/x-filter/`. Keep them identical to `ios/Robin/Resources/x-filter/`.

Hosts set a mobile user agent as a best-effort hint; on Mac, X often still serves desktop chrome — `hidePageHeader` covers both layouts in `filter-core.js`.
