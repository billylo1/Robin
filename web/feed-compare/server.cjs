#!/usr/bin/env node
// Local web UI for For You vs Following credibility comparison.
// Binds to 127.0.0.1 only. Gemini keys and the X login stay on this machine.
//
//   GEMINI_API_KEY=... node web/feed-compare/server.cjs
//   open http://127.0.0.1:8787

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 8787);
const HOST = '127.0.0.1';
const ROOT = path.resolve(__dirname, '../..');
const PUBLIC = path.join(__dirname, 'public');
const OUT = path.join(ROOT, 'scripts/feed-credibility/out');
const COLLECT = path.join(ROOT, 'scripts/feed-credibility/collect-feeds.cjs');
const SCORE = path.join(ROOT, 'scripts/feed-credibility/score-feeds.cjs');
const { isMisleading, misleadingCount } = require(path.join(ROOT, 'scripts/feed-credibility/misleading.cjs'));

const state = { phase: 'idle', log: [], error: null };
const clients = new Set();
let child = null;
let runtimeKey = '';

function geminiConfigured() {
  return Boolean(runtimeKey || process.env.GEMINI_API_KEY);
}

function pushLog(line) {
  const entry = { t: Date.now(), line: String(line).slice(0, 500) };
  state.log.push(entry);
  if (state.log.length > 300) state.log.shift();
  broadcast({ type: 'log', phase: state.phase, ...entry });
}

function broadcast(obj) {
  const payload = `data: ${JSON.stringify(obj)}\n\n`;
  for (const res of clients) res.write(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function loadScores() {
  const file = path.join(OUT, 'scores.jsonl');
  const map = new Map();
  if (!fs.existsSync(file)) return map;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.id) map.set(row.id, row);
    } catch {
      /* skip a torn last line */
    }
  }
  return map;
}

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function misleadingPosts(list, scores) {
  return list
    .map((t) => {
      const s = scores.get(t.id);
      if (!isMisleading(s)) return null;
      const falseFindings = (s.findingStatuses || []).filter((status) => status === 'false_misleading').length;
      return {
        score: s.score,
        verdict: s.verdict || '',
        falseFindings,
        url: t.url,
        author: t.contentAuthor || t.author,
        text: String(t.text || '').replace(/\s+/g, ' ').slice(0, 180),
        isAd: Boolean(t.isAd),
      };
    })
    .filter(Boolean);
}

function snapshot() {
  const feedsDoc = readJson(path.join(OUT, 'feeds.json'));
  const scores = loadScores();
  const feeds = feedsDoc?.feeds || {};
  return {
    phase: state.phase,
    error: state.error,
    geminiConfigured: geminiConfigured(),
    log: state.log.slice(-40),
    collectedAt: feedsDoc?.collectedAt || null,
    source: feedsDoc?.source || null,
    counts: {
      for_you: feeds.for_you?.length || 0,
      following: feeds.following?.length || 0,
      scored: scores.size,
    },
    misleading: feedsDoc
      ? {
          for_you: misleadingCount(feeds.for_you || [], (id) => scores.get(id)),
          for_you_organic: misleadingCount((feeds.for_you || []).filter((t) => !t.isAd), (id) => scores.get(id)),
          following: misleadingCount(feeds.following || [], (id) => scores.get(id)),
          following_organic: misleadingCount((feeds.following || []).filter((t) => !t.isAd), (id) => scores.get(id)),
        }
      : null,
    misleadingPosts: feedsDoc
      ? {
          for_you: misleadingPosts(feeds.for_you || [], scores),
          following: misleadingPosts(feeds.following || [], scores),
        }
      : null,
  };
}

function runJob(phase, args, extraEnv) {
  state.phase = phase;
  state.error = null;
  pushLog(`starting ${phase}`);
  broadcast({ type: 'phase', phase });
  child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
  });
  const onData = (buf) => {
    for (const line of buf.toString().split(/\r?\n/)) {
      if (line.trim()) pushLog(line);
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('exit', (code) => {
    child = null;
    if (code === 0) {
      state.phase = 'idle';
      pushLog(`${phase} finished`);
    } else {
      state.phase = 'error';
      state.error = `${phase} exited with code ${code}`;
      pushLog(state.error);
    }
    broadcast({ type: 'done', phase: state.phase, error: state.error, snapshot: snapshot() });
  });
}

function send(res, status, body, type) {
  const payload = type === 'json' ? JSON.stringify(body) : body;
  res.writeHead(status, {
    'Content-Type': type === 'json' ? 'application/json; charset=utf-8' : type,
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'no', 'text/plain');
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'not found', 'text/plain');
    send(res, 200, data, types[path.extname(file)] || 'application/octet-stream');
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}`);
  try {
    if (req.method === 'GET' && url.pathname === '/api/state') {
      return send(res, 200, snapshot(), 'json');
    }
    if (req.method === 'GET' && url.pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(':\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (req.method === 'POST' && (url.pathname === '/api/collect' || url.pathname === '/api/score')) {
      if (child) return send(res, 409, { error: 'A job is already running.' }, 'json');
      const body = await readJsonBody(req);
      if (url.pathname === '/api/collect') {
        const per = Math.min(100, Math.max(10, Number(body.perFeed) || 50));
        runJob('collecting', [COLLECT, '--per-feed', String(per), '--out', OUT]);
      } else {
        const pasted = String(body.apiKey || '').trim();
        if (pasted && !pasted.startsWith('AIza')) {
          return send(res, 400, { error: 'That does not look like a Gemini API key.' }, 'json');
        }
        if (pasted) runtimeKey = pasted;
        if (!geminiConfigured()) {
          return send(res, 400, { error: 'Add a Gemini API key first. It stays in this process only.' }, 'json');
        }
        const concurrency = Math.min(8, Math.max(1, Number(body.concurrency) || 4));
        runJob('scoring', [SCORE, '--in', OUT, '--concurrency', String(concurrency)], {
          GEMINI_API_KEY: runtimeKey || process.env.GEMINI_API_KEY,
        });
      }
      return send(res, 202, { ok: true, phase: state.phase }, 'json');
    }
    if (req.method === 'GET') return serveStatic(res, url.pathname);
    send(res, 405, { error: 'method' }, 'json');
  } catch (err) {
    send(res, 400, { error: 'Bad request' }, 'json');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Feed compare: http://${HOST}:${PORT}`);
});
