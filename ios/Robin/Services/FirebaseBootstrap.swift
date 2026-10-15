import FirebaseAppCheck
import FirebaseCore
import Foundation

private final class RobinAppCheckProviderFactory: NSObject, AppCheckProviderFactory {
    func createProvider(with app: FirebaseApp) -> (any AppCheckProvider)? {
        #if DEBUG
        return AppCheckDebugProvider(app: app)
        #else
        // App Attest is unsupported for iOS/iPadOS apps running on Apple silicon Macs
        // (and Mac Catalyst). DCAppAttestService.isSupported is always false there.
        // Fall back to DeviceCheck, which does work in that environment.
        let runningOnMac = ProcessInfo.processInfo.isiOSAppOnMac
        if #available(iOS 14.0, *), !runningOnMac {
            return AppAttestProvider(app: app)
        }
        return DeviceCheckProvider(app: app)
        #endif
    }
}

enum FirebaseBootstrap {
    /// Pre-registered in Firebase Console → App Check → Robin iOS → Manage debug tokens
    /// DEBUG builds only.
    private static let debugAppCheckToken = "93B25776-9789-4595-B9EA-B08C4CE49B49"

    static func configure() {
        guard FirebaseApp.app() == nil else { return }

        #if DEBUG
        // Prefer scheme env (`AppCheckDebugToken`); otherwise pin the shared registered token
        // so simulator launches via simctl / without the Xcode scheme still pass App Check.
        let env = ProcessInfo.processInfo.environment
        if env["AppCheckDebugToken"] == nil, env["FIRAAppCheckDebugToken"] == nil {
            setenv("AppCheckDebugToken", debugAppCheckToken, 1)
        }
        #endif

        AppCheck.setAppCheckProviderFactory(RobinAppCheckProviderFactory())
        FirebaseApp.configure()
    }
}
