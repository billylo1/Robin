# Robin

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
> Unofficial project. Not affiliated with, endorsed by, or sponsored by X Corp. or Twitter.

## Why

X is useful for staying current. The default experience buries that in noise — promoted posts, a For You feed of engagement bait, and polarized pile-ons from people you never followed.

Robin is built around three things that matter when you use X to stay informed:

1. **Up-to-date news from people you follow** — without polarized pile-ons from strangers you never chose to hear from.
2. **An ad-free experience** — no promoted posts or sponsored content mixed into your timeline.
3. **No algorithmic feed** — our feed would contain news from people we follow only, nothing added by an algorithm, because we use our information stream to form opinions and act; it should not be ranked or reshaped to steer either.

Robin is a native **Android** and **iOS** client: an x.com WebView with injected filters that force the Following timeline and hide promoted noise. Sign-in is your normal X cookie session inside the WebView — there is no separate Robin backend.

### How much of For You is actually from people you follow?

To put a number on the noise: we scrolled one logged-in **For You** home timeline (~87 posts), labeled each item as an ad (explicit “Ad”), checked each author against that account’s follow graph, and tallied the mix.

| What you see on For You | Share of posts |
| --- | ---: |
| People you follow | **~10%** |
| Algorithmic inserts (accounts you do not follow) | **~70%** |
| Network inserts (e.g. “X reposted”) | **~1%** |
| Ads | **~18%** |

In other words, only about **one in ten** posts on For You came from someone that account chose to follow. Roughly **nine in ten** were algorithm add-ons, ads, or similar. (One scroll session — your mix will vary — but the shape of the problem is hard to miss.)

I hope this helps.

**Architecture:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · **Mobile setup:** [docs/mobile.md](docs/mobile.md) · **WebView filters:** [docs/webview-filter.md](docs/webview-filter.md) · **Contributing:** [CONTRIBUTING.md](CONTRIBUTING.md) · **Security:** [SECURITY.md](SECURITY.md)

## Features

- Following-first feed via injected filters on x.com (force Following / Latest, hide For You)
- Hide promoted posts, page chrome, compose prompts, and related clutter
- Text size controls
- Sign out clears the X WebView cookie session
- Optional Sentry and Aptabase (off unless you configure them locally)

## Stack

- **Android** — Jetpack Compose, WebView, minSdk 33
- **iOS** — SwiftUI, WKWebView, iOS 18+
- Shared filter core adapted from [Minimal Twitter](https://github.com/typefully/minimal-twitter) (MIT)

## Get started

| Platform | Guide |
|----------|--------|
| Android | [docs/mobile.md](docs/mobile.md#android-client) |
| iOS | [docs/mobile.md](docs/mobile.md#ios-client) |
| Store builds | Homebrew Fastlane (`fastlane/`) — see Fastfile |

Quick Android debug build:

```bash
cp android/local.properties.example android/local.properties
# set sdk.dir=…
cd android && ./gradlew :app:assembleDebug
```

Quick iOS:

```bash
cp ios/Config.xcconfig.example ios/Config.xcconfig
open ios/Robin.xcodeproj
```

## Project layout

```
android/                        # Jetpack Compose + x.com WebView
ios/                            # SwiftUI + WKWebView
fastlane/                       # Play / TestFlight release lanes
docs/mobile.md                  # Build & configure Android / iOS
docs/webview-filter.md          # Injected filter behavior
docs/ARCHITECTURE.md
scripts/feed-credibility/       # Optional research tooling (For You vs Following mix)
LICENSE / CONTRIBUTING.md / SECURITY.md / CODE_OF_CONDUCT.md
```

## Before making the repo public

To publish **Robin** as a new GitHub repo with a single initial commit (no prior git history), see [docs/publish-robin-repo.md](docs/publish-robin-repo.md). That export uses `git archive` of `HEAD`, so MyTwitter history and untracked local secrets stay in this repo. Run it manually when you are ready.

1. Commit the open-source cleanup here first (`git archive` reads `HEAD`).
2. Confirm `android/local.properties`, `android/keystore.properties`, `ios/Config.xcconfig`, `.env`, `serviceAccount.json`, and `fastlane/.env` are untracked.
3. On GitHub: set license to MIT, add a description, then flip the repository from private to public.

## License

[MIT](LICENSE). Feed filters include adaptations from Minimal Theme for Twitter / X (MIT).
