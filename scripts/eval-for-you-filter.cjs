#!/usr/bin/env node
/**
 * Offline & live evaluation harness for Robin's For You Quality Filter.
 * Uses production prompt/threshold builders from functions/index.js and mirrors
 * Tier 1 local heuristics from filter-core.js.
 *
 * Usage:
 *   GEMINI_API_KEY=... node scripts/eval-for-you-filter.cjs
 */

"use strict";

const fs = require("fs");
const path = require("path");
const {
  buildDecisionRequest,
  parseDecisionVerdicts,
  sanitizePost,
} = require("../functions/index.js")._internal;

const FEEDS_PATH = path.resolve(__dirname, "feed-credibility/out/feeds.json");
const DECISIONS_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/decisions";
const BATCH_SIZE = 20;

// Mirrors Tier 1 local heuristics in ios/Robin/Resources/x-filter/filter-core.js
const RE_ATTRIBUTION = /(?:^|\s)(?:by|via|cc|credit:?|h\/t)\s+@\w+/i;
const RE_BAIT_CTA =
  /\b(?:comment|reply)\s+["'“”]?[a-z0-9]{1,20}["'“”]?\s+(?:and\s+i(?:'|’)?ll|to\s+get|for\s+(?:the\s+)?(?:link|dm|guide|access))|\b(?:like|rt|retweet)\s*\+\s*(?:rt|retweet|follow)|\bwrong\s+answers\s+only\b|\bdrop\s+a\s+(?:[\u2600-\u27bf]|[\ud83c-\ud83e][\udc00-\udfff])/i;
const RE_USELESS_SHORT =
  /^(?:this\.?|facts\.?|100%|true\.?|so true\.?|real\.?|agreed\.?|agree\??|lfg!?|wow!?|insane!?|crazy!?|huge if true\.?|based\.?|same\.?|yes\.?|no\.?|exact(?:ly)?\.?|[\s!?.,\u2600-\u27bf\ud83c-\ud83e\udc00-\udfff]+)$/i;
const RE_BOT_BIO =
  /\b(?:automated\s+account|bot\s+account|parody\s+account|daily\s+ai\s+news|dm\s+for\s+promo|paid\s+promo)\b/i;

