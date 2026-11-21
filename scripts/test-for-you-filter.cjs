#!/usr/bin/env node
/**
 * Unit tests for For You Quality Filter in Robin filter-core.js.
 * Validates GraphQL HomeTimeline parsing, followed-account & Following-tab exemptions,
 * Tier 1 local heuristics, Tier 2 native bridge batching, __ROBIN_APPLY_FEED_FILTER__,
 * accountWide caching, and scroll-jump protection.
 */

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function createMockElement(tagName, attrs = {}) {
  const attributes = { ...attrs };
  const classListSet = new Set();
  const children = [];
  let parentElement = null;
  let rect = { top: 100, bottom: 250, left: 0, right: 390, width: 390, height: 150 };
  const styleProperties = {};
  const stylePriorities = {};

  const style = {
    getPropertyValue: (p) => styleProperties[p] || "",
    getPropertyPriority: (p) => stylePriorities[p] || "",
    setProperty(p, v, pr = "") {
      styleProperties[p] = String(v);
      stylePriorities[p] = String(pr);
    },
    removeProperty(p) {
      delete styleProperties[p];
      delete stylePriorities[p];
    },
    get display() {
      return styleProperties.display || "";
    },
  };

  const elem = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    isConnected: true,
    style,
    childNodes: children,
    textContent: "",
    get children() {
      return children.filter((c) => c.nodeType === 1);
    },
    get parentElement() {
      return parentElement;
    },
    set parentElement(p) {
      parentElement = p;
    },
    classList: {
      contains: (c) => classListSet.has(c),
      add: (c) => classListSet.add(c),
      remove: (c) => classListSet.delete(c),
      toggle: (c, force) => {
        if (force !== undefined) {
          if (force) classListSet.add(c);
          else classListSet.delete(c);
          return force;
        }
        if (classListSet.has(c)) {
          classListSet.delete(c);
          return false;
        }
        classListSet.add(c);
        return true;
      },
    },
    getAttribute: (n) => (attributes[n] !== undefined ? attributes[n] : null),
    setAttribute: (n, v) => {
      attributes[n] = String(v);
    },
    removeAttribute: (n) => {
      delete attributes[n];
    },
    hasAttribute: (n) => attributes[n] !== undefined,
    appendChild(child) {
      child.parentElement = elem;
      children.push(child);
      return child;
    },
    remove() {
      if (parentElement) {
        const idx = parentElement.childNodes.indexOf(elem);
        if (idx !== -1) parentElement.childNodes.splice(idx, 1);
        parentElement = null;
      }
    },
    setMockRect(r) {
      rect = r;
    },
    getBoundingClientRect: () => rect,
    matches(sel) {
      return matchesSelector(elem, sel);
    },
    querySelectorAll(sel) {
      return queryAll(elem, sel);
    },
    querySelector(sel) {
      const r = queryAll(elem, sel);
      return r.length ? r[0] : null;
    },
    closest(sel) {
      let cur = elem;
      while (cur) {
        if (matchesSelector(cur, sel)) return cur;
        cur = cur.parentElement;
      }
      return null;
    },
    addEventListener() {},
    removeEventListener() {},
  };
  return elem;
}

function matchesSingle(el, sel) {
  sel = sel.trim();
  if (!sel) return false;
  const tagMatch = /^([a-zA-Z0-9_-]+)/.exec(sel);
  if (tagMatch && el.tagName !== tagMatch[1].toUpperCase()) return false;
  const attrRe = /\[([a-zA-Z0-9_-]+)(?:([*^$]?)=["']?([^"'\]]*)["']?)?\]/g;
  let m;
  while ((m = attrRe.exec(sel)) !== null) {
    const [, name, op, val] = m;
    const actual = el.getAttribute(name);
    if (actual === null) return false;
    if (op === undefined && val === undefined) continue;
    if (op === "" && actual !== val) return false;
    if (op === "*" && !actual.includes(val)) return false;
    if (op === "^" && !actual.startsWith(val)) return false;
    if (op === "$" && !actual.endsWith(val)) return false;
  }
  return true;
}

function matchesSelector(el, sel) {
  return sel.split(",").some((part) => matchesSingle(el, part));
}

function queryAll(root, selector) {
  const results = [];
  const parts = selector.split(",").map((s) => s.trim());
  function walk(node) {
    for (const child of node.children || []) {
      for (const p of parts) {
        if (p.includes(" ")) {
          const [parentSel, childSel] = p.split(/\s+/);
          if (matchesSingle(child, childSel)) {
            let anc = child.parentElement;
            while (anc && anc !== root.parentElement) {
              if (matchesSingle(anc, parentSel)) {
                results.push(child);
                break;
              }
              anc = anc.parentElement;
            }
          }
        } else if (matchesSingle(child, p)) {
          results.push(child);
        }
      }
      walk(child);
    }
  }
  walk(root);
  return results;
}

