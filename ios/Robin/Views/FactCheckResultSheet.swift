import SwiftUI
import SafariServices
import WebKit

struct FactCheckRequest: Identifiable, Sendable {
    var id: String { tweetURL?.absoluteString ?? String(text.prefix(60)) }
    var text: String
    var author: String?
    var tweetURL: URL?
    var externalLinks: [URL]
}

struct FactCheckSheet: View {
    let request: FactCheckRequest
    @Environment(\.dismiss) private var dismiss

    @State private var isLoading = true
    @State private var result: FactCheckResult?
    @State private var errorMessage: String?
    @State private var safariURL: URL?

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    loadingView
                } else if let errorMessage {
                    errorView(message: errorMessage)
                } else if let result {
                    resultContent(result: result)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbarBackground(Color(.systemBackground), for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 2) {
                        Text("Fact Check")
                            .font(.headline)
                        if let author = request.author, !author.isEmpty {
                            Text(author)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .background(Color(.systemBackground))
        }
        .presentationDetents([.medium, .large])
        .modifier(OpaqueSheetBackground())
        .task {
            await performFactCheck()
        }
        .sheet(item: $safariURL) { url in
            SafariView(url: url)
        }
    }

    private var loadingView: some View {
        VStack(spacing: 20) {
            Spacer()
            ProgressView()
                .scaleEffect(1.3)
            VStack(spacing: 8) {
                Text("Analyzing claims with Gemini 3.8 Flash…")
                    .font(.headline)
                Text("Grounding with Google Search")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }

    private func errorView(message: String) -> some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 44))
                .foregroundStyle(.orange)
            Text("Fact Check Unavailable")
                .font(.headline)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
            Button("Try Again") {
                Task { await performFactCheck() }
            }
            .buttonStyle(.borderedProminent)
            .padding(.top, 8)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }

    private func resultContent(result: FactCheckResult) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text("\(result.score)")
                        .font(.system(size: 56, weight: .bold, design: .rounded))
                        .foregroundStyle(scoreColor(result.score))
                    VStack(alignment: .leading, spacing: 4) {
                        Text("/ 10")
                            .font(.title3)
                            .foregroundStyle(.secondary)
                        Text(result.verdict)
                            .font(.headline)
                    }
                    Spacer(minLength: 0)
                }

                if !result.justification.isEmpty {
                    FactCheckSection(title: "Summary") {
                        VStack(alignment: .leading, spacing: 14) {
                            ForEach(Array(result.justification.enumerated()), id: \.offset) { index, point in
                                HStack(alignment: .top, spacing: 10) {
                                    Text("\(index + 1).")
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle(.secondary)
                                        .frame(minWidth: 20, alignment: .trailing)
                                    Text(point)
                                        .font(.subheadline)
                                        .textSelection(.enabled)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                }
                            }
                        }
                    }
                }

                if !result.findings.isEmpty {
                    FactCheckSection(title: "Claims check") {
                        VStack(alignment: .leading, spacing: 10) {
                            ForEach(result.findings) { finding in
                                FindingRow(finding: finding)
                            }
                        }
                    }
                }

                if !result.sources.isEmpty {
                    FactCheckSection(title: "Sources") {
                        VStack(alignment: .leading, spacing: 12) {
                            ForEach(result.sources) { source in
                                if let url = URL(string: source.url) {
                                    Button {
                                        safariURL = url
                                    } label: {
                                        SourceRow(title: source.title, subtitle: source.url)
                                    }
                                    .buttonStyle(.plain)
                                } else {
                                    SourceRow(title: source.title, subtitle: nil)
                                }
                            }
                        }
                    }
                }

                if let rating = result.sourceRating {
                    FactCheckSection(title: "Linked Source Rating") {
                        SourceRatingContent(rating: rating)
                    }
                }

                if let html = result.searchSuggestionsHTML, !html.isEmpty {
                    FactCheckSection(title: "Google Search suggestions") {
                        SearchSuggestionsWebView(html: html)
                            .frame(minHeight: 72)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                }
            }
            .padding()
        }
    }

    private func performFactCheck() async {
        isLoading = true
        errorMessage = nil
        do {
            let outcome = try await GenerativeAIService.factCheckTweet(
                text: request.text,
                author: request.author,
                tweetURL: request.tweetURL,
                externalLinks: request.externalLinks
            )
            self.result = outcome.result
            self.isLoading = false
        } catch {
            self.errorMessage = error.localizedDescription
            self.isLoading = false
        }
    }

    private func scoreColor(_ score: Int) -> Color {
        switch score {
        case 1...3: return .red
        case 4...6: return .orange
        default: return .green
        }
    }
}

