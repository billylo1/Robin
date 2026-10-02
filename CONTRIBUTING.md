# Contributing

Thanks for contributing. Robin is a native Android / iOS x.com WebView client with injected Following-first filters — keep PRs focused and avoid committing secrets.

## Setup

Follow the platform guides in [docs/mobile.md](docs/mobile.md):

1. Android: copy `android/local.properties.example` → `android/local.properties` and set `sdk.dir`.
2. iOS: copy `ios/Config.xcconfig.example` → `ios/Config.xcconfig` (optional Sentry / Aptabase).

Do **not** commit:

- `android/local.properties` / `android/keystore.properties`
- `ios/Config.xcconfig`
- `fastlane/.env` (App Store Connect key id, issuer id, and `.p8` path)
- Store credentials, upload keystores, or live analytics DSNs

## Pull requests

- Keep changes small and explain **why** in the PR description.
- Match existing style in `android/` and `ios/`. Prefer keeping Android and iOS filter behavior in sync (`assets/x-filter` ↔ `Resources/x-filter`).
- Update [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) or [docs/webview-filter.md](docs/webview-filter.md) when you change inject behavior or app structure.
- Update [README.md](README.md) / [docs/mobile.md](docs/mobile.md) when you add user-visible setup steps.
- Do not add credentials, personal handles, or production project ids as defaults.

## Code of conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Security

See [SECURITY.md](SECURITY.md) for private vulnerability reports.
