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
const MAX_IDLE_SCROLLS = 4;

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

async function collectFeed(page, feed) {
  const tweets = new Map();
  const isFeedResponse = (res) => res.url().includes(`/${feed.op}?`) && res.status() === 200;

  const onResponse = async (res) => {
    if (!isFeedResponse(res)) return;
    try {
      for (const t of extractTweets(await res.json())) if (!tweets.has(t.id)) tweets.set(t.id, t);
    } catch (err) {
      console.warn(`[${feed.key}] could not parse response: ${err.message}`);
    }
  };
  page.on('response', onResponse);

  await page.goto('https://x.com/home');
  const tab = page.getByRole('tab', { name: feed.tab, exact: true });
  await tab.waitFor();
  const first = page.waitForResponse(isFeedResponse, { timeout: PAGE_RESPONSE_TIMEOUT_MS }).catch(() => null);
  await tab.click();
  await first;

  let idle = 0;
  while (tweets.size < PER_FEED && idle < MAX_IDLE_SCROLLS) {
    const before = tweets.size;
    const next = page.waitForResponse(isFeedResponse, { timeout: PAGE_RESPONSE_TIMEOUT_MS }).catch(() => null);
    await page.mouse.wheel(0, 4000);
    await next;
    idle = tweets.size > before ? 0 : idle + 1;
    console.log(`[${feed.key}] ${tweets.size}/${PER_FEED}`);
  }

  page.off('response', onResponse);
  return [...tweets.values()].slice(0, PER_FEED);
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

  const result = { collectedAt: new Date().toISOString(), feeds: {} };
  for (const feed of FEEDS) {
    result.feeds[feed.key] = await collectFeed(page, feed);
    console.log(`[${feed.key}] collected ${result.feeds[feed.key].length} tweets`);
  }

  const file = path.join(OUT_DIR, 'feeds.json');
  fs.writeFileSync(file, JSON.stringify(result, null, 2));
  console.log(`Wrote ${file}`);
  await context.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
