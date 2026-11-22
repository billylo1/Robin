"use strict";

const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp, getApps } = require("firebase-admin/app");
const { getAppCheck } = require("firebase-admin/app-check");

if (!getApps().length) {
  initializeApp();
}

const geminiApiKey = defineSecret("GEMINI_API_KEY");

const DECISION_MODEL = "gemini-decision-1";
const DECISIONS_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/decisions";
const MAX_POSTS_PER_BATCH = 20;
const KEEP_PROB_HIDE_THRESHOLD = 0.35;
const ACCOUNT_WIDE_THRESHOLD = 0.85;
const UNFACTUAL_HIDE_THRESHOLD = 0.80;
const INVALID_ARGUMENT_HIDE_THRESHOLD = 0.85;
const CATEGORY_KEEP_THRESHOLDS = {
  non_human_aggregator: 0.35,
  engagement_bait: 0.35,
  ai_slop: 0.22,
  useless_comment: 0.20,
};

const CATEGORY_CRITERIA = {
  keep:
    "Original human author sharing firsthand thoughts, work, engineering demos, research, paper/news analysis with real substance or sources, personal stories, or grounded commentary (including enthusiastic praise or questions when accompanied by real technical or domain substance).",
  non_human_aggregator:
    "Content mill, automated news/clip repost farm, scraper ('by @...', 'via @...'), high-volume repost/curated-clip account, or bot/parody account primarily repackaging others' content without original analysis.",
  engagement_bait:
    "Clickbait or rage-bait hook, DM/comment/bookmark/follow farming ('Comment X and I'll DM', 'Wrong answers only', sensationalist viral hooks designed solely to farm clicks or outrage).",
  useless_comment:
    "Zero-substance hype reply, empty quote-tweet, or pure filler reaction ('This.', '100%', 'LFG', 'Huge if true') that adds no real information, domain context, or perspective.",
  ai_slop:
    "Formulaic, obviously LLM-generated engagement copy, recycled LinkedIn-style hustle/corporate platitudes, or generic summary threads lacking genuine human voice or firsthand specificity.",
};

function clampText(value, maxLen) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLen);
}

function sampleText(value, maxLen, headLen, tailLen) {
  if (typeof value !== "string") return "";
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  const head = clean.slice(0, headLen).trimEnd();
  const tail = clean.slice(clean.length - tailLen).trimStart();
  return `${head} [...] ${tail}`;
}

function sanitizeDomains(raw) {
  if (!Array.isArray(raw)) return [];
  const excluded = new Set(["t.co", "x.com", "twitter.com", "pic.twitter.com", "pic.x.com"]);
  const out = [];
  for (let i = 0; i < raw.length && out.length < 3; i++) {
    const d = clampText(String(raw[i] || "").toLowerCase(), 60).replace(/^www\./, "");
    if (!d || excluded.has(d) || out.includes(d)) continue;
    out.push(d);
  }
  return out;
}

function sanitizePost(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = clampText(String(raw.id || ""), 40);
  if (!id || !/^\d+$/.test(id)) return null;
  return {
    id,
    handle: clampText(String(raw.handle || ""), 50),
    name: clampText(String(raw.name || ""), 80),
    bio: clampText(String(raw.bio || ""), 120),
    isBlue: Boolean(raw.isBlue),
    followers: Number.isFinite(raw.followers) ? Math.max(0, Math.floor(raw.followers)) : null,
    friends: Number.isFinite(raw.friends) ? Math.max(0, Math.floor(raw.friends)) : null,
    isReply: Boolean(raw.isReply),
    isRetweet: Boolean(raw.isRetweet),
    isQuote: Boolean(raw.isQuote),
    hasMedia: Boolean(raw.hasMedia),
    hashtagCount: Number.isFinite(raw.hashtagCount) ? Math.max(0, Math.floor(raw.hashtagCount)) : 0,
    mentionCount: Number.isFinite(raw.mentionCount) ? Math.max(0, Math.floor(raw.mentionCount)) : 0,
    charCount: Number.isFinite(raw.charCount) ? Math.max(0, Math.floor(raw.charCount)) : null,
    urlDomains: sanitizeDomains(raw.urlDomains),
    statusesPerDay: Number.isFinite(raw.statusesPerDay)
      ? Math.max(0, Math.round(raw.statusesPerDay * 10) / 10)
      : null,
    accountAgeDays: Number.isFinite(raw.accountAgeDays)
      ? Math.max(0, Math.floor(raw.accountAgeDays))
      : null,
    text: sampleText(String(raw.text || ""), 460, 290, 160),
    quotedText: sampleText(String(raw.quotedText || ""), 180, 110, 60),
  };
}

