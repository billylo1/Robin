# App Store graphics

Listing copy for fastlane deliver lives in `fastlane/metadata/en-US/`. Screenshots for upload are in `fastlane/screenshots/en-US/`.

| Asset | Spec |
|-------|------|
| iPhone 6.3" | 1206 × 2622 PNG |
| iPhone 6.9" | 1320 × 2868 PNG (scaled from 6.3") |
| iPad 13" | 2064 × 2752 PNG |
| Demo recording | [`video/demo.mp4`](video/demo.mp4) — local capture. App Preview is a separate `.mov` upload. |

## Screenshots included

### iPhone (17)

1. `01-feed.png` — Following feed in the embedded X session (gear Settings)
2. `02-feed-scrolled.png` — further down the timeline

### iPad (13" upload size)

1. `ipad-01-feed.png` / `ipad-02-feed-scrolled.png` — same WebView feed, sized for 13" listing

Capture from Device Hub / simulator with an X session signed in, then copy into `fastlane/screenshots/en-US/` as `iPhone63-*`, `iPhone69-*`, `iPad13-*`. App Store text describes this iOS build only (no Android wording).
