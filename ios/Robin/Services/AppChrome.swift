import Foundation

struct BenchmarkResult: Codable, Equatable {
    var initialLoadMs: Int
    var scrollRenderCompletionMs: Int
    var timestamp: Int64
    var bootReady: Bool

    func deltaVs(baseline: BenchmarkResult) -> (initialPct: Double, scrollPct: Double, isRegressed: Bool) {
        let initialDiff = Double(initialLoadMs - baseline.initialLoadMs)
        let initialPct = baseline.initialLoadMs > 0 ? (initialDiff / Double(baseline.initialLoadMs)) * 100.0 : 0.0
        let scrollDiff = Double(scrollRenderCompletionMs - baseline.scrollRenderCompletionMs)
        let scrollPct = baseline.scrollRenderCompletionMs > 0 ? (scrollDiff / Double(baseline.scrollRenderCompletionMs)) * 100.0 : 0.0
        let isRegressed = initialPct > 15.0 || scrollPct > 15.0
        return (initialPct, scrollPct, isRegressed)
    }
}

@Observable
@MainActor
final class RobinBenchmarkStore {
    static let defaultBaseline = BenchmarkResult(
        initialLoadMs: 350,
        scrollRenderCompletionMs: 160,
        timestamp: 0,
        bootReady: true
    )

    private static let keyLatest = "robin:benchmark:latest"
    private static let keyBaseline = "robin:benchmark:baseline"

    var latestResult: BenchmarkResult?
    var baselineResult: BenchmarkResult
    var isRunning = false

    var runner: ((@escaping (BenchmarkResult?) -> Void) -> Void)?

    init() {
        if let data = UserDefaults.standard.data(forKey: Self.keyLatest),
           let res = try? JSONDecoder().decode(BenchmarkResult.self, from: data) {
            self.latestResult = res
        } else {
            self.latestResult = nil
        }

        if let data = UserDefaults.standard.data(forKey: Self.keyBaseline),
           let res = try? JSONDecoder().decode(BenchmarkResult.self, from: data) {
            self.baselineResult = res
        } else {
            self.baselineResult = Self.defaultBaseline
        }
    }

    func recordRun(_ result: BenchmarkResult) {
        latestResult = result
        if let data = try? JSONEncoder().encode(result) {
            UserDefaults.standard.set(data, forKey: Self.keyLatest)
        }
        if UserDefaults.standard.data(forKey: Self.keyBaseline) == nil {
            setAsBaseline(result)
        }
    }

    func setAsBaseline(_ result: BenchmarkResult) {
        baselineResult = result
        if let data = try? JSONEncoder().encode(result) {
            UserDefaults.standard.set(data, forKey: Self.keyBaseline)
        }
    }

    func runBenchmark(completion: ((BenchmarkResult?) -> Void)? = nil) {
        guard let runner else {
            let noResult: BenchmarkResult? = nil
            completion?(noResult)
            return
        }
        isRunning = true
        runner { [weak self] res in
            guard let self else { return }
            self.isRunning = false
            if let res {
                self.recordRun(res)
            }
            completion?(res)
        }
    }
}

/// In-app chrome: settings sheet + toast.
@Observable
@MainActor
final class AppChrome {
    var infoPresented = false
    var toastMessage: String?
    let benchmark = RobinBenchmarkStore()

    func showToast(_ message: String) {
        toastMessage = message
    }
}
