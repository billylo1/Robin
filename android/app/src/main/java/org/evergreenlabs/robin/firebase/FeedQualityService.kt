package org.evergreenlabs.robin.firebase

import android.content.Context
import android.content.SharedPreferences
import com.google.firebase.FirebaseApp
import com.google.firebase.appcheck.FirebaseAppCheck
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Serializable
data class FeedQualityPost(
    val id: String,
    val handle: String = "",
    val name: String? = null,
    val bio: String? = null,
    val isBlue: Boolean? = null,
    val followers: Int? = null,
    val friends: Int? = null,
    val isReply: Boolean? = null,
    val isRetweet: Boolean? = null,
    val isQuote: Boolean? = null,
    val hasMedia: Boolean? = null,
    val hashtagCount: Int? = null,
    val mentionCount: Int? = null,
    val charCount: Int? = null,
    val urlDomains: List<String>? = null,
    val statusesPerDay: Double? = null,
    val accountAgeDays: Int? = null,
    val text: String? = null,
    val quotedText: String? = null,
)

@Serializable
data class FeedQualityHiddenItem(
    val id: String,
    val handle: String? = null,
    val reason: String,
    val accountWide: Boolean = false,
)

@Serializable
data class FeedQualityBridgeResponse(
    val keptIds: List<String> = emptyList(),
    val hidden: List<FeedQualityHiddenItem> = emptyList(),
    val retryIds: List<String> = emptyList(),
)

@Serializable
private data class IncomingBatchPayload(
    val posts: List<FeedQualityPost> = emptyList(),
)

@Serializable
private data class CloudFunctionRequest(
    val posts: List<FeedQualityPost>,
)

@Serializable
private data class CloudFunctionResponse(
    val hidden: List<FeedQualityHiddenItem>? = null,
)

@Serializable
private data class CachedAuthorEntry(
    val reason: String,
    val expiresAtMs: Long,
)

@Serializable
private data class CachedAuthorStrike(
    val tweetIds: List<String>,
    val reason: String,
    val expiresAtMs: Long,
)

private data class CachedTweetVerdict(
    val hidden: FeedQualityHiddenItem?,
    val expiresAtMs: Long,
)

object FeedQualityService {
    private const val PREFS_NAME = "robin_feed_quality_cache"
    private const val KEY_AUTHOR_CACHE = "author_cache_v1"
    private const val KEY_AUTHOR_STRIKES = "author_strikes_v1"
    private const val KEY_BUDGET_DATE = "budget_date_v1"
    private const val KEY_BUDGET_COUNT = "budget_count_v1"

