fastlane documentation
----

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

### beta_both

```sh
[bundle exec] fastlane beta_both
```

Play internal testing then TestFlight (Android first)

----


## iOS

### ios generate

```sh
[bundle exec] fastlane ios generate
```

Regenerate Xcode project from ios/project.yml

### ios build

```sh
[bundle exec] fastlane ios build
```

Build an App Store IPA locally (no upload, no bump)

### ios beta

```sh
[bundle exec] fastlane ios beta
```

Bump iOS build, archive, upload to TestFlight

### ios download_metadata

```sh
[bundle exec] fastlane ios download_metadata
```

Pull App Store listing copy from ASC into fastlane/metadata

### ios upload_metadata

```sh
[bundle exec] fastlane ios upload_metadata
```

Upload App Store listing metadata only (no binary)

### ios release

```sh
[bundle exec] fastlane ios release
```

Bump iOS marketing+build, archive, submit to App Store

----


## Android

### android upload_metadata

```sh
[bundle exec] fastlane android upload_metadata
```

Upload Play Store listing metadata + screenshots only (no AAB)

### android build_aab

```sh
[bundle exec] fastlane android build_aab
```

Build a release AAB locally (no upload)

### android beta

```sh
[bundle exec] fastlane android beta
```

Bump versionCode, build AAB, upload to Play internal testing

### android release

```sh
[bundle exec] fastlane android release
```

Bump version, upload to Play internal, promote to production

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