function buildDecisionRequest(posts) {
  const lines = [
    "You are evaluating X (Twitter) posts from an algorithmic 'For You' feed for author quality, factual credibility, and argument validity.",
    "Preserve original human authors sharing real work, ideas, demos, legitimate opinions, skeptical questions, or humor/satire.",
    "Flag non-human aggregators/repost farms, engagement bait, useless zero-substance comments, AI slop, demonstrably unfactual/misleading claims, and clearly fallacious or bad-faith arguments.",
    "Do NOT penalize unfamiliar recent news, new tech/paper releases, personal anecdotes, or reasonable debates as unfactual or invalid.",
    "",
  ];
  const questions = {};

  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    const tag = `P${i}`;
    const flags = [];
    if (p.isBlue) flags.push("blue");
    if (p.isReply) flags.push("reply");
    if (p.isRetweet) flags.push("repost");
    if (p.isQuote) flags.push("quote");
    if (p.hasMedia) flags.push("media");
    if (p.hashtagCount > 0) flags.push(`hashtags=${p.hashtagCount}`);
    if (p.mentionCount > 0) flags.push(`mentions=${p.mentionCount}`);
    if (p.charCount !== null && p.charCount !== undefined) flags.push(`chars=${p.charCount}`);
    if (p.followers !== null && p.followers !== undefined) flags.push(`followers=${p.followers}`);
    if (p.friends !== null && p.friends !== undefined) flags.push(`following=${p.friends}`);
    if (p.statusesPerDay !== null && p.statusesPerDay !== undefined) {
      flags.push(`posts/day=${p.statusesPerDay}`);
    }
    if (p.accountAgeDays !== null && p.accountAgeDays !== undefined && p.accountAgeDays < 365) {
      flags.push(`age=${p.accountAgeDays}d`);
    }
    if (Array.isArray(p.urlDomains) && p.urlDomains.length > 0) {
      flags.push(`links=${p.urlDomains.join(",")}`);
    }

    lines.push(`[${tag}] @${p.handle || "unknown"} (${p.name || ""}) [${flags.join(", ")}]`);
    if (p.bio) lines.push(`Bio: ${p.bio}`);
    if (p.text) lines.push(`Text: ${p.text}`);
    if (p.quotedText) lines.push(`Quoted: ${p.quotedText}`);
    lines.push("");

    questions[`p${i}_class`] = {
      type: "choice",
      instructions: `Classify post [${tag}] by @${p.handle || "unknown"}. Choose 'keep' unless it is clearly low-quality noise.`,
      criteria: CATEGORY_CRITERIA,
    };
    questions[`p${i}_account_wide`] = {
      type: "noul",
      instructions: `Is the author of post [${tag}] (@${p.handle || "unknown"}) clearly a non-human account, automated bot, viral clip/news aggregator, or repost content-mill (NOT an individual human author) whose future posts should always be hidden?`,
    };
    questions[`p${i}_unfactual`] = {
      type: "noul",
      instructions: `Does post [${tag}] make a demonstrably false, pseudoscientific, fabricated, scammy, or grossly misleading factual claim? Answer NO for unfamiliar recent news/releases, personal anecdotes, legitimate opinions/debates, skeptical questions, or obvious jokes/sarcasm; answer YES only when the factual claim itself is clearly false, debunked, or deceptive.`,
    };
    questions[`p${i}_bad_argument`] = {
      type: "noul",
      instructions: `Does post [${tag}] rely on a clearly invalid, logically fallacious, or intellectually dishonest argument (e.g., sweeping hasty generalization, blatant strawman, absurd non-sequitur, fabricated statistics, or manipulative fear/miracle-cure logic)? Answer NO for casual updates, demos, obvious jokes/hyperbole, skeptical questions, or reasonable opinionated takes; answer YES only for clearly flawed, bad-faith, or manipulative reasoning.`,
    };
  }

  return {
    model: DECISION_MODEL,
    input: lines.join("\n"),
    questions,
  };
}

