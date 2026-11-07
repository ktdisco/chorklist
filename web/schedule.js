(function (root) {
'use strict';

// All dates are plain calendar strings (YYYY-MM-DD) so chores don't drift
// across time zones or daylight-saving changes.

const UNITS = ['day', 'week', 'month', 'year'];

function parseDate(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str || '');
  if (!m) throw new Error(`Invalid date: ${str}`);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCMonth() !== +m[2] - 1) throw new Error(`Invalid date: ${str}`);
  return d;
}

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

function todayString(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addMonthsClamped(d, months) {
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

function addInterval(dateStr, every, unit) {
  const d = parseDate(dateStr);
  switch (unit) {
    case 'day':
      d.setUTCDate(d.getUTCDate() + every);
      return formatDate(d);
    case 'week':
      d.setUTCDate(d.getUTCDate() + every * 7);
      return formatDate(d);
    case 'month':
      return formatDate(addMonthsClamped(d, every));
    case 'year':
      return formatDate(addMonthsClamped(d, every * 12));
    default:
      throw new Error(`Unknown unit: ${unit}`);
  }
}

function daysBetween(fromStr, toStr) {
  return Math.round((parseDate(toStr) - parseDate(fromStr)) / 86400000);
}

// One-time chores have repeats === false. Older rows without the field repeat.
function isOneTime(chore) {
  return chore.repeats === false;
}

// Next due date: one interval after the last completion, or the start date
// if the chore has never been done. A finished one-time chore has none.
function nextDue(chore) {
  if (isOneTime(chore)) return chore.lastDone ? null : chore.startDate;
  if (chore.lastDone) return addInterval(chore.lastDone, chore.every, chore.unit);
  return chore.startDate;
}

function status(chore, today) {
  const due = nextDue(chore);
  if (due === null) return { nextDue: null, daysUntil: null, state: 'finished' };
  const daysUntil = daysBetween(today, due);
  let state;
  if (daysUntil < 0) state = 'overdue';
  else if (daysUntil === 0) state = 'today';
  else if (daysUntil <= 7) state = 'soon';
  else state = 'later';
  return { nextDue: due, daysUntil, state };
}

function describeFrequency(every, unit, repeats = true) {
  if (repeats === false) return 'One time';
  if (every === 1) {
    return { day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Yearly' }[unit];
  }
  return `Every ${every} ${unit}s`;
}

const api = {
  UNITS,
  parseDate,
  formatDate,
  todayString,
  addInterval,
  daysBetween,
  isOneTime,
  nextDue,
  status,
  describeFrequency,
};

if (typeof module === 'object' && module.exports) module.exports = api;
else root.Schedule = api;
})(this);
