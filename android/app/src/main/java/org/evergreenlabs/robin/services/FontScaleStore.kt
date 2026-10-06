package org.evergreenlabs.robin.services

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlin.math.roundToInt

/**
 * In-app text size preference (mirrors iOS / web `robin:fontScale`).
 * Applied only to the X feed WebView, not native Compose chrome.
 */
class FontScaleStore(
    context: Context,
) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private val _scale = MutableStateFlow(clamp(prefs.getFloat(KEY, DEFAULT)))
    val scale: StateFlow<Float> = _scale.asStateFlow()

    val percentLabel: String
        get() = "${(_scale.value * 100f).roundToInt()}%"

    val canDecrease: Boolean
        get() = _scale.value > MIN + 1e-4f

    val canIncrease: Boolean
        get() = _scale.value < MAX - 1e-4f

    fun bump(delta: Float) {
        val next = clamp(_scale.value + delta)
        if (next == _scale.value) return
        _scale.value = next
        prefs.edit().putFloat(KEY, next).apply()
    }

    companion object {
        private const val PREFS = "robin_prefs"
        const val KEY = "robin:fontScale"
        const val MIN = 0.85f
        const val MAX = 2.0f
        const val STEP = 0.1f
        /** 100% — matches the web client's default text size. */
        const val DEFAULT = 1.0f

        fun clamp(value: Float): Float {
            val stepped = (value * 10f).roundToInt() / 10f
            return stepped.coerceIn(MIN, MAX)
        }
    }
}
