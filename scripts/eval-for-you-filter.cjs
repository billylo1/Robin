#!/usr/bin/env node
/**
 * Offline evaluation harness for Robin's For You Quality Filter.
 * Runs Tier 1 local heuristics + Tier 2 Gemini Decisions API (`gemini-decision-1`)
 * on real For You posts from scripts/feed-credibility/out/feeds.json.
 *
 * Usage:
 *   GEMINI_API_KEY=... node scripts/eval-for-you-filter.cjs
 */

"use strict";

const fs = require("fs");
const path = require("path");

const FEEDS_PATH = path.resolve(
  __dirname,
  "feed-credibility/out/feeds.json"
);
const DECISIONS_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/decisions";
const DECISION_MODEL = "gemini-decision-1";
const BATCH_SIZE = 20;
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

// Mirrors Tier 1 local heuristics in filter-core.js
const RE_ATTRIBUTION = /(?:^|\s)(?:by|via|cc|credit:?|h\/t)\s+@\w+/i;
const RE_BAIT_CTA =
  /\b(?:comment|reply)\s+["'“”]?[a-z0-9]{1,20}["'“”]?\s+(?:and\s+i(?:'|’)?ll|to\s+get|for\s+(?:the\s+)?(?:link|dm|guide|access))|\b(?:like|rt|retweet)\s*\+\s*(?:rt|retweet|follow)|\bwrong\s+answers\s+only\b|\bdrop\s+a\s+[\p{Emoji}\u2600-\u27bf]/iu;
const RE_USELESS_SHORT =
  /^(?:this\.?|facts\.?|100%|true\.?|so true\.?|real\.?|agreed\.?|agree\??|lfg!?|wow!?|insane!?|crazy!?|huge if true\.?|based\.?|same\.?|yes\.?|no\.?|exact(?:ly)?\.?|[\s\p{Emoji}\u2600-\u27bf!?.,]+)$/iu;

