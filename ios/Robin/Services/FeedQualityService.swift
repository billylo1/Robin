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

    private static let authorCacheKey = "robin:feedQuality:authorCache:v1"
    private static let dailyBudgetDateKey = "robin:feedQuality:budgetDate:v1"
    private static let dailyBudgetCountKey = "robin:feedQuality:budgetCount:v1"

    private let defaults: UserDefaults
    private var tweetCache: [String: CachedTweetVerdict] = [:]
    private var tweetCacheOrder: [String] = []
    private var authorCache: [String: CachedAuthorEntry]
    private var inFlightIds: Set<String> = []
    private var activeRequests = 0

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.authorCache = Self.loadAuthorCache(from: defaults)
    }

    func classifyBatch(_ posts: [FeedQualityPost]) async -> FeedQualityBridgeResponse {
        let now = Date()
        var hidden: [FeedQualityHiddenItem] = []
        var keptIds: [String] = []
        var uncached: [FeedQualityPost] = []

        for post in posts {
            let handleKey = post.handle.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()

            // Tier 0a: Persistent 14-day author-reputation cache
            if !handleKey.isEmpty, let authorEntry = authorCache[handleKey] {
                if authorEntry.expiresAt > now.timeIntervalSince1970 {
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

        // Enforce concurrency & daily budget cap (silent fallback to local heuristics)
        guard activeRequests < Self.maxConcurrentRequests,
              consumeDailyBudgetIfAvailable(now: now),
              let endpointURL = Self.endpointURL() else {
            NSLog("FeedQuality: skipped network (active=%d, uncached=%d)", activeRequests, uncached.count)
            return FeedQualityBridgeResponse(keptIds: keptIds, hidden: hidden)
        }

        let batchIds = uncached.map(\.id)
        for id in batchIds { inFlightIds.insert(id) }
        activeRequests += 1
        defer {
            activeRequests = max(0, activeRequests - 1)
            for id in batchIds { inFlightIds.remove(id) }
        }

        let started = ContinuousClock.now
        do {
            let appCheckToken = try await AppCheck.appCheck().token(forcingRefresh: false)
            var request = URLRequest(url: endpointURL)
            request.httpMethod = "POST"
            request.timeoutInterval = Self.requestTimeout
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue(appCheckToken.token, forHTTPHeaderField: "X-Firebase-AppCheck")
            request.httpBody = try JSONEncoder().encode(CloudFunctionRequest(posts: uncached))

            let (data, response) = try await URLSession.shared.data(for: request)
            let elapsedMs = Int(started.duration(to: .now).components.seconds * 1000)
                + Int(started.duration(to: .now).components.attoseconds / 1_000_000_000_000_000)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                let code = (response as? HTTPURLResponse)?.statusCode ?? -1
                NSLog("FeedQuality: HTTP %d from %@ in %d ms (uncached=%d)", code, endpointURL.absoluteString, elapsedMs, uncached.count)
                return FeedQualityBridgeResponse(keptIds: keptIds, hidden: hidden)
            }

            let decoded = try JSONDecoder().decode(CloudFunctionResponse.self, from: data)
            let remoteHidden = decoded.hidden ?? []
            var hiddenById: [String: FeedQualityHiddenItem] = [:]
            var authorCacheDirty = false

            for item in remoteHidden {
                hiddenById[item.id] = item
                hidden.append(item)
                if item.accountWide, let rawHandle = item.handle, !rawHandle.isEmpty {
                    let key = rawHandle.lowercased()
                    authorCache[key] = CachedAuthorEntry(
                        reason: item.reason,
                        expiresAt: now.timeIntervalSince1970 + Self.authorCacheTTL
                    )
                    authorCacheDirty = true
                }
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
                pruneAndPersistAuthorCache(now: now)
            }

            let summary = remoteHidden.map { "@\($0.handle ?? "?")(\($0.reason)\($0.accountWide ? ",acct" : ""))" }.joined(separator: ", ")
            NSLog("FeedQuality: AI classified %d posts in %d ms -> hidden=%d [%@]", uncached.count, elapsedMs, remoteHidden.count, summary)
        } catch {
            NSLog("FeedQuality: AI call failed (fallback to local): %@", error.localizedDescription)
        }

        return FeedQualityBridgeResponse(keptIds: keptIds, hidden: hidden)
    }

    func clearCaches() {
        tweetCache.removeAll()
        tweetCacheOrder.removeAll()
        authorCache.removeAll()
        defaults.removeObject(forKey: Self.authorCacheKey)
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

    private func consumeDailyBudgetIfAvailable(now: Date) -> Bool {
        let formatter = DateFormatter()
        formatter.calendar = Calendar.current
        formatter.dateFormat = "yyyy-MM-dd"
        let today = formatter.string(from: now)

        let storedDate = defaults.string(forKey: Self.dailyBudgetDateKey)
        var count = defaults.integer(forKey: Self.dailyBudgetCountKey)
        if storedDate != today {
            count = 0
            defaults.set(today, forKey: Self.dailyBudgetDateKey)
        }
        guard count < Self.dailyBatchLimit else { return false }
        defaults.set(count + 1, forKey: Self.dailyBudgetCountKey)
        return true
    }

    private func pruneAndPersistAuthorCache(now: Date) {
        let ts = now.timeIntervalSince1970
        authorCache = authorCache.filter { $0.value.expiresAt > ts }
        if authorCache.count > Self.maxAuthorCacheCount {
            let sorted = authorCache.sorted { $0.value.expiresAt > $1.value.expiresAt }
            authorCache = Dictionary(uniqueKeysWithValues: Array(sorted.prefix(Self.maxAuthorCacheCount)))
        }
        if let data = try? JSONEncoder().encode(authorCache) {
            defaults.set(data, forKey: Self.authorCacheKey)
        }
    }

    private static func loadAuthorCache(from defaults: UserDefaults) -> [String: CachedAuthorEntry] {
        guard let data = defaults.data(forKey: authorCacheKey),
              let decoded = try? JSONDecoder().decode([String: CachedAuthorEntry].self, from: data) else {
            return [:]
        }
        let ts = Date().timeIntervalSince1970
        return decoded.filter { $0.value.expiresAt > ts }
    }

    private static func endpointURL() -> URL? {
        guard let projectID = FirebaseApp.app()?.options.projectID,
              !projectID.isEmpty else {
            return nil
        }
        return URL(string: "https://us-central1-\(projectID).cloudfunctions.net/classifyForYouFeed")
    }
}
