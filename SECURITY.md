# Security Policy

## Supported versions

Security fixes are applied to the latest commit on the default branch.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security problems (especially anything involving credentials, tokens, or auth bypass).

Prefer one of:

1. [GitHub Security Advisories](https://github.com/billylo1/Robin/security/advisories/new) (private report), or
2. Email the maintainer via the contact listed on the GitHub profile for this repository.

Include a short description, steps to reproduce, and impact. We will acknowledge reports and work on a fix as soon as practical.

## Secrets hygiene

Never commit `android/local.properties`, `android/keystore.properties`, `ios/Config.xcconfig`, `fastlane/.env`, upload keystores, or live Sentry / Aptabase credentials. See `.gitignore` and the examples under `android/`, `ios/`, and `fastlane/.env.example`.

## Privacy model

Robin does not run a backend. The apps load x.com in a WebView and keep the session in the WebView cookie / website data store. Optional Sentry and Aptabase only run when you configure them locally; leaving those values empty disables them.
