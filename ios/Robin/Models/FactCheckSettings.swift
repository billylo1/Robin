import Foundation

enum FactCheckModelPreference: String, Codable, CaseIterable, Identifiable {
    case flashLite = "flash_lite"
    case flash = "flash"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .flashLite: return "Lite"
        case .flash: return "Flash"
        }
    }

    /// Gemini Developer API model id for Firebase AI Logic.
    var modelName: String {
        switch self {
        case .flashLite: return "gemini-3.5-flash-lite"
        case .flash: return "gemini-3.8-flash"
        }
    }

    /// Flash (3.8) defaults to medium thinking; pin to low for fast latency without triggering errors. Lite defaults to minimal.
    var requiresLowThinking: Bool {
        self == .flash
    }
}
