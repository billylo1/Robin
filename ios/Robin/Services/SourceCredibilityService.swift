import Foundation

/// Human-curated Media Bias/Fact Check (MBFC) rating for a news/source domain.
struct SourceCredibilityRating: Hashable, Sendable {
    var sourceName: String
    var bias: String
    var factualReporting: String
    var credibility: String
    var mediaType: String
    var mbfcURL: String
    var sourceURL: String

    /// Bias to show in the Fact Check sheet. Center / center-left / center-right are omitted.
    var displayBias: String? {
        let normalized = bias
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: " ", with: "-")
        guard !normalized.isEmpty else { return nil }
        let hidden: Set<String> = [
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
        ]
        if hidden.contains(normalized) { return nil }
        return bias.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

/// Loads MBFC ratings from the same public mirror Simplifier uses and matches by page host.
enum SourceCredibilityService {
    private static let feedURL = URL(string: "https://evergreen-labs.org/assets/factcheck.json")!
    private static let cacheTTL: TimeInterval = 24 * 60 * 60

    private actor Cache {
        var index: [String: SourceCredibilityRating]?
        var cachedAt: Date?

        func freshIndex(ttl: TimeInterval) -> [String: SourceCredibilityRating]? {
            guard let index, let cachedAt else { return nil }
            guard Date().timeIntervalSince(cachedAt) < ttl else { return nil }
            return index
        }

        func store(_ index: [String: SourceCredibilityRating]) {
            self.index = index
            cachedAt = Date()
        }

        func staleIndex() -> [String: SourceCredibilityRating]? {
            index
        }
    }

    private static let cache = Cache()

    /// Look up an MBFC rating for the page URL’s host. Returns nil on miss or fetch failure.
    static func rating(for pageURL: URL) async -> SourceCredibilityRating? {
        guard let host = normalizedHost(pageURL.host) else { return nil }
        guard let index = await loadIndex() else { return nil }
        return match(host: host, in: index)
    }

    /// Prompt fragment: matched rating, or short generic guidelines when unmatched.
    static func promptFragment(for rating: SourceCredibilityRating?) -> String {
        if let rating {
            var lines = [
                "",
                "CREDIBILITY RATING FOR THIS SOURCE (Media Bias/Fact Check):",
                "Source: \(rating.sourceName)",
            ]
            if !rating.bias.isEmpty {
                lines.append("Bias: \(rating.bias)")
            }
            if !rating.factualReporting.isEmpty {
                lines.append("Factual Reporting: \(rating.factualReporting)")
            }
            if !rating.credibility.isEmpty {
                lines.append("Credibility: \(rating.credibility)")
            }
            if !rating.mediaType.isEmpty {
                lines.append("Media Type: \(rating.mediaType)")
            }
            lines.append(
                "Use this human-curated source rating only as light background about the publisher. Do NOT fact-check, score, or write findings about the publisher's reputation, bias, or credibility. Verify the specific claims in the post or selection with search evidence; do not score from the rating alone."
            )
            return lines.joined(separator: "\n")
        }
        return """

        CREDIBILITY ASSESSMENT GUIDELINES:
        Fact-check the claims in the content (events, figures, quotes), not the publisher's brand.
        When evaluating those claims, consider:
        1. Corroboration from independent reliable sources
        2. Factual accuracy and evidence for each claim
        3. Missing context or misleading framing in the content
        4. Consistency with established reporting on the same events
        """
    }

    // MARK: - Matching

    private static func match(
        host: String,
        in index: [String: SourceCredibilityRating]
    ) -> SourceCredibilityRating? {
        let labels = host.split(separator: ".").map(String.init)
        guard labels.count >= 2 else {
            return index[host]
        }
        // Longest domain first: edition.cnn.com → cnn.com → com
        for i in 0..<(labels.count - 1) {
            let candidate = labels[i...].joined(separator: ".")
            if let rating = index[candidate] {
                return rating
            }
        }
        return nil
    }

    static func normalizedHost(_ raw: String?) -> String? {
        guard var host = raw?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
              !host.isEmpty
        else { return nil }
        if host.hasPrefix("www.") {
            host = String(host.dropFirst(4))
        }
        return host
    }

    // MARK: - Fetch / cache

    private static func loadIndex() async -> [String: SourceCredibilityRating]? {
        if let cached = await cache.freshIndex(ttl: cacheTTL) {
            return cached
        }
        do {
            let (data, response) = try await URLSession.shared.data(from: feedURL)
            if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
                return await cache.staleIndex()
            }
            // Hosted file may include a UTF-8 BOM.
            let jsonData: Data = {
                if data.starts(with: [0xEF, 0xBB, 0xBF]) {
                    return data.dropFirst(3)
                }
                return data
            }()
            let rows = try JSONDecoder().decode([MBFCRow].self, from: jsonData)
            var index: [String: SourceCredibilityRating] = [:]
            index.reserveCapacity(rows.count)
            for row in rows {
                guard let key = normalizedHost(row.sourceURL), !key.isEmpty else { continue }
                let rating = SourceCredibilityRating(
                    sourceName: row.source.trimmingCharacters(in: .whitespacesAndNewlines),
                    bias: row.bias.trimmingCharacters(in: .whitespacesAndNewlines),
                    factualReporting: row.factualReporting.trimmingCharacters(in: .whitespacesAndNewlines),
                    credibility: row.credibility.trimmingCharacters(in: .whitespacesAndNewlines),
                    mediaType: row.mediaType.trimmingCharacters(in: .whitespacesAndNewlines),
                    mbfcURL: row.mbfcURL.trimmingCharacters(in: .whitespacesAndNewlines),
                    sourceURL: key
                )
                if let existing = index[key], existing.sourceURL.count > key.count {
                    continue
                }
                index[key] = rating
            }
            await cache.store(index)
            return index
        } catch {
            print("SourceCredibilityService: fetch failed — \(error.localizedDescription)")
            return await cache.staleIndex()
        }
    }

    private struct MBFCRow: Decodable {
        var source: String
        var mbfcURL: String
        var bias: String
        var factualReporting: String
        var mediaType: String
        var sourceURL: String
        var credibility: String

        enum CodingKeys: String, CodingKey {
            case source = "Source"
            case mbfcURL = "MBFC URL"
            case bias = "Bias"
            case factualReporting = "Factual Reporting"
            case mediaType = "Media Type"
            case sourceURL = "Source URL"
            case credibility = "Credibility"
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            source = try container.decodeIfPresent(String.self, forKey: .source) ?? ""
            mbfcURL = try container.decodeIfPresent(String.self, forKey: .mbfcURL) ?? ""
            bias = try container.decodeIfPresent(String.self, forKey: .bias) ?? ""
            factualReporting = try container.decodeIfPresent(String.self, forKey: .factualReporting) ?? ""
            mediaType = try container.decodeIfPresent(String.self, forKey: .mediaType) ?? ""
            sourceURL = try container.decodeIfPresent(String.self, forKey: .sourceURL) ?? ""
            credibility = try container.decodeIfPresent(String.self, forKey: .credibility) ?? ""
        }
    }
}
