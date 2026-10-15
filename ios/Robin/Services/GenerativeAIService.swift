import FirebaseAILogic
import Foundation

struct FactCheckSource: Identifiable, Hashable, Codable, Sendable {
    var id: String { url }
    var title: String
    var url: String
}

enum FactCheckFindingStatus: String, Hashable, Codable, Sendable, CaseIterable {
    case verified
    case partiallyVerified = "partially_verified"
    case unverified
    case falseMisleading = "false_misleading"

    var displayLabel: String {
        switch self {
        case .verified: return "Verified"
        case .partiallyVerified: return "Partially verified"
        case .unverified: return "Unverified"
        case .falseMisleading: return "False / misleading"
        }
    }

    static func normalize(_ raw: String) -> FactCheckFindingStatus {
        let key = raw
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: " ", with: "_")
            .replacingOccurrences(of: "-", with: "_")
            .replacingOccurrences(of: "/", with: "_")
        switch key {
        case "verified", "true", "supported":
            return .verified
        case "partially_verified", "partial", "partially_verified_", "partiallyverified":
            return .partiallyVerified
        case "unverified", "unknown", "insufficient":
            return .unverified
        case "false_misleading", "false", "misleading", "false_misleading_":
            return .falseMisleading
        default:
            if key.contains("partial") { return .partiallyVerified }
            if key.contains("false") || key.contains("mislead") { return .falseMisleading }
            if key.contains("unverif") { return .unverified }
            if key.contains("verif") { return .verified }
            return .unverified
        }
    }
}

struct FactCheckFinding: Identifiable, Hashable, Codable, Sendable {
    var id: String { "\(status.rawValue)|\(claim)" }
    var claim: String
    var status: FactCheckFindingStatus
    var note: String
}

struct FactCheckResult: Hashable, Sendable {
    var score: Int
    var verdict: String
    var findings: [FactCheckFinding]
    var justification: [String]
    var sources: [FactCheckSource]
    var searchSuggestionsHTML: String?
    var sourceRating: SourceCredibilityRating? = nil
    var author: String? = nil
    var tweetURL: URL? = nil
}

struct FactCheckOutcome: Sendable {
    var result: FactCheckResult
    var durationMs: Int
    var usedFallback: Bool
    var tools: String
    var responseMode: String
    var modelPreference: String
}

enum GenerativeAIService {
    static let defaultModelPreference: FactCheckModelPreference = .flash
    static var defaultModelName: String { defaultModelPreference.modelName }

    private enum ResponseMode: String {
        case schema
        case jsonPrompt = "json_prompt"
    }

    private static let modeLock = NSLock()
    private static var preferredResponseModeByModel: [String: ResponseMode] = [:]

    private static let defaultFindingCount = 4

    private static let factCheckSchema = Schema.object(
        properties: [
            "score": .integer(
                description: "Credibility score from 1 (false/misleading) to 10 (well-supported)."
            ),
            "verdict": .string(description: "Short label such as Mostly accurate, Misleading, or Mixed."),
            "findings": .array(
                items: .object(
                    properties: [
                        "claim": .string(description: "Short paraphrase of the claim."),
                        "status": .string(
                            description: "One of: verified, partially_verified, unverified, false_misleading."
                        ),
                        "note": .string(description: "One sentence of evidence or caveat."),
                    ]
                ),
                description: "Key claim findings with status labels."
            ),
            "justification": .array(
                items: .string(description: "One concise bullet point."),
                description: "Exactly 3 short bullet points explaining the score."
            ),
            "sources": .array(
                items: .object(
                    properties: [
                        "title": .string(description: "Source title or site name."),
                        "url": .string(description: "Absolute https URL for the source."),
                    ]
                ),
                description: "Independent corroborating sources only — not the tweet permalink or x.com."
            ),
        ]
    )

    private struct FactCheckPayload: Decodable {
        var score: Int
        var verdict: String
        var findings: [FactCheckFindingPayload]?
        var justification: [String]
        var sources: [FactCheckSource]?
    }

    private struct FactCheckFindingPayload: Decodable {
        var claim: String
        var status: String
        var note: String
    }

