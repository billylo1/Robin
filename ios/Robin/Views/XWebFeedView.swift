import SafariServices
import SwiftUI
import UIKit
import WebKit

/// Robin breast orange-red — SFSafari control tint.
private let robinBrowserTint = UIColor(red: 0xD9 / 255, green: 0x48 / 255, blue: 0x1C / 255, alpha: 1)

/// Opens http(s) in an in-app Safari sheet (Done returns to the feed).
private func openInAppBrowser(_ url: URL, from webView: WKWebView?) {
    let safari = SFSafariViewController(url: url)
    safari.preferredControlTintColor = robinBrowserTint
    safari.dismissButtonStyle = .done
    guard let presenter = webView?.window?.rootViewController?.topMostPresenter() else {
        NSLog("XWebFeed: no presenter for Safari; falling back to openURL")
        UIApplication.shared.open(url)
        return
    }
    // Avoid stacking Safari sheets if the user double-taps.
    if presenter is SFSafariViewController {
        presenter.dismiss(animated: false) {
            webView?.window?.rootViewController?.topMostPresenter().present(safari, animated: true)
        }
        return
    }
    presenter.present(safari, animated: true)
}

private let xHomeURL = URL(string: "https://x.com/home")!

/// Home / Following timeline — native back should not return to login from here.
private func isFeedHome(_ url: URL?) -> Bool {
    guard let url else { return false }
    let host = (url.host ?? "").lowercased()
    guard host.contains("x.com") || host.contains("twitter.com") else { return false }
    let path = url.path
    return path.isEmpty || path == "/" || path == "/home" || path.hasPrefix("/home/")
}

/// Login / SSO pages we never want to re-enter via WebView back.
private func isAuthFlow(_ url: URL?) -> Bool {
    guard let s = url?.absoluteString.lowercased() else { return false }
    return s.contains("/i/flow/login")
        || s.contains("/i/flow/single_sign_on")
        || s.contains("/i/flow/signup")
        || s.contains("accounts.google.com")
        || s.contains("appleid.apple.com")
}

/// Google / Apple OAuth documents that should appear in the in-app popup sheet.
private func isOAuthPopupURL(_ url: URL) -> Bool {
    let host = (url.host ?? "").lowercased()
    if host.isEmpty { return false }
    if host == "accounts.google.com" || host.hasSuffix(".google.com") { return true }
    if host == "appleid.apple.com" || host.hasSuffix(".apple.com") { return true }
    if host == "accounts.youtube.com" { return true }
    if host.hasSuffix(".googleusercontent.com") || host.hasSuffix(".googleapis.com") {
        return true
    }
    return false
}

/// Hosts allowed inside the X WebView (feed + OAuth).
/// Note: `t.co` is intentionally excluded — short links open in the default browser.
private func isAllowedWebViewURL(_ url: URL) -> Bool {
    let s = url.absoluteString.lowercased()
    if s.hasPrefix("about:") || s.hasPrefix("blob:") {
        return true
    }
    let scheme = (url.scheme ?? "").lowercased()
    if scheme == "http" || scheme == "https" {
        guard let host = url.host?.lowercased(), !host.isEmpty else { return true }
        let allowedExact: Set<String> = [
            "x.com", "twitter.com", "api.x.com", "api.twitter.com",
            "mobile.twitter.com", "mobile.x.com",
            "accounts.google.com", "appleid.apple.com", "accounts.youtube.com",
        ]
        if allowedExact.contains(host) { return true }
        let allowedSuffixes = [
            ".x.com", ".twitter.com",
            ".google.com", ".googleusercontent.com", ".googleapis.com", ".gstatic.com",
            ".apple.com", ".cdn-apple.com",
        ]
        for suffix in allowedSuffixes {
            if host.hasSuffix(suffix) || host == String(suffix.dropFirst()) {
                return true
            }
        }
        return false
    }
    // Custom schemes (e.g. intent-like) — let the system handle outside the WebView.
    return false
}

/// x.com / twitter.com document URLs that should stay in the main WebView.
private func isXSiteURL(_ url: URL) -> Bool {
    let host = (url.host ?? "").lowercased()
    return host == "x.com" || host.hasSuffix(".x.com")
        || host == "twitter.com" || host.hasSuffix(".twitter.com")
}

/// Clears X cookies / site storage and opens the login flow.
enum XWebSession {
    /// Boot cover already hides the live SPA. Skip about:blank — it can race
    /// the cookie wipe. Auth `/i/flow/*` pages skip filter bootstrap.
    static func signOut(webView: WKWebView?) {
        webView?.stopLoading()
        let store = WKWebsiteDataStore.default()
        let types = WKWebsiteDataStore.allWebsiteDataTypes()
        store.removeData(ofTypes: types, modifiedSince: .distantPast) {
            DispatchQueue.main.async {
                webView?.load(URLRequest(url: URL(string: "https://x.com/i/flow/login")!))
            }
        }
    }
}

