package org.evergreenlabs.robin

object AppConfig {
    val versionName: String
        get() = BuildConfig.VERSION_NAME

    val versionCode: Int
        get() = BuildConfig.VERSION_CODE
}
