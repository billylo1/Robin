import DeviceCheck
import FirebaseAppCheck
import FirebaseCore
import Foundation

#if !DEBUG
/// Composite provider that attempts App Attest on genuine iOS/iPadOS hardware,
/// and automatically falls back to DeviceCheck on Mac (Designed for iPad / Mac Catalyst)
/// or whenever App Attest is unsupported or fails.
private final class AppAttestWithDeviceCheckFallbackProvider: NSObject, AppCheckProvider {
    private let primary: (any AppCheckProvider)?
    private let fallback: (any AppCheckProvider)?

    init(app: FirebaseApp) {
        let runningOnMac = ProcessInfo.processInfo.isiOSAppOnMac
        if #available(iOS 14.0, *), !runningOnMac, DCAppAttestService.shared.isSupported {
            self.primary = AppAttestProvider(app: app)
        } else {
            self.primary = nil
        }
        self.fallback = DeviceCheckProvider(app: app)
        super.init()
    }

    private func requestToken(
        from provider: any AppCheckProvider,
        limitedUse: Bool,
        completion: @escaping (AppCheckToken?, (any Error)?) -> Void
    ) {
        if limitedUse, let getLimited = provider.getLimitedUseToken {
            getLimited(completion)
        } else {
            provider.getToken(completion: completion)
        }
    }

    private func executeTokenRequest(
        limitedUse: Bool,
        completion handler: @escaping (AppCheckToken?, (any Error)?) -> Void
    ) {
        if let primary = primary {
            requestToken(from: primary, limitedUse: limitedUse) { [weak self] token, error in
                if let token = token {
                    handler(token, nil)
                } else if let fallback = self?.fallback {
                    self?.requestToken(from: fallback, limitedUse: limitedUse, completion: handler)
                } else {
                    handler(nil, error)
                }
            }
        } else if let fallback = fallback {
            requestToken(from: fallback, limitedUse: limitedUse, completion: handler)
        } else {
            handler(nil, nil)
        }
    }

    func getToken(completion handler: @escaping (AppCheckToken?, (any Error)?) -> Void) {
        executeTokenRequest(limitedUse: false, completion: handler)
    }

    func getLimitedUseToken(completion handler: @escaping (AppCheckToken?, (any Error)?) -> Void) {
        executeTokenRequest(limitedUse: true, completion: handler)
    }
}
#endif

private final class RobinAppCheckProviderFactory: NSObject, AppCheckProviderFactory {
    func createProvider(with app: FirebaseApp) -> (any AppCheckProvider)? {
        #if DEBUG
        return AppCheckDebugProvider(app: app)
        #else
        return AppAttestWithDeviceCheckFallbackProvider(app: app)
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
