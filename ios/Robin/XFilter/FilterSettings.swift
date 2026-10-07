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
    /// Whole-word or phrase hides. Empty hides nothing. `cat` does not match `category`.
    var hideKeywords: [String] = []

    static let keywordMaxCount = 40
    static let keywordMaxLength = 80

    static let `default` = FilterSettings()

    /// Trim, collapse whitespace, drop blanks and over-long phrases, dedupe ignoring case.
    static func normalizedKeywords(_ raw: [String]) -> [String] {
        var seen = Set<String>()
        var out: [String] = []
        for item in raw {
            if out.count >= keywordMaxCount { break }
            let phrase = item.split(whereSeparator: \.isWhitespace).joined(separator: " ")
            if phrase.isEmpty || phrase.count > keywordMaxLength { continue }
            let key = phrase.lowercased()
            if seen.contains(key) { continue }
            seen.insert(key)
            out.append(phrase)
        }
        return out
    }

    /// Nil when the phrase is blank, too long, a duplicate, or the list is full.
    static func addingKeyword(_ existing: [String], _ addition: String) -> [String]? {
        let phrase = addition.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        if phrase.isEmpty || phrase.count > keywordMaxLength { return nil }
        if existing.count >= keywordMaxCount { return nil }
        if existing.contains(where: { $0.caseInsensitiveCompare(phrase) == .orderedSame }) {
            return nil
        }
        return existing + [phrase]
    }

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
        let keywords = hideKeywords.map(Self.jsonStringLiteral).joined(separator: ",")
        return """
        {"forceFollowing":\(forceFollowing),"hideForYouTab":\(hideForYouTab),"hidePromoted":\(hidePromoted),"preferLatest":\(preferLatest),"hideWhoToFollow":\(hideWhoToFollow),"hideLiveContent":\(hideLiveContent),"hideOpenAppNags":\(hideOpenAppNags),"hidePageHeader":\(hidePageHeader),"hideKeywords":[\(keywords)],"fontScale":\(fontScale)}
        """
    }

    /// JS string literal. U+2028/U+2029 are line terminators in JavaScript source.
    private static func jsonStringLiteral(_ raw: String) -> String {
        var out = "\""
        for scalar in raw.unicodeScalars {
            switch scalar {
            case "\\":
                out += "\\\\"
            case "\"":
                out += "\\\""
            case "\n":
                out += "\\n"
            case "\r":
                out += "\\r"
            case "\t":
                out += "\\t"
            case "\u{2028}":
                out += "\\u2028"
            case "\u{2029}":
                out += "\\u2029"
            default:
                if scalar.value < 0x20 {
                    out += String(format: "\\u%04x", scalar.value)
                } else {
                    out.unicodeScalars.append(scalar)
                }
            }
        }
        out += "\""
        return out
    }
}
