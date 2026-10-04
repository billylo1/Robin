/**
 * Robin x-filter core — chrome.*-free inject for Android WebView.
 *
 * Adapted from Minimal Theme for Twitter / X (MIT):
 * https://github.com/typefully/minimal-twitter
 * Copyright (c) 2022 Mailbrew Inc.
 *
 * Settings: window.__ROBIN_SETTINGS__ (set by the host before this runs)
 *   forceFollowing: boolean (default true) — true = Following, false = For You
 *   hideForYouTab: boolean (default true) — usually mirrors forceFollowing
 *   hidePromoted: boolean (default true)
 *   preferLatest: boolean (default true) — Following only (Recent vs Popular)
 *   hideWhoToFollow: boolean (default true)
 *   hideLiveContent: boolean (default true) — hide live / Spaces / broadcast promos on home
 *   hideOpenAppNags: boolean (default true)
 *   hidePageHeader: boolean (default true) — hide X avatar/logo/Subscribe/tabs on home
 *   hideComposeButton: boolean (default true) — hide floating / side-nav compose button
 *   fontScale: number (default 1) — page zoom for text size
 * iOS host sets window.__ROBIN_TEXT_SIZE_ADJUST__: WKWebView text ignores html
 * zoom, so scale is applied via -webkit-text-size-adjust instead.
 */
