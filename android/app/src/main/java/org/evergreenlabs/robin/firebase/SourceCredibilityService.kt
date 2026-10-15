package org.evergreenlabs.robin.firebase

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

/** Human-curated Media Bias/Fact Check (MBFC) rating for a news/source domain. */
data class SourceCredibilityRating(
    val sourceName: String,
    val bias: String,
    val factualReporting: String,
    val credibility: String,
    val mediaType: String,
    val mbfcURL: String,
    val sourceURL: String,
) {
    /**
     * Bias to show in the Fact Check sheet. Center / center-left / center-right
     * (including MBFC “Least Biased” / “Left-Center” / “Right-Center”) are omitted.
     */
    val displayBias: String?
        get() {
            val normalized = bias.trim().lowercase().replace(' ', '-')
            if (normalized.isEmpty()) return null
            val hidden = setOf(
                "least-biased",
                "center",
                "centre",
                "left-center",
                "left-centre",
                "center-left",
                "centre-left",
                "right-center",
                "right-centre",
                "center-right",
                "centre-right",
            )
            return if (normalized in hidden) null else bias.trim()
        }
}

/**
 * Loads MBFC ratings from the same public mirror Simplifier uses and matches by page host.
 */
object SourceCredibilityService {
    private const val TAG = "SourceCredibility"
    private const val FEED_URL = "https://evergreen-labs.org/assets/factcheck.json"
    private val CACHE_TTL_MS = TimeUnit.HOURS.toMillis(24)

    private val mutex = Mutex()
    private var cachedIndex: Map<String, SourceCredibilityRating>? = null
    private var cachedAtMs: Long = 0L

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    /** Look up an MBFC rating for the page URL’s host. Returns null on miss or fetch failure. */
    suspend fun rating(forPageUrl: URL): SourceCredibilityRating? {
        val host = normalizedHost(forPageUrl.host) ?: return null
        val index = loadIndex() ?: return null
        return match(host = host, index = index)
    }

    /** Prompt fragment: matched rating, or short generic guidelines when unmatched. */
    fun promptFragment(rating: SourceCredibilityRating?): String {
        if (rating != null) {
            val lines = mutableListOf(
                "",
                "CREDIBILITY RATING FOR THIS SOURCE (Media Bias/Fact Check):",
                "Source: ${rating.sourceName}",
            )
            if (rating.bias.isNotEmpty()) lines += "Bias: ${rating.bias}"
            if (rating.factualReporting.isNotEmpty()) {
                lines += "Factual Reporting: ${rating.factualReporting}"
            }
            if (rating.credibility.isNotEmpty()) lines += "Credibility: ${rating.credibility}"
            if (rating.mediaType.isNotEmpty()) lines += "Media Type: ${rating.mediaType}"
            lines +=
                "Use this human-curated source rating only as light background about the publisher. Do NOT fact-check, score, or write findings about the publisher's reputation, bias, or credibility. Verify the specific claims in the post or selection with search evidence; do not score from the rating alone."
            return lines.joinToString("\n")
        }
        return """

CREDIBILITY ASSESSMENT GUIDELINES:
Fact-check the claims in the content (events, figures, quotes), not the publisher's brand.
When evaluating those claims, consider:
1. Corroboration from independent reliable sources
2. Factual accuracy and evidence for each claim
3. Missing context or misleading framing in the content
4. Consistency with established reporting on the same events
""".trimEnd()
    }

    private fun match(
        host: String,
        index: Map<String, SourceCredibilityRating>,
    ): SourceCredibilityRating? {
        val labels = host.split('.')
        if (labels.size < 2) return index[host]
        // Longest domain first: edition.cnn.com → cnn.com (skip bare TLD).
        for (i in 0 until labels.size - 1) {
            val candidate = labels.subList(i, labels.size).joinToString(".")
            index[candidate]?.let { return it }
        }
        return null
    }

    fun normalizedHost(raw: String?): String? {
        var host = raw?.trim()?.lowercase().orEmpty()
        if (host.isEmpty()) return null
        if (host.startsWith("www.")) host = host.removePrefix("www.")
        return host
    }

    private suspend fun loadIndex(): Map<String, SourceCredibilityRating>? {
        mutex.withLock {
            val existing = cachedIndex
            if (existing != null && System.currentTimeMillis() - cachedAtMs < CACHE_TTL_MS) {
                return existing
            }
        }

        val fetched = withContext(Dispatchers.IO) {
            runCatching { fetchAndParse() }
                .onFailure { Log.w(TAG, "Fetch failed: ${it.message}") }
                .getOrNull()
        }

        return mutex.withLock {
            if (fetched != null) {
                cachedIndex = fetched
                cachedAtMs = System.currentTimeMillis()
                fetched
            } else {
                cachedIndex
            }
        }
    }

    private fun fetchAndParse(): Map<String, SourceCredibilityRating> {
        val connection = (URL(FEED_URL).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 30_000
            requestMethod = "GET"
            setRequestProperty("Accept", "application/json")
            setRequestProperty("User-Agent", "Robin")
        }
        try {
            val code = connection.responseCode
            val body = (if (code in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader()
                ?.use { it.readText() }
                .orEmpty()
            if (code !in 200..299) {
                throw IllegalStateException("factcheck.json HTTP $code")
            }
            // Hosted file may include a UTF-8 BOM that kotlinx.serialization rejects.
            val normalized = body.removePrefix("\uFEFF").trimStart()
            val rows = json.decodeFromString<List<MBFCRow>>(normalized)
            val index = LinkedHashMap<String, SourceCredibilityRating>(rows.size)
            for (row in rows) {
                val key = normalizedHost(row.sourceURL) ?: continue
                if (key.isEmpty()) continue
                val rating = SourceCredibilityRating(
                    sourceName = row.source.trim(),
                    bias = row.bias.trim(),
                    factualReporting = row.factualReporting.trim(),
                    credibility = row.credibility.trim(),
                    mediaType = row.mediaType.trim(),
                    mbfcURL = row.mbfcURL.trim(),
                    sourceURL = key,
                )
                val existing = index[key]
                if (existing != null && existing.sourceURL.length > key.length) continue
                index[key] = rating
            }
            return index
        } finally {
            connection.disconnect()
        }
    }

    @Serializable
    private data class MBFCRow(
        @SerialName("Source") val source: String = "",
        @SerialName("MBFC URL") val mbfcURL: String = "",
        @SerialName("Bias") val bias: String = "",
        @SerialName("Factual Reporting") val factualReporting: String = "",
        @SerialName("Media Type") val mediaType: String = "",
        @SerialName("Source URL") val sourceURL: String = "",
        @SerialName("Credibility") val credibility: String = "",
    )
}
