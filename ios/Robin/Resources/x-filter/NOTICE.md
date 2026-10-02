# x-filter

Filter scripts injected into the Android WebView that loads x.com.

## Attribution

CSS selectors and hide-promoted / timeline-tab patterns are adapted from
[Minimal Theme for Twitter / X](https://github.com/typefully/minimal-twitter)
by Typefully / Mailbrew Inc., licensed under the MIT License
(see `LICENSE.minimal-twitter`).

This Robin port strips Chrome extension APIs (`chrome.storage`,
`chrome.runtime`) and Typefully UI plugs. Settings are supplied via
`window.__ROBIN_SETTINGS__` before the script runs.
