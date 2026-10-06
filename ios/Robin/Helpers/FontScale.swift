import SwiftUI

enum FontScale {
    static let storageKey = "robin:fontScale"
    static let min = 0.85
    static let max = 2.0
    static let step = 0.1
    /// 100% — matches the web client's default text size.
    static let defaultValue = 1.0

    static func clamp(_ value: Double) -> Double {
        let stepped = (value * 10).rounded() / 10
        return Swift.min(max, Swift.max(min, stepped))
    }
}

@Observable
final class FontScaleStore {
    var scale: Double {
        didSet {
            UserDefaults.standard.set(scale, forKey: FontScale.storageKey)
        }
    }

    var percentLabel: String {
        "\(Int((scale * 100).rounded()))%"
    }

    var canDecrease: Bool { scale > FontScale.min + 1e-9 }
    var canIncrease: Bool { scale < FontScale.max - 1e-9 }

    init() {
        let stored = UserDefaults.standard.object(forKey: FontScale.storageKey) as? Double
        scale = FontScale.clamp(stored ?? FontScale.defaultValue)
    }

    func bump(_ delta: Double) {
        scale = FontScale.clamp(scale + delta)
    }
}
