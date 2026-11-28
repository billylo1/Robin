import FirebaseAppCheck
import FirebaseCore
import Foundation

struct FeedQualityPost: Codable, Sendable {
    var id: String
    var handle: String
    var name: String?
    var bio: String?
    var isBlue: Bool?
    var followers: Int?
    var friends: Int?
    var isReply: Bool?
    var isRetweet: Bool?
    var isQuote: Bool?
    var hasMedia: Bool?
    var hashtagCount: Int?
    var mentionCount: Int?
    var charCount: Int?
    var urlDomains: [String]?
    var statusesPerDay: Double?
    var accountAgeDays: Int?
    var defaultProfileImage: Bool?
    var text: String?
    var quotedText: String?
}

struct FeedQualityHiddenItem: Codable, Sendable {
    var id: String
    var handle: String?
    var reason: String
    var accountWide: Bool
}

struct FeedQualityBridgeResponse: Codable, Sendable {
    var keptIds: [String]
    var hidden: [FeedQualityHiddenItem]
    var retryIds: [String] = []
}

actor FeedQualityService {
    static let shared = FeedQualityService()

    private struct CachedTweetVerdict {
        var hidden: FeedQualityHiddenItem?
        var expiresAt: Date
    }

    private struct CachedAuthorEntry: Codable {
        var reason: String
        var expiresAt: TimeInterval
    }

    private struct CachedAuthorStrike: Codable {
        var tweetIds: [String]
        var reason: String
        var expiresAt: TimeInterval
    }

    private struct CloudFunctionRequest: Encodable {
        var posts: [FeedQualityPost]
    }

    private struct CloudFunctionResponse: Decodable {
        var hidden: [FeedQualityHiddenItem]?
    }

    private static let maxTweetCacheCount = 1000
    private static let tweetCacheTTL: TimeInterval = 24 * 60 * 60
    private static let maxAuthorCacheCount = 1000
    private static let authorCacheTTL: TimeInterval = 14 * 24 * 60 * 60
    private static let dailyBatchLimit = 25
    private static let maxConcurrentRequests = 2
    private static let requestTimeout: TimeInterval = 6.0
    private static let strikePromotionReasons: Set<String> = [
        "non_human_aggregator",
        "engagement_bait",
        "ai_slop",
        "unfactual_claim",
    ]

    private static let authorCacheKey = "robin:feedQuality:authorCache:v1"
    private static let authorStrikesKey = "robin:feedQuality:authorStrikes:v1"
    private static let dailyBudgetDateKey = "robin:feedQuality:budgetDate:v1"
    private static let dailyBudgetCountKey = "robin:feedQuality:budgetCount:v1"

    private let defaults: UserDefaults
    private var tweetCache: [String: CachedTweetVerdict] = [:]
    private var tweetCacheOrder: [String] = []
    private var authorCache: [String: CachedAuthorEntry]
    private var authorStrikes: [String: CachedAuthorStrike]
    private var inFlightIds: Set<String> = []
    private var activeRequests = 0

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.authorCache = Self.loadExpiringMap(from: defaults, key: Self.authorCacheKey, expiresAt: \.expiresAt)
        self.authorStrikes = Self.loadExpiringMap(from: defaults, key: Self.authorStrikesKey, expiresAt: \.expiresAt)
    }

    func classifyBatch(_ posts: [FeedQualityPost]) async -> FeedQualityBridgeResponse {
        let now = Date()
        let ts = now.timeIntervalSince1970
        var hidden: [FeedQualityHiddenItem] = []
        var keptIds: [String] = []
        var uncached: [FeedQualityPost] = []

        for post in posts {
            let handleKey = post.handle.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()

            // Tier 0a: Persistent 14-day author-reputation cache
            if !handleKey.isEmpty, let authorEntry = authorCache[handleKey] {
                if authorEntry.expiresAt > ts {
                    hidden.append(FeedQualityHiddenItem(
                        id: post.id,
                        handle: post.handle,
                        reason: authorEntry.reason,
                        accountWide: true
                    ))
                    continue
                } else {
                    authorCache.removeValue(forKey: handleKey)
                }
            }

            // Tier 0b: In-memory 24h tweet cache
            if let cached = tweetCache[post.id] {
                if cached.expiresAt > now {
                    if let h = cached.hidden {
                        hidden.append(h)
                    } else {
                        keptIds.append(post.id)
                    }
                    continue
                } else {
                    tweetCache.removeValue(forKey: post.id)
                }
            }

            if !inFlightIds.contains(post.id) {
                uncached.append(post)
            }
        }

        guard !uncached.isEmpty else {
            NSLog("FeedQuality: batch=%d cachedHidden=%d cachedKept=%d uncached=0", posts.count, hidden.count, keptIds.count)
            return FeedQualityBridgeResponse(keptIds: keptIds, hidden: hidden)
        }

        // Daily cap exhausted: stay at Tier 1 for today without scheduling retries.
        guard hasDailyBudget(now: now) else {
            NSLog("FeedQuality: daily budget reached (uncached=%d)", uncached.count)
            return FeedQualityBridgeResponse(keptIds: keptIds, hidden: hidden)
        }

        let batchIds = uncached.map(\.id)
        guard activeRequests < Self.maxConcurrentRequests,
              let endpointURL = Self.endpointURL() else {
            NSLog("FeedQuality: skipped network (active=%d, uncached=%d) -> retryable", activeRequests, uncached.count)
            return FeedQualityBridgeResponse(keptIds: keptIds, hidden: hidden, retryIds: batchIds)
        }

        for id in batchIds { inFlightIds.insert(id) }
        activeRequests += 1
        defer {
            activeRequests = max(0, activeRequests - 1)
            for id in batchIds { inFlightIds.remove(id) }
        }

        let started = ContinuousClock.now
        var retryIds: [String] = []
        do {
            // Fetch App Check token before consuming daily budget.
            let appCheckToken = try await AppCheck.appCheck().token(forcingRefresh: false)
            var request = URLRequest(url: endpointURL)
            request.httpMethod = "POST"
            request.timeoutInterval = Self.requestTimeout
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue(appCheckToken.token, forHTTPHeaderField: "X-Firebase-AppCheck")
            request.httpBody = try JSONEncoder().encode(CloudFunctionRequest(posts: uncached))

            recordDailyBudgetUse(now: now)

            let (data, response) = try await URLSession.shared.data(for: request)
            let elapsedMs = Int(started.duration(to: .now).components.seconds * 1000)
                + Int(started.duration(to: .now).components.attoseconds / 1_000_000_000_000_000)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                let code = (response as? HTTPURLResponse)?.statusCode ?? -1
                NSLog("FeedQuality: HTTP %d from %@ in %d ms (uncached=%d) -> retryable", code, endpointURL.absoluteString, elapsedMs, uncached.count)
                return FeedQualityBridgeResponse(keptIds: keptIds, hidden: hidden, retryIds: batchIds)
            }

            let decoded = try JSONDecoder().decode(CloudFunctionResponse.self, from: data)
            let remoteHidden = decoded.hidden ?? []
            var hiddenById: [String: FeedQualityHiddenItem] = [:]
            var resolvedHidden: [FeedQualityHiddenItem] = []
            var authorCacheDirty = false
            var strikesDirty = false
            let expiry = ts + Self.authorCacheTTL

            for rawItem in remoteHidden {
                var resolved = rawItem
                let key = (rawItem.handle ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()

                if rawItem.accountWide, !key.isEmpty {
                    authorCache[key] = CachedAuthorEntry(reason: rawItem.reason, expiresAt: expiry)
                    if authorStrikes.removeValue(forKey: key) != nil {
                        strikesDirty = true
                    }
                    authorCacheDirty = true
                } else if !key.isEmpty, Self.strikePromotionReasons.contains(rawItem.reason) {
                    var strike = authorStrikes[key]
                    if let existing = strike, existing.expiresAt <= ts {
                        strike = nil
                    }
                    var updated = strike ?? CachedAuthorStrike(tweetIds: [], reason: rawItem.reason, expiresAt: expiry)
                    if !updated.tweetIds.contains(rawItem.id) {
                        updated.tweetIds.append(rawItem.id)
                    }
                    updated.reason = rawItem.reason
                    updated.expiresAt = expiry
                    strikesDirty = true

                    if updated.tweetIds.count >= 2 {
                        authorCache[key] = CachedAuthorEntry(reason: rawItem.reason, expiresAt: expiry)
                        authorStrikes.removeValue(forKey: key)
                        authorCacheDirty = true
                        resolved.accountWide = true
                    } else {
                        authorStrikes[key] = updated
                    }
                }

                hiddenById[resolved.id] = resolved
                hidden.append(resolved)
                resolvedHidden.append(resolved)
            }

            for post in uncached {
                if let h = hiddenById[post.id] {
                    rememberTweet(id: post.id, hidden: h, now: now)
                } else {
                    keptIds.append(post.id)
                    rememberTweet(id: post.id, hidden: nil, now: now)
                }
            }

            if authorCacheDirty {
                authorCache = Self.pruneAndPersistExpiringMap(
                    authorCache,
                    defaults: defaults,
                    key: Self.authorCacheKey,
                    nowTs: ts,
                    expiresAt: \.expiresAt
                )
            }
            if strikesDirty {
                authorStrikes = Self.pruneAndPersistExpiringMap(
                    authorStrikes,
                    defaults: defaults,
                    key: Self.authorStrikesKey,
                    nowTs: ts,
                    expiresAt: \.expiresAt
                )
            }

            let summary = resolvedHidden.map { "@\($0.handle ?? "?")(\($0.reason)\($0.accountWide ? ",acct" : ""))" }.joined(separator: ", ")
            NSLog("FeedQuality: AI classified %d posts in %d ms -> hidden=%d [%@]", uncached.count, elapsedMs, resolvedHidden.count, summary)
        } catch {
            NSLog("FeedQuality: AI call failed (retryable, fallback to local): %@", error.localizedDescription)
            retryIds = batchIds
        }

        return FeedQualityBridgeResponse(keptIds: keptIds, hidden: hidden, retryIds: retryIds)
    }

    func clearCaches() {
        tweetCache.removeAll()
        tweetCacheOrder.removeAll()
        authorCache.removeAll()
        authorStrikes.removeAll()
        defaults.removeObject(forKey: Self.authorCacheKey)
        defaults.removeObject(forKey: Self.authorStrikesKey)
    }

    private func rememberTweet(id: String, hidden: FeedQualityHiddenItem?, now: Date) {
        if tweetCache[id] == nil {
            tweetCacheOrder.append(id)
            if tweetCacheOrder.count > Self.maxTweetCacheCount {
                let oldest = tweetCacheOrder.removeFirst()
                tweetCache.removeValue(forKey: oldest)
            }
        }
        tweetCache[id] = CachedTweetVerdict(
            hidden: hidden,
            expiresAt: now.addingTimeInterval(Self.tweetCacheTTL)
        )
    }

    private static func dayString(from now: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar.current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: now)
    }

    private func hasDailyBudget(now: Date) -> Bool {
        let today = Self.dayString(from: now)
        let storedDate = defaults.string(forKey: Self.dailyBudgetDateKey)
        if storedDate != today {
            return true
        }
        return defaults.integer(forKey: Self.dailyBudgetCountKey) < Self.dailyBatchLimit
    }

    private func recordDailyBudgetUse(now: Date) {
        let today = Self.dayString(from: now)
        let storedDate = defaults.string(forKey: Self.dailyBudgetDateKey)
        var count = defaults.integer(forKey: Self.dailyBudgetCountKey)
        if storedDate != today {
            count = 0
            defaults.set(today, forKey: Self.dailyBudgetDateKey)
        }
        defaults.set(count + 1, forKey: Self.dailyBudgetCountKey)
    }

    private static func pruneAndPersistExpiringMap<T: Encodable>(
        _ map: [String: T],
        defaults: UserDefaults,
        key: String,
        nowTs: TimeInterval,
        expiresAt: (T) -> TimeInterval
    ) -> [String: T] {
        var pruned = map.filter { expiresAt($0.value) > nowTs }
        if pruned.count > Self.maxAuthorCacheCount {
            let sorted = pruned.sorted { expiresAt($0.value) > expiresAt($1.value) }
            pruned = Dictionary(uniqueKeysWithValues: Array(sorted.prefix(Self.maxAuthorCacheCount)))
        }
        if let data = try? JSONEncoder().encode(pruned) {
            defaults.set(data, forKey: key)
        }
        return pruned
    }

    private static func loadExpiringMap<T: Decodable>(
        from defaults: UserDefaults,
        key: String,
        expiresAt: (T) -> TimeInterval
    ) -> [String: T] {
        guard let data = defaults.data(forKey: key),
              let decoded = try? JSONDecoder().decode([String: T].self, from: data) else {
            return [:]
        }
        let ts = Date().timeIntervalSince1970
        return decoded.filter { expiresAt($0.value) > ts }
    }

    private static func endpointURL() -> URL? {
        guard let projectID = FirebaseApp.app()?.options.projectID,
              !projectID.isEmpty else {
            return nil
        }
        return URL(string: "https://us-central1-\(projectID).cloudfunctions.net/classifyForYouFeed")
    }
}
