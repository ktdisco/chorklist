'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../lib/schedule');

test('addInterval handles days, weeks, months and years', () => {
  assert.equal(s.addInterval('2026-01-30', 3, 'day'), '2026-02-02');
  assert.equal(s.addInterval('2026-12-28', 1, 'week'), '2027-01-04');
  assert.equal(s.addInterval('2026-03-15', 3, 'month'), '2026-06-15');
  assert.equal(s.addInterval('2026-11-03', 1, 'year'), '2027-11-03');
});

test('monthly intervals clamp to the end of short months', () => {
  assert.equal(s.addInterval('2026-01-31', 1, 'month'), '2026-02-28');
  assert.equal(s.addInterval('2028-01-31', 1, 'month'), '2028-02-29');
  assert.equal(s.addInterval('2028-02-29', 1, 'year'), '2029-02-28');
});

test('addInterval is unaffected by DST transitions', () => {
  assert.equal(s.addInterval('2026-03-07', 1, 'day'), '2026-03-08');
  assert.equal(s.addInterval('2026-10-31', 7, 'day'), '2026-11-07');
});

test('nextDue uses startDate until first completion', () => {
  const chore = { every: 2, unit: 'week', startDate: '2026-11-10', lastDone: null };
  assert.equal(s.nextDue(chore), '2026-11-10');
  chore.lastDone = '2026-11-12';
  assert.equal(s.nextDue(chore), '2026-11-26');
});

test('status buckets chores', () => {
  const base = { every: 1, unit: 'week', lastDone: null };
  const today = '2026-11-03';
  assert.equal(s.status({ ...base, startDate: '2026-11-01' }, today).state, 'overdue');
  assert.equal(s.status({ ...base, startDate: '2026-11-01' }, today).daysUntil, -2);
  assert.equal(s.status({ ...base, startDate: '2026-11-03' }, today).state, 'today');
  assert.equal(s.status({ ...base, startDate: '2026-11-10' }, today).state, 'soon');
  assert.equal(s.status({ ...base, startDate: '2026-11-11' }, today).state, 'later');
});

test('parseDate rejects bad input', () => {
  assert.throws(() => s.parseDate('2026-02-30'));
  assert.throws(() => s.parseDate('11/03/2026'));
  assert.throws(() => s.parseDate(undefined));
});

test('describeFrequency', () => {
  assert.equal(s.describeFrequency(1, 'week'), 'Weekly');
  assert.equal(s.describeFrequency(3, 'month'), 'Every 3 months');
});