function parseDecisionVerdicts(posts, apiResponse) {
  const answers = (apiResponse && apiResponse.answers) || {};
  const hidden = [];

  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    const cls = answers[`p${i}_class`];
    const acct = answers[`p${i}_account_wide`];
    const unfactual = answers[`p${i}_unfactual`];
    const badArg = answers[`p${i}_bad_argument`];
    if (!cls && !unfactual && !badArg) continue;

    const choice = (cls && cls.choice) || "keep";
    const probs = (cls && (cls.probabilities || cls.scores)) || {};
    const keepProb =
      typeof probs.keep === "number"
        ? probs.keep
        : choice === "keep"
        ? 1
        : 0;
    const threshold =
      Object.prototype.hasOwnProperty.call(CATEGORY_KEEP_THRESHOLDS, choice)
        ? CATEGORY_KEEP_THRESHOLDS[choice]
        : 0.30;
    const slopHide = Boolean(cls && choice && choice !== "keep" && keepProb < threshold);
    const unfactualProb = unfactual && typeof unfactual.noul === "number" ? unfactual.noul : 0;
    const badArgProb = badArg && typeof badArg.noul === "number" ? badArg.noul : 0;

    if (slopHide) {
      const accountWide = Boolean(
        choice === "non_human_aggregator" &&
          acct &&
          typeof acct.noul === "number" &&
          acct.noul >= ACCOUNT_WIDE_THRESHOLD
      );
      hidden.push({
        id: p.id,
        handle: p.handle,
        reason: choice,
        accountWide,
      });
    } else if (unfactualProb >= UNFACTUAL_HIDE_THRESHOLD) {
      hidden.push({
        id: p.id,
        handle: p.handle,
        reason: "unfactual_claim",
        accountWide: false,
      });
    } else if (badArgProb >= INVALID_ARGUMENT_HIDE_THRESHOLD) {
      hidden.push({
        id: p.id,
        handle: p.handle,
        reason: "invalid_argument",
        accountWide: false,
      });
    }
  }

  return hidden;
}

exports.classifyForYouFeed = onRequest(
  {
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 15,
    maxInstances: 50,
    secrets: [geminiApiKey],
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const appCheckToken = req.header("X-Firebase-AppCheck");
    if (!appCheckToken) {
      res.status(401).json({ error: "Missing App Check token" });
      return;
    }

    try {
      await getAppCheck().verifyToken(appCheckToken);
    } catch (err) {
      res.status(401).json({ error: "Invalid App Check token" });
      return;
    }

    const rawPosts = req.body && Array.isArray(req.body.posts) ? req.body.posts : null;
    if (!rawPosts || rawPosts.length === 0) {
      res.status(200).json({ hidden: [] });
      return;
    }

    const posts = [];
    for (let i = 0; i < rawPosts.length && posts.length < MAX_POSTS_PER_BATCH; i++) {
      const clean = sanitizePost(rawPosts[i]);
      if (clean && (clean.text || clean.quotedText)) {
        posts.push(clean);
      }
    }

    if (posts.length === 0) {
      res.status(200).json({ hidden: [] });
      return;
    }

    const apiKey = geminiApiKey.value();
    if (!apiKey) {
      res.status(503).json({ error: "Service not configured" });
      return;
    }

    try {
      const payload = buildDecisionRequest(posts);
      const upstream = await fetch(DECISIONS_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(payload),
      });

      if (!upstream.ok) {
        const errText = await upstream.text().catch(() => "");
        console.error(
          `Decisions API error ${upstream.status}: ${errText.slice(0, 300)}`
        );
        res.status(502).json({ error: "Upstream decision service error", hidden: [] });
        return;
      }

      const data = await upstream.json();
      const hidden = parseDecisionVerdicts(posts, data);
      res.status(200).json({ hidden });
    } catch (err) {
      console.error("classifyForYouFeed failed:", err && err.message ? err.message : err);
      res.status(500).json({ error: "Classification failed", hidden: [] });
    }
  }
);

exports._internal = {
  buildDecisionRequest,
  parseDecisionVerdicts,
  sanitizePost,
  sampleText,
  CATEGORY_CRITERIA,
  CATEGORY_KEEP_THRESHOLDS,
  KEEP_PROB_HIDE_THRESHOLD,
  ACCOUNT_WIDE_THRESHOLD,
  UNFACTUAL_HIDE_THRESHOLD,
  INVALID_ARGUMENT_HIDE_THRESHOLD,
};
