import Foundation

/// Home feed mode for Settings (maps to `forceFollowing`, `hideForYouTab`, `preferLatest`).
enum HomeFeedMode: String, CaseIterable, Identifiable, Sendable {
    case followingByTime
    case forYou

    var id: String { rawValue }

    var label: String {
        switch self {
        case .followingByTime: "Following (by time)"
        case .forYou: "For You"
        }
    }
}

/// Defaults for the injected x-filter core (no chrome.storage).
/// Host serializes these onto `window.__ROBIN_SETTINGS__` before filter-core.js.
struct FilterSettings: Equatable, Sendable {
    /// When true, stick to Following and hide For You. When false, stick to For You.
    var forceFollowing: Bool = true
    var hideForYouTab: Bool = true
    var hidePromoted: Bool = true
    var preferLatest: Bool = true
    var hideWhoToFollow: Bool = true
    /// Hide live / Spaces / broadcast promo rows in the Following feed.
    var hideLiveContent: Bool = true
    var hideOpenAppNags: Bool = true
    /// Hide X avatar / logo / Subscribe / Following tabs on home (native bar replaces them).
    var hidePageHeader: Bool = true
    /// Hide the floating / side-nav compose (post) button.
    var hideComposeButton: Bool = true

    static let `default` = FilterSettings()

    /// Home feed mode for Settings UI (default: Following by time).
    var homeFeedMode: HomeFeedMode {
        get {
            !forceFollowing ? .forYou : .followingByTime
        }
        set {
            switch newValue {
            case .followingByTime:
                forceFollowing = true
                hideForYouTab = true
                preferLatest = true
            case .forYou:
                forceFollowing = false
                hideForYouTab = false
                preferLatest = false
            }
        }
    }

    /// JSON object literal for embedding in injected JavaScript.
    func toJSONObjectLiteral(fontScale: Double = 1) -> String {
        """
        {"forceFollowing":\(forceFollowing),"hideForYouTab":\(hideForYouTab),"hidePromoted":\(hidePromoted),"preferLatest":\(preferLatest),"hideWhoToFollow":\(hideWhoToFollow),"hideLiveContent":\(hideLiveContent),"hideOpenAppNags":\(hideOpenAppNags),"hidePageHeader":\(hidePageHeader),"hideComposeButton":\(hideComposeButton),"fontScale":\(fontScale)}
        """
    }
}