private struct FactCheckSection<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.headline)
            content
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 10))
        }
    }
}

private struct FindingRow: View {
    let finding: FactCheckFinding

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(finding.status.displayLabel)
                .font(.caption.weight(.semibold))
                .foregroundStyle(chipForeground)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(chipBackground, in: Capsule())
            Text(finding.claim)
                .font(.subheadline.weight(.semibold))
                .textSelection(.enabled)
            if !finding.note.isEmpty {
                Text(finding.note)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Color(.tertiarySystemBackground), in: RoundedRectangle(cornerRadius: 8))
    }

    private var chipForeground: Color {
        switch finding.status {
        case .verified: return Color(red: 0.02, green: 0.35, blue: 0.14)
        case .partiallyVerified: return Color(red: 0.45, green: 0.27, blue: 0.0)
        case .unverified: return Color(red: 0.25, green: 0.25, blue: 0.28)
        case .falseMisleading: return Color(red: 0.45, green: 0.0, blue: 0.0)
        }
    }

    private var chipBackground: Color {
        switch finding.status {
        case .verified: return Color(red: 0.72, green: 0.95, blue: 0.79)
        case .partiallyVerified: return Color(red: 1.0, green: 0.88, blue: 0.51)
        case .unverified: return Color(red: 0.88, green: 0.88, blue: 0.90)
        case .falseMisleading: return Color(red: 1.0, green: 0.80, blue: 0.82)
        }
    }
}

private struct SourceRow: View {
    let title: String
    let subtitle: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .multilineTextAlignment(.leading)
                    .foregroundStyle(.primary)
                Spacer()
                Image(systemName: "arrow.up.right.square")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if let subtitle, !subtitle.isEmpty {
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }
}

private struct SourceRatingContent: View {
    let rating: SourceCredibilityRating

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(rating.sourceName)
                .font(.subheadline.weight(.semibold))
            ratingRow("Factual reporting", rating.factualReporting)
            if let bias = rating.displayBias {
                ratingRow("Bias", bias)
            }
            ratingRow("Credibility", rating.credibility)
            if let url = URL(string: rating.mbfcURL), !rating.mbfcURL.isEmpty {
                Link("Media Bias/Fact Check", destination: url)
                    .font(.caption.weight(.semibold))
            }
        }
    }

    @ViewBuilder
    private func ratingRow(_ label: String, _ value: String) -> some View {
        if !value.isEmpty {
            HStack(alignment: .firstTextBaseline) {
                Text(label)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 8)
                Text(value)
                    .font(.caption.weight(.medium))
                    .multilineTextAlignment(.trailing)
            }
        }
    }
}

private struct OpaqueSheetBackground: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 16.4, *) {
            content.presentationBackground(Color(.systemBackground))
        } else {
            content.background(Color(.systemBackground))
        }
    }
}

private struct SearchSuggestionsWebView: UIViewRepresentable {
    let html: String

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            if let url = navigationAction.request.url,
               navigationAction.navigationType == .linkActivated {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }
    }

    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView(frame: .zero)
        webView.navigationDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        webView.loadHTMLString(html, baseURL: URL(string: "https://www.google.com"))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        uiView.loadHTMLString(html, baseURL: URL(string: "https://www.google.com"))
    }
}

private struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        SFSafariViewController(url: url)
    }

    func updateUIViewController(_ uiViewController: SFSafariViewController, context: Context) {}
}

extension URL: @retroactive Identifiable {
    public var id: String { absoluteString }
}