    private const val MAX_TWEET_CACHE = 1000
    private const val TWEET_CACHE_TTL_MS = 24L * 60 * 60 * 1000
    private const val MAX_AUTHOR_CACHE = 1000
    private const val AUTHOR_CACHE_TTL_MS = 14L * 24 * 60 * 60 * 1000
    private const val DAILY_BATCH_LIMIT = 25
    private const val MAX_CONCURRENT_REQUESTS = 2
    private const val REQUEST_TIMEOUT_MS = 6000
    private val STRIKE_PROMOTION_REASONS = setOf(
        "non_human_aggregator",
        "engagement_bait",
        "ai_slop",
    )

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = true
    }

    private val mutex = Mutex()
    private val tweetCache = LinkedHashMap<String, CachedTweetVerdict>(128, 0.75f, false)
    private var authorCache: MutableMap<String, CachedAuthorEntry>? = null
    private var authorStrikes: MutableMap<String, CachedAuthorStrike>? = null
    private val inFlightIds = HashSet<String>()
    private var activeRequests = 0

    suspend fun classifyRawBatch(context: Context, rawJson: String): String? {
        val incoming = runCatching {
            json.decodeFromString<IncomingBatchPayload>(rawJson)
        }.getOrNull() ?: return null
        if (incoming.posts.isEmpty()) return null

        val result = classifyBatch(context.applicationContext, incoming.posts)
        if (result.hidden.isEmpty() && result.keptIds.isEmpty() && result.retryIds.isEmpty()) return null
        return runCatching { json.encodeToString(result) }.getOrNull()
    }

    suspend fun clearCaches(context: Context) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        mutex.withLock {
            tweetCache.clear()
            authorCache?.clear()
            authorStrikes?.clear()
            prefs.edit()
                .remove(KEY_AUTHOR_CACHE)
                .remove(KEY_AUTHOR_STRIKES)
                .apply()
        }
    }

    suspend fun classifyBatch(
        context: Context,
        posts: List<FeedQualityPost>,
    ): FeedQualityBridgeResponse {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val nowMs = System.currentTimeMillis()
        val hidden = ArrayList<FeedQualityHiddenItem>()
        val keptIds = ArrayList<String>()
        val uncached = ArrayList<FeedQualityPost>()

        var budgetExhausted = false
        val shouldCallNetwork = mutex.withLock {
            val authors = ensureAuthorCacheLoadedLocked(prefs, nowMs)
            for (post in posts) {
                val handleKey = post.handle.trim().lowercase(Locale.ROOT)
                if (handleKey.isNotEmpty()) {
                    val authorEntry = authors[handleKey]
                    if (authorEntry != null) {
                        if (authorEntry.expiresAtMs > nowMs) {
                            hidden.add(
                                FeedQualityHiddenItem(
                                    id = post.id,
                                    handle = post.handle,
                                    reason = authorEntry.reason,
                                    accountWide = true,
                                ),
                            )
                            continue
                        } else {
                            authors.remove(handleKey)
                        }
                    }
                }

                val cached = tweetCache[post.id]
                if (cached != null) {
                    if (cached.expiresAtMs > nowMs) {
                        if (cached.hidden != null) hidden.add(cached.hidden)
                        else keptIds.add(post.id)
                        continue
                    } else {
                        tweetCache.remove(post.id)
                    }
                }

                if (!inFlightIds.contains(post.id)) {
                    uncached.add(post)
                }
            }

            if (uncached.isEmpty()) {
                false
            } else if (!hasDailyBudgetLocked(prefs, nowMs)) {
                budgetExhausted = true
                false
            } else if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
                false
            } else {
                activeRequests += 1
                for (p in uncached) inFlightIds.add(p.id)
                true
            }
        }

        if (!shouldCallNetwork) {
            val retryIds = if (uncached.isNotEmpty() && !budgetExhausted) uncached.map { it.id } else emptyList()
            return FeedQualityBridgeResponse(keptIds = keptIds, hidden = hidden, retryIds = retryIds)
        }

        val batchIds = uncached.map { it.id }
        var retryIds: List<String> = emptyList()
        try {
            val endpoint = endpointUrl() ?: run {
                retryIds = batchIds
                return FeedQualityBridgeResponse(keptIds = keptIds, hidden = hidden, retryIds = retryIds)
            }
            val appCheckToken = runCatching {
                FirebaseAppCheck.getInstance().getAppCheckToken(false).await().token
            }.getOrNull() ?: run {
                retryIds = batchIds
                return FeedQualityBridgeResponse(keptIds = keptIds, hidden = hidden, retryIds = retryIds)
            }

            mutex.withLock {
                recordDailyBudgetUseLocked(prefs, nowMs)
            }

            val responseBody = withContext(Dispatchers.IO) {
                postJson(
                    urlStr = endpoint,
                    appCheckToken = appCheckToken,
                    body = json.encodeToString(CloudFunctionRequest(posts = uncached)),
                )
            } ?: run {
                retryIds = batchIds
                return FeedQualityBridgeResponse(keptIds = keptIds, hidden = hidden, retryIds = retryIds)
            }

            val decoded = runCatching {
                json.decodeFromString<CloudFunctionResponse>(responseBody)
            }.getOrNull() ?: run {
                retryIds = batchIds
                return FeedQualityBridgeResponse(keptIds = keptIds, hidden = hidden, retryIds = retryIds)
            }

            val remoteHidden = decoded.hidden.orEmpty()
            val hiddenById = HashMap<String, FeedQualityHiddenItem>(remoteHidden.size)

            mutex.withLock {
                val authors = ensureAuthorCacheLoadedLocked(prefs, nowMs)
                val strikes = ensureAuthorStrikesLoadedLocked(prefs, nowMs)
                var authorCacheDirty = false
                var strikesDirty = false
                val expiryMs = nowMs + AUTHOR_CACHE_TTL_MS

                for (rawItem in remoteHidden) {
                    var resolved = rawItem
                    val h = rawItem.handle?.trim()?.lowercase(Locale.ROOT).orEmpty()

                    if (rawItem.accountWide && h.isNotEmpty()) {
                        authors[h] = CachedAuthorEntry(
                            reason = rawItem.reason,
                            expiresAtMs = expiryMs,
                        )
                        if (strikes.remove(h) != null) strikesDirty = true
                        authorCacheDirty = true
                    } else if (h.isNotEmpty() && STRIKE_PROMOTION_REASONS.contains(rawItem.reason)) {
                        val existing = strikes[h]?.takeIf { it.expiresAtMs > nowMs }
                        val updatedIds = ArrayList<String>(existing?.tweetIds.orEmpty())
                        if (!updatedIds.contains(rawItem.id)) {
                            updatedIds.add(rawItem.id)
                        }
                        strikesDirty = true
                        if (updatedIds.size >= 2) {
                            authors[h] = CachedAuthorEntry(
                                reason = rawItem.reason,
                                expiresAtMs = expiryMs,
                            )
                            strikes.remove(h)
                            authorCacheDirty = true
                            resolved = rawItem.copy(accountWide = true)
                        } else {
                            strikes[h] = CachedAuthorStrike(
                                tweetIds = updatedIds,
                                reason = rawItem.reason,
                                expiresAtMs = expiryMs,
                            )
                        }
                    }

                    hiddenById[resolved.id] = resolved
                    hidden.add(resolved)
                }

                for (post in uncached) {
                    val h = hiddenById[post.id]
                    if (h != null) {
                        rememberTweetLocked(post.id, h, nowMs)
                    } else {
                        keptIds.add(post.id)
                        rememberTweetLocked(post.id, null, nowMs)
                    }
                }

                if (authorCacheDirty) {
                    authorCache = pruneAndPersistLocked(
                        prefs = prefs,
                        key = KEY_AUTHOR_CACHE,
                        entries = authors,
                        nowMs = nowMs,
                        expiresAt = { it.expiresAtMs },
                        encode = { json.encodeToString(it) },
                    )
                }
                if (strikesDirty) {
                    authorStrikes = pruneAndPersistLocked(
                        prefs = prefs,
                        key = KEY_AUTHOR_STRIKES,
                        entries = strikes,
                        nowMs = nowMs,
                        expiresAt = { it.expiresAtMs },
                        encode = { json.encodeToString(it) },
                    )
                }
            }
        } catch (_: Exception) {
            // Silent failure: allow retry on later reload/scroll
            retryIds = batchIds
        } finally {
            mutex.withLock {
                activeRequests = (activeRequests - 1).coerceAtLeast(0)
                for (p in uncached) inFlightIds.remove(p.id)
            }
        }

        return FeedQualityBridgeResponse(keptIds = keptIds, hidden = hidden, retryIds = retryIds)
    }

    private fun rememberTweetLocked(id: String, hidden: FeedQualityHiddenItem?, nowMs: Long) {
        if (!tweetCache.containsKey(id) && tweetCache.size >= MAX_TWEET_CACHE) {
            val oldestKey = tweetCache.keys.firstOrNull()
            if (oldestKey != null) tweetCache.remove(oldestKey)
        }
        tweetCache[id] = CachedTweetVerdict(
            hidden = hidden,
            expiresAtMs = nowMs + TWEET_CACHE_TTL_MS,
        )
    }

    private fun todayString(nowMs: Long): String =
        SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(nowMs))

    private fun hasDailyBudgetLocked(prefs: SharedPreferences, nowMs: Long): Boolean {
        val today = todayString(nowMs)
        val storedDate = prefs.getString(KEY_BUDGET_DATE, null)
        if (storedDate != today) return true
        return prefs.getInt(KEY_BUDGET_COUNT, 0) < DAILY_BATCH_LIMIT
    }

    private fun recordDailyBudgetUseLocked(prefs: SharedPreferences, nowMs: Long) {
        val today = todayString(nowMs)
        val storedDate = prefs.getString(KEY_BUDGET_DATE, null)
        val count = if (storedDate == today) prefs.getInt(KEY_BUDGET_COUNT, 0) else 0
        prefs.edit()
            .putString(KEY_BUDGET_DATE, today)
            .putInt(KEY_BUDGET_COUNT, count + 1)
            .apply()
    }

    private fun ensureAuthorCacheLoadedLocked(
        prefs: SharedPreferences,
        nowMs: Long,
    ): MutableMap<String, CachedAuthorEntry> {
        authorCache?.let { return it }
        val loaded = loadExpiringLocked(prefs, KEY_AUTHOR_CACHE, nowMs, expiresAt = { it.expiresAtMs }) { raw ->
            json.decodeFromString<Map<String, CachedAuthorEntry>>(raw)
        }
        authorCache = loaded
        return loaded
    }

    private fun ensureAuthorStrikesLoadedLocked(
        prefs: SharedPreferences,
        nowMs: Long,
    ): MutableMap<String, CachedAuthorStrike> {
        authorStrikes?.let { return it }
        val loaded = loadExpiringLocked(prefs, KEY_AUTHOR_STRIKES, nowMs, expiresAt = { it.expiresAtMs }) { raw ->
            json.decodeFromString<Map<String, CachedAuthorStrike>>(raw)
        }
        authorStrikes = loaded
        return loaded
    }

    private fun <T> loadExpiringLocked(
        prefs: SharedPreferences,
        key: String,
        nowMs: Long,
        expiresAt: (T) -> Long,
        decode: (String) -> Map<String, T>,
    ): MutableMap<String, T> {
        val loaded = LinkedHashMap<String, T>()
        val raw = prefs.getString(key, null)
        if (!raw.isNullOrBlank()) {
            runCatching {
                val map = decode(raw)
                for ((k, v) in map) {
                    if (expiresAt(v) > nowMs) loaded[k] = v
                }
            }
        }
        return loaded
    }

    private fun <T> pruneAndPersistLocked(
        prefs: SharedPreferences,
        key: String,
        entries: MutableMap<String, T>,
        nowMs: Long,
        expiresAt: (T) -> Long,
        encode: (Map<String, T>) -> String,
    ): MutableMap<String, T> {
        val iter = entries.entries.iterator()
        while (iter.hasNext()) {
            if (expiresAt(iter.next().value) <= nowMs) iter.remove()
        }
        val trimmed: LinkedHashMap<String, T> = if (entries.size > MAX_AUTHOR_CACHE) {
            entries.entries
                .sortedByDescending { expiresAt(it.value) }
                .take(MAX_AUTHOR_CACHE)
                .associateTo(LinkedHashMap()) { it.key to it.value }
        } else {
            LinkedHashMap(entries)
        }
        runCatching {
            prefs.edit().putString(key, encode(trimmed)).apply()
        }
        return trimmed
    }

    private fun endpointUrl(): String? {
        val projectId = runCatching {
            FirebaseApp.getInstance().options.projectId
        }.getOrNull()?.trim().orEmpty()
        if (projectId.isEmpty()) return null
        return "https://us-central1-$projectId.cloudfunctions.net/classifyForYouFeed"
    }

    private fun postJson(urlStr: String, appCheckToken: String, body: String): String? {
        val conn = (URL(urlStr).openConnection() as? HttpURLConnection) ?: return null
        return try {
            conn.requestMethod = "POST"
            conn.connectTimeout = REQUEST_TIMEOUT_MS
            conn.readTimeout = REQUEST_TIMEOUT_MS
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("X-Firebase-AppCheck", appCheckToken)
            OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { it.write(body) }
            val code = conn.responseCode
            if (code in 200..299) {
                conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            } else {
                null
            }
        } finally {
            conn.disconnect()
        }
    }
}
