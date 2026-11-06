/**
 * Test script for language filtering in Robin filter-core.js.
 * Validates language extraction, script heuristics, cell hiding,
 * focal status bypass, quote-tweet handling, and coordinate unhiding.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createMockElement(tagName, attrs = {}) {
  const attributes = { ...attrs };
  const classListSet = new Set();
  const children = [];
  let parentElement = null;

  const styleProperties = {};
  const stylePriorities = {};

  const style = {
    getPropertyValue(prop) {
      return styleProperties[prop] || '';
    },
    getPropertyPriority(prop) {
      return stylePriorities[prop] || '';
    },
    setProperty(prop, val, priority = '') {
      styleProperties[prop] = String(val);
      stylePriorities[prop] = String(priority);
    },
    removeProperty(prop) {
      const old = styleProperties[prop] || '';
      delete styleProperties[prop];
      delete stylePriorities[prop];
      return old;
    },
    get display() {
      return styleProperties['display'] || '';
    }
  };

  const elem = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    isConnected: true,
    style,
    childNodes: children,
    get children() { return children.filter(c => c.nodeType === 1); },
    get parentElement() { return parentElement; },
    set parentElement(p) { parentElement = p; },
    get classList() {
      return {
        contains: (c) => classListSet.has(c),
        add: (c) => classListSet.add(c),
        remove: (c) => classListSet.delete(c),
        toggle: (c, force) => {
          if (force !== undefined) {
            if (force) classListSet.add(c); else classListSet.delete(c);
            return force;
          }
          if (classListSet.has(c)) { classListSet.delete(c); return false; }
          classListSet.add(c); return true;
        }
      };
    },
    getAttribute(name) {
      return attributes[name] !== undefined ? attributes[name] : null;
    },
    setAttribute(name, val) {
      attributes[name] = String(val);
    },
    removeAttribute(name) {
      delete attributes[name];
    },
    hasAttribute(name) {
      return attributes[name] !== undefined;
    },
    appendChild(child) {
      child.parentElement = elem;
      children.push(child);
      return child;
    },
    remove() {
      if (parentElement) {
        const idx = parentElement.childNodes.indexOf(elem);
        console.log("REMOVE CALLED ON:", elem.tagName, "parent:", parentElement.tagName); if (idx !== -1) parentElement.childNodes.splice(idx, 1);
        parentElement = null;
      }
    },
    querySelectorAll(selector) {
      return queryAll(elem, selector);
    },
    querySelector(selector) {
      const res = queryAll(elem, selector);
      return res.length ? res[0] : null;
    },
    closest(selector) {
      let cur = elem;
      while (cur) {
        if (matchesSelector(cur, selector)) return cur;
        cur = cur.parentElement;
      }
      return null;
    },
    matches(selector) {
      return matchesSelector(elem, selector);
    },
    get textContent() {
      let text = '';
      for (const c of children) {
        if (c.nodeType === 3) text += c.nodeValue;
        else if (c.nodeType === 1) text += c.textContent;
      }
      return text;
    }
  };

  return elem;
}

function createTextNode(text) {
  return {
    nodeType: 3,
    nodeValue: text,
    childNodes: []
  };
}

function matchesSelector(el, sel) {
  if (!el || el.nodeType !== 1) return false;
  const parts = sel.split(',').map(s => s.trim());
  for (const part of parts) {
    if (matchSingle(el, part)) return true;
  }
  return false;
}

function matchSingle(el, sel) {
  if (!el || el.nodeType !== 1) return false;
  // classes
  const classes = sel.match(/\.([a-zA-Z0-9_-]+)/g);
  if (classes) {
    for (const c of classes) {
      if (!el.classList.contains(c.slice(1))) return false;
    }
  }
  // id
  const idMatch = sel.match(/#([a-zA-Z0-9_-]+)/);
  if (idMatch) {
    if (el.getAttribute('id') !== idMatch[1]) return false;
  }
  // tag
  const mTag = sel.match(/^([a-zA-Z0-9]+)/);
  if (mTag && el.tagName !== mTag[1].toUpperCase()) return false;

  // attributes
  const attrRegex = /\[([a-zA-Z0-9_-]+)(?:=(["][^"]*["]|['][^']*[']|[^\]]*))?\]/g;
  let match;
  let hasAttr = false;
  while ((match = attrRegex.exec(sel)) !== null) {
    hasAttr = true;
    const attrName = match[1];
    let expectedVal = match[2];
    if (expectedVal !== undefined) {
      if ((expectedVal.startsWith('"') && expectedVal.endsWith('"')) ||
          (expectedVal.startsWith("'") && expectedVal.endsWith("'"))) {
        expectedVal = expectedVal.slice(1, -1);
      }
      if (el.getAttribute(attrName) !== expectedVal) return false;
    } else {
      if (!el.hasAttribute(attrName)) return false;
    }
  }
  if (!classes && !idMatch && !mTag && !hasAttr) return false;
  return true;
}

function queryAll(root, selector) {
  const results = [];
  function walk(node) {
    if (!node || node.nodeType !== 1) return;
    for (const child of node.childNodes) {
      if (child.nodeType === 1) {
        if (matchesSelector(child, selector)) {
          results.push(child);
        }
        walk(child);
      }
    }
  }
  walk(root);
  return results;
}

// Build mock DOM environment
const documentElement = createMockElement('html');
const head = createMockElement('head');
const body = createMockElement('body');
documentElement.appendChild(head);
documentElement.appendChild(body);

const mockDocument = {
  documentElement,
  head,
  body,
  getElementById: (id) => null,
  querySelector: (sel) => queryAll(documentElement, sel)[0] || null,
  querySelectorAll: (sel) => queryAll(documentElement, sel),
  createElement: (tag) => createMockElement(tag),
  addEventListener: () => {},
  removeEventListener: () => {}
};

const mockHistory = { pushState: () => {}, replaceState: () => {} };

const mockWindow = {
  document: mockDocument,
  location: { pathname: '/home', href: 'https://x.com/home' },
  history: mockHistory,
  addEventListener: () => {},
  removeEventListener: () => {},
  MutationObserver: class {
    observe() {}
    disconnect() {}
  },
  WeakSet: WeakSet,
  Set: Set,
  Map: Map,
  Object: Object,
  Array: Array,
  Math: Math,
  String: String,
  RegExp: RegExp,
  parseInt: parseInt,
  parseFloat: parseFloat,
  setTimeout: (cb, ms) => { cb(); return 1; },
  clearTimeout: () => {},
  setInterval: () => 1,
  clearInterval: () => {},
  getComputedStyle: () => ({ position: 'static', getPropertyValue: () => '' }),
  requestAnimationFrame: (cb) => cb(),
  innerWidth: 390,
  innerHeight: 844,
  __ROBIN_SETTINGS__: {
    allowedLanguages: [],
    hideKeywords: []
  }
};

// Load filter-core.js
const code = fs.readFileSync(path.join(__dirname, '../android/app/src/main/assets/x-filter/filter-core.js'), 'utf8');

const ctx = vm.createContext({
  window: mockWindow,
  document: mockDocument,
  location: mockWindow.location,
  history: mockHistory,
  getComputedStyle: mockWindow.getComputedStyle,
  MutationObserver: class {
    observe() {}
    disconnect() {}
  },
  WeakSet: WeakSet,
  Set: Set,
  Map: Map,
  Object: Object,
  Array: Array,
  Math: Math,
  String: String,
  RegExp: RegExp,
  parseInt: parseInt,
  parseFloat: parseFloat,
  setTimeout: (cb, ms) => { cb(); return 1; },
  clearTimeout: () => {},
  setInterval: () => 1,
  clearInterval: () => {},
  console: console
});

vm.runInContext(code, ctx);

// Helper to build a tweet cell
function createTweetCell(id, text, langAttr, isFocal = false, quoteText = null, quoteLang = null) {
  const cell = createMockElement('div', { 'data-testid': 'cellInnerDiv', 'id': 'cell-' + id });
  const article = createMockElement('article', { 'data-testid': 'tweet' });
  const timeLink = createMockElement('a', { 'href': `/user/status/${id}` });
  article.appendChild(timeLink);

  if (text !== null) {
    const textNodeAttrs = { 'data-testid': 'tweetText' };
    if (langAttr) textNodeAttrs['lang'] = langAttr;
    const tweetTextEl = createMockElement('div', textNodeAttrs);
    tweetTextEl.appendChild(createTextNode(text));
    article.appendChild(tweetTextEl);
  }

  if (quoteText !== null) {
    const quoteEl = createMockElement('div', { 'data-testid': 'quoteTweet' });
    const quoteTextAttrs = { 'data-testid': 'tweetText' };
    if (quoteLang) quoteTextAttrs['lang'] = quoteLang;
    const quoteTextEl = createMockElement('div', quoteTextAttrs);
    quoteTextEl.appendChild(createTextNode(quoteText));
    quoteEl.appendChild(quoteTextEl);
    article.appendChild(quoteEl);
  }

  cell.appendChild(article);
  body.appendChild(cell);
  return cell;
}

// Create test cells
const cellEn = createTweetCell('101', 'Hello world, loving this app', 'en');
const cellZh = createTweetCell('102', '你好，世界', 'zh-CN');
const cellJa = createTweetCell('103', 'こんにちは世界', 'ja');
const cellEs = createTweetCell('104', 'Hola mundo, como estas', 'es');
const cellUndZh = createTweetCell('105', '这是一个没有语言标签的纯中文推文', 'und');
const cellMedia = createTweetCell('106', null, null);
const cellQuoteEnJa = createTweetCell('107', 'Interesting thread:', 'en', false, '日本のニュース記事です', 'ja');
const cellQuoteJaDe = createTweetCell('108', '面白い記事ですね', 'ja', false, 'Das ist ein deutscher Artikel', 'de');
const cellCatEs = createTweetCell('109', 'Un gato negro y bonito', 'es');

console.log('--- Initial State (No language filter) ---');
ctx.window.__ROBIN_ON_SETTINGS__();

function assertVisible(cell, name) {
  if (cell.getAttribute('data-mt-language-hide') === '1' || cell.style.display === 'none') {
    throw new Error(`Expected ${name} to be visible, but it was hidden!`);
  }
}

function assertHidden(cell, name, reasonAttr = 'data-mt-language-hide') {
  if (cell.getAttribute(reasonAttr) !== '1' || cell.style.display !== 'none') {
    throw new Error(`Expected ${name} to be hidden by ${reasonAttr}, but it was visible!`);
  }
}

assertVisible(cellEn, 'cellEn');
assertVisible(cellZh, 'cellZh');
assertVisible(cellJa, 'cellJa');
assertVisible(cellEs, 'cellEs');
assertVisible(cellUndZh, 'cellUndZh');
assertVisible(cellMedia, 'cellMedia');
assertVisible(cellQuoteEnJa, 'cellQuoteEnJa');
assertVisible(cellQuoteJaDe, 'cellQuoteJaDe');
assertVisible(cellCatEs, 'cellCatEs');
console.log('✓ All 9 cells visible when allowedLanguages is empty');

console.log('\n--- Test Filter: allowedLanguages = ["en", "zh"] ---');
mockWindow.__ROBIN_SETTINGS__ = {
  allowedLanguages: ['en', 'zh'],
  hideKeywords: []
};
ctx.window.__ROBIN_ON_SETTINGS__();

assertVisible(cellEn, 'cellEn (English)');
assertVisible(cellZh, 'cellZh (Chinese)');
assertVisible(cellUndZh, 'cellUndZh (Undetermined CJK text recognized as Chinese)');
assertVisible(cellMedia, 'cellMedia (Media only with no text)');
assertVisible(cellQuoteEnJa, 'cellQuoteEnJa (English commentary quoting Japanese tweet)');

assertHidden(cellJa, 'cellJa (Japanese)');
assertHidden(cellEs, 'cellEs (Spanish)');
assertHidden(cellQuoteJaDe, 'cellQuoteJaDe (Japanese commentary quoting German tweet)');
assertHidden(cellCatEs, 'cellCatEs (Spanish)');
console.log('✓ English, Chinese, CJK fallback, Media-only, and English-quoting tweets are visible');
console.log('✓ Japanese, Spanish, and Japanese-quoting tweets are hidden');

console.log('\n--- Test Focal Status Bypass ---');
// Mock focal status matching cellJa (103)
mockWindow.location.pathname = '/user/status/103';
ctx.window.__ROBIN_ON_SETTINGS__();
assertVisible(cellJa, 'cellJa when focal status is 103');
console.log('✓ Focal tweet is preserved and visible even if in unallowed language');

// Return to /home
mockWindow.location.pathname = '/home';
ctx.window.__ROBIN_ON_SETTINGS__();
assertHidden(cellJa, 'cellJa on home timeline');

console.log('\n--- Test Coordinated Hiding with Keywords ---');
// Add keyword 'gato'
mockWindow.__ROBIN_SETTINGS__ = {
  allowedLanguages: ['en', 'zh'],
  hideKeywords: ['gato']
};
ctx.window.__ROBIN_ON_SETTINGS__();
assertHidden(cellCatEs, 'cellCatEs', 'data-mt-language-hide');
assertHidden(cellCatEs, 'cellCatEs', 'data-mt-keyword-hide');
console.log('✓ cellCatEs has both data-mt-language-hide and data-mt-keyword-hide');

// Now clear allowedLanguages, keeping keyword 'gato'
mockWindow.__ROBIN_SETTINGS__ = {
  allowedLanguages: [],
  hideKeywords: ['gato']
};
ctx.window.__ROBIN_ON_SETTINGS__();

// cellJa and cellEs should be unhidden
assertVisible(cellJa, 'cellJa after language filter cleared');
assertVisible(cellEs, 'cellEs after language filter cleared');
// But cellCatEs MUST REMAIN HIDDEN because of 'gato'
assertHidden(cellCatEs, 'cellCatEs due to keyword', 'data-mt-keyword-hide');
if (cellCatEs.getAttribute('data-mt-language-hide') === '1') {
  throw new Error('cellCatEs should no longer have data-mt-language-hide!');
}
console.log('✓ Unhiding language filter did not expose keyword-hidden cellCatEs');

// Now clear keyword
mockWindow.__ROBIN_SETTINGS__ = {
  allowedLanguages: [],
  hideKeywords: []
};
ctx.window.__ROBIN_ON_SETTINGS__();
assertVisible(cellCatEs, 'cellCatEs after all filters cleared');
console.log('✓ cellCatEs visible after clearing all filters');

console.log('\n========================================');
console.log('🎉 ALL LANGUAGE FILTER TESTS PASSED! 🎉');
console.log('========================================');
