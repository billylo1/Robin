import Foundation

/// How often Robin auto-refreshes the Following feed while near the top.
enum FeedRefreshInterval {
    static let storageKey = "robin:feedRefreshIntervalSeconds"
    /// 0 = Off, then 30s / 1m / 2m / 5m.
    static let steps: [Int] = [0, 30, 60, 120, 300]
    static let defaultSeconds = 300
    /// Require this much quiet time before an automatic refresh fires.
    static let idleSeconds: TimeInterval = 20
    /// Poll tick while waiting for cooldown + idle (not the user-facing interval).
    static let pollTickSeconds: TimeInterval = 15

    static func clamp(_ seconds: Int) -> Int {
        if let exact = steps.first(where: { $0 == seconds }) { return exact }
        return steps.min(by: { abs($0 - seconds) < abs($1 - seconds) }) ?? defaultSeconds
    }

    static func label(for seconds: Int) -> String {
        switch clamp(seconds) {
        case 0: return "Off"
        case 30: return "30s"
        case 60: return "1 min"
        case 120: return "2 min"
        case 300: return "5 min"
        default: return "\(seconds)s"
        }
    }

    static func stepIndex(of seconds: Int) -> Int {
        steps.firstIndex(of: clamp(seconds)) ?? steps.firstIndex(of: defaultSeconds)!
    }
}

@Observable
final class FeedRefreshIntervalStore {
    var seconds: Int {
        didSet {
            UserDefaults.standard.set(seconds, forKey: FeedRefreshInterval.storageKey)
        }
    }

    var label: String { FeedRefreshInterval.label(for: seconds) }
    var isEnabled: Bool { seconds > 0 }
    var canDecrease: Bool { FeedRefreshInterval.stepIndex(of: seconds) > 0 }
    var canIncrease: Bool {
        FeedRefreshInterval.stepIndex(of: seconds) < FeedRefreshInterval.steps.count - 1
    }

    init() {
        let stored = UserDefaults.standard.object(forKey: FeedRefreshInterval.storageKey) as? Int
        seconds = FeedRefreshInterval.clamp(stored ?? FeedRefreshInterval.defaultSeconds)
    }

    func bump(_ direction: Int) {
        let idx = FeedRefreshInterval.stepIndex(of: seconds) + (direction >= 0 ? 1 : -1)
        guard FeedRefreshInterval.steps.indices.contains(idx) else { return }
        seconds = FeedRefreshInterval.steps[idx]
    }
}
