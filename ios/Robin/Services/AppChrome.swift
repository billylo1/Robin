import Foundation

/// In-app chrome: settings sheet + toast.
@Observable
@MainActor
final class AppChrome {
    var infoPresented = false
    var toastMessage: String?

    func showToast(_ message: String) {
        toastMessage = message
    }
}
