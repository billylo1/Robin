import SwiftUI

/// Settings for the WebView filter path.
/// Text size scales the X feed only, not this sheet.
struct InfoSheet: View {
    @Environment(FontScaleStore.self) private var fontScale
    @Environment(FeedRefreshIntervalStore.self) private var feedRefresh
    @Environment(FilterSettingsStore.self) private var filterStore
    @Environment(AppChrome.self) private var chrome
    @Environment(\.dismiss) private var dismiss

    var onSignOut: () -> Void = {}

    @State private var keywordDraft = ""

    private static let minimalTwitterURL = URL(
        string: "https://github.com/typefully/minimal-twitter"
    )!
    private static let robinRepoURL = URL(
        string: "https://github.com/billylo1/Robin"
    )!

    var body: some View {
        NavigationStack {
            List {
                Section("User Interface") {
                    HStack {
                        Text("Text size")
                            .font(.body)
                        Spacer()
                        HStack(spacing: 8) {
                            adjustButton(
                                "A−",
                                enabled: fontScale.canDecrease,
                                accessibilityLabel: "Decrease text size"
                            ) {
                                fontScale.bump(-FontScale.step)
                            }

                            Text(fontScale.percentLabel)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .monospacedDigit()
                                .frame(width: Self.valueColumnWidth)
                                .accessibilityLabel("Text size \(fontScale.percentLabel)")

                            adjustButton(
                                "A+",
                                enabled: fontScale.canIncrease,
                                accessibilityLabel: "Increase text size"
                            ) {
                                fontScale.bump(FontScale.step)
                            }
                        }
                    }

                    HStack {
                        Text("Auto-refresh")
                            .font(.body)
                        Spacer()
                        HStack(spacing: 8) {
                            adjustButton(
                                "−",
                                enabled: feedRefresh.canDecrease,
                                accessibilityLabel: "Decrease auto-refresh interval"
                            ) {
                                feedRefresh.bump(-1)
                            }

                            Text(feedRefresh.label)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .monospacedDigit()
                                .frame(width: Self.valueColumnWidth)
                                .accessibilityLabel("Auto-refresh \(feedRefresh.label)")

                            adjustButton(
                                "+",
                                enabled: feedRefresh.canIncrease,
                                accessibilityLabel: "Increase auto-refresh interval"
                            ) {
                                feedRefresh.bump(1)
                            }
                        }
                    }
                }

                Section("Home Feed") {
                    Picker(
                        "Home Feed",
                        selection: Binding(
                            get: { filterStore.settings.homeFeedMode },
                            set: { mode in
                                filterStore.update { $0.homeFeedMode = mode }
                            }
                        )
                    ) {
                        ForEach(HomeFeedMode.allCases) { mode in
                            Text(mode.label).tag(mode)
                        }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                }

                Section("Filter") {
                    Toggle(
                        "Show live content",
                        isOn: invertedBinding(\.hideLiveContent)
                    )
                }

                Section("Hide keywords") {
                    HStack {
                        TextField("Keyword or phrase", text: $keywordDraft)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .onSubmit { addKeyword() }
                        Button("Add") { addKeyword() }
                    }
                    ForEach(filterStore.settings.hideKeywords, id: \.self) { keyword in
                        HStack {
                            Text(keyword)
                                .font(.body)
                            Spacer()
                            Button(role: .destructive) {
                                filterStore.update { settings in
                                    settings.hideKeywords.removeAll {
                                        $0.caseInsensitiveCompare(keyword) == .orderedSame
                                    }
                                }
                            } label: {
                                Image(systemName: "minus.circle.fill")
                            }
                            .buttonStyle(.borderless)
                            .accessibilityLabel("Remove \(keyword)")
                        }
                    }
                }

                #if DEBUG
                Section("Performance Benchmark") {
                    let current = chrome.benchmark.latestResult ?? chrome.benchmark.baselineResult
                    let delta = current.deltaVs(baseline: chrome.benchmark.baselineResult)

                    HStack {
                        Text("Initial load")
                            .font(.body)
                        Spacer()
                        Text("\(current.initialLoadMs) ms")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                        if chrome.benchmark.latestResult != nil && chrome.benchmark.baselineResult.initialLoadMs > 0 {
                            let pct = String(format: "%+.1f%%", delta.initialPct)
                            Text("(\(pct))")
                                .font(.caption)
                                .foregroundStyle(delta.initialPct <= 5.0 ? .green : .red)
                        }
                    }

                    HStack {
                        Text("Scroll render settle")
                            .font(.body)
                        Spacer()
                        Text("\(current.scrollRenderCompletionMs) ms")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                        if chrome.benchmark.latestResult != nil && chrome.benchmark.baselineResult.scrollRenderCompletionMs > 0 {
                            let pct = String(format: "%+.1f%%", delta.scrollPct)
                            Text("(\(pct))")
                                .font(.caption)
                                .foregroundStyle(delta.scrollPct <= 5.0 ? .green : .red)
                        }
                    }

                    HStack {
                        Text("Status")
                            .font(.body)
                        Spacer()
                        Text(delta.isRegressed ? "Regression" : "Optimal")
                            .font(.subheadline)
                            .foregroundStyle(delta.isRegressed ? .red : .green)
                    }

                    HStack {
                        Button {
                            chrome.benchmark.runBenchmark()
                        } label: {
                            if chrome.benchmark.isRunning {
                                HStack {
                                    ProgressView()
                                        .controlSize(.small)
                                    Text("Running…")
                                }
                            } else {
                                Text("Run Benchmark")
                            }
                        }
                        .disabled(chrome.benchmark.isRunning)

                        Spacer()

                        if let latest = chrome.benchmark.latestResult {
                            Button("Set as Baseline") {
                                chrome.benchmark.setAsBaseline(latest)
                            }
                            .buttonStyle(.borderless)
                            .font(.caption)
                            .disabled(chrome.benchmark.isRunning)
                        }
                    }
                }
                #endif

                Section("Credits") {
                    Text("Feed filters adapted from Minimal Theme for Twitter / X by Typefully (MIT).")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Link("Minimal Theme on Github", destination: Self.minimalTwitterURL)
                        .font(.subheadline)
                }

                Section("About") {
                    Text("Version \(AppConfig.versionName) (\(AppConfig.versionCode))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Link("Robin on GitHub", destination: Self.robinRepoURL)
                        .font(.subheadline)
                }

                Section {
                    Button("Sign out", role: .destructive) {
                        onSignOut()
                        dismiss()
                    }
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    /// Shared so the text-size and auto-refresh steppers sit in the same columns.
    private static let valueColumnWidth: CGFloat = 56

    /// Same chrome for text-size and auto-refresh so a short glyph cannot shrink the control.
    private func adjustButton(
        _ title: String,
        enabled: Bool,
        accessibilityLabel: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(title)
                .lineLimit(1)
                .frame(width: 32, height: 22)
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
        .disabled(!enabled)
        .accessibilityLabel(accessibilityLabel)
    }

    private func addKeyword() {
        guard let next = FilterSettings.addingKeyword(
            filterStore.settings.hideKeywords,
            keywordDraft
        ) else { return }
        filterStore.update { $0.hideKeywords = next }
        keywordDraft = ""
    }

    /// Settings that store a “hide” flag but show a “Show …” toggle in the UI.
    private func invertedBinding(_ keyPath: WritableKeyPath<FilterSettings, Bool>) -> Binding<Bool> {
        Binding(
            get: { !filterStore.settings[keyPath: keyPath] },
            set: { newValue in
                filterStore.update { $0[keyPath: keyPath] = !newValue }
            }
        )
    }
}
