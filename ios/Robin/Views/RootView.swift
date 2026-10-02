import SwiftUI

struct RootView: View {
    @Environment(AppChrome.self) private var chrome

    var body: some View {
        XWebFeedView()
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if let toast = chrome.toastMessage {
                    Text(toast)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(.ultraThinMaterial, in: Capsule())
                        .padding(.bottom, 8)
                        .frame(maxWidth: .infinity)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                        .onAppear {
                            Task {
                                try? await Task.sleep(for: .seconds(2.5))
                                chrome.toastMessage = nil
                            }
                        }
                }
            }
    }
}
