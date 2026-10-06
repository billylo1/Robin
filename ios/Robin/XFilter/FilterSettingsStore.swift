import Foundation
import Observation

/// Persists filter toggles for WebView inject (replaces chrome.storage).
@Observable
final class FilterSettingsStore {
    private enum Keys {
        static let forceFollowing = "xfilter:forceFollowing"
        static let hideForYouTab = "xfilter:hideForYouTab"
        static let hidePromoted = "xfilter:hidePromoted"
        static let preferLatest = "xfilter:preferLatest"
        static let hideWhoToFollow = "xfilter:hideWhoToFollow"
        static let hideLiveContent = "xfilter:hideLiveContent"
        static let hideOpenAppNags = "xfilter:hideOpenAppNags"
        static let hidePageHeader = "xfilter:hidePageHeader"
        static let hideComposeButton = "xfilter:hideComposeButton"
        static let hideKeywords = "xfilter:hideKeywords"
    }

    private let defaults: UserDefaults

    var settings: FilterSettings {
        didSet { persist(settings) }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.settings = Self.load(from: defaults)
    }

    func update(_ transform: (inout FilterSettings) -> Void) {
        var next = settings
        transform(&next)
        settings = next
    }

    private func persist(_ s: FilterSettings) {
        defaults.set(s.forceFollowing, forKey: Keys.forceFollowing)
        defaults.set(s.hideForYouTab, forKey: Keys.hideForYouTab)
        defaults.set(s.hidePromoted, forKey: Keys.hidePromoted)
        defaults.set(s.preferLatest, forKey: Keys.preferLatest)
        defaults.set(s.hideWhoToFollow, forKey: Keys.hideWhoToFollow)
        defaults.set(s.hideLiveContent, forKey: Keys.hideLiveContent)
        defaults.set(s.hideOpenAppNags, forKey: Keys.hideOpenAppNags)
        defaults.set(s.hidePageHeader, forKey: Keys.hidePageHeader)
        defaults.set(s.hideComposeButton, forKey: Keys.hideComposeButton)
        defaults.set(s.hideKeywords, forKey: Keys.hideKeywords)
    }

    private static func load(from defaults: UserDefaults) -> FilterSettings {
        let d = FilterSettings.default
        func bool(_ key: String, fallback: Bool) -> Bool {
            if defaults.object(forKey: key) == nil { return fallback }
            return defaults.bool(forKey: key)
        }
        return FilterSettings(
            forceFollowing: bool(Keys.forceFollowing, fallback: d.forceFollowing),
            hideForYouTab: bool(Keys.hideForYouTab, fallback: d.hideForYouTab),
            hidePromoted: bool(Keys.hidePromoted, fallback: d.hidePromoted),
            preferLatest: bool(Keys.preferLatest, fallback: d.preferLatest),
            hideWhoToFollow: bool(Keys.hideWhoToFollow, fallback: d.hideWhoToFollow),
            hideLiveContent: bool(Keys.hideLiveContent, fallback: d.hideLiveContent),
            hideOpenAppNags: bool(Keys.hideOpenAppNags, fallback: d.hideOpenAppNags),
            hidePageHeader: bool(Keys.hidePageHeader, fallback: d.hidePageHeader),
            hideComposeButton: bool(Keys.hideComposeButton, fallback: d.hideComposeButton),
            hideKeywords: FilterSettings.normalizedKeywords(
                defaults.stringArray(forKey: Keys.hideKeywords) ?? []
            )
        )
    }
}