    static func factCheckTweet(
        text: String,
        author: String?,
        tweetURL: URL?,
        externalLinks: [URL] = [],
        modelPreference: FactCheckModelPreference = defaultModelPreference
    ) async throws -> FactCheckOutcome {
        let started = ContinuousClock.now
        let modelName = modelPreference.modelName
        let cleanText = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanText.isEmpty else {
            throw FactCheckError.emptyContent
        }

        var sourceRating: SourceCredibilityRating? = nil
        for link in externalLinks {
            if let rating = await SourceCredibilityService.rating(for: link) {
                sourceRating = rating
                break
            }
        }

        let prompt = buildTweetFactCheckPrompt(
            text: cleanText,
            author: author,
            tweetURL: tweetURL,
            externalLinks: externalLinks,
            sourceCredibilityContext: SourceCredibilityService.promptFragment(for: sourceRating)
        )

        let tools = [Tool.googleSearch()]
        let toolsLabel = "search"

        let thinkingConfig: ThinkingConfig? = modelPreference.requiresLowThinking
            ? ThinkingConfig(thinkingLevel: .low)
            : nil

        let cachedMode = lockedPreferredMode(for: modelName)
        let modesToTry: [ResponseMode] = {
            if let cachedMode { return [cachedMode] }
            return [.schema, .jsonPrompt]
        }()

        var lastError: Error?
        var usedFallback = false

        for (index, mode) in modesToTry.enumerated() {
            do {
                let response = try await generateFactCheckContent(
                    prompt: prompt,
                    tools: tools,
                    modelName: modelName,
                    thinkingConfig: thinkingConfig,
                    mode: mode
                )
                var result = try parseFactCheckResponse(response, tweetURL: tweetURL)
                result.sourceRating = sourceRating
                result.author = author
                result.tweetURL = tweetURL
                setPreferredMode(mode, for: modelName)
                let ms = Int((ContinuousClock.now - started) / .milliseconds(1))
                return FactCheckOutcome(
                    result: result,
                    durationMs: ms,
                    usedFallback: usedFallback,
                    tools: toolsLabel,
                    responseMode: mode.rawValue,
                    modelPreference: modelPreference.rawValue
                )
            } catch {
                lastError = error
                if modesToTry.count > 1, index == 0 {
                    usedFallback = true
                    continue
                }
                break
            }
        }

        throw FactCheckError.requestFailed(
            message: unwrapGenerateContentError(lastError ?? FactCheckError.emptyResponse)
        )
    }

    private static func generateFactCheckContent(
        prompt: String,
        tools: [Tool],
        modelName: String,
        thinkingConfig: ThinkingConfig?,
        mode: ResponseMode
    ) async throws -> GenerateContentResponse {
        switch mode {
        case .schema:
            let model = FirebaseAI.firebaseAI(backend: .googleAI()).generativeModel(
                modelName: modelName,
                generationConfig: GenerationConfig(
                    responseMIMEType: "application/json",
                    responseSchema: factCheckSchema,
                    thinkingConfig: thinkingConfig
                ),
                tools: tools
            )
            return try await model.generateContent(prompt)
        case .jsonPrompt:
            let model = FirebaseAI.firebaseAI(backend: .googleAI()).generativeModel(
                modelName: modelName,
                generationConfig: GenerationConfig(thinkingConfig: thinkingConfig),
                tools: tools
            )
            return try await model.generateContent(
                prompt + "\n\nRespond with JSON only matching the schema."
            )
        }
    }

    private static func lockedPreferredMode(for modelName: String) -> ResponseMode? {
        modeLock.lock()
        defer { modeLock.unlock() }
        return preferredResponseModeByModel[modelName]
    }

    private static func setPreferredMode(_ mode: ResponseMode, for modelName: String) {
        modeLock.lock()
        preferredResponseModeByModel[modelName] = mode
        modeLock.unlock()
    }

    private static func unwrapGenerateContentError(_ error: Error) -> String {
        guard let generateError = error as? GenerateContentError else {
            return error.localizedDescription
        }
        if case .internalError(let underlying) = generateError {
            return underlying.localizedDescription
        }
        return generateError.localizedDescription
    }

    private static func buildTweetFactCheckPrompt(
        text: String,
        author: String?,
        tweetURL: URL?,
        externalLinks: [URL],
        sourceCredibilityContext: String
    ) -> String {
        let findingCount = defaultFindingCount
        var lines: [String] = [
            "You are a careful, objective fact checker analyzing a social media post on X (formerly Twitter).",
            "Your job is to verify factual claims made in the post (events, numbers, quotes, attributions, purported media content) against independent evidence.",
            "Use Google Search to find reliable, authoritative sources confirming, complicating, or debunking these claims.",
            "",
            "SCORING & FINDINGS:",
            "- Score how well the claims hold up: 1 (false or highly misleading) to 10 (well-supported by solid evidence).",
            "- Score bands: 1-3 mostly false/misleading; 4-6 mixed, unverified, or missing key context; 7-10 mostly accurate / well-supported.",
            "- Findings: return \(findingCount) claim objects. Each finding must include claim (short paraphrase), status (one of: verified, partially_verified, unverified, false_misleading), and note (one sentence of specific evidence or caveat).",
            "- Justification: exactly 3 short bullet points (string array) explaining the score in cautious, provisional language. Avoid definitive adverbs like 'precisely' or 'proven' unless evidence is overwhelming.",
            "- Sources: independent corroborating sources with title and url. Never cite x.com or twitter.com.",
            "- Respond in the language of the post.",
            "",
            "POST UNDER REVIEW:"
        ]
        if let author, !author.isEmpty {
            lines.append("Author: \(author)")
        }
        if let tweetURL {
            lines.append("Tweet Permalink: \(tweetURL.absoluteString)")
        }
        lines.append("Post Text:\n\"\"\"\n\(text)\n\"\"\"")
        if !externalLinks.isEmpty {
            lines.append("Embedded Links in Post:")
            for link in externalLinks {
                lines.append("- \(link.absoluteString)")
            }
        }
        let context = sourceCredibilityContext.trimmingCharacters(in: .whitespacesAndNewlines)
        if !context.isEmpty {
            lines.append("")
            lines.append(context)
        }
        return lines.joined(separator: "\n")
    }

