'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../lib/store');
const { createServer } = require('../server');

async function withServer(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chorklist-'));
  const file = path.join(dir, 'data.json');
  const server = createServer(new Store(file));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  try {
    await fn(call, file);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('full chore lifecycle', () => withServer(async (call, file) => {
  const alex = (await call('POST', '/api/members', { name: 'Alex' })).body;
  const sam = (await call('POST', '/api/members', { name: 'Sam' })).body;

  const created = await call('POST', '/api/chores', {
    name: 'Vacuum living room', every: 1, unit: 'week', startDate: '2026-11-01',
    assigneeId: alex.id, rotate: true, room: 'Living room',
  });
  assert.equal(created.status, 201);
  const id = created.body.id;

  let state = (await call('GET', '/api/state?today=2026-11-03')).body;
  assert.equal(state.chores[0].state, 'overdue');
  assert.equal(state.chores[0].frequency, 'Weekly');

  const done = await call('POST', `/api/chores/${id}/complete`, { memberId: alex.id, date: '2026-11-03' });
  assert.equal(done.status, 201);

  state = (await call('GET', '/api/state?today=2026-11-03')).body;
  assert.equal(state.chores[0].nextDue, '2026-11-10');
  assert.equal(state.chores[0].state, 'soon');
  assert.equal(state.chores[0].assigneeId, sam.id, 'rotates to next member');
  assert.equal(state.history.length, 1);
  assert.equal(state.history[0].choreName, 'Vacuum living room');

  // Data is persisted to disk and reloads cleanly.
  const reloaded = new Store(file);
  assert.equal(reloaded.data.chores[0].lastDone, '2026-11-03');

  // Undo restores schedule and assignee.
  assert.equal((await call('DELETE', `/api/history/${done.body.id}`)).status, 204);
  state = (await call('GET', '/api/state?today=2026-11-03')).body;
  assert.equal(state.chores[0].lastDone, null);
  assert.equal(state.chores[0].nextDue, '2026-11-01');
  assert.equal(state.chores[0].assigneeId, alex.id);

  // Removing a member unassigns their chores.
  await call('DELETE', `/api/members/${alex.id}`);
  state = (await call('GET', '/api/state')).body;
  assert.equal(state.chores[0].assigneeId, null);

  assert.equal((await call('DELETE', `/api/chores/${id}`)).status, 204);
  state = (await call('GET', '/api/state')).body;
  assert.equal(state.chores.length, 0);
}));

test('editing a chore updates its schedule', () => withServer(async (call) => {
  const { body: chore } = await call('POST', '/api/chores', {
    name: 'Change HVAC filter', every: 3, unit: 'month', startDate: '2026-11-03',
  });
  await call('POST', `/api/chores/${chore.id}/complete`, { date: '2026-11-03' });
  const updated = await call('PUT', `/api/chores/${chore.id}`, { every: 2 });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.name, 'Change HVAC filter');
  const state = (await call('GET', '/api/state?today=2026-11-03')).body;
  assert.equal(state.chores[0].nextDue, '2027-01-03');
}));

test('validation errors return 400 with a message', () => withServer(async (call) => {
  let res = await call('POST', '/api/chores', { name: '', every: 1, unit: 'week' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /required/);

  res = await call('POST', '/api/chores', { name: 'Dishes', every: 0, unit: 'week' });
  assert.equal(res.status, 400);

  res = await call('POST', '/api/chores', { name: 'Dishes', every: 1, unit: 'fortnight' });
  assert.equal(res.status, 400);

  res = await call('POST', '/api/chores', { name: 'Dishes', every: 1, unit: 'day', assigneeId: 'nope' });
  assert.equal(res.status, 400);

  await call('POST', '/api/members', { name: 'Alex' });
  res = await call('POST', '/api/members', { name: 'alex' });
  assert.equal(res.status, 400);

  res = await call('POST', '/api/chores/missing/complete', {});
  assert.equal(res.status, 404);

  res = await call('GET', '/api/state?today=garbage');
  assert.equal(res.status, 400);
}));


test('static files', async () => {
  const server = createServer(new Store(null));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const home = await fetch(`${base}/`);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /<title>Chorklist<\/title>/);
    const css = await fetch(`${base}/styles.css`);
    assert.match(css.headers.get('content-type'), /text\/css/);
    const evil = await fetch(`${base}/..%2fserver.js`);
    assert.notEqual(evil.status, 200);
  } finally {
    server.close();
  }
});