function countHashtags(text) {
  const m = String(text || "").match(/(?:^|\s)#[a-z0-9_]+/gi);
  return m ? m.length : 0;
}

function evaluateLocalHeuristic(p) {
  if (p.following || p.isAd) return null;
  const text = (p.text || "").trim();
  const hashtags = countHashtags(text);
  if (hashtags >= 7) return "hashtag_spam";
  if (hashtags >= 4 && RE_ATTRIBUTION.test(text)) return "aggregator_attribution";
  if (RE_BAIT_CTA.test(text)) return "engagement_bait_cta";
  if (
    !p.hasMedia &&
    (!p.expandedUrls || p.expandedUrls.length === 0) &&
    text.length > 0 &&
    text.length <= 28 &&
    RE_USELESS_SHORT.test(text)
  ) {
    return "useless_short";
  }
  return null;
}

async function classifyBatchWithDecisions(apiKey, posts) {
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
    if (p.isReply) flags.push("reply");
    if (p.isRetweet) flags.push("repost");
    if (p.quotedText) flags.push("quote");
    if (p.hasMedia) flags.push("media");
    const hashtags = countHashtags(p.text);
    if (hashtags > 0) flags.push(`hashtags=${hashtags}`);
    lines.push(`[${tag}] @${p.author} [${flags.join(", ")}]`);
    lines.push(`Text: ${String(p.text || "").replace(/\s+/g, " ").slice(0, 400)}`);
    if (p.quotedText) {
      lines.push(`Quoted: ${String(p.quotedText).replace(/\s+/g, " ").slice(0, 160)}`);
    }
    lines.push("");

    questions[`p${i}_class`] = {
      type: "choice",
      instructions: `Classify post [${tag}] by @${p.author}. Choose 'keep' unless it is clearly low-quality noise.`,
      criteria: CATEGORY_CRITERIA,
    };
    questions[`p${i}_account_wide`] = {
      type: "noul",
      instructions: `Is the author of post [${tag}] (@${p.author}) clearly a non-human account, automated bot, clip/news aggregator, or content-mill whose future posts should also be hidden?`,
    };
  }

  const started = Date.now();
  const res = await fetch(DECISIONS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      model: DECISION_MODEL,
      input: lines.join("\n"),
      questions,
    }),
  });
  const durationMs = Date.now() - started;
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return { data, durationMs };
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(FEEDS_PATH, "utf8"));
  const forYou = (raw.feeds && raw.feeds.for_you) || [];
  const nonAds = forYou.filter((t) => !t.isAd);
  const followed = nonAds.filter((t) => t.following);
  const unfollowed = nonAds.filter((t) => !t.following);

  console.log(
    `Loaded ${forYou.length} For You posts: ${forYou.length - nonAds.length} ads, ${followed.length} followed (exempt), ${unfollowed.length} unfollowed candidates.`
  );

  const tier1Hidden = [];
  const tier2Candidates = [];
  for (const p of unfollowed) {
    const localReason = evaluateLocalHeuristic(p);
    if (localReason) {
      tier1Hidden.push({ post: p, reason: localReason });
    } else {
      tier2Candidates.push(p);
    }
  }

  console.log(`\n--- Tier 1 (Local Heuristics, <1 ms, $0): ${tier1Hidden.length} hidden ---`);
  for (const h of tier1Hidden) {
    console.log(
      `  [HIDE:${h.reason}] @${h.post.author}: ${JSON.stringify(h.post.text.slice(0, 100))}`
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log(
      `\n(Skipping Tier 2 Decisions API eval — set GEMINI_API_KEY to run live on ${tier2Candidates.length} candidates.)`
    );
    return;
  }

  console.log(`\n--- Tier 2 (gemini-decision-1, ${tier2Candidates.length} candidates) ---`);
  let totalInputTokens = 0;
  let totalMs = 0;
  let tier2HiddenCount = 0;

  for (let start = 0; start < tier2Candidates.length; start += BATCH_SIZE) {
    const batch = tier2Candidates.slice(start, start + BATCH_SIZE);
    const { data, durationMs } = await classifyBatchWithDecisions(apiKey, batch);
    totalMs += durationMs;
    const inTokens =
      (data.usage && (data.usage.input_tokens || data.usage.prompt_token_count)) || 0;
    totalInputTokens += inTokens;
    const answers = data.answers || {};

    console.log(
      `\nBatch ${start / BATCH_SIZE + 1} (${batch.length} posts) — ${durationMs} ms, input tokens: ${inTokens}`
    );
    for (let i = 0; i < batch.length; i++) {
      const p = batch[i];
      const cls = answers[`p${i}_class`] || {};
      const acct = answers[`p${i}_account_wide`] || {};
      const choice = cls.choice || "keep";
      const probs = cls.probabilities || cls.scores || {};
      const keepProb = typeof probs.keep === "number" ? probs.keep : choice === "keep" ? 1 : 0;
      const acctProb = typeof acct.noul === "number" ? acct.noul : 0;
      const hide = choice !== "keep" && keepProb < KEEP_PROB_HIDE_THRESHOLD;
      if (hide) tier2HiddenCount++;
      const status = hide ? `HIDE:${choice}` : "KEEP";
      const acctTag = acctProb >= ACCOUNT_WIDE_THRESHOLD ? " [ACCT-WIDE]" : "";
      console.log(
        `  [${status}${acctTag}] P(keep)=${keepProb.toFixed(2)} P(acct)=${acctProb.toFixed(2)} @${p.author}: ${JSON.stringify(p.text.slice(0, 90))}`
      );
    }
  }

  const estCostUsd = (totalInputTokens / 1e6) * 0.10;
  console.log(`\n=== Summary ===`);
  console.log(`Tier 1 hidden: ${tier1Hidden.length}`);
  console.log(`Tier 2 hidden: ${tier2HiddenCount} / ${tier2Candidates.length}`);
  console.log(`Total Tier 2 latency: ${totalMs} ms`);
  console.log(`Total input tokens: ${totalInputTokens} (est. cost: $${estCostUsd.toFixed(6)})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
