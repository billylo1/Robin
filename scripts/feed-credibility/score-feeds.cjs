#!/usr/bin/env node
// Scores tweets collected by collect-feeds.cjs with the Simplifier credibility prompt
// (Gemini + Google Search, same request shape as the extension) and compares feeds.
//
// Usage: GEMINI_API_KEY=... node scripts/feed-credibility/score-feeds.cjs [--in <dir>] [--concurrency 4]
// SIMPLIFIER_DIR points at a checkout of the Simplifier repo (default ../simplifier next to this repo).

const fs = require('fs');
const path = require('path');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const DIR = path.resolve(arg('in', path.join(__dirname, 'out')));
const CONCURRENCY = Number(arg('concurrency', 4));
const FINDING_COUNT = 3;
const MIN_TEXT_CHARS = 25;
const MAX_ATTEMPTS = 4;
const SIMPLIFIER_DIR = path.resolve(process.env.SIMPLIFIER_DIR || path.join(__dirname, '../../../simplifier'));
const BrowserUtils = require(path.join(SIMPLIFIER_DIR, 'extension/browser-utils.js'));

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('GEMINI_API_KEY is not set.');
  process.exit(1);
}

const cacheFile = path.join(DIR, 'scores.jsonl');
const cache = new Map();
if (fs.existsSync(cacheFile)) {
  for (const line of fs.readFileSync(cacheFile, 'utf8').split('\n').filter(Boolean)) {
    const row = JSON.parse(line);
    cache.set(row.id, row);
  }
}

function tweetContent(t) {
  const parts = [`@${t.contentAuthor}: ${t.text}`];
  if (t.quotedText) parts.push(`Quoted post: ${t.quotedText}`);
  return parts.join('\n\n');
}

function scorableText(t) {
  return `${t.text} ${t.quotedText}`.replace(/https?:\/\/\S+/g, '').replace(/[@#]\w+/g, '').trim();
}

async function scoreTweet(t) {
  const prompt = BrowserUtils.FactCheckOutput.buildPrompt({
    content: tweetContent(t),
    findingCount: FINDING_COUNT,
    usesLocalKnowledgeOnly: false,
    todayDate: new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    contentLabel: 'CONTENT TO FACT-CHECK',
  });
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 1.0,
      maxOutputTokens: 1536,
      thinkingConfig: { thinkingLevel: 'LOW' },
      responseMimeType: 'application/json',
      responseSchema: BrowserUtils.FactCheckOutput.geminiResponseSchema(),
    },
    tools: [{ googleSearch: {} }],
  });

  for (let attempt = 1; ; attempt++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(90_000) }
    ).catch((err) => ({ ok: false, status: 0, json: async () => ({ error: { message: err.message } }) }));
    const data = await res.json().catch(() => ({}));
    const retryable = res.status === 0 || res.status === 429 || res.status >= 500 || (res.ok && !data.candidates?.length);
    if (!res.ok || !data.candidates?.length) {
      if (retryable && attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
        continue;
      }
      throw new Error(`Gemini HTTP ${res.status}: ${data.error?.message || 'no candidates'}`);
    }
    const raw = (data.candidates[0].content?.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join('\n');
    const parsed = BrowserUtils.ResponseParser.parseAIResponse(raw);
    return {
      score: Number(parsed.credibilityScore) || null,
      verdict: parsed.verdict,
      findingStatuses: (parsed.findings || []).map((f) => f.status).filter(Boolean),
      grounded: Boolean(data.candidates[0].groundingMetadata),
    };
  }
}

async function runPool(items, worker) {
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < items.length) {
        const item = items[next++];
        await worker(item);
        done++;
        if (done % 10 === 0 || done === items.length) console.log(`scored ${done}/${items.length}`);
      }
    })
  );
}

function stats(scores) {
  const n = scores.length;
  if (!n) return { n };
  const sorted = [...scores].sort((a, b) => a - b);
  const mean = scores.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const pct = (f) => Math.round((100 * scores.filter(f).length) / n);
  const hist = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, scores.filter((s) => s === i + 1).length]));
  return {
    n,
    mean: +mean.toFixed(2),
    median,
    sd: +sd.toFixed(2),
    low_1_3_pct: pct((s) => s <= 3),
    mixed_4_6_pct: pct((s) => s >= 4 && s <= 6),
    high_7_10_pct: pct((s) => s >= 7),
    hist,
  };
}

