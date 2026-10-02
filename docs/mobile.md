# Android client

Primary UI is an **x.com WebView** with injected filters (Following by default / optional For You; hide promoted posts). Package: `org.evergreenlabs.robin`. X sign-in is the WebView cookie session (no Robin backend). See [`docs/webview-filter.md`](webview-filter.md).

## Requirements

- Android Studio Ladybug+ (or SDK 36 + JDK 17)
- Device or emulator **API 33+**

## Configure

```bash
cp android/local.properties.example android/local.properties
```

Edit `android/local.properties`:

```properties
sdk.dir=/Users/YOU/Library/Android/sdk
# Optional — omit or leave blank to disable Sentry (recommended for forks)
# sentry.dsn=https://YOUR_PUBLIC_KEY@oXXXX.ingest.us.sentry.io/PROJECT_ID
# Optional Aptabase — leave blank to disable (recommended for forks)
# aptabase.appKey=A-SH-YOUR_APP_KEY
# aptabase.host=https://YOUR_APTABASE_HOST
```

`sentry.dsn` (or env `SENTRY_DSN`) becomes `BuildConfig.SENTRY_DSN`. `aptabase.appKey` / `aptabase.host` (or `APTABASE_APP_KEY` / `APTABASE_HOST`) become BuildConfig fields; empty / placeholder ⇒ Aptabase stays fully disabled. Do not commit `local.properties`.

## Run

```bash
cd android
./gradlew :app:assembleDebug
./gradlew :app:installDebug
```

## Behavior

| Concern | How |
|--------|-----|
| Feed | `x.com` WebView + `assets/x-filter` inject (Following or For You from Settings, hide ads / page header) |
| Sign in | On x.com inside the WebView (cookie session) |
| Settings | Gear → text size, filter toggles, sign out (clears X cookies) |
| Theme | Material 3 light/dark following system; brand blue accent |

## Play release (AAB)

1. Create `android/keystore.properties` (gitignored):

```properties
storeFile=/absolute/path/to/robin-upload.jks
storePassword=…
keyAlias=robin
keyPassword=…
```

2. Optionally set `sentry.dsn` in `android/local.properties`, or export `SENTRY_DSN` in your environment.

3. Build the Play App Bundle:

```bash
cd android
./gradlew :app:bundleRelease
```

Output: `android/app/build/outputs/bundle/release/app-release.aab`

Upload that AAB to Play Console → Testing → closed/open testing (or Internal testing). First upload requires creating the Play app for `org.evergreenlabs.robin` and enrolling in Play App Signing.

## Store listing graphics

Prebuilt assets live in `android/play-store/`:

- App icon: `icon/icon-512.png` (512×512)
- Feature graphic: `feature-graphic/feature-graphic-1024x500.png` (1024×500)
- Phone screenshots: `screenshots/phone/*.png`
- Tablet screenshots: `screenshots/tablet/*.png` (Medium_Tablet AVD, landscape + portrait)

---

# iOS client

Primary UI is an **x.com WKWebView** with the same injected filters as Android. Bundle ID: `org.evergreenlabs.robin`. X sign-in is the WKWebView cookie session (no Robin backend). See [`docs/webview-filter.md`](webview-filter.md).

## Requirements

- Xcode 16+ / **iOS 18+**
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`) to regenerate the project from `ios/project.yml` if needed

## Configure

```bash
cp ios/Config.xcconfig.example ios/Config.xcconfig
```

Edit `ios/Config.xcconfig` (gitignored). In xcconfig files, `//` starts a comment, so write HTTPS URLs as `https:/$()/host`:

```
# Optional — leave blank (or omit) to disable Sentry
# SENTRY_DSN = https:/$()/YOUR_PUBLIC_KEY@oXXXX.ingest.us.sentry.io/PROJECT_ID
# Optional Aptabase — leave blank to disable
# APTABASE_APP_KEY = A-SH-YOUR_APP_KEY
# APTABASE_HOST = https:/$()/YOUR_APTABASE_HOST
```

Leave `SENTRY_DSN` / `APTABASE_APP_KEY` blank to disable those services.

Open [`ios/Robin.xcodeproj`](../ios/Robin.xcodeproj), select your team, then Run.

```bash
cd ios
xcodegen generate   # only if project.yml changed
xcodebuild -project Robin.xcodeproj -scheme Robin \
  -destination 'platform=iOS Simulator,name=iPhone 17' build
```

## Behavior

| Concern | How |
|--------|-----|
| Feed | `x.com` WKWebView + `Resources/x-filter` inject (parity with Android) |
| Sign in | On x.com inside the WebView (cookie session) |
| Settings | Gear → text size, filter toggles, sign out (`WKWebsiteDataStore`) |
| Export compliance | `ITSAppUsesNonExemptEncryption = false` in `ios/project.yml` → `Info.plist` |
