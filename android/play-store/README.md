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

### Phone (`screenshots/phone/`) — 1080 × 1920, framed mockups

1. `01-feed.png` — Following feed in device frame
2. `03-settings.png` — Settings sheet in device frame

Capture the in-app x.com WebView, compose framed mockups at 1080×1920, then copy into this folder and `fastlane/metadata/android/en-US/images/phoneScreenshots/`.
