import Foundation
import OSLog
import Aptabase

/// Optional Aptabase analytics. Empty `APTABASE_APP_KEY` ⇒ no-op (forks stay off).
enum Analytics {
    private static let log = Logger(subsystem: "org.evergreenlabs.robin", category: "Analytics")
    private static var enabled = false

    static func configure() {
        let appKey = AppConfig.aptabaseAppKey
        guard !appKey.isEmpty else {
            log.info("Aptabase disabled (optional; set APTABASE_APP_KEY to enable)")
            enabled = false
            return
        }
        let host = AppConfig.aptabaseHost
        if appKey.uppercased().hasPrefix("A-SH-"), host.isEmpty {
            log.warning("Aptabase A-SH key requires APTABASE_HOST — leaving disabled")
            enabled = false
            return
        }
        let options: InitOptions? = host.isEmpty ? nil : InitOptions(host: host)
        if let options {
            Aptabase.shared.initialize(appKey: appKey, with: options)
        } else {
            Aptabase.shared.initialize(appKey: appKey)
        }
        enabled = true
        log.info("Aptabase enabled")
        track("app_started")
    }

    static func track(_ event: String, with props: [String: Any]? = nil) {
        guard enabled else { return }
        if let props, !props.isEmpty {
            Aptabase.shared.trackEvent(event, with: props)
        } else {
            Aptabase.shared.trackEvent(event)
        }
    }
}
