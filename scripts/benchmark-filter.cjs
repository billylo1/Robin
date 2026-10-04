const pw = require('playwright-core');
const fs = require('fs');
const path = require('path');

const cssContent = fs.readFileSync(path.join(__dirname, '../ios/Robin/Resources/x-filter/filter-core.css'), 'utf8');
const jsContent = fs.readFileSync(path.join(__dirname, '../ios/Robin/Resources/x-filter/filter-core.js'), 'utf8');

function generateTwitterFeedHTML(cellCount = 30) {
  let cellsHTML = '';
  for (let i = 1; i <= cellCount; i++) {
    if (i === 5) {
      cellsHTML += `
        <div data-testid="cellInnerDiv" class="cell-${i}">
          <article data-testid="tweet" tabindex="0">
            <div data-testid="socialContext"><span>Elon Musk reposted</span></div>
            <div data-testid="tweetText"><span>This is a reposted status update about AI and technology #${i}</span></div>
            <a href="/user/status/100000000000000000${i}"><time datetime="2026-10-03T12:00:00.000Z">2h</time></a>
          </article>
        </div>
      `;
    } else if (i === 10) {
      cellsHTML += `
        <div data-testid="cellInnerDiv" class="cell-${i}">
          <aside aria-label="Who to follow">
            <h2>Who to follow</h2>
            <div><span>User One</span><button>Follow</button></div>
            <div><span>User Two</span><button>Follow</button></div>
          </aside>
        </div>
      `;
    } else if (i === 15) {
      cellsHTML += `
        <div data-testid="cellInnerDiv" class="cell-${i}">
          <div data-testid="SpaceCard">
            <div data-testid="spaceLive"><span>Live Space: Modern Web Performance</span></div>
            <a href="/i/spaces/123456789">Tune in</a>
          </div>
        </div>
      `;
    } else if (i === 20) {
      cellsHTML += `
        <div data-testid="cellInnerDiv" class="cell-${i}">
          <div data-testid="placementTracking">
            <article data-testid="tweet">
              <div data-testid="tweetText"><span>Sponsored ad content for developers</span></div>
              <a href="https://example.com/quick_promote_web">Promote</a>
            </article>
          </div>
        </div>
      `;
    } else {
      cellsHTML += `
        <div data-testid="cellInnerDiv" class="cell-${i}">
          <article data-testid="tweet" tabindex="0">
            <div class="author-row">
              <span class="user-name">Developer ${i}</span>
              <span class="handle">@dev_${i}</span>
              <a href="/dev_${i}/status/190000000000000000${i}"><time datetime="2026-10-03T12:00:00.000Z">${i}m</time></a>
            </div>
            <div data-testid="tweetText">
              <span>Optimizing WebView rendering performance for modern mobile feeds. Tweet #${i} with some extra text and links to read.</span>
            </div>
            <div class="actions">
              <button role="button" aria-label="Reply">Reply</button>
              <button role="button" aria-label="Repost">Repost</button>
              <button role="button" aria-label="Like">Like</button>
            </div>
          </article>
        </div>
      `;
    }
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Home / X</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    [data-testid="primaryColumn"] { width: 600px; margin: 0 auto; }
    [data-testid="cellInnerDiv"] { min-height: 120px; border-bottom: 1px solid #eee; padding: 12px; }
  </style>
</head>
<body>
  <div id="react-root">
    <div data-testid="TopNavBar" style="height: 53px; position: sticky; top: 0;">
      <div>Top Nav Content</div>
    </div>
    <main role="main">
      <div data-testid="primaryColumn">
        <header role="banner" style="height: 50px;">Banner</header>
        <div data-testid="ScrollSnap-List" role="tablist">
          <div role="presentation">
            <div role="tab" aria-selected="false" aria-label="For you" tabindex="0"><span>For you</span></div>
          </div>
          <div role="presentation">
            <div role="tab" aria-selected="true" aria-label="Following" aria-haspopup="menu" tabindex="0"><span>Following</span></div>
          </div>
        </div>
        <div class="composer-container" style="min-height: 100px;">
          <div>What's happening?</div>
          <div data-testid="tweetTextarea_0" role="textbox" contenteditable="true"></div>
          <button data-testid="tweetButtonInline">Post</button>
        </div>
        <div class="timeline-container">
          <section>
            ${cellsHTML}
          </section>
        </div>
      </div>
    </main>
    <a data-testid="SideNav_NewTweet_Button" href="/compose/post" style="position: fixed; bottom: 20px; right: 20px; width: 50px; height: 50px;">Compose</a>
  </div>
</body>
</html>`;
}

async function runBenchmark(browserType, label, options = {}) {
  const customJs = options.customJs || jsContent;
  const customCss = options.customCss || cssContent;

  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
  });
  const page = await context.newPage();
  page.on('pageerror', err => console.error(`[${label} pageerror]`, err.message));
  page.on('framenavigated', frame => console.log(`[${label} nav]`, frame.url()));

  // Intercept all x.com requests
  await page.route(/.*x\.com.*/, route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: generateTwitterFeedHTML(30)
  }));

  // Instrumentation
  await page.addInitScript(`
    window.__BENCH_METRICS__ = {
      getBoundingClientRectCount: 0,
      innerTextReads: 0,
      getComputedStyleCount: 0,
      scrollHeightReads: 0,
      querySelectorAllCount: 0,
      querySelectorCount: 0,
      bootReadyTimestamp: null,
      totalLayoutReads: 0
    };

    try {
      const origGBR = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function() {
        window.__BENCH_METRICS__.getBoundingClientRectCount++;
        window.__BENCH_METRICS__.totalLayoutReads++;
        return origGBR.apply(this, arguments);
      };
    } catch(e) {}

    try {
      const origInnerTextDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');
      if (origInnerTextDesc && origInnerTextDesc.get) {
        Object.defineProperty(HTMLElement.prototype, 'innerText', {
          get: function() {
            window.__BENCH_METRICS__.innerTextReads++;
            window.__BENCH_METRICS__.totalLayoutReads++;
            return origInnerTextDesc.get.apply(this, arguments);
          },
          set: origInnerTextDesc.set,
          configurable: true
        });
      }
    } catch(e) {}

    try {
      const origGCS = window.getComputedStyle;
      window.getComputedStyle = function() {
        window.__BENCH_METRICS__.getComputedStyleCount++;
        return origGCS.apply(this, arguments);
      };
    } catch(e) {}

    try {
      const origScrollHeightDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight');
      if (origScrollHeightDesc && origScrollHeightDesc.get) {
        Object.defineProperty(Element.prototype, 'scrollHeight', {
          get: function() {
            window.__BENCH_METRICS__.scrollHeightReads++;
            window.__BENCH_METRICS__.totalLayoutReads++;
            return origScrollHeightDesc.get.apply(this, arguments);
          },
          configurable: true
        });
      }
    } catch(e) {}

    try {
      const origQSA = Document.prototype.querySelectorAll;
      Document.prototype.querySelectorAll = function() {
        window.__BENCH_METRICS__.querySelectorAllCount++;
        return origQSA.apply(this, arguments);
      };
      const origElemQSA = Element.prototype.querySelectorAll;
      Element.prototype.querySelectorAll = function() {
        window.__BENCH_METRICS__.querySelectorAllCount++;
        return origElemQSA.apply(this, arguments);
      };
      const origQS = Document.prototype.querySelector;
      Document.prototype.querySelector = function() {
        window.__BENCH_METRICS__.querySelectorCount++;
        return origQS.apply(this, arguments);
      };
      const origElemQS = Element.prototype.querySelector;
      Element.prototype.querySelector = function() {
        window.__BENCH_METRICS__.querySelectorCount++;
        return origElemQS.apply(this, arguments);
      };
    } catch(e) {}

    // Bootstrap setup matching Robin
    window.__ROBIN_SETTINGS__ = {
      forceFollowing: true,
      hideForYouTab: true,
      hidePromoted: true,
      preferLatest: true,
      hideWhoToFollow: true,
      hideLiveContent: true,
      hideOpenAppNags: true,
      hidePageHeader: true,
      hideComposeButton: true,
      fontScale: 1
    };
    window.__ROBIN_TEXT_SIZE_ADJUST__ = true;
    window.__ROBIN_HOME_RANKED__ = false;
  `);

  // Document start script injecting CSS and JS
  await page.addInitScript(`
    (function(){
      function injectStyle() {
        if (document.getElementById('robin-x-filter-css')) return;
        var parent = document.head || document.documentElement;
        if (!parent) return false;
        var s = document.createElement('style');
        s.id = 'robin-x-filter-css';
        s.textContent = ${JSON.stringify(customCss)};
        parent.appendChild(s);
        return true;
      }
      if (!injectStyle()) {
        document.addEventListener('DOMContentLoaded', injectStyle);
      }
      function setupRoot() {
        var root = document.documentElement;
        if (root) {
          root.setAttribute('data-mt-home', '1');
          root.classList.add('mt-hide-page-header', 'mt-hide-compose', 'mt-hide-live');
        }
      }
      if (document.documentElement) setupRoot();
      else document.addEventListener('DOMContentLoaded', setupRoot);
    })();
  `);

  await page.addInitScript(customJs);

  const t0 = performance.now();
  await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
  const dclTime = performance.now() - t0;

  // Let initial mutations and scheduled passes settle (up to 400ms)
  await page.waitForTimeout(400);
  const initialLoadTime = performance.now() - t0;

  const initialMetrics = await page.evaluate(() => {
    return {
      ...window.__BENCH_METRICS__,
      bootReady: document.documentElement.getAttribute('data-mt-boot-ready') === '1',
      totalDOMQueries: window.__BENCH_METRICS__.querySelectorAllCount + window.__BENCH_METRICS__.querySelectorCount
    };
  });

  // Snapshot before scrolling
  await page.evaluate(() => {
    window.__SCROLL_SNAPSHOT__ = {
      totalLayoutReads: window.__BENCH_METRICS__.totalLayoutReads,
      gbr: window.__BENCH_METRICS__.getBoundingClientRectCount,
      innerText: window.__BENCH_METRICS__.innerTextReads,
      gcs: window.__BENCH_METRICS__.getComputedStyleCount,
      scrollHeight: window.__BENCH_METRICS__.scrollHeightReads,
      qsa: window.__BENCH_METRICS__.querySelectorAllCount,
      qs: window.__BENCH_METRICS__.querySelectorCount
    };
  });

  // Simulate 50 scroll frames of rapid scrolling
  const scrollStart = performance.now();
  for (let s = 1; s <= 50; s++) {
    await page.evaluate((step) => {
      window.scrollTo(0, step * 50);
      window.dispatchEvent(new Event('scroll'));
    }, s);
  }
  const scrollDuration = performance.now() - scrollStart;

  // Wait for 150ms scroll idle timer to fire
  await page.waitForTimeout(160);

  // Measure delta during scrolling
  const scrollSettleMetrics = await page.evaluate(() => {
    const snap = window.__SCROLL_SNAPSHOT__;
    const cur = window.__BENCH_METRICS__;
    return {
      scrollLayoutReads: cur.totalLayoutReads - snap.totalLayoutReads,
      scrollGBR: cur.getBoundingClientRectCount - snap.gbr,
      scrollInnerText: cur.innerTextReads - snap.innerText,
      scrollGCS: cur.getComputedStyleCount - snap.gcs,
      scrollScrollHeight: cur.scrollHeightReads - snap.scrollHeight,
      scrollDOMQueries: (cur.querySelectorAllCount + cur.querySelectorCount) - (snap.qsa + snap.qs)
    };
  });

  // Now simulate virtualized mounting: 20 new cells mounted as user reaches bottom of feed
  await page.evaluate(() => {
    window.__MOUNT_SNAPSHOT__ = {
      totalLayoutReads: window.__BENCH_METRICS__.totalLayoutReads,
      gbr: window.__BENCH_METRICS__.getBoundingClientRectCount,
      innerText: window.__BENCH_METRICS__.innerTextReads,
      gcs: window.__BENCH_METRICS__.getComputedStyleCount,
      domQueries: window.__BENCH_METRICS__.querySelectorAllCount + window.__BENCH_METRICS__.querySelectorCount
    };
  });

  const mountStart = performance.now();
  await page.evaluate(() => {
    const section = document.querySelector('section') || document.querySelector('.timeline-container') || document.querySelector('[data-testid="primaryColumn"]') || document.body;
    if (!section) throw new Error('URL: ' + location.href + ' readyState: ' + document.readyState + ' HTML: ' + (document.documentElement ? document.documentElement.outerHTML.slice(0, 500) : 'no docElem'));
    for (let c = 31; c <= 50; c++) {
      const div = document.createElement('div');
      div.setAttribute('data-testid', 'cellInnerDiv');
      div.className = 'cell-' + c;
      div.innerHTML = '<article data-testid="tweet"><div class="author-row"><span>User ' + c + '</span></div><div data-testid="tweetText">Virtualized post #' + c + '</div></article>';
      section.appendChild(div);
    }
  });

  // Wait for mutation observer and incremental drain
  await page.waitForTimeout(300);
  const mountDuration = performance.now() - mountStart;

  const mountMetrics = await page.evaluate(() => {
    const snap = window.__MOUNT_SNAPSHOT__;
    const cur = window.__BENCH_METRICS__;
    return {
      mountLayoutReads: cur.totalLayoutReads - snap.totalLayoutReads,
      mountGBR: cur.getBoundingClientRectCount - snap.gbr,
      mountInnerText: cur.innerTextReads - snap.innerText,
      mountGCS: cur.getComputedStyleCount - snap.gcs,
      mountDOMQueries: (cur.querySelectorAllCount + cur.querySelectorCount) - snap.domQueries
    };
  });

  await browser.close();

  return {
    engine: label,
    initialLoad: {
      bootReady: initialMetrics.bootReady,
      dclTimeMs: Math.round(dclTime * 10) / 10,
      totalLayoutReads: initialMetrics.totalLayoutReads,
      getBoundingClientRectCount: initialMetrics.getBoundingClientRectCount,
      innerTextReads: initialMetrics.innerTextReads,
      getComputedStyleCount: initialMetrics.getComputedStyleCount,
      scrollHeightReads: initialMetrics.scrollHeightReads,
      totalDOMQueries: initialMetrics.totalDOMQueries
    },
    fastScrolling: {
      scrollDurationMs: Math.round(scrollDuration * 10) / 10,
      scrollLayoutReads: scrollSettleMetrics.scrollLayoutReads,
      scrollGBR: scrollSettleMetrics.scrollGBR,
      scrollInnerText: scrollSettleMetrics.scrollInnerText,
      scrollGCS: scrollSettleMetrics.scrollGCS,
      scrollScrollHeight: scrollSettleMetrics.scrollScrollHeight,
      scrollDOMQueries: scrollSettleMetrics.scrollDOMQueries
    },
    virtualizedCellMounting: {
      mountDurationMs: Math.round(mountDuration * 10) / 10,
      mountLayoutReads: mountMetrics.mountLayoutReads,
      mountGBR: mountMetrics.mountGBR,
      mountInnerText: mountMetrics.mountInnerText,
      mountGCS: mountMetrics.mountGCS,
      mountDOMQueries: mountMetrics.mountDOMQueries
    }
  };
}

module.exports = { runBenchmark };

function printReport(title, metrics) {
  console.log(`\n================ ${title} ================`);
  console.log(`Initial Load:`);
  console.log(`  - Boot Ready:               ${metrics.initialLoad.bootReady ? 'YES (gate lifted)' : 'NO (gate active)'}`);
  console.log(`  - Layout Reads / Reflows:   ${metrics.initialLoad.totalLayoutReads}`);
  console.log(`    * getBoundingClientRect:  ${metrics.initialLoad.getBoundingClientRectCount}`);
  console.log(`    * innerText reads:        ${metrics.initialLoad.innerTextReads}`);
  console.log(`  - Total DOM Queries:        ${metrics.initialLoad.totalDOMQueries}`);
  console.log(`Fast Scrolling (50 scroll events):`);
  console.log(`  - Scroll Layout Reads:      ${metrics.fastScrolling.scrollLayoutReads}`);
  console.log(`    * scrollHeight reads:     ${metrics.fastScrolling.scrollScrollHeight}`);
  console.log(`    * getBoundingClientRect:  ${metrics.fastScrolling.scrollGBR}`);
  console.log(`  - Scroll DOM Queries:       ${metrics.fastScrolling.scrollDOMQueries}`);
  console.log(`Virtualized Cell Mounting (20 new cells):`);
  console.log(`  - Mount Layout Reads:       ${metrics.virtualizedCellMounting.mountLayoutReads}`);
  console.log(`    * getBoundingClientRect:  ${metrics.virtualizedCellMounting.mountGBR}`);
  console.log(`  - Mount DOM Queries:        ${metrics.virtualizedCellMounting.mountDOMQueries}`);
  const totalReflows = metrics.initialLoad.totalLayoutReads + metrics.fastScrolling.scrollLayoutReads + metrics.virtualizedCellMounting.mountLayoutReads;
  const totalQueries = metrics.initialLoad.totalDOMQueries + metrics.fastScrolling.scrollDOMQueries + metrics.virtualizedCellMounting.mountDOMQueries;
  console.log(`TOTAL FORCED REFLOWS:        ${totalReflows}`);
  console.log(`TOTAL DOM QUERIES:           ${totalQueries}`);
}

if (require.main === module) {
  (async () => {
    console.log('Running benchmark on WebKit (iOS WKWebView engine)...');
    const webkitMetrics = await runBenchmark(pw.webkit, 'WebKit (iOS WKWebView)');
    printReport('WEBKIT (iOS WKWebView) RESULTS', webkitMetrics);

    console.log('\nRunning benchmark on Chromium (Android WebView engine)...');
    const chromiumMetrics = await runBenchmark(pw.chromium, 'Chromium (Android WebView)');
    printReport('CHROMIUM (Android WebView) RESULTS', chromiumMetrics);
  })();
}
