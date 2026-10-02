import Foundation

enum AppConfig {
    /// Empty / placeholder / unresolved xcconfig ⇒ Sentry stays off (safe for forks).
    static var sentryDSN: String {
        let raw = (Bundle.main.object(forInfoDictionaryKey: "SENTRY_DSN") as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if raw.isEmpty { return "" }
        if raw.contains("$(") { return "" }
        if raw.localizedCaseInsensitiveContains("YOUR_") { return "" }
        if !(raw.hasPrefix("http://") || raw.hasPrefix("https://")) { return "" }
        return raw
    }

    /// Empty / placeholder ⇒ Aptabase stays off (safe for forks).
    static var aptabaseAppKey: String {
        let raw = (Bundle.main.object(forInfoDictionaryKey: "APTABASE_APP_KEY") as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if raw.isEmpty { return "" }
        if raw.contains("$(") { return "" }
        if raw.localizedCaseInsensitiveContains("YOUR_") { return "" }
        if !raw.uppercased().hasPrefix("A-") { return "" }
        return raw
    }

    /// Self-hosted Aptabase origin (required for `A-SH-*` keys). Empty when cloud or disabled.
    static var aptabaseHost: String {
        let raw = (Bundle.main.object(forInfoDictionaryKey: "APTABASE_HOST") as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let cleaned = raw.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        if cleaned.isEmpty { return "" }
        if cleaned.contains("$(") { return "" }
        if cleaned.localizedCaseInsensitiveContains("YOUR_") { return "" }
        if !(cleaned.hasPrefix("http://") || cleaned.hasPrefix("https://")) { return "" }
        return cleaned
    }

    static var versionName: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.0"
    }

    static var versionCode: Int {
        Int(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1") ?? 1
    }
}