function createTweetCell(handle, id, text) {
  const cell = createMockElement("div", { "data-testid": "cellInnerDiv" });
  const article = createMockElement("article", { "data-testid": "tweet" });
  const link = createMockElement("a", { href: `/${handle}/status/${id}` });
  const time = createMockElement("time");
  link.appendChild(time);
  const textDiv = createMockElement("div", { "data-testid": "tweetText", lang: "en" });
  textDiv.textContent = text;
  article.appendChild(link);
  article.appendChild(textDiv);
  cell.appendChild(article);
  return cell;
}

function makeGraphQLEntry({
  id,
  handle,
  text,
  bio = "",
  following = false,
  hashtags = [],
  promoted = false,
  hasMedia = false,
  hasUrls = false,
}) {
  return {
    content: {
      itemContent: {
        ...(promoted ? { promotedMetadata: { impressionId: "ad-1" } } : {}),
        tweet_results: {
          result: {
            __typename: "Tweet",
            rest_id: id,
            core: {
              user_results: {
                result: {
                  is_blue_verified: true,
                  relationship_perspectives: { following },
                  core: { screen_name: handle, name: handle },
                  legacy: {
                    screen_name: handle,
                    name: handle,
                    description: bio,
                    followers_count: 5000,
                    friends_count: 200,
                  },
                },
              },
            },
            legacy: {
              full_text: text,
              created_at: "Sat Oct 03 19:23:05 +0000 2026",
              entities: {
                hashtags: hashtags.map((h) => ({ text: h })),
                urls: hasUrls ? [{ expanded_url: "https://example.com" }] : [],
                media: hasMedia ? [{ type: "photo" }] : [],
              },
            },
          },
        },
      },
    },
  };
}

function createSandbox(settings) {
  const htmlEl = createMockElement("html");
  const headEl = createMockElement("head");
  const bodyEl = createMockElement("body");
  htmlEl.appendChild(headEl);
  htmlEl.appendChild(bodyEl);

  const aiBatches = [];
  const fetchResolvers = [];

  class MockXHR {
    open(method, url) {
      this._url = url;
    }
    send() {}
    addEventListener(evt, cb) {
      this._onLoad = cb;
    }
  }

  const document = {
    documentElement: htmlEl,
    head: headEl,
    body: bodyEl,
    readyState: "complete",
    createElement: (t) => createMockElement(t),
    getElementById: () => null,
    querySelector: (s) => htmlEl.querySelector(s),
    querySelectorAll: (s) => htmlEl.querySelectorAll(s),
    addEventListener() {},
  };

  const windowObj = {
    document,
    location: { pathname: "/home", href: "https://x.com/home", search: "", hash: "" },
    history: { pushState() {}, replaceState() {} },
    navigator: { userAgent: "" },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    getComputedStyle: () => ({ display: "block", visibility: "visible", position: "static" }),
    __ROBIN_SETTINGS__: settings,
    XMLHttpRequest: MockXHR,
    fetch(url) {
      return new Promise((resolve) => {
        fetchResolvers.push({ url, resolve });
      });
    },
    webkit: {
      messageHandlers: {
        robinFeedFilter: {
          postMessage(payload) {
            aiBatches.push(payload);
          },
        },
      },
    },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    requestAnimationFrame: (cb) => cb(),
    setTimeout: (cb, ms) => (ms <= 20 ? cb() : 0),
    clearTimeout() {},
    setInterval: () => 0,
    clearInterval() {},
    addEventListener() {},
    removeEventListener() {},
    scrollY: 0,
    innerHeight: 800,
    innerWidth: 390,
    performance: { now: () => Date.now() },
  };
  windowObj.window = windowObj;
  windowObj.self = windowObj;
  windowObj.globalThis = windowObj;

  const src = fs.readFileSync(
    path.resolve(__dirname, "../ios/Robin/Resources/x-filter/filter-core.js"),
    "utf8"
  );
  vm.runInNewContext(src, windowObj);

  return { windowObj, bodyEl, aiBatches, fetchResolvers };
}

