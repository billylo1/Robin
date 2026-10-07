package org.evergreenlabs.robin.xfilter

import org.evergreenlabs.robin.R
import java.util.Locale

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
    /** Whole-word or phrase hides. Empty hides nothing. `cat` does not match `category`. */
    val hideKeywords: List<String> = emptyList(),
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
        append("\"hideKeywords\":[")
        hideKeywords.forEachIndexed { index, phrase ->
            if (index > 0) append(',')
            append(jsonStringLiteral(phrase))
        }
        append("],")
        append("\"fontScale\":").append(fontScale)
        append('}')
    }

    companion object {
        const val KEYWORD_MAX_COUNT = 40
        const val KEYWORD_MAX_LENGTH = 80

        val Default = FilterSettings()

        /** Trim, collapse whitespace, drop blanks and over-long phrases, dedupe ignoring case. */
        fun normalizedKeywords(raw: List<String>): List<String> {
            val seen = HashSet<String>()
            val out = ArrayList<String>()
            for (item in raw) {
                if (out.size >= KEYWORD_MAX_COUNT) break
                val phrase = item.trim().replace(Regex("\\s+"), " ")
                if (phrase.isEmpty() || phrase.length > KEYWORD_MAX_LENGTH) continue
                val key = phrase.lowercase(Locale.ROOT)
                if (!seen.add(key)) continue
                out.add(phrase)
            }
            return out
        }

        /** Null when the phrase is blank, too long, a duplicate, or the list is full. */
        fun addingKeyword(existing: List<String>, addition: String): List<String>? {
            val phrase = addition.trim().replace(Regex("\\s+"), " ")
            if (phrase.isEmpty() || phrase.length > KEYWORD_MAX_LENGTH) return null
            if (existing.size >= KEYWORD_MAX_COUNT) return null
            if (existing.any { it.equals(phrase, ignoreCase = true) }) return null
            return existing + phrase
        }

        /** JS string literal. U+2028/U+2029 are line terminators in JavaScript source. */
        private fun jsonStringLiteral(raw: String): String = buildString {
            append('"')
            for (ch in raw) {
                when (ch) {
                    '\\' -> append("\\\\")
                    '"' -> append("\\\"")
                    '\n' -> append("\\n")
                    '\r' -> append("\\r")
                    '\t' -> append("\\t")
                    '\u2028' -> append("\\u2028")
                    '\u2029' -> append("\\u2029")
                    else -> {
                        if (ch.code < 0x20) append("\\u%04x".format(ch.code))
                        else append(ch)
                    }
                }
            }
            append('"')
        }
    }
}
