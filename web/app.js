'use strict';

const $ = (sel) => document.querySelector(sel);
const db = window.ChorkDB;
const S = window.Schedule;

let session = { user: null, household: null };
let state = { members: [], chores: [], history: [], recent: [], accountCount: 0, today: '' };
let editingId = null;
let unsubscribe = null;
let signUpMode = false;

const local = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, v) { try { localStorage.setItem(key, v); } catch { /* ignore */ } },
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- screens ----------

function show(screen) {
  for (const el of document.querySelectorAll('.screen')) el.hidden = el.id !== `screen-${screen}`;
  $('#me-wrap').hidden = screen !== 'app';
}

let routing = 0;
async function route() {
  const ticket = ++routing;
  try {
    const user = await db.getUser();
    if (ticket !== routing) return;
    session.user = user;
    if (!user) {
      stopLive();
      session.household = null;
      setAuthMode(false);
      $('#auth-form').password.value = '';
      return show('auth');
    }
    const household = await db.getHousehold();
    if (ticket !== routing) return;
    session.household = household;
    if (!household) {
      stopLive();
      return show('household');
    }
    await refresh();
    if (ticket !== routing) return;
    show('app');
    startLive();
  } catch (err) {
    show('auth');
    showError(err);
  }
}

// ---------- data ----------

function localToday() {
  return S.todayString(new Date());
}

async function refresh() {
  if (!session.household) return;
  const today = localToday();
  const since = S.addInterval(today, -30, 'day');
  const data = await db.loadState(session.household.id, since);
  const names = Object.fromEntries(data.chores.map((c) => [c.id, c.name]));
  state = {
    ...data,
    today,
    chores: data.chores
      .map((c) => ({ ...c, frequency: S.describeFrequency(c.every, c.unit), ...S.status(c, today) }))
      .sort((a, b) => a.nextDue.localeCompare(b.nextDue) || a.name.localeCompare(b.name)),
    history: data.history.map((h) => ({ ...h, choreName: names[h.choreId] || '(deleted chore)' })),
  };
  render();
}

let refreshTimer;
function refreshSoon() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refresh().catch(() => {}), 300);
}

function startLive() {
  stopLive();
  unsubscribe = db.subscribe(session.household.id, refreshSoon);
}

function stopLive() {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
}

// ---------- helpers ----------

function member(id) {
  return state.members.find((m) => m.id === id);
}

function chip(id) {
  const m = member(id);
  if (!m) return '<span class="chip chip-none">Anyone</span>';
  return `<span class="chip" style="--c:${esc(m.color)}">${esc(m.name)}</span>`;
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
  toast(`<span>${esc(err.message || err)}</span>`);
}

// ---------- rendering ----------

function render() {
  renderMemberSelects();
  renderChores();
  renderHistory();
  renderHousehold();
}