function countHashtags(text) {
  const m = String(text || "").match(/(?:^|\s)#[A-Za-z0-9_]+/g);
  return m ? m.length : 0;
}

function countBodyMentions(rawText, isReply) {
  if (!rawText) return 0;
  const body = isReply
    ? String(rawText).replace(/^(?:@[A-Za-z0-9_]{1,15}\s+)+/, "")
    : String(rawText);
  const m = body.match(/(?:^|\s)@[A-Za-z0-9_]{1,15}\b/g);
  return m ? m.length : 0;
}

function extractUrlDomains(urls) {
  if (!Array.isArray(urls) || !urls.length) return [];
  const excluded = new Set([
    "t.co",
    "x.com",
    "twitter.com",
    "pic.twitter.com",
    "pic.x.com",
  ]);
  const out = [];
  for (const raw of urls) {
    if (out.length >= 3) break;
    const u = typeof raw === "string" ? raw : raw && (raw.expanded_url || raw.unwound_url || raw.url);
    if (!u) continue;
    let host = "";
    try {
      host = new URL(u).hostname || "";
    } catch {
      const m = /^https?:\/\/([^\/:?#]+)/i.exec(u);
      host = m ? m[1] : "";
    }
    host = host.toLowerCase().replace(/^www\./, "").slice(0, 60);
    if (!host || excluded.has(host) || out.includes(host)) continue;
    out.push(host);
  }
  return out;
}

function buildMetaFromPost(p) {
  const rawText = String(p.text || "").trim();
  const hashtags = Number.isFinite(p.hashtagCount)
    ? p.hashtagCount
    : countHashtags(rawText);
  const mentionCount = Number.isFinite(p.mentionCount)
    ? p.mentionCount
    : countBodyMentions(rawText, p.isReply);
  const urlDomains = Array.isArray(p.urlDomains)
    ? p.urlDomains
    : extractUrlDomains(p.expandedUrls);
  const hasUrls = Boolean(
    (p.expandedUrls && p.expandedUrls.length > 0) || urlDomains.length > 0 || p.hasUrls
  );
  const meta = sanitizePost({
    id: String(p.id),
    handle: p.author || p.handle || "",
    name: p.name || p.author || p.handle || "",
    bio: p.bio || "",
    isBlue: Boolean(p.isBlue),
    followers: Number.isFinite(p.followers) ? p.followers : null,
    friends: Number.isFinite(p.friends) ? p.friends : null,
    isReply: Boolean(p.isReply),
    isRetweet: Boolean(p.isRetweet),
    isQuote: Boolean(p.isQuote || p.quotedText),
    hasMedia: Boolean(p.hasMedia),
    hashtagCount: hashtags,
    mentionCount,
    charCount: rawText.length,
    urlDomains,
    statusesPerDay: Number.isFinite(p.statusesPerDay) ? p.statusesPerDay : null,
    accountAgeDays: Number.isFinite(p.accountAgeDays) ? p.accountAgeDays : null,
    text: rawText,
    quotedText: p.quotedText || "",
  });
  if (!meta) return null;
  return {
    meta,
    rawText,
    hasUrls,
    following: Boolean(p.following),
    isAd: Boolean(p.isAd),
  };
}

function evaluateLocalHeuristic(entry) {
  if (!entry || entry.following || entry.isAd) return null;
  const { meta, rawText, hasUrls } = entry;
  const hashtags = meta.hashtagCount || 0;
  const nonHashtagLen = rawText
    .replace(/#[A-Za-z0-9_]+/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim().length;
  if (hashtags >= 7 && nonHashtagLen < 350) return "hashtag_spam";
  if (!meta.isReply && (meta.mentionCount || 0) >= 8) return "mention_pod_spam";
  if (hashtags >= 4 && RE_ATTRIBUTION.test(rawText)) return "aggregator_attribution";
  if (RE_BAIT_CTA.test(rawText)) return "engagement_bait_cta";
  const trimmed = rawText.trim();
  if (
    !meta.hasMedia &&
    !hasUrls &&
    trimmed.length > 0 &&
    trimmed.length <= 28 &&
    RE_USELESS_SHORT.test(trimmed)
  ) {
    return "useless_short";
  }
  if (meta.bio && RE_BOT_BIO.test(meta.bio)) return "bot_bio";
  return null;
}

async function classifyBatchWithDecisions(apiKey, posts) {
  const payload = buildDecisionRequest(posts);
  const started = Date.now();
  const res = await fetch(DECISIONS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(payload),
  });
  const durationMs = Date.now() - started;
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return { data, durationMs };
}

async function runSuite(name, rawPosts, apiKey, labeled = false) {
  console.log(`\n============================================================`);
  console.log(`${name} (${rawPosts.length} posts)`);
  console.log(`============================================================`);

  const prepared = [];
  for (const p of rawPosts) {
    const built = buildMetaFromPost(p);
    if (built) prepared.push({ orig: p, ...built });
  }

  const tier1Hidden = [];
  const tier2Candidates = [];
  const verdictById = new Map();

  for (const item of prepared) {
    const localReason = evaluateLocalHeuristic(item);
    if (localReason) {
      tier1Hidden.push({ item, reason: localReason });
      verdictById.set(item.meta.id, {
        hide: true,
        tier: 1,
        reason: localReason,
        accountWide: false,
      });
    } else {
      tier2Candidates.push(item);
    }
  }

  console.log(`\n--- Tier 1 (Local Heuristics, <1 ms, $0): ${tier1Hidden.length} hidden ---`);
  for (const h of tier1Hidden) {
    console.log(
      `  [HIDE:${h.reason}] @${h.item.meta.handle}: ${JSON.stringify(h.item.rawText.slice(0, 95))}`
    );
  }

  let totalInputTokens = 0;
  let totalMs = 0;
  let tier2HiddenCount = 0;

  if (!apiKey) {
    console.log(
      `\n(Skipping Tier 2 Decisions API — set GEMINI_API_KEY to evaluate ${tier2Candidates.length} candidates.)`
    );
  } else {
    console.log(`\n--- Tier 2 (gemini-decision-1, ${tier2Candidates.length} candidates) ---`);
    for (let start = 0; start < tier2Candidates.length; start += BATCH_SIZE) {
      const slice = tier2Candidates.slice(start, start + BATCH_SIZE);
      const batchPosts = slice.map((s) => s.meta);
      const { data, durationMs } = await classifyBatchWithDecisions(apiKey, batchPosts);
      totalMs += durationMs;
      const inTokens =
        (data.usage && (data.usage.total_input_tokens || data.usage.total_tokens)) || 0;
      totalInputTokens += inTokens;

      const parsedHidden = parseDecisionVerdicts(batchPosts, data);
      const hiddenMap = new Map(parsedHidden.map((h) => [h.id, h]));
      const answers = data.answers || {};

      console.log(
        `\nBatch ${start / BATCH_SIZE + 1} (${slice.length} posts) — ${durationMs} ms, input tokens: ${inTokens}`
      );
      for (let i = 0; i < slice.length; i++) {
        const { meta, rawText } = slice[i];
        const cls = answers[`p${i}_class`] || {};
        const acct = answers[`p${i}_account_wide`] || {};
        const choice = cls.choice || "keep";
        const probs = cls.probabilities || cls.scores || {};
        const keepProb =
          typeof probs.keep === "number" ? probs.keep : choice === "keep" ? 1 : 0;
        const conf = typeof cls.confidence === "number" ? cls.confidence : 0;
        const acctProb = typeof acct.noul === "number" ? acct.noul : 0;
        const h = hiddenMap.get(meta.id);
        const hide = Boolean(h);
        if (hide) tier2HiddenCount++;

        verdictById.set(meta.id, {
          hide,
          tier: 2,
          reason: h ? h.reason : "keep",
          accountWide: Boolean(h && h.accountWide),
          keepProb,
          conf,
          acctProb,
        });

        const status = hide ? `HIDE:${h.reason}` : "KEEP";
        const acctTag = h && h.accountWide ? " [ACCT-WIDE]" : "";
        console.log(
          `  [${status}${acctTag}] P(keep)=${keepProb.toFixed(2)} conf=${conf.toFixed(2)} P(acct)=${acctProb.toFixed(2)} @${meta.handle}: ${JSON.stringify(rawText.slice(0, 85))}`
        );
      }
    }
  }

  const estCostUsd = (totalInputTokens / 1e6) * 0.10;
  const costPer1k =
    tier2Candidates.length > 0 ? (estCostUsd / tier2Candidates.length) * 1000 : 0;
  console.log(`\n=== ${name} Summary ===`);
  console.log(`Tier 1 hidden: ${tier1Hidden.length}`);
  if (apiKey) {
    console.log(`Tier 2 hidden: ${tier2HiddenCount} / ${tier2Candidates.length}`);
    console.log(`Total hidden: ${tier1Hidden.length + tier2HiddenCount} / ${prepared.length}`);
    console.log(`Total Tier 2 latency: ${totalMs} ms`);
    console.log(
      `Total input tokens: ${totalInputTokens} (est. $${estCostUsd.toFixed(6)}, ~$${costPer1k.toFixed(4)} per 1k AI posts at $0.10/1M in)`
    );
  }

  if (labeled && apiKey) {
    let tp = 0;
    let fp = 0;
    let tn = 0;
    let fn = 0;
    let acctCorrect = 0;
    let acctTotal = 0;
    const misses = [];

    for (const item of prepared) {
      const v = verdictById.get(item.meta.id);
      const expHide = item.orig.expected === "hide";
      const gotHide = Boolean(v && v.hide);
      if (expHide && gotHide) tp++;
      else if (!expHide && gotHide) {
        fp++;
        misses.push(`FP @${item.meta.handle} (reason=${v.reason}, P(keep)=${v.keepProb?.toFixed(2)})`);
      } else if (!expHide && !gotHide) tn++;
      else {
        fn++;
        misses.push(`FN @${item.meta.handle} (expected hide, got keep=${v.keepProb?.toFixed(2)})`);
      }

      if (typeof item.orig.expectedAccountWide === "boolean") {
        acctTotal++;
        if (Boolean(v && v.accountWide) === item.orig.expectedAccountWide) {
          acctCorrect++;
        } else {
          misses.push(
            `ACCT_MISMATCH @${item.meta.handle} (expected=${item.orig.expectedAccountWide}, got=${Boolean(v && v.accountWide)}, P(acct)=${v.acctProb?.toFixed(2)})`
          );
        }
      }
    }

    const precision = tp + fp > 0 ? (tp / (tp + fp)) * 100 : 100;
    const recall = tp + fn > 0 ? (tp / (tp + fn)) * 100 : 100;
    const fpr = fp + tn > 0 ? (fp / (fp + tn)) * 100 : 0;
    console.log(
      `Labeled Metrics: TP=${tp} FP=${fp} TN=${tn} FN=${fn} | Precision=${precision.toFixed(1)}% Recall=${recall.toFixed(1)}% FPR=${fpr.toFixed(1)}% | AcctWide=${acctCorrect}/${acctTotal}`
    );
    if (misses.length) {
      console.log(`Mismatches: ${misses.join("; ")}`);
    } else {
      console.log(`Mismatches: none (100% agreement!)`);
    }
  }
}

const SUITE_2_GOLDEN = [
  {
    id: "90001",
    author: "cre8ivepark",
    bio: "Spatial computing & sci-viz builder",
    followers: 4200,
    friends: 380,
    statusesPerDay: 1.4,
    accountAgeDays: 1800,
    hasMedia: true,
    expected: "keep",
    expectedAccountWide: false,
    text:
      "Continuing my weekend explorations in spatial data visualization: Deep Space Missions. " +
      "Nine robotic missions (Cassini, New Horizons, Rosetta, OSIRIS-REx, Juno, DART, Voyager 1 & 2, Dawn) plotted from NASA JPL Horizons trajectories with a timeline slider so you can scrub decades of exploration in physical space. " +
      "One of the hardest problems was compressing planetary scales without losing orbital accuracy. " +
      "#CosmicXR #DeepSpaceMissions #MixedReality #VirtualReality #MetaQuest #Quest3 #SpatialComputing #XR #SpaceExploration #SpaceScience #DataVisualization #UXDesign #NASA #JPL #Unity3D",
  },
  {
    id: "90002",
    author: "bamitav",
    bio: "Tech enthusiast sharing IoT & AI innovations",
    followers: 18500,
    friends: 17900,
    statusesPerDay: 22.5,
    accountAgeDays: 2100,
    hasMedia: true,
    expected: "hide",
    expectedAccountWide: false,
    text:
      "Raspberry Pi prototype watches railway tracks and detects defects with AI and GPS! #RaspberryPi #AI #RailSafety " +
      "@lexfridman @KirkDBorne @Ronald_vanLoon @erikbryn @antgrasso @sallyeaves @Nicochan33 @HaroldSinnott @mvollmer1 @marcusborba @ylecun @TerenceLeungSF",
  },
  {
    id: "90003",
    author: "prompt_hustler99",
    bio: "Helping you 10x with AI workflows",
    followers: 54000,
    friends: 1200,
    statusesPerDay: 14.2,
    accountAgeDays: 420,
    expected: "hide",
    expectedAccountWide: false,
    text:
      "We spent six months testing autonomous coding loops across customer support, onboarding, and billing operations to replace five fragmented manual spreadsheets with a clean single-operator cockpit. " +
      "Most teams assume prompt engineering is the bottleneck when the actual win comes from deterministic schema validation, structured retries, and strict state machines wired cleanly into existing CRM events. " +
      "Want our complete n8n + Claude Code production template? Comment \"SYSTEM\" and I'll DM you the exact blueprint!",
  },
  {
    id: "90004",
    author: "woocash_j",
    bio: "Founding engineer building end-to-end test infra",
    followers: 920,
    friends: 410,
    statusesPerDay: 0.9,
    accountAgeDays: 2400,
    isQuote: true,
    quotedText: "Launching our new autonomous Playwright CI runner today with deterministic trace replay.",
    expected: "keep",
    expectedAccountWide: false,
    text:
      "Super proud to see this popping! Insane launch and credible people!\n\ne2e is the driver of our QA loops for n deployments",
  },
  {
    id: "90005",
    author: "Math_files",
    bio: "Expository notes on pure mathematics & modern proofs",
    followers: 28000,
    friends: 140,
    statusesPerDay: 1.8,
    accountAgeDays: 1450,
    expandedUrls: ["https://arxiv.org/abs/2609.02882"],
    hasMedia: true,
    expected: "keep",
    expectedAccountWide: false,
    text:
      "An AI-produced proof inspired a mathematician to find a simpler argument about one of mathematics' deepest mysteries. " +
      "In a September 2026 preprint, Youness Lamzouri replaces an intricate matrix framework with a single Hilbert space inequality proving >67.25% of zeta zeros are simple and on the critical line. " +
      "What makes this significant is moving from obtaining a bound to understanding why it works. " +
      "Source: Youness Lamzouri, arXiv:2609.02882",
  },
  {
    id: "90006",
    author: "azlenelza",
    bio: "Design engineer",
    followers: 6100,
    friends: 520,
    statusesPerDay: 1.1,
    accountAgeDays: 3100,
    hasMedia: true,
    expected: "keep",
    expectedAccountWide: false,
    text: "Bounding box study",
  },
  {
    id: "90007",
    author: "crypto_hype_01",
    bio: "Web3 believer",
    followers: 112,
    friends: 940,
    statusesPerDay: 35.0,
    accountAgeDays: 180,
    isQuote: true,
    quotedText: "Big partnership announcement coming tomorrow",
    expected: "hide",
    expectedAccountWide: false,
    text: "LFG!",
  },
  {
    id: "90008",
    author: "AlertaNews24_sim",
    bio: "Última hora | Noticias internacionales las 24 horas",
    name: "ALERTA NEWS 24",
    followers: 890000,
    friends: 12,
    statusesPerDay: 85.0,
    accountAgeDays: 120,
    hasMedia: true,
    expected: "hide",
    expectedAccountWide: true,
    text:
      "🚨 ÚLTIMA HORA | Fuertes lluvias provocan inundaciones en varias avenidas principales de la capital; autoridades recomiendan precaución.",
  },
  {
    id: "90009",
    author: "DailyViralClips_",
    bio: "Daily dose of science, nature & crazy engineering clips 🎥",
    name: "Daily Viral Clips",
    followers: 1240000,
    friends: 4,
    statusesPerDay: 45.0,
    accountAgeDays: 950,
    hasMedia: true,
    expected: "hide",
    expectedAccountWide: true,
    text:
      "This self-balancing gyroscope reaction wheel recovers instantly from heavy impacts 🤯 (by @eth_robotics_lab)",
  },
  {
    id: "90010",
    author: "tokufxug",
    bio: "3DGS / Computer Vision Engineer in Tokyo",
    followers: 7800,
    friends: 430,
    statusesPerDay: 1.7,
    accountAgeDays: 2200,
    hasMedia: true,
    expected: "keep",
    expectedAccountWide: false,
    text:
      "店舗の監視カメラ映像と3DGSによるデジタルツインで、顧客がどの商品棚を見ているか？を解析\n🔹スマホ映像から3D Gaussian Splattingで店舗を3D化\n🔹監視カメラ映像から棚ごとの滞留時間を分析",
  },
  {
    id: "90011",
    author: "carmen_ml_es",
    bio: "Investigadora de ML y sistemas distribuidos",
    followers: 3400,
    friends: 610,
    statusesPerDay: 1.5,
    accountAgeDays: 1650,
    expected: "keep",
    expectedAccountWide: false,
    text:
      "Pasamos tres días depurando un cuello de botella en nuestro pipeline de inferencia en PyTorch: resultó ser contención de memoria compartida en el dataloader cuando superábamos 8 workers. Bajar el prefetch factor redujo el p99 un 42%.",
  },
  {
    id: "90012",
    author: "founder_platitude",
    bio: "Building in public | Scaling startups | Mindset",
    followers: 41000,
    friends: 800,
    statusesPerDay: 11.4,
    accountAgeDays: 500,
    expected: "hide",
    expectedAccountWide: false,
    text:
      "Most founders fail because they optimize for comfort instead of velocity.\n\nWinners do 3 things differently:\n→ Ship before they feel ready\n→ Obsess over distribution daily\n→ Turn rejection into fuel\n\nConsistency beats talent every single time. Save this.",
  },
  {
    id: "90013",
    author: "thread_hook_dev",
    bio: "10x Engineer | Writing threads on code & wealth",
    followers: 62000,
    friends: 300,
    statusesPerDay: 8.5,
    accountAgeDays: 600,
    expected: "hide",
    expectedAccountWide: false,
    text:
      "99% of developers are still using React state completely wrong.\n\nI audited 50+ production codebases last month and the exact same costly mistake appeared in almost all of them.\n\nHere are the 7 patterns senior engineers refuse to write 👇🧵",
  },
  {
    id: "90014",
    author: "kernel_hannah",
    bio: "Linux storage & io_uring contributor",
    followers: 5200,
    friends: 310,
    statusesPerDay: 2.1,
    accountAgeDays: 2900,
    isReply: true,
    expected: "keep",
    expectedAccountWide: false,
    text:
      "@u1 @u2 @u3 @u4 @u5 @u6 @u7 @u8 @u9 Agreed, registering fixed buffers with IOSQE_BUFFER_SELECT avoids the mmap lock contention we saw in 6.11.",
  },
  {
    id: "90015",
    author: "quake_feed_bot",
    bio: "Automated account posting USGS seismic alerts worldwide.",
    followers: 19000,
    friends: 0,
    statusesPerDay: 18.0,
    accountAgeDays: 1400,
    expandedUrls: ["https://earthquake.usgs.gov/earthquakes"],
    expected: "hide",
    expectedAccountWide: false,
    text: "M 4.1 earthquake detected 32km NW of Anchorage, AK.",
  },
  {
    id: "90016",
    author: "simon_oss",
    bio: "Maintainer of sqlite-utils and Datasette",
    followers: 95000,
    friends: 880,
    statusesPerDay: 3.2,
    accountAgeDays: 5400,
    expandedUrls: ["https://github.com/simonw/llm"],
    expected: "keep",
    expectedAccountWide: false,
    text:
      "Released llm 0.27 with plugin support for structured JSON decision hooks and local SQLite logging of input token counts across prompts.",
  },
];

async function main() {
  const apiKey = process.env.GEMINI_API_KEY || "";
  const raw = JSON.parse(fs.readFileSync(FEEDS_PATH, "utf8"));
  const forYou = (raw.feeds && raw.feeds.for_you) || [];
  const nonAds = forYou.filter((t) => !t.isAd);
  const followed = nonAds.filter((t) => t.following);
  const unfollowed = nonAds.filter((t) => !t.following);

  console.log(
    `Loaded ${forYou.length} For You posts: ${forYou.length - nonAds.length} ads, ${followed.length} followed (exempt), ${unfollowed.length} unfollowed candidates.`
  );

  await runSuite("Suite 1: Real For You Corpus (feeds.json)", unfollowed, apiKey, false);
  await runSuite("Suite 2: Labeled Golden Stress Set", SUITE_2_GOLDEN, apiKey, true);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