struct XWebFeedView: View {
    @Environment(AppChrome.self) private var chrome
    @Environment(FilterSettingsStore.self) private var filterStore
    @Environment(FontScaleStore.self) private var fontScale
    @Environment(FeedRefreshIntervalStore.self) private var feedRefresh
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.colorScheme) private var colorScheme

    @State private var webView: WKWebView?
    @State private var canGoBack = false
    @State private var pageURL: URL?
    @State private var progress: Double = 0
    @State private var showScrollTop = false
    @State private var lastScrollY: CGFloat = 0
    /// Covers the WebView until filter-core posts `mtBoot` (or timeout).
    @State private var showBootCover = true
    @State private var bootCoverTimeoutTask: Task<Void, Never>?
    /// Next home document load skips the spinner cover (warm refresh shows a snapshot).
    @State private var suppressNextHomeBootCover = false
    /// Frozen image of the old feed shown over the WebView during a warm reload,
    /// crossfaded away once the new document posts `mtBoot`.
    @State private var warmSnapshot: UIImage?
    @State private var lastFeedRefreshAt: Date?
    /// True after the app left the foreground at least once (skip initial `.active`).
    @State private var didLeaveActive = false
    /// Poll near-top refresh while the feed stays in the foreground.
    @State private var nearTopPollTask: Task<Void, Never>?
    /// Snapshot → load → timeout fallback for a warm reload.
    @State private var warmReloadTask: Task<Void, Never>?
    /// Last touch / scroll / key / pointer activity in the feed.
    @State private var lastInteractionAt = Date()
    /// Snapshot of feed-affecting settings when Settings opened (reload on return if changed).
    @State private var filterSettingsWhenInfoOpened: FilterSettings?
    /// True after Settings changed Following / ordering / feed filters until home reloads.
    @State private var pendingFeedSettingsReload = false

    private static let scrollTopThreshold: CGFloat = 400
    private static let nearTopThreshold: CGFloat = 80
    fileprivate static let warmCrossfadeSeconds: Double = 0.45
    /// Matches Android `RobinCream` / launcher mark field.
    private static let robinCream = Color(red: 0xF5 / 255, green: 0xF0 / 255, blue: 0xE8 / 255)
    /// Matches Android `RobinHeaderDark` / DarkColors.surface.
    private static let robinHeaderDark = Color(red: 0x15 / 255, green: 0x20 / 255, blue: 0x2B / 255)
    /// Matches Android `RobinRed` — breast orange-red, not Twitter blue.
    private static let robinRed = Color(red: 0xD9 / 255, green: 0x48 / 255, blue: 0x1C / 255)
    /// Matches Android `RobinRedLight` — readable on dark header chrome.
    private static let robinRedLight = Color(red: 0xFF / 255, green: 0x6B / 255, blue: 0x45 / 255)
    /// Slightly longer than filter-core's 5s hard reveal.
    private static let bootCoverTimeoutNs: UInt64 = 5_500_000_000

    /// Hide back on the Following feed so login stays out of the stack UI.
    private var showBackButton: Bool {
        canGoBack && !isFeedHome(pageURL)
    }

    private var headerAccent: Color {
        colorScheme == .dark ? Self.robinRedLight : Self.robinRed
    }

    /// Reports scrollY from nested X containers (window scroll often stays at 0).
    fileprivate static let scrollProbeJS = """
    (function(){
      if (window.__ROBIN_SCROLL_PROBE__) return;
      window.__ROBIN_SCROLL_PROBE__ = true;
      var last = -1;
      function report(y) {
        y = Math.max(0, Math.round(y || 0));
        if (y === last) return;
        last = y;
        try {
          if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.mtScroll) {
            window.webkit.messageHandlers.mtScroll.postMessage(y);
          }
          if (window.RobinScroll && window.RobinScroll.post) {
            window.RobinScroll.post(y);
          }
        } catch (e) {}
      }
      function fromEvent(e) {
        var t = e && e.target;
        if (!t || t === document || t === window) {
          var r = document.scrollingElement || document.documentElement;
          report(r ? r.scrollTop : 0);
          return;
        }
        if (typeof t.scrollTop === 'number') report(t.scrollTop);
      }
      window.addEventListener('scroll', fromEvent, true);
      document.addEventListener('scroll', fromEvent, true);

      var lastInteract = 0;
      function interact() {
        var now = Date.now();
        if (now - lastInteract < 1000) return;
        lastInteract = now;
        try {
          if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.mtInteract) {
            window.webkit.messageHandlers.mtInteract.postMessage(1);
          }
          if (window.RobinInteract && window.RobinInteract.post) {
            window.RobinInteract.post();
          }
        } catch (e) {}
      }
      ['pointerdown', 'touchstart', 'keydown', 'wheel', 'mousemove'].forEach(function (n) {
        window.addEventListener(n, interact, { capture: true, passive: true });
      });
    })();
    """

    var body: some View {
        VStack(spacing: 0) {
            feedHeader
            if progress > 0, progress < 1, !showBootCover, warmSnapshot == nil {
                ProgressView(value: progress)
                    .progressViewStyle(.linear)
            }
            ZStack {
                XWebViewRepresentable(
                    webView: $webView,
                    canGoBack: $canGoBack,
                    pageURL: $pageURL,
                    progress: $progress,
                    showBootCover: $showBootCover,
                    warmSnapshot: $warmSnapshot,
                    suppressNextHomeBootCover: $suppressNextHomeBootCover,
                    settings: filterStore.settings,
                    fontScale: fontScale.scale,
                    onScroll: handleScroll,
                    onInteract: noteUserInteraction
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)

                if let warmSnapshot {
                    Image(uiImage: warmSnapshot)
                        .resizable()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .transition(.opacity)
                        .accessibilityHidden(true)
                }

                if showBootCover {
                    Color(.systemBackground)
                        .overlay {
                            VStack(spacing: 12) {
                                ProgressView()
                                Text("Preparing feed…")
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .transition(.opacity)
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("Preparing feed")
                }
            }
            .animation(.easeInOut(duration: 0.2), value: showBootCover)
        }
        .animation(.easeInOut(duration: 0.15), value: showScrollTop)
        .sheet(isPresented: Binding(
            get: { chrome.infoPresented },
            set: { chrome.infoPresented = $0 }
        )) {
            InfoSheet(onSignOut: {
                Analytics.track("sign_out")
                cancelWarmReloadTask()
                warmSnapshot = nil
                showBootCover = true
                XWebSession.signOut(webView: webView)
            })
            .presentationBackground(.background)
        }
        .onChange(of: filterStore.settings) { _, newSettings in
            guard let webView else { return }
            XFilterInjector.applySettingsOnly(
                to: webView,
                settings: newSettings,
                fontScale: fontScale.scale
            )
        }
        .onChange(of: fontScale.scale) { _, newScale in
            guard let webView else { return }
            XFilterInjector.applySettingsOnly(
                to: webView,
                settings: filterStore.settings,
                fontScale: newScale
            )
        }
        .onChange(of: chrome.infoPresented) { _, presented in
            guard !presented else { return }
            let opened = filterSettingsWhenInfoOpened
            filterSettingsWhenInfoOpened = nil
            guard let opened else { return }
            if Self.feedReloadFingerprint(filterStore.settings)
                != Self.feedReloadFingerprint(opened)
            {
                pendingFeedSettingsReload = true
            }
            flushPendingFeedSettingsReloadIfNeeded()
        }
        .onChange(of: pageURL) { _, _ in
            flushPendingFeedSettingsReloadIfNeeded()
        }
        .onChange(of: showBootCover) { _, show in
            bootCoverTimeoutTask?.cancel()
            if !show {
                flushPendingFeedSettingsReloadIfNeeded()
            }
            guard show else { return }
            bootCoverTimeoutTask = Task { @MainActor in
                try? await Task.sleep(nanoseconds: Self.bootCoverTimeoutNs)
                guard !Task.isCancelled else { return }
                if showBootCover { showBootCover = false }
            }
        }
        .onAppear {
            if showBootCover {
                bootCoverTimeoutTask = Task { @MainActor in
                    try? await Task.sleep(nanoseconds: Self.bootCoverTimeoutNs)
                    guard !Task.isCancelled else { return }
                    if showBootCover { showBootCover = false }
                }
            }
            startNearTopPollIfNeeded()
        }
        .onDisappear {
            stopNearTopPoll()
            cancelWarmReloadTask()
            restoreFeedOpacityIfNeeded()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background {
                didLeaveActive = true
                stopNearTopPoll()
                cancelWarmReloadTask()
                restoreFeedOpacityIfNeeded()
            } else if phase == .inactive {
                didLeaveActive = true
                // Phones: stop while inactive. Mac: keep polling — the window often
                // stays visible without being key, and that used to kill self-refresh.
                if !ProcessInfo.processInfo.isiOSAppOnMac {
                    stopNearTopPoll()
                    cancelWarmReloadTask()
                    restoreFeedOpacityIfNeeded()
                }
            } else if phase == .active {
                if didLeaveActive {
                    didLeaveActive = false
                    requestNearTopAutoRefresh()
                }
                startNearTopPollIfNeeded()
            }
        }
    }

    private var feedHeader: some View {
        HStack(spacing: 8) {
            if showBackButton {
                Button {
                    webView?.goBack()
                } label: {
                    Image(systemName: "chevron.backward")
                        .foregroundStyle(headerAccent)
                }
                .accessibilityLabel("Back")
            }
            HStack(spacing: 8) {
                Image("RobinMark")
                    .resizable()
                    .scaledToFill()
                    .frame(width: 24, height: 24)
                    .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
                Text("Robin")
                    .font(.headline)
                    .foregroundStyle(headerAccent)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
            .onTapGesture(perform: onTitleTap)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Robin")
            .accessibilityAddTraits(.isButton)
            .accessibilityHint(
                lastScrollY <= Self.nearTopThreshold
                    ? "Refresh feed"
                    : "Back to top"
            )
            if showScrollTop {
                Button(action: scrollToTop) {
                    Image(systemName: "arrow.up")
                        .foregroundStyle(.primary)
                }
                .accessibilityLabel("Back to top")
                .transition(.opacity.combined(with: .scale(scale: 0.9)))
            }
            Button {
                hardReloadFeed(warm: !showBootCover)
            } label: {
                Image(systemName: "arrow.clockwise")
                    .foregroundStyle(.primary)
            }
            .accessibilityLabel("Refresh")
            Button {
                Analytics.track("settings_opened")
                filterSettingsWhenInfoOpened = filterStore.settings
                chrome.infoPresented = true
            } label: {
                Image(systemName: "gearshape")
                    .foregroundStyle(.primary)
            }
            .accessibilityLabel("Settings")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(colorScheme == .dark ? Self.robinHeaderDark : Self.robinCream)
    }

    private func handleScroll(y: CGFloat) {
        lastScrollY = y
        showScrollTop = y >= Self.scrollTopThreshold
        noteUserInteraction()
    }

    private func noteUserInteraction() {
        lastInteractionAt = Date()
    }

    private func onTitleTap() {
        if lastScrollY <= Self.nearTopThreshold {
            requestNearTopAutoRefresh(userInitiated: true)
        } else {
            scrollToTop()
        }
    }

    /// Automatic refreshes wait until the user has left the feed alone.
    private func userIsIdle() -> Bool {
        guard !chrome.infoPresented else { return false }
        return Date().timeIntervalSince(lastInteractionAt) >= FeedRefreshInterval.idleSeconds
    }

    private func canRefreshFeedNow() -> Bool {
        guard !showBootCover else { return false }
        guard warmSnapshot == nil else { return false }
        guard isFeedHome(pageURL) else { return false }
        guard lastScrollY <= Self.nearTopThreshold else { return false }
        guard progress == 0 || progress >= 1 else { return false }
        if feedRefresh.isEnabled,
           let last = lastFeedRefreshAt,
           Date().timeIntervalSince(last) < TimeInterval(feedRefresh.seconds)
        {
            return false
        }
        return webView != nil
    }

    private func requestNearTopAutoRefresh(userInitiated: Bool = false) {
        if !userInitiated && !feedRefresh.isEnabled { return }
        guard canRefreshFeedNow() else { return }
        guard userInitiated || userIsIdle() else { return }
        // Pill auto-click already handles “Show N posts” when X paints it.
        // Host-driven refresh must force a network fetch — SPA reload() often
        // serves a cached document and leaves the same stale Following posts.
        hardReloadFeed(warm: true)
    }

    private func startNearTopPollIfNeeded() {
        // Phone/iPad: only while `.active`. Mac: also while `.inactive` so a
        // visible but non-key window still self-refreshes without user input.
        if ProcessInfo.processInfo.isiOSAppOnMac {
            guard scenePhase != .background else { return }
        } else {
            guard scenePhase == .active else { return }
        }
        guard nearTopPollTask == nil else { return }
        nearTopPollTask = Task { @MainActor in
            while !Task.isCancelled {
                let tickNs = UInt64(FeedRefreshInterval.pollTickSeconds * 1_000_000_000)
                try? await Task.sleep(nanoseconds: tickNs)
                guard !Task.isCancelled else { return }
                requestNearTopAutoRefresh()
            }
        }
    }

    private func stopNearTopPoll() {
        nearTopPollTask?.cancel()
        nearTopPollTask = nil
    }

    private func cancelWarmReloadTask() {
        warmReloadTask?.cancel()
        warmReloadTask = nil
    }

    /// If a warm reload was interrupted before mtBoot, drop the frozen snapshot.
    private func restoreFeedOpacityIfNeeded() {
        warmSnapshot = nil
        suppressNextHomeBootCover = false
    }

    private func hardReloadFeed(warm: Bool, markRefresh: Bool = true) {
        guard let webView else { return }
        if markRefresh { lastFeedRefreshAt = Date() }
        cancelWarmReloadTask()

        let request = URLRequest(
            url: xHomeURL,
            cachePolicy: .reloadIgnoringLocalCacheData,
            timeoutInterval: 60
        )

        if warm {
            // Freeze the old feed over the WebView, load underneath, and let
            // mtBoot crossfade the snapshot away — the blank document and
            // boot-gated body are never visible.
            suppressNextHomeBootCover = true
            warmReloadTask = Task { @MainActor in
                let image = try? await webView.takeSnapshot(configuration: nil)
                guard !Task.isCancelled else { return }
                warmSnapshot = image
                webView.load(request)
                try? await Task.sleep(nanoseconds: Self.bootCoverTimeoutNs)
                guard !Task.isCancelled, warmSnapshot != nil else { return }
                suppressNextHomeBootCover = false
                withAnimation(.easeOut(duration: Self.warmCrossfadeSeconds)) {
                    warmSnapshot = nil
                }
            }
        } else {
            warmSnapshot = nil
            webView.load(request)
        }
    }

    /// Feed type / ordering / content filters that need a home reload to fully apply.
    private static func feedReloadFingerprint(_ s: FilterSettings) -> (
        Bool, Bool, Bool, Bool
    ) {
        (s.forceFollowing, s.preferLatest, s.hideLiveContent, s.hideComposeButton)
    }

    private func flushPendingFeedSettingsReloadIfNeeded() {
        guard pendingFeedSettingsReload else { return }
        guard !chrome.infoPresented else { return }
        guard isFeedHome(pageURL) else { return }
        guard !showBootCover else { return }
        guard warmSnapshot == nil else { return }
        pendingFeedSettingsReload = false
        hardReloadFeed(warm: true, markRefresh: false)
    }

    private func scrollToTop() {
        guard let webView else { return }
        webView.scrollView.setContentOffset(.zero, animated: true)
        webView.evaluateJavaScript(
            """
            (function(){
              var r = document.scrollingElement || document.documentElement;
              if (r && r.scrollTo) r.scrollTo({ top: 0, behavior: 'smooth' });
              else { document.documentElement.scrollTop = 0; document.body.scrollTop = 0; }
              var nodes = document.querySelectorAll('div');
              for (var i = 0; i < Math.min(nodes.length, 80); i++) {
                var el = nodes[i];
                if (el.scrollTop > 0) el.scrollTop = 0;
              }
            })();
            """,
            completionHandler: nil
        )
        lastScrollY = 0
        showScrollTop = false
    }
}

// MARK: - WKWebView bridge

private struct XWebViewRepresentable: UIViewRepresentable {
    /// iPhone Mobile Safari — keeps X on the mobile DOM (TopNavBar) even on Mac.
    static let mobileSafariUserAgent =
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 "
        + "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"

    @Binding var webView: WKWebView?
    @Binding var canGoBack: Bool
    @Binding var pageURL: URL?
    @Binding var progress: Double
    @Binding var showBootCover: Bool
    @Binding var warmSnapshot: UIImage?
    @Binding var suppressNextHomeBootCover: Bool
    var settings: FilterSettings
    var fontScale: Double
    var onScroll: (CGFloat) -> Void
    var onInteract: () -> Void

    func makeCoordinator() -> XWebViewCoordinator {
        XWebViewCoordinator(
            canGoBack: $canGoBack,
            pageURL: $pageURL,
            progress: $progress,
            showBootCover: $showBootCover,
            warmSnapshot: $warmSnapshot,
            suppressNextHomeBootCover: $suppressNextHomeBootCover,
            settings: settings,
            fontScale: fontScale,
            onScroll: onScroll,
            onInteract: onInteract
        )
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        // Prefer mobile X layout on iPhone, iPad, and Mac (Designed for iPhone/iPad).
        config.defaultWebpagePreferences.preferredContentMode = .mobile
        config.allowsInlineMediaPlayback = true

        let userScript = XFilterInjector.makeUserScript(
            settings: settings,
            fontScale: fontScale
        )
        config.userContentController.addUserScript(userScript)
        config.userContentController.add(
            context.coordinator,
            name: "mtScroll"
        )
        config.userContentController.add(
            context.coordinator,
            name: "mtBoot"
        )
        config.userContentController.add(
            context.coordinator,
            name: "mtInteract"
        )
        config.userContentController.addUserScript(
            WKUserScript(
                source: XWebFeedView.scrollProbeJS,
                injectionTime: .atDocumentEnd,
                forMainFrameOnly: false
            )
        )

        let wv = WKWebView(frame: .zero, configuration: config)
        wv.navigationDelegate = context.coordinator
        wv.uiDelegate = context.coordinator
        wv.allowsBackForwardNavigationGestures = true
        wv.scrollView.contentInsetAdjustmentBehavior = .automatic
        // Force mobile Safari UA so X serves TopNavBar layout (not desktop chrome).
        wv.customUserAgent = Self.mobileSafariUserAgent
        if #available(iOS 16.4, *) {
            wv.isInspectable = true
        }

        context.coordinator.observe(wv)
        context.coordinator.liveSettings = settings
        context.coordinator.liveFontScale = fontScale
        context.coordinator.onScroll = onScroll
        context.coordinator.onInteract = onInteract

        DispatchQueue.main.async {
            webView = wv
        }
        wv.load(URLRequest(url: xHomeURL))
        return wv
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        context.coordinator.liveSettings = settings
        context.coordinator.liveFontScale = fontScale
        context.coordinator.onScroll = onScroll
        context.coordinator.onInteract = onInteract
        // Settings / font scale are applied via onChange in XWebFeedView — avoid
        // re-toggling zoom/classes on every SwiftUI pass (causes paint churn).
    }

    static func dismantleUIView(_ uiView: WKWebView, coordinator: XWebViewCoordinator) {
        let ucc = uiView.configuration.userContentController
        ucc.removeScriptMessageHandler(forName: "mtScroll")
        ucc.removeScriptMessageHandler(forName: "mtBoot")
        ucc.removeScriptMessageHandler(forName: "mtInteract")
    }
}

@MainActor
final class XWebViewCoordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    @Binding var canGoBack: Bool
    @Binding var pageURL: URL?
    @Binding var progress: Double
    @Binding var showBootCover: Bool
    @Binding var warmSnapshot: UIImage?
    @Binding var suppressNextHomeBootCover: Bool
    var liveSettings: FilterSettings
    var liveFontScale: Double
    var onScroll: (CGFloat) -> Void
    var onInteract: () -> Void

    private var progressObservation: NSKeyValueObservation?
    private var backObservation: NSKeyValueObservation?
    private var urlObservation: NSKeyValueObservation?

    /// Destination of the in-flight main-frame load (decidePolicy → provisional).
    /// `webView.url` can still be the prior page when provisional starts.
    private var pendingMainFrameURL: URL?

    /// In-app Google/Apple SSO window (`window.open`) — must keep `window.opener`.
    private weak var authPopupWebView: WKWebView?
    private weak var authPopupPresenter: UIViewController?
    /// Main webview waiting for an about:blank popup to navigate to http(s).
    private weak var pendingAuthPopupSource: WKWebView?

    init(
        canGoBack: Binding<Bool>,
        pageURL: Binding<URL?>,
        progress: Binding<Double>,
        showBootCover: Binding<Bool>,
        warmSnapshot: Binding<UIImage?>,
        suppressNextHomeBootCover: Binding<Bool>,
        settings: FilterSettings,
        fontScale: Double,
        onScroll: @escaping (CGFloat) -> Void,
        onInteract: @escaping () -> Void
    ) {
        _canGoBack = canGoBack
        _pageURL = pageURL
        _progress = progress
        _showBootCover = showBootCover
        _warmSnapshot = warmSnapshot
        _suppressNextHomeBootCover = suppressNextHomeBootCover
        liveSettings = settings
        liveFontScale = fontScale
        self.onScroll = onScroll
        self.onInteract = onInteract
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        if (message.name == "mtBoot") {
            showBootCover = false
            suppressNextHomeBootCover = false
            if warmSnapshot != nil {
                withAnimation(.easeOut(duration: XWebFeedView.warmCrossfadeSeconds)) {
                    warmSnapshot = nil
                }
            }
            return
        }
        if message.name == "mtInteract" {
            onInteract()
            return
        }
        guard message.name == "mtScroll" else { return }
        let y: CGFloat
        if let n = message.body as? NSNumber {
            y = CGFloat(truncating: n)
        } else if let d = message.body as? Double {
            y = CGFloat(d)
        } else if let i = message.body as? Int {
            y = CGFloat(i)
        } else {
            return
        }
        onScroll(y)
    }

    func observe(_ webView: WKWebView) {
        progressObservation = webView.observe(\.estimatedProgress, options: [.new]) { [weak self] wv, _ in
            Task { @MainActor in
                self?.progress = wv.estimatedProgress
            }
        }
        backObservation = webView.observe(\.canGoBack, options: [.new]) { [weak self] wv, _ in
            Task { @MainActor in
                self?.syncNavigationState(wv)
            }
        }
        urlObservation = webView.observe(\.url, options: [.new]) { [weak self] wv, _ in
            Task { @MainActor in
                self?.syncNavigationState(wv)
            }
        }
        // Nested X scroll is reported via mtScroll JS probe — WKWebView
        // contentOffset often stays at 0 and would falsely re-show the header.
    }

    private func syncNavigationState(_ webView: WKWebView) {
        // Ignore popup navigations for the main chrome bindings.
        if webView === authPopupWebView { return }
        pageURL = webView.url
        // On the Following feed, treat history as empty for the native back control
        // (login may still sit in WKBackForwardList).
        canGoBack = webView.canGoBack && !isFeedHome(webView.url)
        webView.allowsBackForwardNavigationGestures = !isFeedHome(webView.url)
    }

    /// Log feed layout once after load so Mac blank screens are diagnosable in Console.
    private func scheduleLayoutDiagnostics(on webView: WKWebView) {
        guard ProcessInfo.processInfo.isiOSAppOnMac else { return }
        let delays: [Double] = [1.0, 3.0, 6.0]
        for delay in delays {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak webView] in
                guard let webView else { return }
                webView.evaluateJavaScript(
                    """
                    (function(){
                      var col = document.querySelector('[data-testid="primaryColumn"]');
                      var r = col && col.getBoundingClientRect();
                      return {
                        boot: document.documentElement.getAttribute('data-mt-boot-ready'),
                        iw: window.innerWidth,
                        vh: window.innerHeight,
                        articles: document.querySelectorAll('article[data-testid="tweet"]').length,
                        primary: !!col,
                        primaryW: r ? Math.round(r.width) : 0,
                        primaryH: r ? Math.round(r.height) : 0,
                        sidebar: !!document.querySelector('[data-testid="sidebarColumn"]'),
                        topNav: !!document.querySelector('[data-testid="TopNavBar"]'),
                        scrollSnap: !!document.querySelector("[data-testid='ScrollSnap-List']"),
                        bodyVis: document.body ? getComputedStyle(document.body).visibility : null,
                        forceFollowing: !!(window.__ROBIN_SETTINGS__||{}).forceFollowing,
                        home: document.documentElement.getAttribute('data-mt-home')
                      };
                    })()
                    """
                ) { result, error in
                    if let error {
                        NSLog("XWebFeed layoutDiag error: \(error.localizedDescription)")
                    } else {
                        NSLog("XWebFeed layoutDiag: \(String(describing: result))")
                    }
                }
            }
        }
    }

    func webView(
        _ webView: WKWebView,
        didStartProvisionalNavigation navigation: WKNavigation!
    ) {
        guard webView !== authPopupWebView else { return }
        // Full document loads to home re-run bootstrap; cover until mtBoot.
        // Prefer pendingMainFrameURL — webView.url is often still the prior page
        // when going back from a status URL to /home.
        if isFeedHome(pendingMainFrameURL) || isFeedHome(webView.url) {
            if suppressNextHomeBootCover {
                // Warm reload: keep suppress until mtBoot. X may fire more than
                // one provisional home navigation (redirects); clearing early
                // would re-show the spinner over the snapshot.
            } else {
                showBootCover = true
                warmSnapshot = nil
            }
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        syncNavigationState(webView)
        if webView !== authPopupWebView {
            progress = 1
            webView.evaluateJavaScript(XWebFeedView.scrollProbeJS, completionHandler: nil)
            scheduleLayoutDiagnostics(on: webView)
        }
        // Delayed SSO popup: about:blank → accounts.google.com — show sheet now.
        if webView === authPopupWebView,
           authPopupPresenter == nil,
           let url = webView.url,
           isOAuthPopupURL(url),
           let source = pendingAuthPopupSource
        {
            pendingAuthPopupSource = nil
            presentAuthPopup(webView, from: source)
        }
        // Only re-apply filter settings on X hosts (not mid-OAuth).
        if let host = webView.url?.host?.lowercased(),
           host == "x.com" || host.hasSuffix(".x.com")
            || host == "twitter.com" || host.hasSuffix(".twitter.com")
        {
            if webView === authPopupWebView {
                // SSO finished and landed back on X — close the popup so cookies
                // apply to the opener via the shared data store.
                dismissAuthPopup()
                return
            }
            XFilterInjector.applySettingsOnly(
                to: webView,
                settings: liveSettings,
                fontScale: liveFontScale
            )
        }
    }

    func webView(
        _ webView: WKWebView,
        didFail navigation: WKNavigation!,
        withError error: Error
    ) {
        print("XWebFeed didFail: \(error.localizedDescription)")
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        print("XWebFeed didFailProvisional: \(error.localizedDescription)")
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        preferences: WKWebpagePreferences,
        decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow, preferences)
            return
        }
        // Block swipe/back into the login / SSO stack after a successful session.
        if webView !== authPopupWebView,
           navigationAction.navigationType == .backForward,
           isAuthFlow(url)
        {
            decisionHandler(.cancel, preferences)
            return
        }

        let scheme = (url.scheme ?? "").lowercased()
        let host = url.host?.lowercased() ?? ""
        let isX = host == "x.com" || host.hasSuffix(".x.com")
            || host == "twitter.com" || host.hasSuffix(".twitter.com")
        preferences.preferredContentMode = isX ? .mobile : .recommended

        // X mobile shell uses x-safari-https://… to bounce into Safari. Rewrite in-place
        // for allowlisted hosts; hand off other destinations to SFSafariViewController.
        if scheme == "x-safari-https" || scheme == "x-safari-http" {
            if let rewritten = url.rewrittenSafariSchemeURL() {
                if !isAllowedWebViewURL(rewritten) {
                    NSLog("XWebFeed safari-scheme → Safari sheet: %@", rewritten.absoluteString)
                    openInAppBrowser(rewritten, from: webView)
                    decisionHandler(.cancel, preferences)
                    return
                }
                NSLog("XWebFeed rewrite %@ → %@", url.absoluteString, rewritten.absoluteString)
                decisionHandler(.cancel, preferences)
                webView.load(URLRequest(url: rewritten))
                return
            }
        }

        // New-window requests (targetFrame == nil) are handled in createWebViewWith.
        let isMainFrame = navigationAction.targetFrame?.isMainFrame == true

        // Article / web links leave the X shell → in-app Safari sheet. Keep x.com / OAuth in-app.
        if isMainFrame, scheme == "http" || scheme == "https", !isAllowedWebViewURL(url) {
            NSLog("XWebFeed open external: %@", url.absoluteString)
            openInAppBrowser(url, from: webView)
            if webView === authPopupWebView {
                dismissAuthPopup()
            }
            decisionHandler(.cancel, preferences)
            return
        }

        // Stay inside the WebView for allowlisted http(s) / about / blob.
        // Cancel twitter:// / x:// / itms-apps:// nags.
        if scheme == "http" || scheme == "https" || scheme == "about" || scheme == "blob" {
            if webView !== authPopupWebView, isMainFrame {
                pendingMainFrameURL = url
            }
            decisionHandler(.allow, preferences)
            return
        }
        NSLog("XWebFeed blocked external scheme: %@", url.absoluteString)
        decisionHandler(.cancel, preferences)
    }

    // MARK: - WKUIDelegate (Google/Apple SSO needs a real window.open target)

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        guard navigationAction.targetFrame == nil else { return nil }

        let requestURL = navigationAction.request.url
        NSLog(
            "XWebFeed createWebView url=%@ userGesture=%@",
            requestURL?.absoluteString ?? "nil",
            navigationAction.navigationType == .linkActivated ? "link" : "other"
        )

        // Ignore "open in X app" / App Store window.open nags (they used to bounce to Safari).
        if let url = requestURL {
            let scheme = (url.scheme ?? "").lowercased()
            if scheme == "x-safari-https" || scheme == "x-safari-http" {
                if let rewritten = url.rewrittenSafariSchemeURL() {
                    if !isAllowedWebViewURL(rewritten) {
                        openInAppBrowser(rewritten, from: webView)
                    } else {
                        webView.load(URLRequest(url: rewritten))
                    }
                }
                return nil
            }
            if scheme != "http", scheme != "https", scheme != "about", scheme != "blob", !scheme.isEmpty {
                NSLog("XWebFeed ignored popup scheme: %@", url.absoluteString)
                return nil
            }
            // window.open from link taps: X uses https://t.co/… (not about:blank).
            // Only Google/Apple OAuth needs a real child WebView; everything else → Safari sheet.
            if scheme == "http" || scheme == "https" {
                if isOAuthPopupURL(url) {
                    // Fall through to auth popup below.
                } else if isXSiteURL(url) {
                    NSLog("XWebFeed popup → main webview: %@", url.absoluteString)
                    webView.load(URLRequest(url: url))
                    return nil
                } else {
                    // t.co + articles / external sites → SFSafariViewController.
                    NSLog("XWebFeed popup → Safari sheet: %@", url.absoluteString)
                    openInAppBrowser(url, from: webView)
                    return nil
                }
            }
        }

        let popup = makeAuthPopupWebView(configuration: configuration)
        authPopupWebView = popup
        // about:blank first is common; show the sheet only once we hit Google/Apple (or
        // an immediate https OAuth URL). Avoid presenting for tracker popups on launch.
        if let url = requestURL, isOAuthPopupURL(url) {
            presentAuthPopup(popup, from: webView)
        } else {
            pendingAuthPopupSource = webView
        }
        return popup
    }

    func webViewDidClose(_ webView: WKWebView) {
        if webView === authPopupWebView {
            dismissAuthPopup()
        }
    }

    private func makeAuthPopupWebView(configuration: WKWebViewConfiguration) -> WKWebView {
        // Use WebKit's configuration so the popup shares process / cookies / window.opener.
        // Do not inject filter scripts into the OAuth window.
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.defaultWebpagePreferences.preferredContentMode = .recommended

        let popup = WKWebView(frame: .zero, configuration: configuration)
        popup.navigationDelegate = self
        popup.uiDelegate = self
        popup.allowsBackForwardNavigationGestures = true
        // Stock UA — Google often rejects embedded / spoofed mobile UAs.
        popup.customUserAgent = nil
        return popup
    }

    private func presentAuthPopup(_ popup: WKWebView, from source: WKWebView) {
        if authPopupPresenter != nil, authPopupWebView === popup { return }
        dismissAuthPopupKeeping(popup)
        authPopupWebView = popup

        let host = AuthPopupViewController(webView: popup) { [weak self] in
            self?.dismissAuthPopup()
        }
        host.modalPresentationStyle = .pageSheet
        if let sheet = host.sheetPresentationController {
            sheet.detents = [.large()]
            sheet.prefersGrabberVisible = true
        }
        authPopupPresenter = host

        guard let presenter = source.window?.rootViewController?.topMostPresenter() else {
            NSLog("XWebFeed: no presenter for auth popup")
            return
        }
        presenter.present(host, animated: true)
    }

    private func dismissAuthPopupKeeping(_ keep: WKWebView?) {
        let popup = authPopupWebView
        let presenter = authPopupPresenter
        authPopupPresenter = nil
        pendingAuthPopupSource = nil
        if popup !== keep {
            authPopupWebView = nil
            popup?.navigationDelegate = nil
            popup?.uiDelegate = nil
            popup?.stopLoading()
        }
        presenter?.dismiss(animated: true)
    }

    private func dismissAuthPopup() {
        dismissAuthPopupKeeping(nil)
    }
}

