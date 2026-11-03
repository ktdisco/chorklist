'use strict';

const $ = (sel) => document.querySelector(sel);
let state = { members: [], chores: [], history: [], today: '' };
let editingId = null;

const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, v) { try { localStorage.setItem(key, v); } catch { /* ignore */ } },
};

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function refresh() {
  state = await api('GET', `/api/state?today=${localToday()}`);
  render();
}

// ---------- helpers ----------

function member(id) {
  return state.members.find((m) => m.id === id);
}

function chip(id) {
  const m = member(id);
  if (!m) return '<span class="chip chip-none">Anyone</span>';
  return `<span class="chip" style="--c:${m.color}">${esc(m.name)}</span>`;
}

function formatDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function dueText(c) {
  const n = c.daysUntil;
  if (n < -1) return `${-n} days overdue`;
  if (n === -1) return '1 day overdue';
  if (n === 0) return 'Due today';
  if (n === 1) return 'Due tomorrow';
  if (n <= 7) return `Due in ${n} days`;
  return `Due ${formatDate(c.nextDue)}`;
}

let toastTimer;
function toast(html, ms = 5000) {
  const el = $('#toast');
  el.innerHTML = html;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function showError(err) {
  toast(`<span>${esc(err.message)}</span>`);
}

// ---------- rendering ----------

function render() {
  renderMemberSelects();
  renderChores();
  renderHistory();
  renderMembers();
}

function renderMemberSelects() {
  const opts = state.members.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('');

  const me = store.get('chorklist.me') || '';
  $('#me-select').innerHTML = `<option value="">—</option>${opts}`;
  $('#me-select').value = member(me) ? me : '';

  const filter = store.get('chorklist.filter') || 'all';
  $('#filter-select').innerHTML =
    `<option value="all">Everyone's chores</option>${state.members
      .map((m) => `<option value="${m.id}">${esc(m.name)}'s chores</option>`).join('')}<option value="none">Unassigned</option>`;
  $('#filter-select').value = filter === 'all' || filter === 'none' || member(filter) ? filter : 'all';

  $('#chore-form').assigneeId.innerHTML = `<option value="">Anyone</option>${opts}`;

  const rooms = [...new Set(state.chores.map((c) => c.room).filter(Boolean))].sort();
  $('#room-options').innerHTML = rooms.map((r) => `<option value="${esc(r)}">`).join('');
}

const GROUPS = [
  ['overdue', 'Overdue'],
  ['today', 'Today'],
  ['soon', 'This week'],
  ['later', 'Later'],
];

function renderChores() {
  const filter = $('#filter-select').value;
  const chores = state.chores.filter((c) =>
    filter === 'all' ? true : filter === 'none' ? !c.assigneeId : c.assigneeId === filter);

  if (!state.chores.length) {
    $('#chore-groups').innerHTML = `
      <div class="empty">
        <p><strong>No chores yet.</strong></p>
        <p>Add your household in the <em>Household</em> tab, then add chores like
        “Take out recycling — every week” or “Change HVAC filter — every 3 months”.</p>
      </div>`;
    return;
  }

  $('#chore-groups').innerHTML = GROUPS.map(([key, label]) => {
    const items = chores.filter((c) => c.state === key);
    if (!items.length) return '';
    return `
      <h2 class="group-title group-${key}">${label} <span class="count">${items.length}</span></h2>
      <ul class="chores">${items.map(choreCard).join('')}</ul>`;
  }).join('') || '<p class="empty">Nothing here. 🎉</p>';
}

function choreCard(c) {
  const last = c.lastDone
    ? `Last done ${formatDate(c.lastDone)}${member(c.lastDoneBy) ? ` by ${esc(member(c.lastDoneBy).name)}` : ''}`
    : 'Never done';
  return `
    <li class="chore state-${c.state}">
      <button class="done-btn" data-done="${c.id}" aria-label="Mark ${esc(c.name)} done" title="Mark done">✓</button>
      <div class="chore-main" data-edit="${c.id}" role="button" tabindex="0">
        <div class="chore-title">${esc(c.name)}${c.room ? ` <span class="room">${esc(c.room)}</span>` : ''}</div>
        <div class="chore-meta">
          <span class="due">${dueText(c)}</span> ·
          <span>${esc(c.frequency)}${c.rotate ? ' · rotates' : ''}</span>
        </div>
        <div class="chore-meta subtle">${last}</div>
        ${c.notes ? `<div class="chore-notes">${esc(c.notes)}</div>` : ''}
      </div>
      ${chip(c.assigneeId)}
    </li>`;
}

function renderHistory() {
  if (!state.history.length) {
    $('#history-list').innerHTML = '<li class="empty">Completed chores will show up here.</li>';
    return;
  }
  $('#history-list').innerHTML = state.history.map((h) => `
    <li>
      <span class="when">${formatDate(h.date)}</span>
      <span class="what">${esc(h.choreName)}</span>
      ${h.memberId ? chip(h.memberId) : ''}
      <button class="link" data-undo="${h.id}">Undo</button>
    </li>`).join('');
}

function renderMembers() {
  const counts = {};
  for (const c of state.chores) counts[c.assigneeId] = (counts[c.assigneeId] || 0) + 1;
  const monthAgo = new Date();
  monthAgo.setDate(monthAgo.getDate() - 30);
  const since = monthAgo.toISOString().slice(0, 10);
  const recent = {};
  for (const h of state.history) if (h.date >= since) recent[h.memberId] = (recent[h.memberId] || 0) + 1;

  $('#member-list').innerHTML = state.members.length
    ? state.members.map((m) => `
      <li>
        <span class="chip" style="--c:${m.color}">${esc(m.name)}</span>
        <span class="subtle">${counts[m.id] || 0} assigned · ${recent[m.id] || 0} done in last 30 days</span>
        <button class="link danger" data-remove-member="${m.id}">Remove</button>
      </li>`).join('')
    : '<li class="empty">Add the people who share the chores.</li>';
}

// ---------- chore dialog ----------

function openChoreDialog(chore) {
  const form = $('#chore-form');
  editingId = chore ? chore.id : null;
  $('#chore-dialog-title').textContent = chore ? 'Edit chore' : 'Add chore';
  $('#delete-chore-btn').hidden = !chore;
  $('#chore-error').textContent = '';
  form.name.value = chore?.name || '';
  form.room.value = chore?.room || '';
  form.every.value = chore?.every || 1;
  form.unit.value = chore?.unit || 'week';
  form.startDate.value = chore ? (chore.lastDone ? chore.nextDue : chore.startDate) : localToday();
  form.assigneeId.value = chore?.assigneeId || '';
  form.rotate.checked = chore?.rotate || false;
  form.notes.value = chore?.notes || '';
  $('#chore-dialog').showModal();
  form.name.focus();
}

async function saveChore(e) {
  e.preventDefault();
  const form = $('#chore-form');
  const body = {
    name: form.name.value,
    room: form.room.value,
    every: Number(form.every.value),
    unit: form.unit.value,
    assigneeId: form.assigneeId.value || null,
    rotate: form.rotate.checked,
    notes: form.notes.value,
  };
  try {
    if (editingId) {
      const existing = state.chores.find((c) => c.id === editingId);
      // "First due" only changes the schedule when the chore has never been done.
      if (!existing.lastDone) body.startDate = form.startDate.value;
      await api('PUT', `/api/chores/${editingId}`, body);
    } else {
      body.startDate = form.startDate.value;
      await api('POST', '/api/chores', body);
    }
    $('#chore-dialog').close();
    await refresh();
  } catch (err) {
    $('#chore-error').textContent = err.message;
  }
}

// ---------- events ----------

function bindEvents() {
  document.querySelectorAll('.tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
      document.querySelectorAll('.tab-panel').forEach((p) => { p.hidden = p.id !== `tab-${btn.dataset.tab}`; });
    });
  });

  $('#me-select').addEventListener('change', (e) => store.set('chorklist.me', e.target.value));
  $('#filter-select').addEventListener('change', (e) => {
    store.set('chorklist.filter', e.target.value);
    renderChores();
  });

  $('#add-chore-btn').addEventListener('click', () => openChoreDialog(null));
  $('#chore-form').addEventListener('submit', saveChore);
  $('#cancel-chore-btn').addEventListener('click', () => $('#chore-dialog').close());
  $('#delete-chore-btn').addEventListener('click', async () => {
    const chore = state.chores.find((c) => c.id === editingId);
    if (!chore || !confirm(`Delete “${chore.name}” and its history?`)) return;
    try {
      await api('DELETE', `/api/chores/${editingId}`);
      $('#chore-dialog').close();
      await refresh();
    } catch (err) { showError(err); }
  });

  $('#chore-groups').addEventListener('click', async (e) => {
    const done = e.target.closest('[data-done]');
    if (done) {
      const chore = state.chores.find((c) => c.id === done.dataset.done);
      const me = $('#me-select').value;
      done.disabled = true;
      try {
        const entry = await api('POST', `/api/chores/${chore.id}/complete`, {
          memberId: me || chore.assigneeId || null,
          date: localToday(),
        });
        await refresh();
        toast(`<span>✓ ${esc(chore.name)} done</span><button class="link" data-undo="${entry.id}">Undo</button>`);
      } catch (err) {
        done.disabled = false;
        showError(err);
      }
      return;
    }
    const edit = e.target.closest('[data-edit]');
    if (edit) openChoreDialog(state.chores.find((c) => c.id === edit.dataset.edit));
  });

  $('#chore-groups').addEventListener('keydown', (e) => {
    const edit = e.target.closest('[data-edit]');
    if (edit && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      openChoreDialog(state.chores.find((c) => c.id === edit.dataset.edit));
    }
  });

  document.addEventListener('click', async (e) => {
    const undo = e.target.closest('[data-undo]');
    if (!undo) return;
    try {
      await api('DELETE', `/api/history/${undo.dataset.undo}`);
      $('#toast').hidden = true;
      await refresh();
    } catch (err) { showError(err); }
  });

  $('#member-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/api/members', { name: $('#member-name').value });
      $('#member-name').value = '';
      await refresh();
    } catch (err) { showError(err); }
  });

  $('#member-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-remove-member]');
    if (!btn) return;
    const m = member(btn.dataset.removeMember);
    if (!confirm(`Remove ${m.name}? Their chores will become unassigned.`)) return;
    try {
      await api('DELETE', `/api/members/${m.id}`);
      await refresh();
    } catch (err) { showError(err); }
  });

  // Keep the list fresh when other household members make changes,
  // and roll over to a new day if the tab stays open overnight.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh().catch(() => {});
  });
  setInterval(() => { if (!document.hidden) refresh().catch(() => {}); }, 60_000);
}

bindEvents();
refresh().catch(showError);