// Two-sided Mann–Whitney U with normal approximation and tie correction.
function mannWhitney(a, b) {
  const all = [...a.map((v) => ({ v, g: 0 })), ...b.map((v) => ({ v, g: 1 }))].sort((x, y) => x.v - y.v);
  const ranks = new Array(all.length);
  let tieTerm = 0;
  for (let i = 0; i < all.length; ) {
    let j = i;
    while (j < all.length && all[j].v === all[i].v) j++;
    const r = (i + j + 1) / 2;
    for (let k = i; k < j; k++) ranks[k] = r;
    tieTerm += (j - i) ** 3 - (j - i);
    i = j;
  }
  const n1 = a.length;
  const n2 = b.length;
  const r1 = all.reduce((s, x, i) => s + (x.g === 0 ? ranks[i] : 0), 0);
  const u1 = r1 - (n1 * (n1 + 1)) / 2;
  const N = n1 + n2;
  const sigma = Math.sqrt(((n1 * n2) / 12) * (N + 1 - tieTerm / (N * (N - 1))));
  const z = (u1 - (n1 * n2) / 2) / sigma;
  const erf = (x) => {
    const t = 1 / (1 + 0.3275911 * Math.abs(x));
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return x >= 0 ? y : -y;
  };
  const p = 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2)));
  return { U: u1, z: +z.toFixed(2), p: +p.toFixed(4) };
}

async function main() {
  const { feeds, collectedAt } = JSON.parse(fs.readFileSync(path.join(DIR, 'feeds.json'), 'utf8'));
  const unique = new Map();
  for (const list of Object.values(feeds)) for (const t of list) unique.set(t.id, t);
  const todo = [...unique.values()].filter((t) => !cache.has(t.id) && scorableText(t).length >= MIN_TEXT_CHARS);
  console.log(`${unique.size} unique tweets, ${todo.length} to score (${cache.size} cached)`);

  const out = fs.createWriteStream(cacheFile, { flags: 'a' });
  await runPool(todo, async (t) => {
    try {
      const row = { id: t.id, ...(await scoreTweet(t)) };
      cache.set(t.id, row);
      out.write(JSON.stringify(row) + '\n');
    } catch (err) {
      console.warn(`failed ${t.url}: ${err.message}`);
    }
  });
  out.end();

  const scoreOf = (t) => cache.get(t.id)?.score;
  const scored = (list) => list.filter((t) => scoreOf(t)).map(scoreOf);
  const fo = feeds.following;
  const followedAuthors = new Set(fo.filter((t) => !t.isAd).map((t) => t.author));
  const fy = feeds.for_you.map((t) => ({ ...t, following: t.following || followedAuthors.has(t.author) }));
  const report = {
    collectedAt,
    overlap: fy.filter((t) => fo.some((u) => u.id === t.id)).length,
    feeds: {},
    comparisons: {},
  };
  for (const [name, list] of Object.entries({
    for_you: fy,
    for_you_organic: fy.filter((t) => !t.isAd),
    for_you_ads: fy.filter((t) => t.isAd),
    for_you_followed_authors: fy.filter((t) => !t.isAd && t.following),
    for_you_algorithmic: fy.filter((t) => !t.isAd && !t.following),
    following: fo,
  })) {
    report.feeds[name] = {
      collected: list.length,
      skipped_too_short: list.filter((t) => scorableText(t).length < MIN_TEXT_CHARS).length,
      ...stats(scored(list)),
    };
  }
  report.comparisons.for_you_vs_following = mannWhitney(scored(fy), scored(fo));
  report.comparisons.for_you_organic_vs_following = mannWhitney(scored(fy.filter((t) => !t.isAd)), scored(fo));
  report.comparisons.for_you_algorithmic_vs_following = mannWhitney(
    scored(fy.filter((t) => !t.isAd && !t.following)),
    scored(fo)
  );

  const lowest = (list) =>
    list
      .filter((t) => scoreOf(t) && scoreOf(t) <= 3)
      .map((t) => ({ score: scoreOf(t), verdict: cache.get(t.id).verdict, url: t.url, text: t.text.slice(0, 140) }));
  report.low_scoring = { for_you: lowest(fy), following: lowest(fo) };

  fs.writeFileSync(path.join(DIR, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ overlap: report.overlap, feeds: report.feeds, comparisons: report.comparisons }, null, 2));
  console.log(`Full report: ${path.join(DIR, 'report.json')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
