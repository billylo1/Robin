package org.evergreenlabs.robin.services

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject

data class BenchmarkResult(
    val initialLoadMs: Long,
    val scrollRenderCompletionMs: Long,
    val timestamp: Long,
    val bootReady: Boolean,
) {
    fun deltaVs(baseline: BenchmarkResult): BenchmarkDelta {
        val initialDiff = initialLoadMs - baseline.initialLoadMs
        val initialPct = if (baseline.initialLoadMs > 0) {
            (initialDiff.toDouble() / baseline.initialLoadMs) * 100.0
        } else {
            0.0
        }
        val scrollDiff = scrollRenderCompletionMs - baseline.scrollRenderCompletionMs
        val scrollPct = if (baseline.scrollRenderCompletionMs > 0) {
            (scrollDiff.toDouble() / baseline.scrollRenderCompletionMs) * 100.0
        } else {
            0.0
        }
        val isRegressed = initialPct > 15.0 || scrollPct > 15.0
        val isImproved = initialPct < -5.0 || scrollPct < -5.0
        return BenchmarkDelta(
            initialLoadPct = initialPct,
            scrollRenderPct = scrollPct,
            isRegressed = isRegressed,
            isImproved = isImproved,
        )
    }

    fun toJsonString(): String {
        val obj = JSONObject()
        obj.put("initialLoadMs", initialLoadMs)
        obj.put("scrollRenderCompletionMs", scrollRenderCompletionMs)
        obj.put("timestamp", timestamp)
        obj.put("bootReady", bootReady)
        return obj.toString()
    }

    companion object {
        fun fromJsonString(jsonStr: String?): BenchmarkResult? {
            if (jsonStr.isNullOrBlank()) return null
            return try {
                val obj = JSONObject(jsonStr)
                BenchmarkResult(
                    initialLoadMs = obj.optLong("initialLoadMs", 0L),
                    scrollRenderCompletionMs = obj.optLong("scrollRenderCompletionMs", 0L),
                    timestamp = obj.optLong("timestamp", 0L),
                    bootReady = obj.optBoolean("bootReady", true),
                )
            } catch (_: Exception) {
                null
            }
        }
    }
}

data class BenchmarkDelta(
    val initialLoadPct: Double,
    val scrollRenderPct: Double,
    val isRegressed: Boolean,
    val isImproved: Boolean,
)

/**
 * Manages in-app performance benchmark measurements and historical baselines.
 */
class BenchmarkStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private val _latestResult = MutableStateFlow(
        BenchmarkResult.fromJsonString(prefs.getString(KEY_LATEST, null))
    )
    val latestResult: StateFlow<BenchmarkResult?> = _latestResult.asStateFlow()

    private val _baselineResult = MutableStateFlow(
        BenchmarkResult.fromJsonString(prefs.getString(KEY_BASELINE, null)) ?: DEFAULT_BASELINE
    )
    val baselineResult: StateFlow<BenchmarkResult> = _baselineResult.asStateFlow()

    private val _isRunning = MutableStateFlow(false)
    val isRunning: StateFlow<Boolean> = _isRunning.asStateFlow()

    private var runner: (((BenchmarkResult?) -> Unit) -> Unit)? = null

    fun registerRunner(runner: (((BenchmarkResult?) -> Unit) -> Unit)?) {
        this.runner = runner
    }

    fun runBenchmark(onComplete: ((BenchmarkResult?) -> Unit)? = null) {
        val r = runner
        if (r == null) {
            onComplete?.invoke(null)
            return
        }
        _isRunning.value = true
        r { result ->
            _isRunning.value = false
            if (result != null) {
                recordRun(result)
            }
            onComplete?.invoke(result)
        }
    }

    fun recordRun(result: BenchmarkResult) {
        _latestResult.value = result
        prefs.edit().putString(KEY_LATEST, result.toJsonString()).apply()
        // If baseline is default or empty, set the first run as baseline
        if (prefs.getString(KEY_BASELINE, null) == null) {
            setAsBaseline(result)
        }
    }

    fun setAsBaseline(result: BenchmarkResult) {
        _baselineResult.value = result
        prefs.edit().putString(KEY_BASELINE, result.toJsonString()).apply()
    }

    fun resetBaseline() {
        _baselineResult.value = DEFAULT_BASELINE
        prefs.edit().remove(KEY_BASELINE).apply()
    }

    companion object {
        private const val PREFS = "robin_benchmark_prefs"
        private const val KEY_LATEST = "benchmark:latest"
        private const val KEY_BASELINE = "benchmark:baseline"

        val DEFAULT_BASELINE = BenchmarkResult(
            initialLoadMs = 350L,
            scrollRenderCompletionMs = 160L,
            timestamp = 0L,
            bootReady = true,
        )
    }
}
