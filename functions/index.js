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
const ACCOUNT_WIDE_THRESHOLD = 0.80;

const CATEGORY_CRITERIA = {
  keep:
    "Original human author sharing firsthand thoughts, work, engineering demos, research, news analysis, personal stories, or substantive commentary.",
  non_human_aggregator:
    "Content mill, automated news/clip repost farm, scraper ('by @...', 'via @...'), hashtag-stuffed repost account, or bot/parody account repackaging others' content.",
  engagement_bait:
    "Clickbait or rage-bait hook, DM/comment/bookmark/follow farming ('Comment X and I'll DM', 'Wrong answers only', sensationalist viral hooks designed solely for clicks).",
  useless_comment:
    "Zero-substance hype reply, empty quote-tweet, or filler reaction ('This.', '100%', 'Insane launch!', 'LFG', 'Huge if true') adding no real information or perspective.",
  ai_slop:
    "Formulaic, obviously LLM-generated engagement copy or generic hustle/corporate platitudes lacking genuine human specificity.",
};

function clampText(value, maxLen) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLen);
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
    text: clampText(String(raw.text || ""), 400),
    quotedText: clampText(String(raw.quotedText || ""), 160),
  };
}

function buildDecisionRequest(posts) {
  const lines = [
    "You are classifying X (Twitter) posts from an algorithmic 'For You' feed.",
    "Preserve original human authors sharing real work, ideas, demos, or substantive commentary.",
    "Flag non-human aggregators/repost farms, engagement bait, useless zero-substance comments, and AI slop.",
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
    if (p.followers !== null) flags.push(`followers=${p.followers}`);
    if (p.friends !== null) flags.push(`following=${p.friends}`);

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
      instructions: `Is the author of post [${tag}] (@${p.handle || "unknown"}) clearly a non-human account, automated bot, clip/news aggregator, or content-mill whose future posts should also be hidden?`,
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
    if (!cls) continue;

    const choice = cls.choice || "";
    const probs = cls.probabilities || cls.scores || {};
    const keepProb =
      typeof probs.keep === "number"
        ? probs.keep
        : choice === "keep"
        ? 1
        : 0;

    if (choice && choice !== "keep" && keepProb < KEEP_PROB_HIDE_THRESHOLD) {
      const accountWide = Boolean(
        acct && typeof acct.noul === "number" && acct.noul >= ACCOUNT_WIDE_THRESHOLD
      );
      hidden.push({
        id: p.id,
        handle: p.handle,
        reason: choice,
        accountWide,
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
  KEEP_PROB_HIDE_THRESHOLD,
  ACCOUNT_WIDE_THRESHOLD,
};