(function () {
  "use strict";
  if (window.__ROBIN_FILTER_INSTALLED__) return;
  window.__ROBIN_FILTER_INSTALLED__ = true;

  // Whether the home feed X last requested is ranked. Following → Popular and
  // Following → Recent both call HomeLatestTimeline; only the enableRanking
  // variable tells them apart. HomeTimeline (For you) is always ranked.
  // null until the first home feed request. Ground truth for preferLatest.
  window.__ROBIN_HOME_OP__ = "";
  window.__ROBIN_HOME_RANKED__ = null;
  var HOME_OP_RE = /\/graphql\/[^/]+\/(HomeLatestTimeline|HomeTimeline)\b/;
  function homeOpOf(url) {
    var m = HOME_OP_RE.exec(String(url || ""));
    return m ? m[1] : "";
  }
  function noteHomeRequest(op, url, body) {
    var vars = null;
    try {
      if (typeof body === "string" && body) vars = JSON.parse(body).variables;
    } catch (e) {}
    if (!vars) {
      try {
        var q = /[?&]variables=([^&]*)/.exec(String(url || ""));
        if (q) vars = JSON.parse(decodeURIComponent(q[1]));
      } catch (e2) {}
    }
    window.__ROBIN_HOME_OP__ = op;
    window.__ROBIN_HOME_RANKED__ =
      vars && typeof vars.enableRanking === "boolean"
        ? vars.enableRanking
        : op === "HomeTimeline";
  }

  // Original post id -> repost time (ms). The DOM only shows the original
  // post's age on reposts; the feed response carries when it was reposted.
  var repostTimes = {};
  function unwrapTweet(r) {
    return r && r.tweet ? r.tweet : r;
  }
  function collectRepost(itemContent) {
    var r = unwrapTweet(
      itemContent && itemContent.tweet_results && itemContent.tweet_results.result
    );
    var lg = r && r.legacy;
    var rt = unwrapTweet(
      lg && lg.retweeted_status_result && lg.retweeted_status_result.result
    );
    if (!rt || !rt.rest_id || !lg.created_at) return;
    var t = Date.parse(lg.created_at);
    if (!isNaN(t) && !(repostTimes[rt.rest_id] > t)) repostTimes[rt.rest_id] = t;
  }
  function collectRepostTimes(text) {
    try {
      var ins = JSON.parse(text).data.home.home_timeline_urt.instructions || [];
      for (var i = 0; i < ins.length; i++) {
        var es = ins[i].entries || [];
        for (var k = 0; k < es.length; k++) {
          var c = es[k].content || {};
          if (c.itemContent) collectRepost(c.itemContent);
          var items = c.items || [];
          for (var n = 0; n < items.length; n++) {
            collectRepost(items[n].item && items[n].item.itemContent);
          }
        }
      }
    } catch (e) {}
  }

  try {
    var origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      var op = homeOpOf(url);
      this.__mtHomeOp = op;
      this.__mtHomeUrl = url;
      if (op) {
        var xhr = this;
        xhr.addEventListener("load", function () {
          if (typeof xhr.responseText === "string") collectRepostTimes(xhr.responseText);
        });
      }
      return origOpen.apply(this, arguments);
    };
    var origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (body) {
      if (this.__mtHomeOp) noteHomeRequest(this.__mtHomeOp, this.__mtHomeUrl, body);
      return origSend.apply(this, arguments);
    };
    var origFetch = window.fetch;
    if (origFetch) {
      window.fetch = function (input, init) {
        var p = origFetch.apply(this, arguments);
        var url = typeof input === "string" ? input : input && input.url;
        var op = homeOpOf(url);
        if (op) {
          noteHomeRequest(op, url, init && init.body);
          p.then(function (res) {
            return res.clone().text().then(collectRepostTimes);
          }).catch(function () {});
        }
        return p;
      };
    }
  } catch (e) {}

  var defaults = {
    forceFollowing: true,
    hideForYouTab: true,
    hidePromoted: true,
    preferLatest: true,
    hideWhoToFollow: true,
    hideLiveContent: true,
    hideOpenAppNags: true,
    hidePageHeader: true,
    hideComposeButton: true,
    fontScale: 1,
  };

  function currentSettings() {
    return Object.assign({}, defaults, window.__ROBIN_SETTINGS__ || {});
  }

  function isHomePath() {
    var p = location.pathname || "";
    return p === "/" || p === "/home" || p.indexOf("/home") === 0;
  }

  /** Track home so leave-home can undo sticky inline display:none. */
  var wasOnHome = isHomePath();

  function markRobinHide(el) {
    if (!el) return;
    el.setAttribute("data-mt-robin-hide", "1");
    el.style.setProperty("display", "none", "important");
  }

  function setImportant(el, prop, value) {
    if (!el) return;
    if (
      el.style.getPropertyValue(prop) === value &&
      el.style.getPropertyPriority(prop) === "important"
    ) {
      return;
    }
    el.style.setProperty(prop, value, "important");
  }

  /**
   * Short visible-label sample that does not lay out the subtree.
   * innerText on a timeline wrapper stringifies every mounted tweet and
   * gets slower the further down the feed you are.
   */
  function boundedText(el, maxLen) {
    if (!el) return "";
    var limit = maxLen || 120;
    var out = "";
    function walk(node, depth) {
      if (!node || out.length >= limit || depth > 8) return;
      if (node.nodeType === 3) {
        if (node.nodeValue) out += " " + node.nodeValue;
        return;
      }
      if (node.nodeType !== 1) return;
      if (node.getAttribute && node.getAttribute("data-testid") === "tweet") return;
      var kids = node.childNodes;
      for (var i = 0; i < kids.length; i++) {
        walk(kids[i], depth + 1);
        if (out.length >= limit) return;
      }
    }
    walk(el, 0);
    return out.replace(/\s+/g, " ").trim().slice(0, limit).toLowerCase();
  }

  function clearRobinHides() {
    var nodes = document.querySelectorAll("[data-mt-robin-hide]");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      el.style.removeProperty("display");
      el.removeAttribute("data-mt-robin-hide");
    }
  }

  function tabLabel(el) {
    return (el && (el.getAttribute("aria-label") || el.textContent || "") || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  // --- Following / Latest (Minimal Twitter patterns + mobile Sort by) ---
  // Ports changeFollowingTimeline / changeLatestTweets from:
  // https://github.com/typefully/minimal-twitter (timeline.js)
  // Mobile Following is Grok-ranked; chronological needs Sort by → Recent.

  var TIMELINE_TABLIST = "div[data-testid='ScrollSnap-List'][role='tablist']";

  function getTimelineTablist() {
    return document.querySelector(TIMELINE_TABLIST);
  }

  function isFollowingLabel(label) {
    return (
      label === "following" ||
      label === "フォロー中" ||
      label === "seguindo" ||
      label === "abonnements" ||
      label === "siguiendo"
    );
  }

  function isForYouLabel(label) {
    return (
      label === "for you" ||
      label === "おすすめ" ||
      label === "para ti" ||
      label === "pour vous" ||
      label.indexOf("for you") !== -1
    );
  }

  function tabNodeLabel(t) {
    var label = tabLabel(t);
    var shortTxt = (t.innerText || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (shortTxt && shortTxt.length <= 20) label = shortTxt;
    return label;
  }

  function findHomeTabs() {
    var following = null;
    var forYou = null;
    // Prefer label match — presentation order is only safe on verified mobile tabs.
    // Wide Mac / tablet layouts can expose other tablists; never click those.
    var nodes = document.querySelectorAll(
      "div[role='tab'], a[role='tab'], [role='tab']"
    );
    for (var i = 0; i < nodes.length; i++) {
      var t = nodes[i];
      var r = t.getBoundingClientRect();
      if (r.top > 280 || r.height === 0) continue;
      var label = tabNodeLabel(t);
      if (!following && isFollowingLabel(label)) following = t;
      if (!forYou && isForYouLabel(label)) forYou = t;
    }
    if (following && forYou) return { following: following, forYou: forYou };

    // Mobile ScrollSnap heuristic only when both labels verify as home tabs.
    var tablist = getTimelineTablist();
    if (tablist) {
      var presentations = tablist.querySelectorAll("div[role='presentation']");
      if (presentations.length >= 2) {
        var candForYou =
          presentations[0].querySelector("div[role='tab'], a[role='tab'], a") ||
          presentations[0];
        var candFollowing =
          presentations[1].querySelector("div[role='tab'], a[role='tab'], a") ||
          presentations[1];
        if (
          isForYouLabel(tabNodeLabel(candForYou)) &&
          isFollowingLabel(tabNodeLabel(candFollowing))
        ) {
          forYou = forYou || candForYou;
          following = following || candFollowing;
        }
      }
    }
    return { following: following, forYou: forYou };
  }

  function isTabSelected(el) {
    if (!el) return false;
    if (el.getAttribute("aria-selected") === "true") return true;
    var tab = el.querySelector && el.querySelector("[aria-selected='true']");
    return !!tab;
  }

  var lastFollowClick = 0;
  function forceFollowing() {
    // Port of changeFollowingTimeline (minimal-twitter).
    var settings = currentSettings();
    if (!settings.forceFollowing || !isHomePath()) return;
    var now = Date.now();
    if (now - lastFollowClick < 1500) return;
    if (
      window.__ROBIN_USER_PICKED_TAB__ &&
      now - window.__ROBIN_USER_PICKED_TAB__ < 8000
    ) {
      return;
    }

    var tabs = findHomeTabs();
    if (!tabs.following || isTabSelected(tabs.following)) return;
    // Require a verified Following control — never click a guessed nth tab.
    if (!isFollowingLabel(tabNodeLabel(tabs.following))) return;
    lastFollowClick = now;
    try {
      tabs.following.click();
    } catch (e) {}
  }

  function forceForYou() {
    var settings = currentSettings();
    if (settings.forceFollowing || !isHomePath()) return;
    var now = Date.now();
    if (now - lastFollowClick < 1500) return;
    if (
      window.__ROBIN_USER_PICKED_TAB__ &&
      now - window.__ROBIN_USER_PICKED_TAB__ < 8000
    ) {
      return;
    }

    var tabs = findHomeTabs();
    if (!tabs.forYou || isTabSelected(tabs.forYou)) return;
    if (!isForYouLabel(tabNodeLabel(tabs.forYou))) return;
    lastFollowClick = now;
    try {
      tabs.forYou.click();
    } catch (e) {}
  }

  function hideForYouTab() {
    var settings = currentSettings();
    var tabs = findHomeTabs();
    if (!tabs.forYou) return;
    if (settings.hideForYouTab) {
      tabs.forYou.style.setProperty("display", "none", "important");
    } else {
      tabs.forYou.style.removeProperty("display");
    }
  }

  function textOf(el) {
    return ((el && (el.innerText || el.textContent)) || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function findSortSheetRoot() {
    // Mobile "Sort by" sheet: Popular + Recent (+ Cancel).
    var layers = document.getElementById("layers");
    var roots = [];
    if (layers) roots.push(layers);
    var menus = document.querySelectorAll(
      "[role='menu'], [role='listbox'], [data-testid='Dropdown'], [role='dialog']"
    );
    for (var i = 0; i < menus.length; i++) roots.push(menus[i]);
    for (var r = 0; r < roots.length; r++) {
      var t = textOf(roots[r]);
      if (
        (t.indexOf("popular") !== -1 || t.indexOf("人気") !== -1) &&
        (t.indexOf("recent") !== -1 ||
          t.indexOf("latest") !== -1 ||
          t.indexOf("最新") !== -1)
      ) {
        return roots[r];
      }
    }
    return null;
  }

  function findChoiceRow(root, names) {
    if (!root) return null;
    var nodes = root.querySelectorAll(
      "[role='menuitem'], [role='menuitemradio'], [role='option'], [role='button'], button, div[tabindex='0'], span, div"
    );
    var exact = null;
    var prefix = null;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var t = textOf(n);
      if (!t || t.length > 48) continue;
      // Prefer leaf rows whose visible text is exactly the label (not "Sort by Popular Recent").
      var leaf = (n.innerText || "").replace(/\s+/g, " ").trim().toLowerCase();
      for (var j = 0; j < names.length; j++) {
        if (leaf === names[j]) {
          exact =
            n.closest(
              "[role='menuitem'], [role='menuitemradio'], [role='option'], [role='button'], button, div[tabindex='0']"
            ) || n;
          break;
        }
        if (!prefix && (leaf.indexOf(names[j]) === 0 || t === names[j])) {
          prefix =
            n.closest(
              "[role='menuitem'], [role='menuitemradio'], [role='option'], [role='button'], button, div[tabindex='0']"
            ) || n;
        }
      }
      if (exact) break;
    }
    return exact || prefix;
  }

  function dismissSortSheet(root) {
    var scope = root || findSortSheetRoot() || document.getElementById("layers");
    if (!scope) return;
    var cancel = findChoiceRow(scope, ["cancel", "close", "done", "閉じる"]);
    if (cancel) {
      try {
        cancel.click();
      } catch (e) {}
      return;
    }
    try {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          bubbles: true,
        })
      );
    } catch (e2) {}
  }

  var RECENT_NAMES = ["recent", "most recent", "latest", "最新", "新着", "時系列"];

  var lastSortClick = 0;

  function preferLatest() {
    // Port of changeLatestTweets, gated on whether the requested feed is ranked.
    var settings = currentSettings();
    if (!settings.preferLatest || !isHomePath()) return;
    // Reverse-chron sort only applies to Following, not For You.
    if (!settings.forceFollowing) {
      window.__ROBIN_LATEST_OK__ = true;
      return;
    }

    var ranked = window.__ROBIN_HOME_RANKED__;
    var sheet = findSortSheetRoot();

    if (ranked === false) {
      window.__ROBIN_LATEST_OK__ = true;
      if (sheet && window.__ROBIN_SHEET_BY_US__) dismissSortSheet(sheet);
      window.__ROBIN_SHEET_BY_US__ = false;
      return;
    }
    window.__ROBIN_LATEST_OK__ = false;
    if (ranked !== true) return; // feed not requested yet

    var tabs = findHomeTabs();
    if (tabs.following && !isTabSelected(tabs.following)) return;

    if (sheet) {
      var recent = findChoiceRow(sheet, RECENT_NAMES);
      if (recent) {
        try {
          recent.click();
        } catch (e) {}
      }
      return;
    }

    var now = Date.now();
    if (now - lastSortClick < 3000) return;

    // Desktop: Timeline options / Top Tweets on → first menu item (minimal-twitter).
    var legacy =
      document.querySelector("div[aria-label='Timeline options']") ||
      document.querySelector("div[aria-label='Top Tweets on']");
    if (legacy) {
      lastSortClick = now;
      try {
        legacy.click();
      } catch (e2) {}
      setTimeout(function () {
        if (findSortSheetRoot()) return;
        var menuitem = document.querySelector("div[role='menuitem'][tabindex='0']");
        if (menuitem) {
          try {
            menuitem.click();
          } catch (e3) {}
        }
      }, 120);
      return;
    }

    // Mobile: tapping the selected Following tab (aria-haspopup) opens Sort by.
    var following = tabs.following;
    if (!following || !isTabSelected(following)) return;
    var opener = following.getAttribute("aria-haspopup")
      ? following
      : following.querySelector && following.querySelector("[aria-haspopup]");
    if (!opener) return;
    lastSortClick = now;
    window.__ROBIN_SHEET_BY_US__ = true;
    try {
      opener.click();
    } catch (e4) {}
  }

  function shortAge(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) return s + "s";
    if (s < 3600) return Math.floor(s / 60) + "m";
    if (s < 86400) return Math.floor(s / 3600) + "h";
    return Math.floor(s / 86400) + "d";
  }

  function labelRepostTimes(root) {
    if (!currentSettings().preferLatest || !isHomePath()) return;
    var scope = root && root.querySelectorAll ? root : document;
    var ctxs;
    if (
      scope !== document &&
      scope.matches &&
      scope.matches('[data-testid="socialContext"]')
    ) {
      ctxs = [scope];
    } else {
      ctxs = scope.querySelectorAll('[data-testid="socialContext"]');
    }
    var now = Date.now();
    for (var i = 0; i < ctxs.length; i++) {
      var ctx = ctxs[i];
      var art = ctx.closest("article");
      var link = art && art.querySelector('a[href*="/status/"] time');
      link = link && link.closest("a");
      var m = link && /\/status\/(\d+)/.exec(link.getAttribute("href") || "");
      var t = m && repostTimes[m[1]];
      var tag = ctx.querySelector(".mt-repost-time");
      if (!t) {
        if (tag) tag.remove();
        continue;
      }
      var label = " · " + shortAge(now - t);
      if (!tag) {
        tag = document.createElement("span");
        tag.className = "mt-repost-time";
        ctx.appendChild(tag);
      }
      if (tag.textContent !== label) tag.textContent = label;
    }
  }

  function hideOpenAppNags() {
    if (!currentSettings().hideOpenAppNags) return;
    var nodes = document.querySelectorAll(
      'a[href*="twitter://"], a[href*="apps.apple.com"], a[href*="play.google.com"][href*="com.twitter"]'
    );
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var text = (n.textContent || "").toLowerCase();
      if (
        text.indexOf("app") !== -1 ||
        text.indexOf("open") !== -1 ||
        text.indexOf("install") !== -1 ||
        text.indexOf("get") !== -1
      ) {
        var sheet = n.closest('[role="dialog"]') || n.closest("div[data-testid]");
        if (sheet) sheet.style.setProperty("display", "none", "important");
      }
    }
  }

  function hideWhoToFollowBlocks(root) {
    if (!currentSettings().hideWhoToFollow) return;
    var scope = root && root.querySelectorAll ? root : document;
    var seen = typeof WeakSet === "function" ? new WeakSet() : null;
    function consider(h) {
      if (!h || (seen && seen.has(h))) return;
      if (seen) seen.add(h);
      var t = (h.textContent || "").trim().toLowerCase();
      if (
        t === "who to follow" ||
        t === "topics to follow" ||
        t === "subscribe to premium"
      ) {
        var block =
          h.closest('[data-testid="cellInnerDiv"]') ||
          h.closest("section") ||
          h.parentElement;
        if (block) block.style.setProperty("display", "none", "important");
      }
    }
    if (scope.matches && scope.matches("h2, span")) consider(scope);
    var wide =
      scope === document ||
      scope === document.documentElement ||
      scope === document.body;
    if (wide) {
      // A document-wide "span" query grows with every tweet still mounted.
      var heads = scope.querySelectorAll("h2");
      var spans = scope.querySelectorAll(
        "[data-testid='cellInnerDiv'] span, section span, aside span, [role='region'] span"
      );
      for (var hi = 0; hi < heads.length; hi++) consider(heads[hi]);
      for (var si = 0; si < spans.length; si++) consider(spans[si]);
      return;
    }
    var local = scope.querySelectorAll("h2, span");
    for (var li = 0; li < local.length; li++) consider(local[li]);
  }

  var LIVE_LINK_RE =
    /\/i\/broadcast\/|\/i\/spaces\/|\/i\/events\/|\/live(?:\/|$|\?)/i;

  function testIdLooksLive(tid) {
    if (!tid) return false;
    var t = tid.toLowerCase();
    return (
      t.indexOf("spacecard") !== -1 ||
      t.indexOf("spacelive") !== -1 ||
      t === "space" ||
      t.indexOf("broadcast") !== -1 ||
      t.indexOf("liveevent") !== -1
    );
  }

  function cellHasNormalTweetText(cell) {
    return !!cell.querySelector('[data-testid="tweetText"]');
  }

  function cellLooksLikeLivePromo(cell) {
    if (!cell) return false;
    var links = cell.querySelectorAll("a[href]");
    var hasLiveLink = false;
    for (var li = 0; li < links.length; li++) {
      var href = links[li].getAttribute("href") || "";
      if (LIVE_LINK_RE.test(href)) {
        hasLiveLink = true;
        break;
      }
    }
    var liveTestId = false;
    var tidNodes = cell.querySelectorAll("[data-testid]");
    for (var ti = 0; ti < tidNodes.length; ti++) {
      if (testIdLooksLive(tidNodes[ti].getAttribute("data-testid"))) {
        liveTestId = true;
        break;
      }
    }
    if (hasLiveLink || liveTestId) {
      if (!cellHasNormalTweetText(cell)) return true;
      if (liveTestId && !cell.querySelector('article[data-testid="tweet"]')) {
        return true;
      }
    }
    if (cellHasNormalTweetText(cell)) return false;
    if (
      cell.querySelector('[data-testid="liveBadge"], [data-testid="LiveBadge"]')
    ) {
      return true;
    }
    var labelled = cell.querySelectorAll("[aria-label]");
    for (var ai = 0; ai < labelled.length; ai++) {
      var al = (labelled[ai].getAttribute("aria-label") || "").toLowerCase();
      if (al.indexOf("live") !== -1 && al.indexOf("live photo") === -1) return true;
    }
    // textContent avoids the layout innerText forces on every cell.
    var compact = (cell.textContent || "").replace(/\s+/g, " ").trim();
    if (compact.length > 280) return false;
    if (/\blive\b/i.test(compact) && (hasLiveLink || liveTestId)) return true;
    if (
      /\+\d[\d,.]*\s*[·•]\s*.+/i.test(compact) &&
      /\b(live|space|broadcast|event|listening)\b/i.test(compact)
    ) {
      return true;
    }
    return false;
  }

  function hideLiveChipNodes(root) {
    var scope = root || document;
    var chips = scope.querySelectorAll(
      [
        '[data-testid="SpaceCard"]',
        '[data-testid="spaceLive"]',
        '[data-testid="space"]',
        '[data-testid="liveBadge"]',
        '[data-testid="LiveBadge"]',
        'a[href*="/i/broadcast/"]',
        'a[href*="/i/spaces/"]',
        'a[href*="/i/events/"]',
        'a[href*="/live"]',
      ].join(",")
    );
    for (var i = 0; i < chips.length; i++) {
      var el = chips[i];
      // Prefer the compact card/chip wrapper over a raw status link ancestor.
      var wrap =
        el.closest('[data-testid="card.wrapper"]') ||
        el.closest('[data-testid="card.layoutLarge.media"]') ||
        el.closest('[data-testid="card.layoutSmall.media"]') ||
        el;
      // Skip ordinary in-status permalinks that only mention /live in query noise.
      if (wrap.tagName === "A") {
        var href = wrap.getAttribute("href") || "";
        if (!LIVE_LINK_RE.test(href)) continue;
      }
      markRobinHide(wrap);
    }
  }

  function hideLiveContentBlocks(root) {
    if (!currentSettings().hideLiveContent || !isHomePath()) return;
    var scope = root && root.querySelectorAll ? root : document;
    // Embedded magenta “+N · Event” chips inside tweets.
    hideLiveChipNodes(scope);
    // Dedicated live/broadcast timeline modules (no normal tweet body).
    var cells;
    if (scope.getAttribute && scope.getAttribute("data-testid") === "cellInnerDiv") {
      cells = [scope];
    } else {
      cells = scope.querySelectorAll('[data-testid="cellInnerDiv"]');
    }
    for (var i = 0; i < cells.length; i++) {
      if (cells[i].getAttribute("data-mt-robin-hide") === "1") continue;
      if (cellLooksLikeLivePromo(cells[i])) markRobinHide(cells[i]);
    }
  }

  function syncPageHeaderFlags() {
    var settings = currentSettings();
    var root = document.documentElement;
    if (!root) return;
    var home = isHomePath();
    // SPA leave-home: undo sticky inline hides so status / back-to-feed stay visible.
    if (wasOnHome && !home) clearRobinHides();
    wasOnHome = home;
    if (home) root.setAttribute("data-mt-home", "1");
    else root.removeAttribute("data-mt-home");
    root.classList.toggle("mt-hide-page-header", !!settings.hidePageHeader);
    root.classList.toggle("mt-hide-compose", !!settings.hideComposeButton);
    root.classList.toggle("mt-hide-live", !!settings.hideLiveContent);
    // Keep TopNavBar visible until X is confirmed loading HomeLatestTimeline.
    var deferChrome =
      home &&
      !!settings.hidePageHeader &&
      !!settings.forceFollowing &&
      !!settings.preferLatest &&
      !window.__ROBIN_LATEST_OK__;
    if (deferChrome) root.setAttribute("data-mt-defer-feed-chrome", "1");
    else root.removeAttribute("data-mt-defer-feed-chrome");
  }

  function hideComposeButtonFallback() {
    if (!currentSettings().hideComposeButton) return;
    var selectors = [
      'a[data-testid="SideNav_NewTweet_Button"]',
      'a[href="/compose/post"]',
      'a[href="/compose/tweet"]',
      'a[href="/compose/post/"]',
    ];
    for (var s = 0; s < selectors.length; s++) {
      var nodes = document.querySelectorAll(selectors[s]);
      for (var i = 0; i < nodes.length; i++) {
        markRobinHide(nodes[i]);
      }
    }
    // Mobile FAB: fixed/absolute round button near bottom-right linking to compose
    var links = document.querySelectorAll('a[href*="/compose/"]');
    for (var li = 0; li < links.length; li++) {
      var a = links[li];
      var st = window.getComputedStyle(a);
      if (st.position !== "fixed" && st.position !== "absolute") continue;
      var r = a.getBoundingClientRect();
      if (r.width >= 40 && r.width <= 72 && r.height >= 40 && r.height <= 72 && r.bottom > window.innerHeight - 120) {
        markRobinHide(a);
      }
    }
  }

  var chromePassHref = "";

  function hidePageHeaderFallback() {
    if (!currentSettings().hidePageHeader || !isHomePath()) return;

    var deferFeedChrome =
      !!currentSettings().forceFollowing &&
      !!currentSettings().preferLatest &&
      !window.__ROBIN_LATEST_OK__;

    // Steady-state scrolling used to re-run the layout walk below on every
    // mutation. Once chrome is hidden for this URL, a couple of selectors
    // are enough to notice a remount.
    if (!deferFeedChrome && chromePassHref === location.href) {
      var existing = document.querySelector('[data-testid="TopNavBar"]');
      var barOk = !existing || existing.getAttribute("data-mt-robin-hide") === "1";
      var composer = document.querySelector(
        '[data-testid="tweetTextarea_0"], [data-testid^="tweetTextarea_"]'
      );
      var composerOk =
        !composer ||
        (composer.closest && composer.closest("[data-mt-robin-hide]"));
      if (barOk && composerOk) return;
    }

    // Mobile TopNavBar + any banner (mobile spacer or desktop left rail)
    var bar = document.querySelector('[data-testid="TopNavBar"]');
    if (bar && !deferFeedChrome) {
      markRobinHide(bar);
    }
    var banners = document.querySelectorAll('header[role="banner"]');
    for (var bi = 0; bi < banners.length; bi++) {
      markRobinHide(banners[bi]);
    }
    var side = document.querySelector('[data-testid="sidebarColumn"]');
    if (side) markRobinHide(side);

    // Desktop / Mac: Following switcher + inline composer at top of feed
    var col = document.querySelector('[data-testid="primaryColumn"]');
    if (!col) return;
    setImportant(col, "max-width", "min(100%, 840px)");
    setImportant(col, "width", "100%");
    setImportant(col, "margin-left", "auto");
    setImportant(col, "margin-right", "auto");

    var kids = col.children;
    for (var ci = 0; ci < Math.min(kids.length, 3); ci++) {
      setImportant(kids[ci], "max-width", "none");
      setImportant(kids[ci], "width", "100%");
    }

    for (var ti = 0; ti < Math.min(kids.length, 8); ti++) {
      var block = kids[ti];
      var br = block.getBoundingClientRect();
      if (br.height === 0) continue;
      if (br.top > 240) break;
      var bt = boundedText(block, 120);
      var hasCompose = !!block.querySelector(
        '[data-testid="tweetTextarea_0"], [data-testid^="tweetTextarea_"], [data-testid="toolBar"], [data-testid="tweetButtonInline"]'
      );
      var hasFeedSwitch =
        bt.indexOf("following") !== -1 ||
        bt.indexOf("for you") !== -1 ||
        !!block.querySelector(
          '[role="tablist"], [role="tab"], [data-testid="ScrollSnap-List"]'
        );
      if (hasCompose && br.height < 480) {
        // Don't hide a top block that also owns the timeline.
        if (!block.querySelector('article[data-testid="tweet"]')) {
          markRobinHide(block);
        }
        continue;
      }
      if (hasFeedSwitch && br.height < 100 && !deferFeedChrome) {
        markRobinHide(block);
      }
    }

    if (!deferFeedChrome) {
      // Walk up from the tablist only. querySelectorAll("div") + getComputedStyle
      // on the whole column was the multi-second hitch deep in the feed.
      var tablist = col.querySelector(
        '[data-testid="ScrollSnap-List"], [data-testid="ScrollSnap-SwipeableList"], [role="tablist"]'
      );
      var el = tablist;
      for (var depth = 0; el && el !== col && depth < 8; depth++) {
        var st = window.getComputedStyle(el);
        if (
          (st.position === "sticky" || st.position === "fixed") &&
          !el.querySelector('article[data-testid="tweet"]')
        ) {
          markRobinHide(el);
        }
        el = el.parentElement;
      }
    }

    hideInlineHomeComposer(col);
    if (!deferFeedChrome) chromePassHref = location.href;
  }

  /** Hide the home “What’s happening?” draft box; never touch reply composers. */
  function hideInlineHomeComposer(col) {
    if (!col) return;
    var hooks = col.querySelectorAll(
      '[data-testid="tweetTextarea_0"], [data-testid^="tweetTextarea_"], [data-testid="toolBar"], [data-testid="tweetButtonInline"], div[role="textbox"][contenteditable="true"]'
    );
    var hidden = {};
    for (var hi = 0; hi < hooks.length; hi++) {
      var hook = hooks[hi];
      if (hook.closest && hook.closest('article[data-testid="tweet"]')) continue;
      var hr = hook.getBoundingClientRect();
      // Top-of-feed composer only (reply boxes sit lower in the column).
      if (hr.top > 420) continue;
      var p = hook;
      var best = null;
      for (var k = 0; k < 16 && p && p !== col; k++) {
        // Never hide a wrapper that also contains the timeline.
        if (p.querySelector && p.querySelector('article[data-testid="tweet"]')) {
          break;
        }
        var r = p.getBoundingClientRect();
        if (r.height >= 48 && r.height <= 520 && r.top < 480) {
          var t = boundedText(p, 200);
          var looksCompose =
            t.indexOf("what") !== -1 ||
            t.indexOf("happening") !== -1 ||
            !!p.querySelector(
              '[data-testid="toolBar"], [data-testid="tweetButtonInline"], [data-testid="fileInput"]'
            );
          if (looksCompose) best = p;
        }
        p = p.parentElement;
      }
      if (!best) {
        // Fallback: hide a mid-sized ancestor near the top even without copy match.
        p = hook;
        for (var k2 = 0; k2 < 10 && p && p !== col; k2++) {
          if (p.querySelector && p.querySelector('article[data-testid="tweet"]')) {
            break;
          }
          var r2 = p.getBoundingClientRect();
          if (r2.height >= 72 && r2.height <= 420 && r2.top < 360) {
            best = p;
            break;
          }
          p = p.parentElement;
        }
      }
      if (best && !hidden[best]) {
        // Final guard: do not blank the feed column.
        if (best.querySelector && best.querySelector('article[data-testid="tweet"]')) {
          continue;
        }
        hidden[best] = true;
        markRobinHide(best);
      }
    }

    // Trends module label (sidebar or misplaced in main on wide layouts)
    var regions = document.querySelectorAll(
      '[aria-label="What\'s happening"], [aria-label="What’s happening"], [aria-label="Timeline: Trending now"]'
    );
    for (var ri = 0; ri < regions.length; ri++) {
      var region = regions[ri];
      if (region.querySelector && region.querySelector('article[data-testid="tweet"]')) {
        continue;
      }
      markRobinHide(region);
    }
  }

  function applyFontScale() {
    var scale = currentSettings().fontScale;
    if (typeof scale !== "number" || !(scale > 0)) scale = 1;
    var root = document.documentElement;
    if (!root) return;
    if (window.__ROBIN_TEXT_SIZE_ADJUST__) {
      var pct = Math.round(scale * 100) + "%";
      if (root.style.getPropertyValue("-webkit-text-size-adjust") !== pct) {
        root.style.setProperty("-webkit-text-size-adjust", pct, "important");
      }
      if (root.style.zoom) root.style.removeProperty("zoom");
      if (window.__ROBIN_SCALE_LINE_HEIGHT__) scaleFixedLineHeights(scale);
      return;
    }
    // zoom:1 still puts the document on Android WebView's zoom path, which
    // rasterizes slower as the feed gets taller. Only zoom when asked.
    if (scale === 1) {
      if (root.style.zoom) root.style.removeProperty("zoom");
      return;
    }
    var zoom = String(scale);
    if (root.style.zoom !== zoom) root.style.zoom = zoom;
  }

  window.__ROBIN_APPLY_FONT_SCALE__ = applyFontScale;

  // Mac WebKit's text-size-adjust grows fonts but not fixed px line-heights,
  // so mirror X's `line-height: Npx` rules scaled by the same factor.
  var lhState = { scale: 1, ruleCount: -1 };
  function scaleFixedLineHeights(scale) {
    var sheets = document.styleSheets;
    var count = 0;
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i].ownerNode && sheets[i].ownerNode.id === "robin-lh-scale") continue;
      try {
        count += sheets[i].cssRules.length;
      } catch (e) {}
    }
    if (count === lhState.ruleCount && scale === lhState.scale) return;
    lhState.ruleCount = count;
    lhState.scale = scale;

    var style = document.getElementById("robin-lh-scale");
    if (!style) {
      style = document.createElement("style");
      style.id = "robin-lh-scale";
      (document.head || document.documentElement).appendChild(style);
    }
    if (scale === 1) {
      style.textContent = "";
      return;
    }
    var out = [];
    for (var s = 0; s < sheets.length; s++) {
      if (sheets[s].ownerNode === style) continue;
      var rules;
      try {
        rules = sheets[s].cssRules;
      } catch (e) {
        continue;
      }
      for (var r = 0; r < rules.length; r++) {
        var rule = rules[r];
        if (!rule.selectorText || !rule.style) continue;
        var m = /^([\d.]+)px$/.exec(rule.style.lineHeight || "");
        if (!m) continue;
        var px = Math.round(parseFloat(m[1]) * scale * 10) / 10;
        out.push(rule.selectorText + "{line-height:" + px + "px !important}");
      }
    }
    style.textContent = out.join("\n");
  }

  function onUserTabClick(ev) {
    var t = ev.target && ev.target.closest && ev.target.closest('[role="tab"]');
    if (!t || !isHomePath()) return;
    var label = tabLabel(t);
    if (
      label.indexOf("for you") !== -1 ||
      label === "for you" ||
      label === "おすすめ" ||
      label === "para ti" ||
      label === "pour vous" ||
      label === "following" ||
      label === "フォロー中" ||
      label === "seguindo" ||
      label === "abonnements" ||
      label === "siguiendo"
    ) {
      window.__ROBIN_USER_PICKED_TAB__ = Date.now();
    }
  }

  /**
   * Soft-refresh home timeline without a full document reload.
   * Native hosts call this when near the top (foreground / title tap / Mac poll).
   * Returns true if a “Show N posts” control was clicked; false ⇒ host should
   * warm hard-reload. Intentionally does not click Home — that is often a
   * no-op when already at the top of /home, which hid failed Mac self-refresh.
   *
   * Also used by autoClickNewPostsPill — piggybacks on X’s own “Show N posts”
   * affordance when the site has already detected newer timeline entries.
   *
   * hidePageHeader often wraps that pill in TopNavBar / sticky chrome we
   * display:none, so discovery must ignore visibility and clickNewPostsControl
   * briefly clears robin hides for the click.
   */
  function newPostsLabelMatch(label) {
    if (!label || label.length > 64) return false;
    return (
      /^show\s+\d+\s+posts?$/.test(label) ||
      /^show\s+new\s+posts?$/.test(label) ||
      /^show\s+\d+\s+post/.test(label) ||
      /^(see )?new posts?$/.test(label) ||
      label.indexOf("new posts") !== -1 ||
      label.indexOf("新しいポスト") !== -1 ||
      label.indexOf("新しいツイート") !== -1 ||
      /^ポストを\d+件表示$/.test(label)
    );
  }

  function findNewPostsControl() {
    if (!isHomePath()) return null;
    var nodes = document.querySelectorAll(
      '[role="button"], button, a[role="link"], div[role="button"], div[tabindex="0"], span'
    );
    var hidden = null;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var label = (
        el.getAttribute("aria-label") ||
        el.innerText ||
        el.textContent ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      if (!newPostsLabelMatch(label)) continue;
      // Prefer a clickable ancestor when the match is an inner span.
      var clickable =
        el.closest(
          '[role="button"], button, a[role="link"], div[role="button"], div[tabindex="0"]'
        ) || el;
      var r = clickable.getBoundingClientRect();
      var visible = r.width >= 8 && r.height >= 8 && r.bottom > 0 && r.top < window.innerHeight;
      if (visible) return clickable;
      if (!hidden) hidden = clickable;
    }
    return hidden;
  }

  function clearRobinHideChain(el) {
    var restored = [];
    var p = el;
    for (var i = 0; i < 16 && p && p !== document.documentElement; i++) {
      if (p.getAttribute && p.getAttribute("data-mt-robin-hide")) {
        restored.push({
          el: p,
          robinHide: true,
          display: p.style.getPropertyValue("display"),
          priority: p.style.getPropertyPriority("display"),
        });
        p.style.removeProperty("display");
        p.removeAttribute("data-mt-robin-hide");
      }
      p = p.parentElement;
    }
    return restored;
  }

  function restoreRobinHideChain(restored) {
    for (var i = 0; i < restored.length; i++) {
      var item = restored[i];
      if (item.robinHide) {
        item.el.setAttribute("data-mt-robin-hide", "1");
        item.el.style.setProperty("display", "none", "important");
      }
    }
  }

  function clickNewPostsControl(el) {
    if (!el) return false;
    var restored = clearRobinHideChain(el);
    // CSS class hide (TopNavBar) may still apply — briefly lift page-header hide.
    var root = document.documentElement;
    var hadClass = root && root.classList.contains("mt-hide-page-header");
    if (hadClass) root.classList.remove("mt-hide-page-header");
    try {
      el.click();
    } catch (e) {
      if (hadClass) root.classList.add("mt-hide-page-header");
      restoreRobinHideChain(restored);
      return false;
    }
    if (hadClass) root.classList.add("mt-hide-page-header");
    restoreRobinHideChain(restored);
    // Next tick re-applies chrome hides cleanly.
    schedule();
    return true;
  }

  function feedScrollNearTop() {
    var roots = [
      document.scrollingElement,
      document.documentElement,
      document.body,
    ];
    for (var r = 0; r < roots.length; r++) {
      var topEl = roots[r];
      if (topEl && topEl.scrollTop > 80) return false;
    }
    var start =
      document.querySelector('[data-testid="primaryColumn"]') || document.body;
    if (!start) return true;
    var ancestor = start;
    for (var a = 0; a < 8 && ancestor; a++) {
      if (ancestor.scrollTop > 80) return false;
      ancestor = ancestor.parentElement;
    }
    // Shallow walk only. querySelectorAll("div") materializes every tweet div
    // and was dominating the main thread further down the feed.
    var stack = [start];
    var seen = 0;
    while (stack.length && seen < 40) {
      var node = stack.pop();
      seen++;
      if (!node || node.nodeType !== 1) continue;
      if (node.scrollTop > 80) return false;
      if (node.getAttribute && node.getAttribute("data-testid") === "tweet") continue;
      var kids = node.children;
      for (var i = 0; i < kids.length && i < 6; i++) stack.push(kids[i]);
    }
    return true;
  }

  var lastNewPostsClick = 0;
  function autoClickNewPostsPill() {
    if (!isHomePath()) return;
    if (!feedScrollNearTop()) return;
    var now = Date.now();
    if (now - lastNewPostsClick < 2500) return;
    var el = findNewPostsControl();
    if (!el) return;
    if (clickNewPostsControl(el)) lastNewPostsClick = now;
  }

  window.__ROBIN_SOFT_REFRESH_FEED__ = function () {
    try {
      if (!isHomePath()) return false;

      var pill = findNewPostsControl();
      if (pill && clickNewPostsControl(pill)) {
        lastNewPostsClick = Date.now();
        return true;
      }

      // No pill yet. Do not treat a Home-tab click as success: when already
      // sitting at the top of /home (common on Mac where the window stays
      // foregrounded), X often no-ops and never surfaces newer posts — the
      // host must warm hard-reload instead. Home-tap also hid the failure
      // mode where the Mac near-top poll "ran" but the feed never updated.
      return false;
    } catch (e) {
      return false;
    }
  };

  // --- Boot gate: hide until Following / Latest / chrome work settles ---
  var bootStart = Date.now();
  var bootLatestOkAt = 0;
  var bootRevealed = false;
  var BOOT_HARD_MS = 5000;
  var BOOT_AFTER_LATEST_MS = 1200;
  var BOOT_FOLLOWING_SETTLE_MS = 800;

  function notifyBootReady() {
    try {
      if (
        window.webkit &&
        window.webkit.messageHandlers &&
        window.webkit.messageHandlers.mtBoot
      ) {
        window.webkit.messageHandlers.mtBoot.postMessage("ready");
      }
    } catch (e) {}
    try {
      if (window.RobinBoot && window.RobinBoot.ready) {
        window.RobinBoot.ready();
      }
    } catch (e2) {}
  }

  function revealBoot() {
    if (bootRevealed) return;
    bootRevealed = true;
    var root = document.documentElement;
    if (root) root.setAttribute("data-mt-boot-ready", "1");
    notifyBootReady();
  }

  function hasLoginCta() {
    return !!(
      document.querySelector('[data-testid="loginButton"]') ||
      document.querySelector('a[href*="/i/flow/login"]') ||
      document.querySelector('a[href*="/i/flow/signup"]')
    );
  }

  function hasFeedContent() {
    return !!(
      document.querySelector('article[data-testid="tweet"]') ||
      document.querySelector('[data-testid="emptyState"]') ||
      document.querySelector('[data-testid="error-detail"]')
    );
  }

  function isHomeTabSettled() {
    var settings = currentSettings();
    var tabs = findHomeTabs();
    if (settings.forceFollowing) {
      if (!tabs.following) {
        return Date.now() - bootStart >= BOOT_FOLLOWING_SETTLE_MS;
      }
      return isTabSelected(tabs.following);
    }
    if (!tabs.forYou) {
      return Date.now() - bootStart >= BOOT_FOLLOWING_SETTLE_MS;
    }
    return isTabSelected(tabs.forYou);
  }

  function isBootReady() {
    var elapsed = Date.now() - bootStart;
    if (elapsed >= BOOT_HARD_MS) return true;
    if (!isHomePath()) return true;
    if (hasLoginCta()) return true;

    var settings = currentSettings();
    if (window.__ROBIN_SHEET_BY_US__ && findSortSheetRoot()) return false;

    if (
      settings.forceFollowing &&
      settings.preferLatest &&
      !window.__ROBIN_LATEST_OK__
    ) {
      return false;
    }
    if (window.__ROBIN_LATEST_OK__ && !bootLatestOkAt) {
      bootLatestOkAt = Date.now();
    }

    if (!isHomeTabSettled()) return false;

    if (hasFeedContent()) return true;
    if (
      window.__ROBIN_LATEST_OK__ &&
      Date.now() - bootLatestOkAt >= BOOT_AFTER_LATEST_MS
    ) {
      return true;
    }
    if (!settings.preferLatest && elapsed >= BOOT_FOLLOWING_SETTLE_MS) {
      return hasFeedContent() || elapsed >= 2500;
    }
    return false;
  }

  function maybeRevealBoot() {
    if (bootRevealed) return;
    if (isBootReady()) revealBoot();
  }

  var DRAIN_BUDGET = 8;
  var needsFullPass = true;
  var pendingNodes = [];
  var pendingSeen = typeof WeakSet === "function" ? new WeakSet() : null;
  var scrolling = false;
  var scrollIdleTimer = 0;

  function rememberPending(n) {
    if (!n || n.nodeType !== 1) return;
    if (pendingSeen) {
      if (pendingSeen.has(n)) return;
      pendingSeen.add(n);
    }
    pendingNodes.push(n);
  }

  function queueMutationNode(n) {
    if (!n) return;
    if (n.nodeType === 3) n = n.parentElement;
    if (!n || n.nodeType !== 1) return;
    if (n.classList && n.classList.contains("mt-repost-time")) return;
    var cell = n.closest && n.closest('[data-testid="cellInnerDiv"]');
    rememberPending(cell || n);
  }

  function expandWorkItem(n) {
    if (!n || !n.isConnected || !n.querySelectorAll) return [];
    if (n.getAttribute && n.getAttribute("data-testid") === "cellInnerDiv") return [n];
    var cells = n.querySelectorAll('[data-testid="cellInnerDiv"]');
    if (cells.length > 1) {
      var out = [];
      for (var i = 0; i < cells.length; i++) out.push(cells[i]);
      return out;
    }
    return [n];
  }

  function tick() {
    syncPageHeaderFlags();
    applyFontScale();
    forceFollowing();
    forceForYou();
    hideForYouTab();
    preferLatest();

    if (needsFullPass) {
      needsFullPass = false;
      pendingNodes = [];
      pendingSeen = typeof WeakSet === "function" ? new WeakSet() : null;
      labelRepostTimes(document);
      hideOpenAppNags();
      hideWhoToFollowBlocks(document);
      hideLiveContentBlocks(document);
      hidePageHeaderFallback();
      hideComposeButtonFallback();
    } else {
      var batch = pendingNodes;
      pendingNodes = [];
      pendingSeen = typeof WeakSet === "function" ? new WeakSet() : null;
      var work = [];
      for (var i = 0; i < batch.length; i++) {
        var parts = expandWorkItem(batch[i]);
        for (var j = 0; j < parts.length; j++) work.push(parts[j]);
      }
      var limit = Math.min(work.length, DRAIN_BUDGET);
      for (var w = 0; w < limit; w++) {
        var n = work[w];
        labelRepostTimes(n);
        hideWhoToFollowBlocks(n);
        hideLiveContentBlocks(n);
      }
      if (work.length > limit) {
        for (var k = limit; k < work.length; k++) rememberPending(work[k]);
        schedule();
      }
      // Header walk early-returns once settled. Compose / nag selectors stay
      // narrow (href and testid), so they can run on the incremental path.
      hidePageHeaderFallback();
      hideComposeButtonFallback();
      hideOpenAppNags();
    }

    autoClickNewPostsPill();
    maybeRevealBoot();
  }

  document.addEventListener("click", onUserTabClick, true);

  var scheduled = false;
  var observer = new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      var added = records[i].addedNodes;
      for (var j = 0; j < added.length; j++) queueMutationNode(added[j]);
    }
    schedule();
  });

  function observeFeed() {
    try {
      observer.observe(document.documentElement || document, {
        childList: true,
        subtree: true,
      });
    } catch (e) {}
  }

  function runScheduled() {
    scheduled = false;
    // Virtualizer commits are the scroll-critical work. Filter ticks wait
    // until the fling ends so newly scrolled-in cells can mount in time.
    if (bootRevealed && scrolling) return;
    observer.disconnect();
    try {
      tick();
    } finally {
      if (!scrolling) observeFeed();
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(runScheduled, bootRevealed && scrolling ? 160 : 50);
  }

  function queueMountedCells() {
    var cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
    for (var i = 0; i < cells.length; i++) rememberPending(cells[i]);
  }

  // X updates the timeline on a 100ms throttle and, while a fling is in
  // progress, shrinks the mounted window to half a viewport. On Android
  // WebView that update is also queued through requestIdleCallback, which
  // does not run until the fling slows down, so the viewport is white for
  // the whole gap. Run the update on the next frame, keep the idle window,
  // and mount several viewports ahead. The stock 2.5-viewport window is
  // left behind by one fast fling; about eight viewports stays filled.
  // React replaces props on each commit, so the ratios have to be forced
  // inside the candidate pass or the next update snaps the window back.
  function patchAndroidScroller(s) {
    if (!s || s.__robinFast) return;
    var root = document.documentElement;
    if (!root || !root.classList.contains("mt-android-webview")) return;
    if (typeof s._update !== "function" || typeof s._handleScroll !== "function") return;
    s.__robinFast = true;
    if (typeof s._getRenderCandidates === "function") {
      var origCandidates = s._getRenderCandidates;
      s._getRenderCandidates = function () {
        if (this.props) {
          this.props.preferredOffscreenToViewportRatio = 8;
          this.props.minimumOffscreenToViewportRatio = 6;
        }
        return origCandidates.apply(this, arguments);
      };
    }
    var update = s._update.bind(s);
    var queued = false;
    function pump() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () {
        queued = false;
        try {
          update();
        } catch (e) {}
      });
    }
    s._scheduleCriticalUpdate = pump;
    s._scheduleCriticalUpdateThrottled = pump;
    var origScroll = s._handleScroll;
    s._handleScroll = function () {
      var result = origScroll.apply(this, arguments);
      this._isIdle = true;
      return result;
    };
    s._isIdle = true;
    try {
      update();
    } catch (e) {}
  }

  function onFeedScroll() {
    patchAndroidScroller(window.scroller);
    if (!bootRevealed) return;
    if (!scrolling) {
      scrolling = true;
      // Drop the document observer for the whole gesture. Its callback runs
      // on every cell X mounts and was holding the virtualizer a full second
      // behind a fast fling (white viewport until the scroll slowed).
      try {
        observer.disconnect();
      } catch (e) {}
    }
    clearTimeout(scrollIdleTimer);
    scrollIdleTimer = setTimeout(function () {
      scrolling = false;
      queueMountedCells();
      schedule();
    }, 120);
  }
  window.addEventListener("scroll", onFeedScroll, { capture: true, passive: true });

  function requestFullPass() {
    needsFullPass = true;
    chromePassHref = "";
    schedule();
  }

  observeFeed();

  // Tapping a post scrolls that row toward the top before X records history.
  // Back then restores the shifted position, so the feed lands further down.
  // Snapshot the viewport at pointerdown and pin it again when /home returns.
  var savedScrollY = null;
  var savedAnchor = null;
  var lastFeedScroller = null;
  var pinArticle = null;
  var freezeUntil = 0;
  var pinUntil = 0;
  var pinLoopOn = false;
  var applyingPin = false;
  var lastPinTop = null;
  var lastNudgeMoved = false;
  var tapX = 0;
  var tapY = 0;

  function pathnameOf(href) {
    var path = String(href || "");
    var hash = path.indexOf("#");
    if (hash !== -1) path = path.slice(0, hash);
    var q = path.indexOf("?");
    if (q !== -1) path = path.slice(0, q);
    var scheme = path.indexOf("://");
    if (scheme !== -1) {
      var slash = path.indexOf("/", scheme + 3);
      path = slash === -1 ? "/" : path.slice(slash);
    }
    return path || "/";
  }

  function hrefIsHome(href) {
    var p = pathnameOf(href);
    return p === "/" || p === "/home" || p.indexOf("/home") === 0;
  }

  function asElement(node) {
    if (!node) return null;
    if (node.nodeType === 1) return node;
    return node.parentElement || null;
  }

  function statusIdFromArticle(article) {
    if (!article || !article.querySelector) return "";
    var link = article.querySelector('a[href*="/status/"] time');
    link = link && link.closest ? link.closest("a") : null;
    if (!link) link = article.querySelector('a[href*="/status/"]');
    var m = link && /\/status\/(\d+)/.exec(link.getAttribute("href") || "");
    return m ? m[1] : "";
  }

  function captureAnchor(el) {
    if (!el || !el.closest) return null;
    var article = el.closest('article[data-testid="tweet"]');
    if (!article) {
      var link = el.closest('a[href*="/status/"]');
      article = link && link.closest ? link.closest("article") : null;
    }
    if (!article) return null;
    var id = statusIdFromArticle(article);
    if (!id) return null;
    return { id: id, top: article.getBoundingClientRect().top };
  }

  function isDocumentScroller(el) {
    return (
      el === document.scrollingElement ||
      el === document.documentElement ||
      el === document.body
    );
  }

  function readScrollerY(el) {
    if (!el) return 0;
    if (isDocumentScroller(el)) return window.scrollY || el.scrollTop || 0;
    return el.scrollTop || 0;
  }

  function primaryFeedScroller() {
    var best = null;
    var bestExtra = 0;
    var docBest = null;
    var docExtra = 0;
    function consider(el) {
      if (!el || el.nodeType !== 1) return;
      var extra = (el.scrollHeight || 0) - (el.clientHeight || 0);
      if (extra <= 80) return;
      if (isDocumentScroller(el)) {
        if (extra > docExtra) {
          docExtra = extra;
          docBest = el;
        }
        return;
      }
      if (extra > bestExtra) {
        bestExtra = extra;
        best = el;
      }
    }
    consider(document.scrollingElement);
    consider(document.documentElement);
    consider(document.body);
    var col = document.querySelector('[data-testid="primaryColumn"]');
    var node = col;
    for (var i = 0; node && i < 10; i++) {
      consider(node);
      node = node.parentElement;
    }
    if (col) {
      var stack = [col];
      var seen = 0;
      while (stack.length && seen < 40) {
        var cur = stack.pop();
        seen++;
        consider(cur);
        if (cur.getAttribute && cur.getAttribute("data-testid") === "tweet") continue;
        var kids = cur.children;
        for (var k = 0; k < kids.length && k < 4; k++) stack.push(kids[k]);
      }
    }
    return best || docBest;
  }

  function feedScrollerEl() {
    if (
      lastFeedScroller &&
      lastFeedScroller.isConnected &&
      lastFeedScroller.scrollHeight > (lastFeedScroller.clientHeight || 0) + 80
    ) {
      return lastFeedScroller;
    }
    return primaryFeedScroller();
  }

  function currentFeedScrollY() {
    return readScrollerY(feedScrollerEl());
  }

  function writeFeedScroll(y) {
    var el = feedScrollerEl();
    if (!el) return;
    if (isDocumentScroller(el)) {
      if (Math.abs((window.scrollY || 0) - y) > 1) window.scrollTo(0, y);
      return;
    }
    // Window scroll on top of an inner timeline shifts the whole feed.
    if ((window.scrollY || 0) > 1) window.scrollTo(0, 0);
    if (Math.abs((el.scrollTop || 0) - y) > 1) el.scrollTop = y;
  }

  function nudgeFeedBy(delta) {
    var el = feedScrollerEl();
    if (!el) return false;
    var before = readScrollerY(el);
    if (isDocumentScroller(el)) {
      window.scrollTo(0, before + delta);
    } else {
      if ((window.scrollY || 0) > 1) window.scrollTo(0, 0);
      el.scrollTop = before + delta;
    }
    return Math.abs(readScrollerY(el) - before) > 0.5;
  }

  function findFeedArticle(statusId) {
    if (!isHomePath() || !statusId) return null;
    if (
      pinArticle &&
      pinArticle.isConnected &&
      statusIdFromArticle(pinArticle) === statusId
    ) {
      return pinArticle;
    }
    var nodes = document.querySelectorAll(
      '[data-testid="cellInnerDiv"] article[data-testid="tweet"]'
    );
    for (var i = 0; i < nodes.length; i++) {
      if (statusIdFromArticle(nodes[i]) === statusId) {
        pinArticle = nodes[i];
        return pinArticle;
      }
    }
    return null;
  }

  function rememberFeedTap(target) {
    if (!isHomePath()) return;
    var el = asElement(target);
    savedScrollY = currentFeedScrollY();
    savedAnchor = captureAnchor(el);
    var link = el && el.closest && el.closest("a[href]");
    if (savedAnchor || link) freezeUntil = Date.now() + 900;
  }

  function pinFeedStep() {
    if (applyingPin) return false;
    applyingPin = true;
    try {
      if (savedAnchor) {
        var article = findFeedArticle(savedAnchor.id);
        if (article) {
          var top = article.getBoundingClientRect().top;
          var delta = top - savedAnchor.top;
          if (Math.abs(delta) < 2) return true;
          // Row didn't move after the last nudge. One stale frame is normal;
          // a second means this scroller isn't the feed, so use the saved offset.
          if (lastPinTop != null && Math.abs(top - lastPinTop) < 1) {
            if (!lastNudgeMoved && savedScrollY != null) writeFeedScroll(savedScrollY);
            lastNudgeMoved = false;
            return false;
          }
          lastPinTop = top;
          lastNudgeMoved = nudgeFeedBy(delta);
          return false;
        }
      }
      if (savedScrollY == null) return true;
      var el = feedScrollerEl();
      if (!el) return false;
      if (Math.abs(readScrollerY(el) - savedScrollY) < 2) return !savedAnchor;
      writeFeedScroll(savedScrollY);
      return false;
    } finally {
      applyingPin = false;
    }
  }

  function beginFeedPin() {
    if (savedScrollY == null && !savedAnchor) return;
    pinUntil = Date.now() + 2000;
    pinArticle = null;
    lastPinTop = null;
    lastNudgeMoved = false;
    if (pinLoopOn) return;
    pinLoopOn = true;
    var stable = 0;
    var started = Date.now();
    function step() {
      if (!pinUntil || Date.now() >= pinUntil || !isHomePath()) {
        pinLoopOn = false;
        pinUntil = 0;
        return;
      }
      if (pinFeedStep()) stable++;
      else stable = 0;
      // X's virtualizer restores scroll on a short delay. Wait it out, then
      // stop once the tapped row has held its original viewport position.
      if (stable >= 8 && Date.now() - started > 700) {
        pinLoopOn = false;
        pinUntil = 0;
        return;
      }
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function cancelFeedPin() {
    pinUntil = 0;
  }

  function onFeedPathChange(prevHref, nextHref) {
    // Only when a post (or other non-home route) is popped back to the feed.
    // The snapshot was taken on the feed itself; re-reading here would sample
    // the status page that just unmounted.
    if (hrefIsHome(prevHref) || !hrefIsHome(nextHref)) return;
    freezeUntil = 0;
    beginFeedPin();
  }

  document.addEventListener(
    "pointerdown",
    function (e) {
      tapX = e.clientX;
      tapY = e.clientY;
      if (!isHomePath()) return;
      if (pinUntil && Date.now() < pinUntil) cancelFeedPin();
      rememberFeedTap(e.target);
    },
    true
  );
  document.addEventListener(
    "pointermove",
    function (e) {
      if (!freezeUntil || Date.now() >= freezeUntil) return;
      if (Math.abs(e.clientX - tapX) + Math.abs(e.clientY - tapY) > 16) {
        freezeUntil = 0;
      }
    },
    true
  );
  document.addEventListener(
    "wheel",
    function () {
      freezeUntil = 0;
      if (pinUntil && Date.now() < pinUntil) cancelFeedPin();
    },
    { capture: true, passive: true }
  );
  document.addEventListener(
    "keydown",
    function (e) {
      if (pinUntil && Date.now() < pinUntil) cancelFeedPin();
      if ((e.key === "Enter" || e.key === " ") && isHomePath()) {
        rememberFeedTap(e.target);
      }
    },
    true
  );
  document.addEventListener(
    "click",
    function (e) {
      if (!isHomePath() || Date.now() < freezeUntil) return;
      var el = asElement(e.target);
      var anchor = captureAnchor(el);
      var link = el && el.closest && el.closest('a[href*="/status/"]');
      if (!anchor && !link) return;
      savedScrollY = currentFeedScrollY();
      if (anchor) savedAnchor = anchor;
      freezeUntil = Date.now() + 900;
    },
    true
  );
  window.addEventListener(
    "scroll",
    function (e) {
      var t = e.target;
      var el = null;
      if (t && t !== window && t !== document && typeof t.scrollTop === "number") {
        el = t;
      } else {
        el = document.scrollingElement || document.documentElement;
      }
      if (
        el &&
        isHomePath() &&
        Date.now() >= pinUntil &&
        el.scrollHeight > (el.clientHeight || 0) + 80
      ) {
        lastFeedScroller = el;
        if (Date.now() >= freezeUntil) {
          savedScrollY = readScrollerY(el);
          savedAnchor = null;
        }
      }
      if (pinUntil && Date.now() < pinUntil && isHomePath() && !applyingPin) {
        pinFeedStep();
      }
    },
    true
  );

  var lastHref = location.href;
  function noteLocation(href) {
    if (href === lastHref) return;
    var prev = lastHref;
    lastHref = href;
    onFeedPathChange(prev, href);
    requestFullPass();
  }

  var origPushState = history.pushState;
  var origReplaceState = history.replaceState;
  if (origPushState) {
    history.pushState = function () {
      var before = location.href;
      var ret = origPushState.apply(this, arguments);
      if (location.href !== before) noteLocation(location.href);
      return ret;
    };
  }
  if (origReplaceState) {
    history.replaceState = function () {
      var before = location.href;
      var ret = origReplaceState.apply(this, arguments);
      if (location.href !== before) noteLocation(location.href);
      return ret;
    };
  }
  window.addEventListener("popstate", function () {
    noteLocation(location.href);
  });

  // SPA path changes (fallback if navigation skips history.pushState)
  setInterval(function () {
    patchAndroidScroller(window.scroller);
    noteLocation(location.href);
  }, 500);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", requestFullPass);
  } else {
    requestFullPass();
  }
  setTimeout(requestFullPass, 400);
  setTimeout(requestFullPass, 1200);
  setTimeout(maybeRevealBoot, BOOT_HARD_MS);
})();