/// Modal host for Google/Apple `window.open` OAuth.
private final class AuthPopupViewController: UIViewController {
    private let webView: WKWebView
    private let onClose: () -> Void

    init(webView: WKWebView, onClose: @escaping () -> Void) {
        self.webView = webView
        self.onClose = onClose
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)

        let close = UIButton(type: .system)
        close.translatesAutoresizingMaskIntoConstraints = false
        close.setTitle("Close", for: .normal)
        close.titleLabel?.font = .systemFont(ofSize: 14, weight: .semibold)
        close.configuration = {
            var config = UIButton.Configuration.filled()
            config.contentInsets = NSDirectionalEdgeInsets(top: 5, leading: 12, bottom: 5, trailing: 12)
            config.cornerStyle = .capsule
            config.baseForegroundColor = .white
            config.baseBackgroundColor = .systemBlue
            config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
                var outgoing = incoming
                outgoing.font = .systemFont(ofSize: 14, weight: .semibold)
                return outgoing
            }
            return config
        }()
        close.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)

        let header = UIView()
        header.translatesAutoresizingMaskIntoConstraints = false
        header.addSubview(close)
        view.addSubview(header)

        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            header.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            header.trailingAnchor.constraint(equalTo: view.trailingAnchor),

            close.topAnchor.constraint(equalTo: header.topAnchor, constant: 10),
            close.trailingAnchor.constraint(equalTo: header.trailingAnchor, constant: -12),
            close.bottomAnchor.constraint(equalTo: header.bottomAnchor, constant: -6),
            close.heightAnchor.constraint(equalToConstant: 28),

            webView.topAnchor.constraint(equalTo: header.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
    }

    @objc private func closeTapped() {
        onClose()
    }
}

private extension UIViewController {
    func topMostPresenter() -> UIViewController {
        if let presented = presentedViewController {
            return presented.topMostPresenter()
        }
        if let nav = self as? UINavigationController, let visible = nav.visibleViewController {
            return visible.topMostPresenter()
        }
        if let tab = self as? UITabBarController, let selected = tab.selectedViewController {
            return selected.topMostPresenter()
        }
        return self
    }
}

private extension URL {
    /// `x-safari-https://host/path` → `https://host/path` (keeps query/fragment).
    func rewrittenSafariSchemeURL() -> URL? {
        let scheme = (self.scheme ?? "").lowercased()
        guard scheme == "x-safari-https" || scheme == "x-safari-http" else { return nil }
        var comps = URLComponents(url: self, resolvingAgainstBaseURL: false)
        comps?.scheme = scheme == "x-safari-https" ? "https" : "http"
        return comps?.url
    }
}
