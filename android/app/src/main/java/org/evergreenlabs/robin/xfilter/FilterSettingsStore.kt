package org.evergreenlabs.robin.xfilter

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.filterSettingsDataStore by preferencesDataStore(name = "x_filter_settings")

/**
 * Persists filter toggles for WebView inject (replaces chrome.storage).
 */
class FilterSettingsStore(private val context: Context) {
    private object Keys {
        val forceFollowing = booleanPreferencesKey("forceFollowing")
        val hideForYouTab = booleanPreferencesKey("hideForYouTab")
        val hidePromoted = booleanPreferencesKey("hidePromoted")
        val preferLatest = booleanPreferencesKey("preferLatest")
        val hideWhoToFollow = booleanPreferencesKey("hideWhoToFollow")
        val hideLiveContent = booleanPreferencesKey("hideLiveContent")
        val hideOpenAppNags = booleanPreferencesKey("hideOpenAppNags")
        val hidePageHeader = booleanPreferencesKey("hidePageHeader")
        val hideComposeButton = booleanPreferencesKey("hideComposeButton")
    }

    val settings: Flow<FilterSettings> = context.filterSettingsDataStore.data.map { prefs ->
        prefs.toFilterSettings()
    }

    suspend fun update(transform: (FilterSettings) -> FilterSettings) {
        context.filterSettingsDataStore.edit { prefs ->
            val next = transform(prefs.toFilterSettings())
            prefs[Keys.forceFollowing] = next.forceFollowing
            prefs[Keys.hideForYouTab] = next.hideForYouTab
            prefs[Keys.hidePromoted] = next.hidePromoted
            prefs[Keys.preferLatest] = next.preferLatest
            prefs[Keys.hideWhoToFollow] = next.hideWhoToFollow
            prefs[Keys.hideLiveContent] = next.hideLiveContent
            prefs[Keys.hideOpenAppNags] = next.hideOpenAppNags
            prefs[Keys.hidePageHeader] = next.hidePageHeader
            prefs[Keys.hideComposeButton] = next.hideComposeButton
        }
    }

    private fun Preferences.toFilterSettings(): FilterSettings {
        val d = FilterSettings.Default
        return FilterSettings(
            forceFollowing = this[Keys.forceFollowing] ?: d.forceFollowing,
            hideForYouTab = this[Keys.hideForYouTab] ?: d.hideForYouTab,
            hidePromoted = this[Keys.hidePromoted] ?: d.hidePromoted,
            preferLatest = this[Keys.preferLatest] ?: d.preferLatest,
            hideWhoToFollow = this[Keys.hideWhoToFollow] ?: d.hideWhoToFollow,
            hideLiveContent = this[Keys.hideLiveContent] ?: d.hideLiveContent,
            hideOpenAppNags = this[Keys.hideOpenAppNags] ?: d.hideOpenAppNags,
            hidePageHeader = this[Keys.hidePageHeader] ?: d.hidePageHeader,
            hideComposeButton = this[Keys.hideComposeButton] ?: d.hideComposeButton,
        )
    }
}
