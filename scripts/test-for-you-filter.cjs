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
  const withoutAttrs = sel.replace(/\[[^\]]*\]/g, "");
  const tagMatch = /^([a-zA-Z0-9_-]+)/.exec(withoutAttrs);
  if (tagMatch && el.tagName !== tagMatch[1].toUpperCase()) return false;
  const idRe = /#([a-zA-Z0-9_-]+)/g;
  let idMatch;
  while ((idMatch = idRe.exec(withoutAttrs)) !== null) {
    const elId = el.id || el.getAttribute("id") || "";
    if (elId !== idMatch[1]) return false;
  }
  const classRe = /\.([a-zA-Z0-9_-]+)/g;
  let clsMatch;
  while ((clsMatch = classRe.exec(withoutAttrs)) !== null) {
    const cls = clsMatch[1];
    const hasCls =
      (el.classList && el.classList.contains(cls)) ||
      String(el.className || "").split(/\s+/).includes(cls);
    if (!hasCls) return false;
  }
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
  urls = null,
  inReplyTo = null,
  noteTweet = null,
  statusesCount = 500,
  userCreatedAt = "Mon Jan 01 00:00:00 +0000 2024",
}) {
  const result = {
    __typename: "Tweet",
    rest_id: id,
    core: {
      user_results: {
        result: {
          is_blue_verified: true,
          relationship_perspectives: { following },
          core: { screen_name: handle, name: handle, created_at: userCreatedAt },
          legacy: {
            screen_name: handle,
            name: handle,
            description: bio,
            followers_count: 5000,
            friends_count: 200,
            statuses_count: statusesCount,
            created_at: userCreatedAt,
          },
        },
      },
    },
    legacy: {
      full_text: text,
      created_at: "Sat Oct 03 19:23:05 +0000 2026",
      ...(inReplyTo ? { in_reply_to_status_id_str: inReplyTo } : {}),
      entities: {
        hashtags: hashtags.map((h) => ({ text: h })),
        urls: urls || (hasUrls ? [{ expanded_url: "https://example.com" }] : []),
        media: hasMedia ? [{ type: "photo" }] : [],
      },
    },
  };
  if (noteTweet) {
    result.note_tweet = {
      note_tweet_results: {
        result: noteTweet,
      },
    };
  }
  return {
    content: {
      itemContent: {
        ...(promoted ? { promotedMetadata: { impressionId: "ad-1" } } : {}),
        tweet_results: {
          result,
        },
      },
    },
  };
}

