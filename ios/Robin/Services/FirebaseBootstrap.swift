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
    static func configure() {
        guard FirebaseApp.app() == nil else { return }

        #if DEBUG
        // Check scheme / process env (`AppCheckDebugToken`), or local xcconfig.
        // If unset, AppCheckDebugProvider automatically logs a newly generated debug secret to the console.
        let env = ProcessInfo.processInfo.environment
        if env["AppCheckDebugToken"] == nil, env["FIRAAppCheckDebugToken"] == nil {
            if let customToken = (Bundle.main.object(forInfoDictionaryKey: "APP_CHECK_DEBUG_TOKEN") as? String)?
                .trimmingCharacters(in: .whitespacesAndNewlines),
               !customToken.isEmpty, !customToken.contains("$("), !customToken.localizedCaseInsensitiveContains("YOUR_") {
                setenv("AppCheckDebugToken", customToken, 1)
            }
        }
        #endif

        AppCheck.setAppCheckProviderFactory(RobinAppCheckProviderFactory())
        FirebaseApp.configure()
    }
}