    private static func parseFactCheckResponse(
        _ response: GenerateContentResponse,
        tweetURL: URL?
    ) throws -> FactCheckResult {
        guard let text = response.text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else {
            throw FactCheckError.emptyResponse
        }

        let jsonText = extractJSONObject(from: text)
        guard let data = jsonText.data(using: .utf8) else {
            throw FactCheckError.invalidJSON
        }

        let payload: FactCheckPayload
        do {
            payload = try JSONDecoder().decode(FactCheckPayload.self, from: data)
        } catch {
            throw FactCheckError.invalidJSON
        }

        let score = min(10, max(1, payload.score))
        var sources = (payload.sources ?? []).filter { source in
            !isSocialHost(sourceURL: source.url)
        }

        let grounding = response.candidates.first?.groundingMetadata
        if let grounding {
            for chunk in grounding.groundingChunks {
                guard let web = chunk.web, let uri = web.uri, !uri.isEmpty else { continue }
                if isSocialHost(sourceURL: uri) { continue }
                let title = web.title?.trimmingCharacters(in: .whitespacesAndNewlines)
                let entry = FactCheckSource(
                    title: (title?.isEmpty == false ? title! : uri),
                    url: uri
                )
                if !sources.contains(where: { $0.url == entry.url }) {
                    sources.append(entry)
                }
            }
        }

        let findings = normalizeFindings(payload.findings ?? [])
        let bullets = normalizeJustificationBullets(payload.justification)
        guard !bullets.isEmpty else {
            throw FactCheckError.invalidJSON
        }

        return FactCheckResult(
            score: score,
            verdict: payload.verdict.trimmingCharacters(in: .whitespacesAndNewlines),
            findings: findings,
            justification: bullets,
            sources: sources,
            searchSuggestionsHTML: grounding?.searchEntryPoint?.renderedContent
        )
    }

    private static func isSocialHost(sourceURL: String) -> Bool {
        guard let url = URL(string: sourceURL), let host = url.host?.lowercased() else { return false }
        return host.contains("twitter.com") || host.contains("x.com") || host.contains("t.co")
    }

    private static func normalizeFindings(_ raw: [FactCheckFindingPayload]) -> [FactCheckFinding] {
        let cleaned = raw.compactMap { item -> FactCheckFinding? in
            let claim = item.claim.trimmingCharacters(in: .whitespacesAndNewlines)
            let note = item.note.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !claim.isEmpty else { return nil }
            return FactCheckFinding(
                claim: claim,
                status: FactCheckFindingStatus.normalize(item.status),
                note: note
            )
        }
        return Array(cleaned.prefix(defaultFindingCount))
    }

    private static func normalizeJustificationBullets(_ raw: [String]) -> [String] {
        let cleaned = raw
            .map { bullet in
                var text = bullet.trimmingCharacters(in: .whitespacesAndNewlines)
                while let first = text.first, "•-*–—".contains(first) {
                    text = String(text.dropFirst()).trimmingCharacters(in: .whitespacesAndNewlines)
                }
                if let match = text.range(of: #"^\d+[\.\)]\s*"#, options: .regularExpression) {
                    text = String(text[match.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
                }
                return text
            }
            .filter { !$0.isEmpty }
        return Array(cleaned.prefix(3))
    }

    private static func extractJSONObject(from text: String) -> String {
        if let start = text.firstIndex(of: "{"), let end = text.lastIndex(of: "}") {
            return String(text[start...end])
        }
        return text
    }
}

enum FactCheckError: LocalizedError {
    case emptyContent
    case emptyResponse
    case invalidJSON
    case requestFailed(message: String)

    var errorDescription: String? {
        switch self {
        case .emptyContent:
            return "No text available to fact-check."
        case .emptyResponse:
            return "The fact check returned no content."
        case .invalidJSON:
            return "Could not parse the fact-check response."
        case .requestFailed(let message):
            return message
        }
    }
}
