#!/usr/bin/env node
// Collects tweets from the X "For you" and "Following" home feeds by reading the
// HomeTimeline / HomeLatestTimeline GraphQL responses in a real, logged-in browser.
//
// Usage: node scripts/feed-credibility/collect-feeds.cjs [--per-feed 100] [--out <dir>]
// The browser profile lives outside the repo (FEED_CRED_PROFILE, default ~/.cache/feed-credibility-profile)
// so you only log in once.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

function loadPlaywright() {
  try {
    return require('playwright-core');
  } catch {
    const globalRoot = execSync('npm root -g').toString().trim();
    return require(path.join(globalRoot, 'playwright-core'));
  }
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const PER_FEED = Number(arg('per-feed', 100));
const OUT_DIR = path.resolve(arg('out', path.join(__dirname, 'out')));
const PROFILE_DIR = process.env.FEED_CRED_PROFILE || path.join(os.homedir(), '.cache', 'feed-credibility-profile');
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const PAGE_RESPONSE_TIMEOUT_MS = 20 * 1000;
const MAX_REPLAY_PAGES = 8;

const FEEDS = [
  { key: 'for_you', tab: 'For you', op: 'HomeTimeline' },
  { key: 'following', tab: 'Following', op: 'HomeLatestTimeline' },
];

function unwrapTweet(result) {
  if (!result) return null;
  if (result.__typename === 'TweetWithVisibilityResults') return result.tweet;
  if (result.__typename === 'Tweet') return result;
  return null;
}

function mapTweet(itemContent) {
  const tweet = unwrapTweet(itemContent?.tweet_results?.result);
  if (!tweet?.legacy) return null;
  const user = tweet.core?.user_results?.result || {};
  const handle = user.core?.screen_name || user.legacy?.screen_name || '';
  const retweeted = unwrapTweet(tweet.legacy.retweeted_status_result?.result);
  const source = retweeted || tweet;
  const text = source.note_tweet?.note_tweet_results?.result?.text || source.legacy?.full_text || '';
  const quoted = unwrapTweet(source.quoted_status_result?.result);
  const quotedText = quoted
    ? quoted.note_tweet?.note_tweet_results?.result?.text || quoted.legacy?.full_text || ''
    : '';
  const sourceUser = source.core?.user_results?.result || {};
  return {
    id: tweet.rest_id,
    url: `https://x.com/${handle}/status/${tweet.rest_id}`,
    author: handle,
    contentAuthor: sourceUser.core?.screen_name || sourceUser.legacy?.screen_name || handle,
    following: Boolean(user.relationship_perspectives?.following ?? user.legacy?.following),
    isAd: Boolean(itemContent.promotedMetadata),
    isRetweet: Boolean(retweeted),
    isReply: Boolean(source.legacy?.in_reply_to_status_id_str),
    createdAt: tweet.legacy.created_at,
    text,
    quotedText,
    hasMedia: Boolean(source.legacy?.extended_entities?.media?.length),
    expandedUrls: (source.legacy?.entities?.urls || []).map((u) => u.expanded_url).filter(Boolean),
  };
}

function extractTweets(json) {
  const instructions = json?.data?.home?.home_timeline_urt?.instructions || [];
  const out = [];
  for (const ins of instructions) {
    const entries = ins.entries || (ins.entry ? [ins.entry] : []);
    for (const entry of entries) {
      const c = entry.content || {};
      const items = c.itemContent ? [c.itemContent] : (c.items || []).map((i) => i.item?.itemContent);
      for (const ic of items) {
        const t = ic && mapTweet(ic);
        if (t) out.push(t);
      }
    }
  }
  return out;
}

// HomeLatestTimeline serves both Following → Popular (enableRanking true) and
// Following → Recent (false). For You (HomeTimeline) is always ranked and has
// no public X API equivalent — only reverse_chronological exists, and that is Following.
function bottomCursor(json) {
  const instructions = json?.data?.home?.home_timeline_urt?.instructions || [];
  for (const ins of instructions) {
    const entries = ins.entries || (ins.entry ? [ins.entry] : []);
    for (const entry of entries) {
      const c = entry.content || {};
      if (c.cursorType === 'Bottom' && c.value) return c.value;
    }
  }
  return null;
}

function replayHeaders(req) {
  const headers = { ...req.headers() };
  for (const key of ['content-length', 'host', 'connection']) delete headers[key];
  return headers;
}

function parseVariables(req) {
  const url = new URL(req.url());
  const fromQuery = url.searchParams.get('variables');
  if (fromQuery) return { kind: 'query', vars: JSON.parse(fromQuery), post: '' };
  const post = req.postData() || '';
  if (post) {
    try {
      const json = JSON.parse(post);
      if (json && json.variables) return { kind: 'json', vars: json.variables, post };
    } catch {
      /* form body */
    }
    const params = new URLSearchParams(post);
    if (params.get('variables')) return { kind: 'form', vars: JSON.parse(params.get('variables')), post };
  }
  const keys = [...url.searchParams.keys()].join(',') || 'none';
  throw new Error(`${req.method()} ${url.pathname} has no variables (query keys: ${keys}, post ${post.length} chars)`);
}

// Replays the timeline request the page just made. Following forces enableRanking
// false (Recent). Pagination follows the Bottom cursor. The public X API has no For You timeline.
async function replayFeed(page, seedRes, feed) {
  const req = seedRes.request();
  const parsed = parseVariables(req);
  const headers = replayHeaders(req);
  const tweets = new Map();
  const seenCursors = new Set();
  let cursor;
  console.log(`[${feed.key}] replaying ${parsed.kind} request, enableRanking seed=${parsed.vars.enableRanking}`);
  for (let pageNo = 0; pageNo < MAX_REPLAY_PAGES && tweets.size < PER_FEED; pageNo++) {
    const vars = { ...parsed.vars };
    if (feed.key === 'following') vars.enableRanking = false;
    if (cursor) vars.cursor = cursor;
    else delete vars.cursor;
    const url = new URL(req.url());
    let res;
    if (parsed.kind === 'query') {
      url.searchParams.set('variables', JSON.stringify(vars));
      res = await page.request.fetch(url.toString(), { method: req.method(), headers, timeout: 25_000 });
    } else if (parsed.kind === 'json') {
      const body = JSON.parse(parsed.post);
      body.variables = vars;
      res = await page.request.fetch(url.toString(), {
        method: 'POST',
        headers,
        data: JSON.stringify(body),
        timeout: 25_000,
      });
    } else {
      const params = new URLSearchParams(parsed.post);
      params.set('variables', JSON.stringify(vars));
      res = await page.request.fetch(url.toString(), {
        method: 'POST',
        headers,
        data: params.toString(),
        timeout: 25_000,
      });
    }
    if (!res.ok()) {
      console.warn(`[${feed.key}] replay HTTP ${res.status()} on page ${pageNo + 1}`);
      break;
    }
    const json = await res.json();
    const batch = extractTweets(json);
    for (const t of batch) if (!tweets.has(t.id)) tweets.set(t.id, t);
    const next = bottomCursor(json);
    console.log(`[${feed.key}] ${tweets.size}/${PER_FEED} (page ${pageNo + 1}, +${batch.length})`);
    if (!next || seenCursors.has(next)) break;
    seenCursors.add(next);
    cursor = next;
  }
  return [...tweets.values()].slice(0, PER_FEED);
}

function isOp(res, op) {
  return res.status() === 200 && res.url().includes(`/${op}`);
}

async function collectFeed(page, feed) {
  const hits = [];
  const graphql = new Set();
  const onResponse = (res) => {
    if (res.status() !== 200) return;
    if (res.url().includes('/graphql/')) {
      try {
        graphql.add(new URL(res.url()).pathname.split('/').pop());
      } catch {
        /* ignore */
      }
    }
    if (isOp(res, 'HomeTimeline') || isOp(res, 'HomeLatestTimeline')) hits.push(res);
  };
  page.on('response', onResponse);
  try {
    if (!page.url().includes('x.com/home')) {
      await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
    }
    const tab = page.getByRole('tab', { name: feed.tab, exact: true });
    await tab.waitFor();
    if ((await tab.getAttribute('aria-selected')) !== 'true') {
      const waited = page.waitForResponse((res) => isOp(res, feed.op), { timeout: PAGE_RESPONSE_TIMEOUT_MS }).catch(() => null);
      await tab.click({ timeout: 10_000, noWaitAfter: true });
      await waited;
    }
    let seed = [...hits].reverse().find((res) => isOp(res, feed.op));
    if (!seed) {
      // Cached tab paints "See new posts" without a new timeline request. Reload once.
      const waited = page.waitForResponse((res) => isOp(res, feed.op), { timeout: PAGE_RESPONSE_TIMEOUT_MS }).catch(() => null);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waited;
      seed = [...hits].reverse().find((res) => isOp(res, feed.op));
    }
    if (!seed) {
      const shot = path.join(OUT_DIR, `${feed.key}-fail.png`);
      await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
      throw new Error(`no ${feed.op} response (graphql: ${[...graphql].slice(0, 12).join(', ') || 'none'})`);
    }
    console.log(`[${feed.key}] captured ${feed.op}; replaying`);
    return await replayFeed(page, seed, feed);
  } finally {
    page.off('response', onResponse);
  }
}

async function main() {
  const { chromium } = loadPlaywright();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1200, height: 1000 },
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = context.pages()[0] || (await context.newPage());

  await page.goto('https://x.com/home');
  console.log('Waiting for X home timeline (log in in the browser window if prompted)…');
  await page.getByRole('tab', { name: 'Following', exact: true }).waitFor({ timeout: LOGIN_TIMEOUT_MS });

  const result = {
    collectedAt: new Date().toISOString(),
    source: 'x.com session (For You is not in the public X API; reverse_chronological is Following only)',
    feeds: {},
  };
  const file = path.join(OUT_DIR, 'feeds.json');
  for (const feed of FEEDS) {
    result.feeds[feed.key] = await collectFeed(page, feed);
    console.log(`[${feed.key}] collected ${result.feeds[feed.key].length} tweets`);
    fs.writeFileSync(file, JSON.stringify(result, null, 2));
  }
  console.log(`Wrote ${file}`);
  await context.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
