package org.evergreenlabs.robin.services

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlin.math.abs

/**
 * How often Robin auto-refreshes the Following feed while near the top
 * (mirrors iOS `FeedRefreshIntervalStore`).
 */
class FeedRefreshIntervalStore(
    context: Context,
) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private val _seconds = MutableStateFlow(clamp(prefs.getInt(KEY, DEFAULT_SECONDS)))
    val seconds: StateFlow<Int> = _seconds.asStateFlow()

    val label: String
        get() = labelFor(_seconds.value)

    val isEnabled: Boolean
        get() = _seconds.value > 0

    val canDecrease: Boolean
        get() = stepIndexOf(_seconds.value) > 0

    val canIncrease: Boolean
        get() = stepIndexOf(_seconds.value) < STEPS.lastIndex

    fun bump(direction: Int) {
        val idx = stepIndexOf(_seconds.value) + if (direction >= 0) 1 else -1
        if (idx !in STEPS.indices) return
        val next = STEPS[idx]
        if (next == _seconds.value) return
        _seconds.value = next
        prefs.edit().putInt(KEY, next).apply()
    }

    companion object {
        private const val PREFS = "robin_prefs"
        const val KEY = "robin:feedRefreshIntervalSeconds"
        /** 0 = Off, then 30s / 1m / 2m / 5m. */
        val STEPS = listOf(0, 30, 60, 120, 300)
        const val DEFAULT_SECONDS = 300
        /** Require this much quiet time before an automatic refresh fires. */
        const val IDLE_MS = 20_000L
        /** Poll tick while waiting for cooldown + idle (not the user-facing interval). */
        const val POLL_TICK_MS = 15_000L

        fun clamp(seconds: Int): Int =
            STEPS.minByOrNull { abs(it - seconds) } ?: DEFAULT_SECONDS

        fun stepIndexOf(seconds: Int): Int =
            STEPS.indexOf(clamp(seconds)).takeIf { it >= 0 }
                ?: STEPS.indexOf(DEFAULT_SECONDS)

        fun labelFor(seconds: Int): String = when (clamp(seconds)) {
            0 -> "Off"
            30 -> "30s"
            60 -> "1 min"
            120 -> "2 min"
            300 -> "5 min"
            else -> "${seconds}s"
        }
    }
}