function createSandbox(settings, pathname = "/home") {
  const htmlEl = createMockElement("html");
  const headEl = createMockElement("head");
  const bodyEl = createMockElement("body");
  htmlEl.appendChild(headEl);
  htmlEl.appendChild(bodyEl);

  const aiBatches = [];
  const qualityStatuses = [];
  const fetchResolvers = [];
  const docListeners = {};

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
    addEventListener(evt, cb) {
      docListeners[evt] = docListeners[evt] || [];
      docListeners[evt].push(cb);
    },
    dispatchMockEvent(evt, evObj) {
      for (const cb of docListeners[evt] || []) {
        cb(evObj);
      }
    },
  };

  const windowObj = {
    document,
    location: {
      pathname,
      href: `https://x.com${pathname}`,
      search: "",
      hash: "",
    },
    history: {
      pushState(_state, _title, nextUrl) {
        if (nextUrl) {
          const u = new URL(String(nextUrl), "https://x.com");
          windowObj.location.pathname = u.pathname;
          windowObj.location.href = u.href;
        }
      },
      replaceState(_state, _title, nextUrl) {
        if (nextUrl) {
          const u = new URL(String(nextUrl), "https://x.com");
          windowObj.location.pathname = u.pathname;
          windowObj.location.href = u.href;
        }
      },
    },
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
        robinFeedQualityStatus: {
          postMessage(payload) {
            qualityStatuses.push({
              active: Boolean(payload.active),
              count: Number(payload.count),
              revealed: Boolean(payload.revealed),
            });
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

  return { windowObj, bodyEl, document, aiBatches, qualityStatuses, fetchResolvers };
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

  // 4. Long firsthand post with 10 trailing hashtags + mention-pod spam vs reply thread + note_tweet entity_set
  const longEnv = createSandbox({
    forceFollowing: false,
    hideForYouTab: false,
    preferLatest: false,
    forYouQualityFilter: "ai",
  });
  const longProse =
    "Continuing my weekend explorations in spatial data visualization for Deep Space Missions. " +
    "The real challenge is balancing NASA JPL Horizons ephemeris accuracy with readable orbital paths across " +
    "nine robotic probes so visitors can scrub decades of exploration chronologically in a small room and compare " +
    "Cassini, Voyager, Rosetta, OSIRIS-REx, and New Horizons trajectories side by side without clipping any landmarks. ";
  const longCreatorText =
    longProse +
    "#CosmicXR #DeepSpace #XR #Spatial #NASA #JPL #DataViz #Design #Science #Space";
  const mentionPodText =
    "New Raspberry Pi prototype detects track defects using edge AI @user1 @user2 @user3 @user4 @user5 @user6 @user7 @user8";
  const replyWithMentionsText =
    "@alice @bob @carol @dave @eve @frank @grace @heidi Agree on using an explicit backoff timer here.";
  const noteTailCtaText =
    "Here is a 500-character technical overview explaining why deterministic harness evaluation outperforms loose LLM prompting in production systems. " +
    "We logged latency, token budgets, structured outputs, and error recovery across five thousand synthetic runs without seeing drift or regressions. " +
    "Many teams miss the basic setup details for caching repeatable prompts safely across mobile clients and edge Cloud Functions. " +
    'Full architecture checklist ready — Comment "GUIDE" and I\'ll DM you the PDF!';
  const noteWithDomainsText =
    "We open-sourced our reproducible spatial trajectory benchmark along with weights, dataset generator, and evaluation harness for robotics research teams to verify independently on commodity GPUs. " +
    "Full paper and benchmark scripts linked at the bottom so anyone can replicate every table from Section 4 in under ten minutes. " +
    "Source: arxiv.org/abs/2609.02882 and github.com/example/spatial-bench";

  const longCreatorCell = createTweetCell("cre8ivepark", "4001", longCreatorText);
  const mentionPodCell = createTweetCell("bamitav", "4002", mentionPodText);
  const replyCell = createTweetCell("eng_reply", "4003", replyWithMentionsText);
  const noteCtaCell = createTweetCell("hustle_note", "4004", noteTailCtaText);
  const noteDomainsCell = createTweetCell("research_lab", "4005", noteWithDomainsText);
  for (const c of [longCreatorCell, mentionPodCell, replyCell, noteCtaCell, noteDomainsCell]) {
    longEnv.bodyEl.appendChild(c);
  }

  const lp = longEnv.windowObj.fetch("https://x.com/i/api/graphql/abc123/HomeTimeline?variables=%7B%7D");
  longEnv.fetchResolvers[0].resolve({
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
                        id: "4001",
                        handle: "cre8ivepark",
                        text: longCreatorText,
                        hashtags: ["CosmicXR", "DeepSpace", "XR", "Spatial", "NASA", "JPL", "DataViz", "Design", "Science", "Space"],
                      }),
                      makeGraphQLEntry({
                        id: "4002",
                        handle: "bamitav",
                        text: mentionPodText,
                      }),
                      makeGraphQLEntry({
                        id: "4003",
                        handle: "eng_reply",
                        text: replyWithMentionsText,
                        inReplyTo: "999",
                      }),
                      makeGraphQLEntry({
                        id: "4004",
                        handle: "hustle_note",
                        text: noteTailCtaText.slice(0, 260),
                        noteTweet: {
                          text: noteTailCtaText,
                          entity_set: { hashtags: [], urls: [] },
                        },
                      }),
                      makeGraphQLEntry({
                        id: "4005",
                        handle: "research_lab",
                        text: noteWithDomainsText.slice(0, 260),
                        noteTweet: {
                          text: noteWithDomainsText,
                          entity_set: {
                            hashtags: [],
                            urls: [
                              { expanded_url: "https://arxiv.org/abs/2609.02882" },
                              { expanded_url: "https://www.github.com/example/spatial-bench" },
                              { expanded_url: "https://t.co/short" },
                            ],
                          },
                        },
                        statusesCount: 3650,
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
  await lp;
  await new Promise((r) => setImmediate(r));

  assert.strictEqual(longCreatorCell.getAttribute("data-mt-quality-hide"), null, "Long firsthand post with trailing hashtags must NOT hide in Tier 1");
  assert.strictEqual(mentionPodCell.getAttribute("data-mt-quality-hide"), "1", "Non-reply >=8 @mention pod must hide in Tier 1");
  assert.strictEqual(replyCell.getAttribute("data-mt-quality-hide"), null, "Reply thread with 8 leading @mentions must NOT hide as mention pod");
  assert.strictEqual(noteCtaCell.getAttribute("data-mt-quality-hide"), "1", "Long note_tweet ending in DM CTA must hide in Tier 1");

  const longSent = Array.from(longEnv.aiBatches[0].posts);
  assert.deepStrictEqual(
    longSent.map((p) => p.id),
    ["4001", "4003", "4005"],
    "Long creator post, normal reply, and research note should reach Tier 2"
  );
  const sentCreator = longSent.find((p) => p.id === "4001");
  assert(sentCreator.text.includes(" [...] "), "Long text >460 chars must be head+tail sampled");
  assert(sentCreator.text.includes("#Space"), "Tail hashtags should be preserved in sampled text");
  assert(sentCreator.charCount > 460, "charCount should reflect full unsampled length");
  assert.strictEqual(sentCreator.hashtagCount, 10, "hashtagCount should preserve all 10 hashtags");

  const sentResearch = longSent.find((p) => p.id === "4005");
  assert.deepStrictEqual(Array.from(sentResearch.urlDomains), ["arxiv.org", "github.com"], "Should extract clean urlDomains from note_tweet.entity_set excluding t.co");
  assert(sentResearch.text.includes("github.com/example/spatial-bench"), "Tail citation should survive head+tail sampling");
  assert.strictEqual(typeof sentResearch.statusesPerDay, "number", "statusesPerDay should be populated");

  // 5. Cached tab switch on /home updates quality hide state immediately without new GraphQL fetch
  const tabEnv = createSandbox({
    forceFollowing: false,
    hideForYouTab: false,
    preferLatest: false,
    forYouQualityFilter: "ai",
  });
  const tabList = createMockElement("div", { role: "tablist" });
  const tabForYou = createMockElement("div", { role: "tab", "aria-selected": "true" });
  tabForYou.textContent = "For you";
  const tabFollowing = createMockElement("div", { role: "tab", "aria-selected": "false" });
  tabFollowing.textContent = "Following";
  tabList.appendChild(tabForYou);
  tabList.appendChild(tabFollowing);
  tabEnv.bodyEl.appendChild(tabList);

  const tabCell = createTweetCell("slop_tab", "5001", "This.");
  tabEnv.bodyEl.appendChild(tabCell);
  const tp = tabEnv.windowObj.fetch("https://x.com/i/api/graphql/abc123/HomeTimeline?variables=%7B%7D");
  tabEnv.fetchResolvers[0].resolve({
    clone: () => ({
      text: async () =>
        JSON.stringify({
          data: {
            home: {
              home_timeline_urt: {
                instructions: [
                  { entries: [makeGraphQLEntry({ id: "5001", handle: "slop_tab", text: "This." })] },
                ],
              },
            },
          },
        }),
    }),
  });
  await tp;
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(tabCell.getAttribute("data-mt-quality-hide"), "1", "Initially hidden on For you tab");

  // Simulate React switching to Following tab without firing a GraphQL response
  tabForYou.setAttribute("aria-selected", "false");
  tabFollowing.setAttribute("aria-selected", "true");
  tabEnv.document.dispatchMockEvent("click", { target: tabFollowing });
  assert.strictEqual(tabCell.getAttribute("data-mt-quality-hide"), null, "Switching to Following tab must unhide quality cells immediately");

  // Simulate switching back to cached For you tab
  tabFollowing.setAttribute("aria-selected", "false");
  tabForYou.setAttribute("aria-selected", "true");
  tabEnv.document.dispatchMockEvent("click", { target: tabForYou });
  assert.strictEqual(tabCell.getAttribute("data-mt-quality-hide"), "1", "Switching back to For you tab must re-hide cached quality cells immediately");

  // 6. Non-quality paths (/elonmusk) never dispatch AI or hide; /i/communities/123 both dispatches and hides
  const profileEnv = createSandbox(
    { forceFollowing: false, hideForYouTab: false, forYouQualityFilter: "ai" },
    "/elonmusk"
  );
  const profCell = createTweetCell("prof_user", "6001", "This.");
  profileEnv.bodyEl.appendChild(profCell);
  const pp = profileEnv.windowObj.fetch("https://x.com/i/api/graphql/xyz/GenericTimelineById?variables=%7B%7D");
  profileEnv.fetchResolvers[0].resolve({
    clone: () => ({
      text: async () =>
        JSON.stringify({
          data: {
            timeline: {
              timeline: {
                instructions: [
                  { entries: [makeGraphQLEntry({ id: "6001", handle: "prof_user", text: "This." })] },
                ],
              },
            },
          },
        }),
    }),
  });
  await pp;
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(profileEnv.aiBatches.length, 0, "Non-quality path (/elonmusk) must never dispatch AI batches");
  assert.strictEqual(profCell.getAttribute("data-mt-quality-hide"), null, "Non-quality path must never hide cells");

  const commEnv = createSandbox(
    { forceFollowing: false, hideForYouTab: false, forYouQualityFilter: "ai" },
    "/i/communities/123"
  );
  const commCellLocal = createTweetCell("comm_hype", "6002", "This.");
  const commCellAi = createTweetCell("comm_bot", "6003", "Viral reposted clip from someone else");
  commEnv.bodyEl.appendChild(commCellLocal);
  commEnv.bodyEl.appendChild(commCellAi);
  const cmp = commEnv.windowObj.fetch("https://x.com/i/api/graphql/xyz/CommunityTweetsTimeline?variables=%7B%7D");
  commEnv.fetchResolvers[0].resolve({
    clone: () => ({
      text: async () =>
        JSON.stringify({
          data: {
            communityResults: {
              result: {
                ranked_community_timeline: {
                  timeline: {
                    instructions: [
                      {
                        entries: [
                          makeGraphQLEntry({ id: "6002", handle: "comm_hype", text: "This." }),
                          makeGraphQLEntry({ id: "6003", handle: "comm_bot", text: "Viral reposted clip from someone else" }),
                        ],
                      },
                    ],
                  },
                },
              },
            },
          },
        }),
    }),
  });
  await cmp;
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(commCellLocal.getAttribute("data-mt-quality-hide"), "1", "/i/communities/123 must hide Tier 1 slop");
  assert.strictEqual(commEnv.aiBatches.length, 1, "/i/communities/123 must dispatch Tier 2 batch");
  commEnv.windowObj.__ROBIN_APPLY_FEED_FILTER__({
    keptIds: [],
    hidden: [{ id: "6003", handle: "comm_bot", reason: "non_human_aggregator", accountWide: false }],
  });
  assert.strictEqual(commCellAi.getAttribute("data-mt-quality-hide"), "1", "/i/communities/123 must apply Tier 2 AI hide verdicts");

  // 7. retryIds clears qualityQueuedById so skipped/failed posts can re-dispatch
  commEnv.windowObj.__ROBIN_APPLY_FEED_FILTER__({
    keptIds: [],
    hidden: [],
    retryIds: ["6004"],
  });
  const retryFetch1 = commEnv.windowObj.fetch("https://x.com/i/api/graphql/xyz/CommunityTweetsTimeline?variables=%7B%7D");
  commEnv.fetchResolvers[1].resolve({
    clone: () => ({
      text: async () =>
        JSON.stringify({
          data: {
            communityResults: {
              result: {
                ranked_community_timeline: {
                  timeline: {
                    instructions: [
                      { entries: [makeGraphQLEntry({ id: "6004", handle: "author_retry", text: "Borderline post awaiting retry" })] },
                    ],
                  },
                },
              },
            },
          },
        }),
    }),
  });
  await retryFetch1;
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(commEnv.aiBatches.length, 2, "6004 queued on initial fetch");

  commEnv.windowObj.__ROBIN_APPLY_FEED_FILTER__({ keptIds: [], hidden: [], retryIds: ["6004"] });
  const retryFetch2 = commEnv.windowObj.fetch("https://x.com/i/api/graphql/xyz/CommunityTweetsTimeline?variables=%7B%7D");
  commEnv.fetchResolvers[2].resolve({
    clone: () => ({
      text: async () =>
        JSON.stringify({
          data: {
            communityResults: {
              result: {
                ranked_community_timeline: {
                  timeline: {
                    instructions: [
                      { entries: [makeGraphQLEntry({ id: "6004", handle: "author_retry", text: "Borderline post awaiting retry" })] },
                    ],
                  },
                },
              },
            },
          },
        }),
    }),
  });
  await retryFetch2;
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(commEnv.aiBatches.length, 3, "retryIds must allow 6004 to be re-dispatched");

  // 8. Direct unit tests on functions/index.js _internal
  const fnInternal = require("../functions/index.js")._internal;
  assert.strictEqual(fnInternal.sampleText("  hello   world  ", 40, 20, 10), "hello world");
  const headTail = fnInternal.sampleText("HEAD " + "x".repeat(60) + " TAIL", 30, 10, 10);
  assert(headTail.startsWith("HEAD "), "sampleText preserves head");
  assert(headTail.includes(" [...] "), "sampleText inserts [...] separator");
  assert(headTail.endsWith(" TAIL"), "sampleText preserves tail");

  const legacySanitized = fnInternal.sanitizePost({
    id: "7001",
    handle: "legacy_client",
    text: "Hello world",
    followers: 100,
    friends: 50,
  });
  assert.strictEqual(legacySanitized.mentionCount, 0);
  assert.deepStrictEqual(legacySanitized.urlDomains, []);

  const enrichedSanitized = fnInternal.sanitizePost({
    id: "7002",
    handle: "new_client",
    text: "Check our benchmark",
    mentionCount: 2,
    charCount: 512,
    urlDomains: ["www.arXiv.org", "t.co", "github.com", "x.com", "docs.rs"],
    statusesPerDay: 14.37,
    accountAgeDays: 90,
  });
  assert.deepStrictEqual(enrichedSanitized.urlDomains, ["arxiv.org", "github.com", "docs.rs"]);
  assert.strictEqual(enrichedSanitized.statusesPerDay, 14.4);
  const reqPayload = fnInternal.buildDecisionRequest([enrichedSanitized]);
  assert(reqPayload.input.includes("mentions=2"));
  assert(reqPayload.input.includes("chars=512"));
  assert(reqPayload.input.includes("posts/day=14.4"));
  assert(reqPayload.input.includes("age=90d"));
  assert(reqPayload.input.includes("links=arxiv.org,github.com,docs.rs"));

  const verdictPosts = [
    { id: "8001", handle: "ai_borderline" },
    { id: "8002", handle: "ai_clear" },
    { id: "8003", handle: "useless_borderline" },
    { id: "8004", handle: "agg_low_noul" },
    { id: "8005", handle: "agg_high_noul" },
    { id: "8006", handle: "split_prob_agg" },
  ];
  const verdicts = fnInternal.parseDecisionVerdicts(verdictPosts, {
    answers: {
      p0_class: { choice: "ai_slop", confidence: 0.65, probabilities: { keep: 0.28, ai_slop: 0.65 } },
      p0_account_wide: { noul: 0.90 },
      p1_class: { choice: "ai_slop", confidence: 0.72, probabilities: { keep: 0.18, ai_slop: 0.72 } },
      p1_account_wide: { noul: 0.95 },
      p2_class: { choice: "useless_comment", confidence: 0.60, probabilities: { keep: 0.25, useless_comment: 0.60 } },
      p2_account_wide: { noul: 0.10 },
      p3_class: { choice: "non_human_aggregator", confidence: 0.68, probabilities: { keep: 0.20, non_human_aggregator: 0.68 } },
      p3_account_wide: { noul: 0.82 },
      p4_class: { choice: "non_human_aggregator", confidence: 0.80, probabilities: { keep: 0.10, non_human_aggregator: 0.80 } },
      p4_account_wide: { noul: 0.90 },
      p5_class: { choice: "non_human_aggregator", confidence: 0.42, probabilities: { keep: 0.27, non_human_aggregator: 0.42, ai_slop: 0.25 } },
      p5_account_wide: { noul: 0.78 },
    },
  });
  assert.deepStrictEqual(
    verdicts,
    [
      { id: "8002", handle: "ai_clear", reason: "ai_slop", accountWide: false },
      { id: "8004", handle: "agg_low_noul", reason: "non_human_aggregator", accountWide: false },
      { id: "8005", handle: "agg_high_noul", reason: "non_human_aggregator", accountWide: true },
      { id: "8006", handle: "split_prob_agg", reason: "non_human_aggregator", accountWide: false },
    ],
    "Per-category thresholds and aggregator-only 1-strike accountWide must match spec"
  );

  // 9. Show/hide filtered slop toggle, reason labels, count status, tab switch & route transitions
  const revEnv = createSandbox({
    forceFollowing: false,
    hideForYouTab: false,
    preferLatest: false,
    forYouQualityFilter: "ai",
  });
  const revTabList = createMockElement("div", { role: "tablist" });
  const revTabForYou = createMockElement("div", { role: "tab", "aria-selected": "true" });
  revTabForYou.textContent = "For you";
  const revTabFollowing = createMockElement("div", { role: "tab", "aria-selected": "false" });
  revTabFollowing.textContent = "Following";
  revTabList.appendChild(revTabForYou);
  revTabList.appendChild(revTabFollowing);
  revEnv.bodyEl.appendChild(revTabList);

  const revBaitCell = createTweetCell("bait_9", "9001", 'Comment "AI" and I\'ll DM you!');
  const revAggCell = createTweetCell("agg_9", "9002", "Repacked clip via aggregator");
  const revHumanCell = createTweetCell("human_9", "9003", "Building an open-source iOS feed reader.");
  revEnv.bodyEl.appendChild(revBaitCell);
  revEnv.bodyEl.appendChild(revAggCell);
  revEnv.bodyEl.appendChild(revHumanCell);

  const rp = revEnv.windowObj.fetch("https://x.com/i/api/graphql/abc123/HomeTimeline?variables=%7B%7D");
  revEnv.fetchResolvers[0].resolve({
    clone: () => ({
      text: async () =>
        JSON.stringify({
          data: {
            home: {
              home_timeline_urt: {
                instructions: [
                  {
                    entries: [
                      makeGraphQLEntry({ id: "9001", handle: "bait_9", text: 'Comment "AI" and I\'ll DM you!' }),
                      makeGraphQLEntry({ id: "9002", handle: "agg_9", text: "Repacked clip via aggregator" }),
                      makeGraphQLEntry({ id: "9003", handle: "human_9", text: "Building an open-source iOS feed reader." }),
                    ],
                  },
                ],
              },
            },
          },
        }),
    }),
  });
  await rp;
  await new Promise((r) => setImmediate(r));

  revEnv.windowObj.__ROBIN_APPLY_FEED_FILTER__({
    keptIds: ["9003"],
    hidden: [{ id: "9002", handle: "agg_9", reason: "non_human_aggregator", accountWide: false }],
  });

  assert.deepStrictEqual(
    revEnv.qualityStatuses[revEnv.qualityStatuses.length - 1],
    { active: true, count: 2, revealed: false },
    "Status handler must report active=true, count=2, revealed=false after Tier 1 + Tier 2 hides"
  );

  // Toggle reveal ON
  revEnv.windowObj.__ROBIN_SET_REVEAL_SLOP__(true);
  assert.strictEqual(revBaitCell.getAttribute("data-mt-quality-hide"), null, "Reveal ON removes quality hide attr on Tier 1 cell");
  assert.strictEqual(revBaitCell.style.display, "", "Reveal ON restores display on Tier 1 cell");
  assert.strictEqual(revBaitCell.getAttribute("data-mt-quality-revealed"), "1");
  assert.strictEqual(revBaitCell.getAttribute("data-mt-quality-label"), "Filtered \u00b7 Engagement bait");

  assert.strictEqual(revAggCell.getAttribute("data-mt-quality-hide"), null, "Reveal ON removes quality hide attr on AI cell");
  assert.strictEqual(revAggCell.style.display, "", "Reveal ON restores display on AI cell");
  assert.strictEqual(revAggCell.getAttribute("data-mt-quality-revealed"), "1");
  assert.strictEqual(revAggCell.getAttribute("data-mt-quality-label"), "Filtered \u00b7 Aggregator");
  assert.strictEqual(revHumanCell.getAttribute("data-mt-quality-revealed"), null, "Human post must not be marked revealed");
  assert.deepStrictEqual(
    revEnv.qualityStatuses[revEnv.qualityStatuses.length - 1],
    { active: true, count: 2, revealed: true },
    "Status handler must report revealed=true when toggled ON"
  );

  // Toggle reveal OFF
  revEnv.windowObj.__ROBIN_SET_REVEAL_SLOP__(false);
  assert.strictEqual(revBaitCell.getAttribute("data-mt-quality-hide"), "1");
  assert.strictEqual(revBaitCell.style.display, "none");
  assert.strictEqual(revBaitCell.getAttribute("data-mt-quality-revealed"), null);
  assert.strictEqual(revBaitCell.getAttribute("data-mt-quality-label"), null);
  assert.strictEqual(revAggCell.getAttribute("data-mt-quality-hide"), "1");
  assert.strictEqual(revAggCell.style.display, "none");
  assert.deepStrictEqual(
    revEnv.qualityStatuses[revEnv.qualityStatuses.length - 1],
    { active: true, count: 2, revealed: false },
    "Status handler must report revealed=false when toggled OFF"
  );

  // Route navigation to status permalink hides button (active=false), back to /home restores count
  revEnv.windowObj.history.pushState({}, "", "/human_9/status/999");
  assert.deepStrictEqual(
    revEnv.qualityStatuses[revEnv.qualityStatuses.length - 1],
    { active: false, count: 0, revealed: false },
    "Status permalink must deactivate quality status"
  );
  revEnv.windowObj.history.pushState({}, "", "/home");
  assert.deepStrictEqual(
    revEnv.qualityStatuses[revEnv.qualityStatuses.length - 1],
    { active: true, count: 2, revealed: false },
    "Returning to /home must restore active=true and filtered count"
  );

  // Tab switch to Following resets status to inactive / count 0
  revTabForYou.setAttribute("aria-selected", "false");
  revTabFollowing.setAttribute("aria-selected", "true");
  revEnv.document.dispatchMockEvent("click", { target: revTabFollowing });
  assert.deepStrictEqual(
    revEnv.qualityStatuses[revEnv.qualityStatuses.length - 1],
    { active: false, count: 0, revealed: false },
    "Switching to Following tab must reset quality status"
  );

  console.log("ALL FOR YOU QUALITY FILTER TESTS PASSED!");
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
