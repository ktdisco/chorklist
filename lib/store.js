'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { UNITS, parseDate, todayString } = require('./schedule');

const COLORS = ['#e76f51', '#2a9d8f', '#e9c46a', '#8e7dbe', '#f4a261', '#457b9d', '#d62887', '#6a994e'];

class ValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function newId() {
  return crypto.randomBytes(6).toString('hex');
}

function cleanString(value, field, { required = false, max = 200 } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new ValidationError(`${field} is required`);
    return '';
  }
  if (typeof value !== 'string') throw new ValidationError(`${field} must be text`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new ValidationError(`${field} is required`);
  if (trimmed.length > max) throw new ValidationError(`${field} is too long (max ${max})`);
  return trimmed;
}

function cleanDate(value, field) {
  try {
    parseDate(value);
    return value;
  } catch {
    throw new ValidationError(`${field} must be a date like 2026-01-31`);
  }
}

class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { members: [], chores: [], history: [] };
    if (filePath && fs.existsSync(filePath)) {
      const loaded = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      this.data = {
        members: loaded.members || [],
        chores: loaded.chores || [],
        history: loaded.history || [],
      };
    }
  }

  save() {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.filePath);
  }

  // ---- members ----

  getMember(id) {
    return this.data.members.find((m) => m.id === id);
  }

  addMember(input) {
    const name = cleanString(input.name, 'Name', { required: true, max: 40 });
    if (this.data.members.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
      throw new ValidationError(`${name} is already in the household`);
    }
    const member = {
      id: newId(),
      name,
      color: COLORS[this.data.members.length % COLORS.length],
    };
    this.data.members.push(member);
    this.save();
    return member;
  }

  removeMember(id) {
    const idx = this.data.members.findIndex((m) => m.id === id);
    if (idx === -1) throw new ValidationError('Member not found', 404);
    this.data.members.splice(idx, 1);
    for (const chore of this.data.chores) {
      if (chore.assigneeId === id) chore.assigneeId = null;
    }
    this.save();
  }

  // ---- chores ----

  getChore(id) {
    const chore = this.data.chores.find((c) => c.id === id);
    if (!chore) throw new ValidationError('Chore not found', 404);
    return chore;
  }

  validateChore(input, existing = {}) {
    const merged = { ...existing, ...input };
    const every = Number(merged.every);
    if (!Number.isInteger(every) || every < 1 || every > 365) {
      throw new ValidationError('Frequency must be a whole number between 1 and 365');
    }
    if (!UNITS.includes(merged.unit)) {
      throw new ValidationError(`Unit must be one of: ${UNITS.join(', ')}`);
    }
    const assigneeId = merged.assigneeId || null;
    if (assigneeId && !this.getMember(assigneeId)) {
      throw new ValidationError('Assignee is not a household member');
    }
    return {
      name: cleanString(merged.name, 'Chore name', { required: true, max: 80 }),
      notes: cleanString(merged.notes, 'Notes', { max: 500 }),
      room: cleanString(merged.room, 'Room', { max: 40 }),
      every,
      unit: merged.unit,
      assigneeId,
      rotate: Boolean(merged.rotate),
      startDate: cleanDate(merged.startDate || todayString(), 'Start date'),
    };
  }

  addChore(input) {
    const chore = {
      id: newId(),
      ...this.validateChore(input),
      lastDone: null,
      lastDoneBy: null,
      createdAt: new Date().toISOString(),
    };
    this.data.chores.push(chore);
    this.save();
    return chore;
  }

  updateChore(id, input) {
    const chore = this.getChore(id);
    Object.assign(chore, this.validateChore(input, chore));
    this.save();
    return chore;
  }

  removeChore(id) {
    this.getChore(id);
    this.data.chores = this.data.chores.filter((c) => c.id !== id);
    this.data.history = this.data.history.filter((h) => h.choreId !== id);
    this.save();
  }

  // ---- completions ----

  completeChore(id, input = {}) {
    const chore = this.getChore(id);
    const date = cleanDate(input.date || todayString(), 'Date');
    const memberId = input.memberId || null;
    if (memberId && !this.getMember(memberId)) {
      throw new ValidationError('Member not found');
    }
    const entry = {
      id: newId(),
      choreId: chore.id,
      memberId,
      date,
      previousAssigneeId: chore.assigneeId,
      at: new Date().toISOString(),
    };
    this.data.history.push(entry);
    this.recomputeLastDone(chore);

    if (chore.rotate && this.data.members.length > 1) {
      const ids = this.data.members.map((m) => m.id);
      const current = ids.indexOf(chore.assigneeId);
      chore.assigneeId = ids[(current + 1) % ids.length];
    }
    this.save();
    return entry;
  }

  undoCompletion(historyId) {
    const entry = this.data.history.find((h) => h.id === historyId);
    if (!entry) throw new ValidationError('History entry not found', 404);
    this.data.history = this.data.history.filter((h) => h.id !== historyId);
    const chore = this.data.chores.find((c) => c.id === entry.choreId);
    if (chore) {
      this.recomputeLastDone(chore);
      if (chore.rotate && entry.previousAssigneeId !== undefined) {
        const prev = entry.previousAssigneeId;
        chore.assigneeId = prev && this.getMember(prev) ? prev : chore.assigneeId;
      }
    }
    this.save();
  }

  recomputeLastDone(chore) {
    const entries = this.data.history
      .filter((h) => h.choreId === chore.id)
      .sort((a, b) => (a.date === b.date ? a.at.localeCompare(b.at) : a.date.localeCompare(b.date)));
    const latest = entries[entries.length - 1];
    chore.lastDone = latest ? latest.date : null;
    chore.lastDoneBy = latest ? latest.memberId : null;
  }
}

module.exports = { Store, ValidationError };
