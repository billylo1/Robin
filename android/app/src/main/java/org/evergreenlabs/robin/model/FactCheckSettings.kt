package org.evergreenlabs.robin.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class FactCheckModelPreference {
    @SerialName("flash_lite")
    FlashLite,

    @SerialName("flash")
    Flash,
    ;

    val label: String
        get() = when (this) {
            FlashLite -> "Lite"
            Flash -> "Flash"
        }

    /** Gemini Developer API model id for Firebase AI Logic. */
    val modelName: String
        get() = when (this) {
            FlashLite -> "gemini-3.5-flash-lite"
            Flash -> "gemini-3.8-flash"
        }

    val requiresLowThinking: Boolean
        get() = this == Flash

    val analyticsValue: String
        get() = when (this) {
            FlashLite -> "flash_lite"
            Flash -> "flash"
        }
}
