'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Store, ValidationError } = require('./lib/store');
const schedule = require('./lib/schedule');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 100_000) {
        reject(new ValidationError('Request too large', 413));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new ValidationError('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function buildState(store, today) {
  const chores = store.data.chores
    .map((c) => ({
      ...c,
      frequency: schedule.describeFrequency(c.every, c.unit),
      ...schedule.status(c, today),
    }))
    .sort((a, b) => a.nextDue.localeCompare(b.nextDue) || a.name.localeCompare(b.name));
  const history = store.data.history
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at))
    .slice(0, 50)
    .map((h) => {
      const chore = store.data.chores.find((c) => c.id === h.choreId);
      return { ...h, choreName: chore ? chore.name : '(deleted chore)' };
    });
  return { today, members: store.data.members, chores, history };
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(content);
  });
}

function createHandler(store) {
  const routes = [
    ['GET', /^\/api\/state$/, (req, url) => {
      const today = url.searchParams.get('today') || schedule.todayString();
      try {
        schedule.parseDate(today);
      } catch {
        throw new ValidationError('today must be a date like 2026-01-31');
      }
      return [200, buildState(store, today)];
    }],
    ['POST', /^\/api\/members$/, async (req) => [201, store.addMember(await readBody(req))]],
    ['DELETE', /^\/api\/members\/([\w-]+)$/, (req, url, id) => {
      store.removeMember(id);
      return [204];
    }],
    ['POST', /^\/api\/chores$/, async (req) => [201, store.addChore(await readBody(req))]],
    ['PUT', /^\/api\/chores\/([\w-]+)$/, async (req, url, id) => [200, store.updateChore(id, await readBody(req))]],
    ['DELETE', /^\/api\/chores\/([\w-]+)$/, (req, url, id) => {
      store.removeChore(id);
      return [204];
    }],
    ['POST', /^\/api\/chores\/([\w-]+)\/complete$/, async (req, url, id) => [201, store.completeChore(id, await readBody(req))]],
    ['DELETE', /^\/api\/history\/([\w-]+)$/, (req, url, id) => {
      store.undoCompletion(id);
      return [204];
    }],
  ];

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405);
        return res.end();
      }
      return serveStatic(req, res);
    }
    for (const [method, pattern, fn] of routes) {
      const match = pattern.exec(url.pathname);
      if (match && req.method === method) {
        try {
          const [status, body] = await fn(req, url, ...match.slice(1));
          return sendJson(res, status, body);
        } catch (err) {
          if (err instanceof ValidationError) return sendJson(res, err.status, { error: err.message });
          console.error(err);
          return sendJson(res, 500, { error: 'Something went wrong' });
        }
      }
    }
    return sendJson(res, 404, { error: 'Not found' });
  };
}

function createServer(store) {
  return http.createServer(createHandler(store));
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';
  const dataFile = process.env.CHORKLIST_DATA || path.join(__dirname, 'data', 'chorklist.json');
  const store = new Store(dataFile);
  createServer(store).listen(port, host, () => {
    console.log(`Chorklist running at http://localhost:${port}`);
    console.log(`Data stored in ${dataFile}`);
  });
}

module.exports = { createServer, createHandler, buildState };