function renderMemberSelects() {
  const opts = state.members.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('');

  const me = local.get('chorklist.me') || '';
  $('#me-select').innerHTML = `<option value="">—</option>${opts}`;
  $('#me-select').value = member(me) ? me : '';

  const filter = local.get('chorklist.filter') || 'all';
  $('#filter-select').innerHTML =
    `<option value="all">Everyone's chores</option>${state.members
      .map((m) => `<option value="${m.id}">${esc(m.name)}'s chores</option>`).join('')}<option value="none">Unassigned</option>`;
  $('#filter-select').value = filter === 'all' || filter === 'none' || member(filter) ? filter : 'all';

  const form = $('#chore-form');
  const selected = form.assigneeId.value;
  form.assigneeId.innerHTML = `<option value="">Anyone</option>${opts}`;
  form.assigneeId.value = member(selected) ? selected : '';

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
        “Take out recycling, every week” or “Change HVAC filter, every 3 months”.</p>
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
  const by = member(c.lastDoneBy);
  const last = c.lastDone ? `Last done ${formatDate(c.lastDone)}${by ? ` by ${esc(by.name)}` : ''}` : 'Never done';
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

function renderHousehold() {
  const counts = {};
  for (const c of state.chores) counts[c.assigneeId] = (counts[c.assigneeId] || 0) + 1;
  const recent = {};
  for (const id of state.recent) recent[id] = (recent[id] || 0) + 1;

  $('#household-name').textContent = session.household.name;
  $('#member-list').innerHTML = state.members.length
    ? state.members.map((m) => `
      <li>
        <span class="chip" style="--c:${esc(m.color)}">${esc(m.name)}</span>
        <span class="subtle">${counts[m.id] || 0} assigned · ${recent[m.id] || 0} done in last 30 days</span>
        <button class="link danger" data-remove-member="${m.id}">Remove</button>
      </li>`).join('')
    : '<li class="empty">Add the people who share the chores.</li>';

  $('#invite-code').textContent = session.household.invite_code.replace(/(.{4})(?=.)/g, '$1-');
  const n = state.accountCount;
  $('#account-count').textContent = `${n} ${n === 1 ? 'account has' : 'accounts have'} access to this household.`;
  $('#user-email').textContent = session.user.email;
}

// ---------- chore dialog ----------

function openChoreDialog(chore) {
  const form = $('#chore-form');
  editingId = chore ? chore.id : null;
  renderMemberSelects();
  $('#chore-dialog-title').textContent = chore ? 'Edit chore' : 'Add chore';
  $('#delete-chore-btn').hidden = !chore;
  $('#chore-error').textContent = '';
  form.name.value = chore?.name || '';
  form.room.value = chore?.room || '';
  form.every.value = chore?.every || 1;
  form.unit.value = chore?.unit || 'week';
  // Once a chore has been done, its schedule comes from the last completion.
  $('#start-date-label').hidden = Boolean(chore?.lastDone);
  form.startDate.value = chore ? chore.startDate : localToday();
  form.assigneeId.value = chore?.assigneeId || '';
  form.rotate.checked = chore?.rotate || false;
  form.notes.value = chore?.notes || '';
  $('#chore-dialog').showModal();
  if (!chore) form.name.focus();
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
    startDate: form.startDate.value,
  };
  if (!body.name.trim()) {
    $('#chore-error').textContent = 'Give the chore a name';
    return;
  }
  try {
    if (editingId) await db.updateChore(editingId, body);
    else await db.addChore(session.household.id, body);
  } catch (err) {
    $('#chore-error').textContent = err.message;
    return;
  }
  $('#chore-dialog').close();
  refresh().catch(showError);
}

// ---------- events ----------

function setAuthMode(signup) {
  const form = $('#auth-form');
  signUpMode = signup;
  $('#auth-title').textContent = signup ? 'Create an account' : 'Sign in';
  $('#auth-submit').textContent = signup ? 'Create account' : 'Sign in';
  $('#auth-toggle').textContent = signup ? 'Already have an account? Sign in' : 'New here? Create an account';
  form.password.autocomplete = signup ? 'new-password' : 'current-password';
  $('#auth-error').textContent = '';
}

function bindAuth() {
  const form = $('#auth-form');

  $('#auth-toggle').addEventListener('click', () => setAuthMode(!signUpMode));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#auth-error').textContent = '';
    $('#auth-note').textContent = '';
    $('#auth-submit').disabled = true;
    try {
      const email = form.email.value.trim();
      if (signUpMode) {
        const { needsConfirmation } = await db.signUp(email, form.password.value);
        if (needsConfirmation) {
          $('#auth-note').textContent = 'Check your email and tap the confirmation link, then come back here and sign in.';
          setAuthMode(false);
        }
      } else {
        await db.signIn(email, form.password.value);
      }
    } catch (err) {
      $('#auth-error').textContent = err.message;
    } finally {
      $('#auth-submit').disabled = false;
    }
  });

  $('#auth-forgot').addEventListener('click', async () => {
    const email = form.email.value.trim();
    if (!email) {
      $('#auth-error').textContent = 'Enter your email above first.';
      return;
    }
    try {
      await db.resetPassword(email);
      $('#auth-note').textContent = 'If that email has an account, a password reset link is on its way.';
    } catch (err) {
      $('#auth-error').textContent = err.message;
    }
  });

  for (const btn of document.querySelectorAll('.sign-out')) {
    btn.addEventListener('click', () => db.signOut());
  }
}

