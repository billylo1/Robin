import UIKit
import SwiftUI
import Sentry
import OSLog

final class AppDelegate: NSObject, UIApplicationDelegate {
    private let log = Logger(subsystem: "org.evergreenlabs.robin", category: "App")
    private static var didApplyMacMinWidth = false

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        configureSentry()
        Analytics.configure()

        for case let scene as UIWindowScene in application.connectedScenes {
            Self.applyMacMinimumWindowWidth(scene)
        }
        NotificationCenter.default.addObserver(
            forName: UIScene.willConnectNotification,
            object: nil,
            queue: .main
        ) { notification in
            Self.applyMacMinimumWindowWidth(notification.object as? UIWindowScene)
        }
        return true
    }

    /// iPad-on-Mac windows inherit a fairly large system minimum width; shrink it.
    private static func applyMacMinimumWindowWidth(_ scene: UIWindowScene?) {
        guard !didApplyMacMinWidth,
              ProcessInfo.processInfo.isiOSAppOnMac,
              let restrictions = scene?.sizeRestrictions
        else { return }
        didApplyMacMinWidth = true
        var minimum = restrictions.minimumSize
        minimum.width *= 0.7
        restrictions.minimumSize = minimum
    }

    // MARK: - Sentry

    private func configureSentry() {
        let dsn = AppConfig.sentryDSN
        guard !dsn.isEmpty else {
            log.warning("Sentry disabled (empty SENTRY_DSN)")
            return
        }
        SentrySDK.start { options in
            options.dsn = dsn
            options.environment = {
                #if DEBUG
                "debug"
                #else
                "release"
                #endif
            }()
            options.releaseName =
                "\(Bundle.main.bundleIdentifier ?? "org.evergreenlabs.robin")@\(AppConfig.versionName)+\(AppConfig.versionCode)"
            #if DEBUG
            options.tracesSampleRate = 1.0
            options.debug = true
            #else
            options.tracesSampleRate = 0.2
            options.debug = false
            #endif
        }
    }
}

/// On Mac ("Designed for iPad") the window title bar already sits above our
/// content, yet iOS still reports a 20pt status-bar safe area that nothing
/// occupies, leaving an empty band under the title bar. Cancel it with a matching
/// negative additional inset on the root view controller — SwiftUI's
/// `ignoresSafeArea` has no effect because the inset comes from the UIKit window.
private struct MacTopInsetFix: UIViewRepresentable {
    func makeUIView(context: Context) -> UIView {
        let view = UIView(frame: .zero)
        view.isUserInteractionEnabled = false
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        guard ProcessInfo.processInfo.isiOSAppOnMac else { return }
        DispatchQueue.main.async {
            guard let root = uiView.window?.rootViewController else { return }
            let excess = root.view.safeAreaInsets.top
            guard excess > 0 else { return }
            root.additionalSafeAreaInsets.top -= excess
        }
    }
}

extension View {
    /// Removes the empty status-bar band iOS-on-Mac reserves under the title bar.
    func removingMacPhantomTopInset() -> some View {
        background(MacTopInsetFix().frame(width: 0, height: 0))
    }
}
