package org.evergreenlabs.robin.xfilter

import org.evergreenlabs.robin.R

/** Home feed mode for Settings (maps to forceFollowing, hideForYouTab, preferLatest). */
enum class HomeFeedMode(val labelRes: Int) {
    FollowingByTime(R.string.filter_home_following_time),
    ForYou(R.string.filter_home_for_you),
}

/**
 * Defaults for the injected x-filter core (no chrome.storage).
 * Host serializes these onto window.__ROBIN_SETTINGS__ before filter-core.js.
 */
data class FilterSettings(
    /** When true, stick to Following and hide For You. When false, stick to For You. */
    val forceFollowing: Boolean = true,
    val hideForYouTab: Boolean = true,
    val hidePromoted: Boolean = true,
    val preferLatest: Boolean = true,
    val hideWhoToFollow: Boolean = true,
    /** Hide live / Spaces / broadcast promo rows in the Following feed. */
    val hideLiveContent: Boolean = true,
    val hideOpenAppNags: Boolean = true,
    /** Hide X avatar / logo / Subscribe / Following tabs on home (native bar replaces them). */
    val hidePageHeader: Boolean = true,
    /** Hide the floating / side-nav compose (post) button. */
    val hideComposeButton: Boolean = true,
) {
    /** Home feed mode for Settings UI (default: Following by time). */
    val homeFeedMode: HomeFeedMode
        get() = if (!forceFollowing) HomeFeedMode.ForYou else HomeFeedMode.FollowingByTime

    fun withHomeFeedMode(mode: HomeFeedMode): FilterSettings = when (mode) {
        HomeFeedMode.FollowingByTime -> copy(
            forceFollowing = true,
            hideForYouTab = true,
            preferLatest = true,
        )
        HomeFeedMode.ForYou -> copy(
            forceFollowing = false,
            hideForYouTab = false,
            preferLatest = false,
        )
    }

    /**
     * @param fontScale Host text-size preference (from [org.evergreenlabs.robin.services.FontScaleStore]).
     */
    fun toJsonObjectLiteral(fontScale: Float = 1f): String = buildString {
        append('{')
        append("\"forceFollowing\":").append(forceFollowing).append(',')
        append("\"hideForYouTab\":").append(hideForYouTab).append(',')
        append("\"hidePromoted\":").append(hidePromoted).append(',')
        append("\"preferLatest\":").append(preferLatest).append(',')
        append("\"hideWhoToFollow\":").append(hideWhoToFollow).append(',')
        append("\"hideLiveContent\":").append(hideLiveContent).append(',')
        append("\"hideOpenAppNags\":").append(hideOpenAppNags).append(',')
        append("\"hidePageHeader\":").append(hidePageHeader).append(',')
        append("\"hideComposeButton\":").append(hideComposeButton).append(',')
        append("\"fontScale\":").append(fontScale)
        append('}')
    }

    companion object {
        val Default = FilterSettings()
    }
}