function bindHouseholdSetup() {
  $('#create-household-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await db.createHousehold(e.target.name.value);
      await route();
    } catch (err) {
      $('#household-error').textContent = err.message;
    }
  });
  $('#join-household-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await db.joinHousehold(e.target.code.value);
      await route();
    } catch (err) {
      $('#household-error').textContent = err.message;
    }
  });
}

function bindApp() {
  document.querySelectorAll('.tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
      document.querySelectorAll('.tab-panel').forEach((p) => { p.hidden = p.id !== `tab-${btn.dataset.tab}`; });
    });
  });

  $('#me-select').addEventListener('change', (e) => local.set('chorklist.me', e.target.value));
  $('#filter-select').addEventListener('change', (e) => {
    local.set('chorklist.filter', e.target.value);
    renderChores();
  });

  $('#add-chore-btn').addEventListener('click', () => openChoreDialog(null));
  $('#chore-form').addEventListener('submit', saveChore);
  $('#cancel-chore-btn').addEventListener('click', () => $('#chore-dialog').close());
  $('#delete-chore-btn').addEventListener('click', async () => {
    const chore = state.chores.find((c) => c.id === editingId);
    if (!chore || !confirm(`Delete “${chore.name}” and its history?`)) return;
    try {
      await db.removeChore(editingId);
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
        const entry = await db.completeChore(chore.id, me || chore.assigneeId, localToday());
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
    undo.disabled = true;
    try {
      await db.undoCompletion(undo.dataset.undo);
      $('#toast').hidden = true;
      await refresh();
    } catch (err) { showError(err); }
  });

  $('#member-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#member-name').value;
    if (!name.trim()) return;
    try {
      await db.addMember(session.household.id, name, state.members.length);
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
      await db.removeMember(m.id);
      await refresh();
    } catch (err) { showError(err); }
  });

  $('#share-invite').addEventListener('click', async () => {
    const code = $('#invite-code').textContent;
    const url = location.origin + location.pathname;
    const text = `Join our household on Chorklist: open ${url}, create an account, and enter invite code ${code}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Join our Chorklist', text });
      } else {
        await navigator.clipboard.writeText(text);
        toast('<span>Invite copied</span>');
      }
    } catch (err) {
      if (err.name !== 'AbortError') showError(err);
    }
  });

  $('#reset-invite').addEventListener('click', async () => {
    if (!confirm('Make a new invite code? The current code will stop working (people already in stay in).')) return;
    try {
      session.household.invite_code = await db.resetInviteCode(session.household.id);
      renderHousehold();
    } catch (err) { showError(err); }
  });

  $('#leave-household').addEventListener('click', async () => {
    if (!confirm(`Leave “${session.household.name}”? You'll need an invite code to rejoin.`)) return;
    try {
      await db.leaveHousehold(session.household.id, session.user.id);
      await route();
    } catch (err) { showError(err); }
  });

  // Catch up when the app comes back to the foreground (e.g. reopening it on the phone),
  // and roll over to a new day if it stays open overnight.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && session.household) refresh().catch(() => {});
  });
  setInterval(() => {
    if (!document.hidden && session.household) refresh().catch(() => {});
  }, 5 * 60_000);
}

function start() {
  if (!db.configured) {
    show('setup');
    return;
  }
  bindAuth();
  bindHouseholdSetup();
  bindApp();
  db.onAuthChange((event) => {
    // Run outside the auth callback; Supabase recommends not awaiting its own calls in here.
    setTimeout(async () => {
      if (event === 'PASSWORD_RECOVERY') {
        const pw = prompt('Choose a new password (at least 6 characters):');
        if (pw) {
          try {
            await db.updatePassword(pw);
            toast('<span>Password updated</span>');
          } catch (err) { showError(err); }
        }
      }
      if (['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT', 'PASSWORD_RECOVERY'].includes(event)) route();
    }, 0);
  });
}

start();
