# Google Play Store graphics

Ready for Play Console → **Grow users** → **Store presence** → **Main store listing**.

| Asset | File | Spec |
|-------|------|------|
| App icon | [`icon/icon-512.png`](icon/icon-512.png) | 512 × 512 PNG, 32-bit with alpha |
| Feature graphic | [`feature-graphic/feature-graphic-1024x500.png`](feature-graphic/feature-graphic-1024x500.png) | 1024 × 500 PNG, 24-bit, no alpha |
| Phone screenshots | [`screenshots/phone/`](screenshots/phone/) | 1080 × 1920 PNG (min 2) |
| Tablet screenshots | [`screenshots/tablet/`](screenshots/tablet/) | 2560 × 1600 landscape / 1600 × 2560 portrait |
| Demo recording | [`video/demo.mp4`](video/demo.mp4) | Local capture. Play listing video is a YouTube URL, not this file. |

Listing copy for supply lives in `fastlane/metadata/android/en-US/`. Phone crops are mirrored under `fastlane/metadata/android/en-US/images/phoneScreenshots/`.

## Screenshots included

### Phone (`screenshots/phone/`) — 1080 × 1920, WebView feed

1. `01-feed.png` — Following feed with refresh + Settings gear
2. `02-feed-scrolled.png` — further down the timeline
3. `03-settings.png` — Settings sheet (text size, filters, sign out)

Capture the in-app x.com WebView, then crop to 1080×1920 (top-aligned) into this folder and `fastlane/metadata/android/en-US/images/phoneScreenshots/`.

Optional extra: `icon/icon-1024.png` for other storefronts (not required by Play).