async function runTests() {
  // 1. HomeTimeline (For You) with Smart AI mode
  const { windowObj, bodyEl, aiBatches, fetchResolvers } = createSandbox({
    forceFollowing: false,
    hideForYouTab: false,
    preferLatest: false,
    forYouQualityFilter: "ai",
  });

  const cellFollowed = createTweetCell("friend", "1001", "This.");
  const cellHashtagAttr = createTweetCell(
    "Ronald_vanLoon",
    "1002",
    "#AI demo by @orig #ML #Tech #Auto #Data"
  );
  const cellBaitCta = createTweetCell(
    "hustle_bro",
    "1003",
    'Comment "AI" and I\'ll DM you the secret prompt!'
  );
  const cellUselessShort = createTweetCell("hype_reply", "1004", "This.");
  const cellCreator5Tags = createTweetCell(
    "cre8ivepark",
    "1005",
    "My weekend spatial viz #a #b #c #d #e"
  );
  const cellAggregatorAI = createTweetCell(
    "Rainmaker1973",
    "1006",
    "The Butterfly Mendocino Motor by Semyon Nazarov"
  );
  const cellAboveViewport = createTweetCell(
    "slop_above",
    "1007",
    "Formulaic AI slop above viewport"
  );
  cellAboveViewport.setMockRect({ top: -300, bottom: -50, left: 0, right: 390, width: 390, height: 250 });

  for (const c of [
    cellFollowed,
    cellHashtagAttr,
    cellBaitCta,
    cellUselessShort,
    cellCreator5Tags,
    cellAggregatorAI,
    cellAboveViewport,
  ]) {
    bodyEl.appendChild(c);
  }

  // Trigger a mocked HomeTimeline GraphQL fetch
  const fetchPromise = windowObj.fetch(
    "https://x.com/i/api/graphql/abc123/HomeTimeline?variables=%7B%7D"
  );
  const gqlPayload = {
    data: {
      home: {
        home_timeline_urt: {
          instructions: [
            {
              entries: [
                makeGraphQLEntry({ id: "1001", handle: "friend", text: "This.", following: true }),
                makeGraphQLEntry({
                  id: "1002",
                  handle: "Ronald_vanLoon",
                  text: "#AI demo by @orig #ML #Tech #Auto #Data",
                  hashtags: ["AI", "ML", "Tech", "Auto", "Data"],
                }),
                makeGraphQLEntry({
                  id: "1003",
                  handle: "hustle_bro",
                  text: 'Comment "AI" and I\'ll DM you the secret prompt!',
                }),
                makeGraphQLEntry({ id: "1004", handle: "hype_reply", text: "This." }),
                makeGraphQLEntry({
                  id: "1005",
                  handle: "cre8ivepark",
                  text: "My weekend spatial viz #a #b #c #d #e",
                  hashtags: ["a", "b", "c", "d", "e"],
                }),
                makeGraphQLEntry({
                  id: "1006",
                  handle: "Rainmaker1973",
                  text: "The Butterfly Mendocino Motor by Semyon Nazarov",
                }),
                makeGraphQLEntry({
                  id: "1007",
                  handle: "slop_above",
                  text: "Formulaic AI slop above viewport",
                }),
              ],
            },
          ],
        },
      },
    },
  };

  fetchResolvers[0].resolve({
    clone: () => ({
      text: async () => JSON.stringify(gqlPayload),
    }),
  });
  await fetchPromise;
  await new Promise((r) => setImmediate(r));

  // Verify Tier 1 results & exemptions
  assert.strictEqual(cellFollowed.getAttribute("data-mt-quality-hide"), null, "Followed account must never be hidden");
  assert.strictEqual(cellHashtagAttr.getAttribute("data-mt-quality-hide"), "1", "4+ hashtags + by @ should hide in Tier 1");
  assert.strictEqual(cellBaitCta.getAttribute("data-mt-quality-hide"), "1", "Comment X and I'll DM should hide in Tier 1");
  assert.strictEqual(cellUselessShort.getAttribute("data-mt-quality-hide"), "1", "Useless short 'This.' should hide in Tier 1");
  assert.strictEqual(cellCreator5Tags.getAttribute("data-mt-quality-hide"), null, "5 hashtags without attribution should NOT hide in Tier 1");

  // Verify Tier 2 batch only sent the 3 ambiguous unfollowed posts (1005, 1006, 1007)
  assert.strictEqual(aiBatches.length, 1, "Expected 1 batched AI call");
  const sentIds = Array.from(aiBatches[0].posts, (p) => p.id);
  assert.deepStrictEqual(sentIds, ["1005", "1006", "1007"], "Tier 2 batch should exclude followed & Tier-1-hidden posts");

  // Apply native Tier 2 response
  windowObj.__ROBIN_APPLY_FEED_FILTER__({
    keptIds: ["1005"],
    hidden: [
      { id: "1006", handle: "Rainmaker1973", reason: "non_human_aggregator", accountWide: true },
      { id: "1007", handle: "slop_above", reason: "ai_slop", accountWide: false },
    ],
  });

  assert.strictEqual(cellCreator5Tags.getAttribute("data-mt-quality-hide"), null, "AI-kept post must stay visible");
  assert.strictEqual(cellAggregatorAI.getAttribute("data-mt-quality-hide"), "1", "AI-hidden post in viewport must be hidden");
  assert.strictEqual(cellAggregatorAI.style.display, "none", "Hidden cell must have display:none");
  assert.strictEqual(cellAboveViewport.getAttribute("data-mt-quality-hide"), null, "Above-viewport cell must not collapse immediately (scroll-jump protection)");

  // Verify accountWide cache hides a brand-new post from Rainmaker1973 immediately without another AI call
  const cellRainmaker2 = createTweetCell("Rainmaker1973", "1008", "Another viral physics clip");
  bodyEl.appendChild(cellRainmaker2);
  const fetchPromise2 = windowObj.fetch(
    "https://x.com/i/api/graphql/abc123/HomeTimeline?variables=%7B%7D"
  );
  fetchResolvers[1].resolve({
    clone: () => ({
      text: async () =>
        JSON.stringify({
          data: {
            home: {
              home_timeline_urt: {
                instructions: [
                  {
                    entries: [
                      makeGraphQLEntry({
                        id: "1008",
                        handle: "Rainmaker1973",
                        text: "Another viral physics clip",
                      }),
                    ],
                  },
                ],
              },
            },
          },
        }),
    }),
  });
  await fetchPromise2;
  await new Promise((r) => setImmediate(r));

  assert.strictEqual(
    aiBatches.filter((b) => b.posts && b.posts.length > 0).length,
    1,
    "Account-wide cached handle should not trigger a second AI call"
  );
  assert.strictEqual(cellRainmaker2.getAttribute("data-mt-quality-hide"), "1", "Account-wide cached handle should hide immediately");

  // 2. Verify Following feed (HomeLatestTimeline) never hides or calls AI
  const followingEnv = createSandbox({
    forceFollowing: true,
    hideForYouTab: true,
    preferLatest: true,
    forYouQualityFilter: "ai",
  });
  const followingCell = createTweetCell("hype_reply", "2001", "This.");
  followingEnv.bodyEl.appendChild(followingCell);
  const fp = followingEnv.windowObj.fetch(
    "https://x.com/i/api/graphql/abc123/HomeLatestTimeline?variables=%7B%22enableRanking%22%3Afalse%7D"
  );
  followingEnv.fetchResolvers[0].resolve({
    clone: () => ({
      text: async () =>
        JSON.stringify({
          data: {
            home: {
              home_timeline_urt: {
                instructions: [
                  {
                    entries: [makeGraphQLEntry({ id: "2001", handle: "hype_reply", text: "This." })],
                  },
                ],
              },
            },
          },
        }),
    }),
  });
  await fp;
  await new Promise((r) => setImmediate(r));

  assert.strictEqual(followingEnv.aiBatches.length, 0, "Following timeline must never invoke For You AI filter");
  assert.strictEqual(followingCell.getAttribute("data-mt-quality-hide"), null, "Following timeline must never apply quality hide");

  // 3. Verify category / list tabs (GenericTimelineById / ListLatestTweetsTimeline) ARE filtered
  const catEnv = createSandbox({
    forceFollowing: true,
    hideForYouTab: true,
    preferLatest: true,
    hidePageHeader: false,
    forYouQualityFilter: "ai",
  });
  const catCell = createTweetCell("cat_spammer", "3001", "This.");
  catEnv.bodyEl.appendChild(catCell);
  const cp = catEnv.windowObj.fetch(
    "https://x.com/i/api/graphql/xyz789/GenericTimelineById?variables=%7B%7D"
  );
  catEnv.fetchResolvers[0].resolve({
    clone: () => ({
      text: async () =>
        JSON.stringify({
          data: {
            timeline: {
              timeline: {
                instructions: [
                  {
                    entries: [makeGraphQLEntry({ id: "3001", handle: "cat_spammer", text: "This." })],
                  },
                ],
              },
            },
          },
        }),
    }),
  });
  await cp;
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(catCell.getAttribute("data-mt-quality-hide"), "1", "Category tab (GenericTimelineById) should filter low-quality posts");

  console.log("ALL FOR YOU QUALITY FILTER TESTS PASSED!");
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
