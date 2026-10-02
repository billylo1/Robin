import SwiftUI
import UIKit

@main
struct RobinApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var chrome = AppChrome()
    @State private var fontScale = FontScaleStore()
    @State private var feedRefreshInterval = FeedRefreshIntervalStore()
    @State private var filterSettings = FilterSettingsStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .removingMacPhantomTopInset()
                .environment(chrome)
                .environment(fontScale)
                .environment(feedRefreshInterval)
                .environment(filterSettings)
                .environment(\.fontScale, fontScale.scale)
                .onKeyPress(keys: [.init("="), .init("+")]) { press in
                    guard press.modifiers.contains(.command) else { return .ignored }
                    fontScale.bump(FontScale.step)
                    return .handled
                }
                .onKeyPress(keys: [.init("-"), .init("_")]) { press in
                    guard press.modifiers.contains(.command) else { return .ignored }
                    fontScale.bump(-FontScale.step)
                    return .handled
                }
        }
    }
}
