const perFeed = document.querySelector('#per-feed');
const apiKey = document.querySelector('#api-key');
const collectBtn = document.querySelector('#collect');
const scoreBtn = document.querySelector('#score');
const statusEl = document.querySelector('#status');
const resultsEl = document.querySelector('#results');
const logEl = document.querySelector('#log');

let snapshot = null;
let renderKey = '';

function fmt(n) {
  return n == null || Number.isNaN(n) ? '—' : String(n);
}

function posts(title, rows) {
  if (!rows?.length) return `<div><h3>${title}</h3><p class="status">None.</p></div>`;
  const items = rows
    .map((p) => {
      const why = /mislead/i.test(p.verdict)
        ? p.verdict
        : `${p.falseFindings} misleading claim${p.falseFindings === 1 ? '' : 's'}`;
      return `<div class="post">
        <span class="badge low">${p.score}</span>
        <a href="${p.url}" target="_blank" rel="noreferrer">@${escapeHtml(p.author || 'post')}</a>
        · ${escapeHtml(why)}${p.isAd ? ' · ad' : ''}
        <div>${escapeHtml(p.text)}</div>
      </div>`;
    })
    .join('');
  return `<div><h3>${title}</h3>${items}</div>`;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function render() {
  if (!snapshot) return;
  const busy = snapshot.phase === 'collecting' || snapshot.phase === 'scoring';
  collectBtn.disabled = busy;
  scoreBtn.disabled = busy || !snapshot.counts.for_you;
  const bits = [];
  if (snapshot.phase === 'collecting') bits.push('Collecting. If Chrome is sitting on a login page, sign in there.');
  else if (snapshot.phase === 'scoring') bits.push('Scoring posts. This calls Gemini once per post and can take several minutes.');
  else if (snapshot.error) bits.push(snapshot.error);
  else if (snapshot.counts.for_you) {
    bits.push(`Collected ${snapshot.counts.for_you} For you and ${snapshot.counts.following} Following. ${snapshot.counts.scored} scored.`);
  } else bits.push(snapshot.geminiConfigured ? 'Gemini key is available to this server.' : 'No Gemini key yet.');
  statusEl.textContent = bits.join(' ');
  logEl.textContent = (snapshot.log || []).map((l) => l.line).join('\n');
  logEl.scrollTop = logEl.scrollHeight;

  const m = snapshot.misleading;
  const fy = m?.for_you;
  const fo = m?.following;
  if (!fy?.scored && !fo?.scored) {
    resultsEl.hidden = true;
    return;
  }
  resultsEl.hidden = false;
  const row = (label, cell) =>
    `<tr><td>${label}</td><td>${fmt(cell?.misleading)}</td><td>${fmt(cell?.scored)}</td></tr>`;
  resultsEl.innerHTML = `
    <div class="means">
      <article class="mean following">
        <h2>Following</h2>
        <div class="num">${fmt(fo.misleading)}</div>
        <p>misleading posts out of ${fmt(fo.scored)} scored</p>
      </article>
      <article class="mean foryou">
        <h2>For you</h2>
        <div class="num">${fmt(fy.misleading)}</div>
        <p>misleading posts out of ${fmt(fy.scored)} scored</p>
      </article>
    </div>
    <div class="panel">
      <h2>With ads removed</h2>
      <table>
        <tr><th></th><th>Misleading</th><th>Scored</th></tr>
        ${row('Following', m.following)}
        ${row('For you', m.for_you)}
        ${row('Following, ads removed', m.following_organic)}
        ${row('For you, ads removed', m.for_you_organic)}
      </table>
    </div>
    <div class="panel">
      <h2>The misleading posts</h2>
      <div class="posts">
        ${posts('Following', snapshot.misleadingPosts?.following)}
        ${posts('For you', snapshot.misleadingPosts?.for_you)}
      </div>
    </div>`;
}

async function refresh() {
  const res = await fetch('/api/state');
  snapshot = await res.json();
  const key = JSON.stringify({
    phase: snapshot.phase,
    error: snapshot.error,
    counts: snapshot.counts,
    misleading: snapshot.misleading,
    logs: (snapshot.log || []).length,
  });
  if (key === renderKey) return;
  renderKey = key;
  render();
}

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) statusEl.textContent = data.error || `Request failed (${res.status})`;
  await refresh();
}

collectBtn.addEventListener('click', () => post('/api/collect', { perFeed: Number(perFeed.value) }));
scoreBtn.addEventListener('click', () => post('/api/score', { apiKey: apiKey.value }));

const events = new EventSource('/api/events');
events.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.type === 'log' && snapshot) {
    snapshot.phase = msg.phase;
    snapshot.log = snapshot.log || [];
    snapshot.log.push({ t: msg.t, line: msg.line });
    render();
  }
  if (msg.type === 'done') refresh();
});

refresh();
setInterval(refresh, 4000);
