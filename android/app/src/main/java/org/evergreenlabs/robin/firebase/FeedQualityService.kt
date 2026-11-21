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

private data class CachedTweetVerdict(
    val hidden: FeedQualityHiddenItem?,
    val expiresAtMs: Long,
)

object FeedQualityService {
    private const val PREFS_NAME = "robin_feed_quality_cache"
    private const val KEY_AUTHOR_CACHE = "author_cache_v1"
    private const val KEY_BUDGET_DATE = "budget_date_v1"
    private const val KEY_BUDGET_COUNT = "budget_count_v1"

    private const val MAX_TWEET_CACHE = 1000
    private const val TWEET_CACHE_TTL_MS = 24L * 60 * 60 * 1000
    private const val MAX_AUTHOR_CACHE = 1000
    private const val AUTHOR_CACHE_TTL_MS = 14L * 24 * 60 * 60 * 1000
    private const val DAILY_BATCH_LIMIT = 25
    private const val MAX_CONCURRENT_REQUESTS = 2
    private const val REQUEST_TIMEOUT_MS = 6000

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = true
    }

    private val mutex = Mutex()
    private val tweetCache = LinkedHashMap<String, CachedTweetVerdict>(128, 0.75f, false)
    private var authorCache: MutableMap<String, CachedAuthorEntry>? = null
    private val inFlightIds = HashSet<String>()
    private var activeRequests = 0

    suspend fun classifyRawBatch(context: Context, rawJson: String): String? {
        val incoming = runCatching {
            json.decodeFromString<IncomingBatchPayload>(rawJson)
        }.getOrNull() ?: return null
        if (incoming.posts.isEmpty()) return null

        val result = classifyBatch(context.applicationContext, incoming.posts)
        if (result.hidden.isEmpty() && result.keptIds.isEmpty()) return null
        return runCatching { json.encodeToString(result) }.getOrNull()
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

        val shouldCallNetwork = mutex.withLock {
            val authors = ensureAuthorCacheLoaded(prefs, nowMs)
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
            } else if (activeRequests >= MAX_CONCURRENT_REQUESTS || !consumeDailyBudgetIfAvailable(prefs, nowMs)) {
                false
            } else {
                activeRequests += 1
                for (p in uncached) inFlightIds.add(p.id)
                true
            }
        }

        if (!shouldCallNetwork) {
            return FeedQualityBridgeResponse(keptIds = keptIds, hidden = hidden)
        }

        try {
            val endpoint = endpointUrl() ?: return FeedQualityBridgeResponse(keptIds = keptIds, hidden = hidden)
            val appCheckToken = runCatching {
                FirebaseAppCheck.getInstance().getAppCheckToken(false).await().token
            }.getOrNull() ?: return FeedQualityBridgeResponse(keptIds = keptIds, hidden = hidden)

            val responseBody = withContext(Dispatchers.IO) {
                postJson(
                    urlStr = endpoint,
                    appCheckToken = appCheckToken,
                    body = json.encodeToString(CloudFunctionRequest(posts = uncached)),
                )
            } ?: return FeedQualityBridgeResponse(keptIds = keptIds, hidden = hidden)

            val decoded = runCatching {
                json.decodeFromString<CloudFunctionResponse>(responseBody)
            }.getOrNull() ?: return FeedQualityBridgeResponse(keptIds = keptIds, hidden = hidden)

            val remoteHidden = decoded.hidden.orEmpty()
            val hiddenById = HashMap<String, FeedQualityHiddenItem>(remoteHidden.size)

            mutex.withLock {
                val authors = ensureAuthorCacheLoaded(prefs, nowMs)
                var authorCacheDirty = false
                for (item in remoteHidden) {
                    hiddenById[item.id] = item
                    hidden.add(item)
                    val h = item.handle?.trim()?.lowercase(Locale.ROOT).orEmpty()
                    if (item.accountWide && h.isNotEmpty()) {
                        authors[h] = CachedAuthorEntry(
                            reason = item.reason,
                            expiresAtMs = nowMs + AUTHOR_CACHE_TTL_MS,
                        )
                        authorCacheDirty = true
                    }
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
                    pruneAndPersistAuthorCacheLocked(prefs, authors, nowMs)
                }
            }
        } catch (_: Exception) {
            // Silent failure: never block or disturb the feed
        } finally {
            mutex.withLock {
                activeRequests = (activeRequests - 1).coerceAtLeast(0)
                for (p in uncached) inFlightIds.remove(p.id)
            }
        }

        return FeedQualityBridgeResponse(keptIds = keptIds, hidden = hidden)
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

    private fun consumeDailyBudgetIfAvailable(prefs: SharedPreferences, nowMs: Long): Boolean {
        val today = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(nowMs))
        val storedDate = prefs.getString(KEY_BUDGET_DATE, null)
        var count = prefs.getInt(KEY_BUDGET_COUNT, 0)
        if (storedDate != today) {
            count = 0
        }
        if (count >= DAILY_BATCH_LIMIT) return false
        prefs.edit()
            .putString(KEY_BUDGET_DATE, today)
            .putInt(KEY_BUDGET_COUNT, count + 1)
            .apply()
        return true
    }

    private fun ensureAuthorCacheLoaded(
        prefs: SharedPreferences,
        nowMs: Long,
    ): MutableMap<String, CachedAuthorEntry> {
        authorCache?.let { return it }
        val loaded = LinkedHashMap<String, CachedAuthorEntry>()
        val raw = prefs.getString(KEY_AUTHOR_CACHE, null)
        if (!raw.isNullOrBlank()) {
            runCatching {
                val map = json.decodeFromString<Map<String, CachedAuthorEntry>>(raw)
                for ((k, v) in map) {
                    if (v.expiresAtMs > nowMs) loaded[k] = v
                }
            }
        }
        authorCache = loaded
        return loaded
    }

    private fun pruneAndPersistAuthorCacheLocked(
        prefs: SharedPreferences,
        authors: MutableMap<String, CachedAuthorEntry>,
        nowMs: Long,
    ) {
        val iter = authors.entries.iterator()
        while (iter.hasNext()) {
            if (iter.next().value.expiresAtMs <= nowMs) iter.remove()
        }
        val trimmed: Map<String, CachedAuthorEntry> = if (authors.size > MAX_AUTHOR_CACHE) {
            authors.entries
                .sortedByDescending { it.value.expiresAtMs }
                .take(MAX_AUTHOR_CACHE)
                .associate { it.key to it.value }
        } else {
            authors
        }
        runCatching {
            prefs.edit().putString(KEY_AUTHOR_CACHE, json.encodeToString(trimmed)).apply()
        }
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
