'use strict';

// Data layer: everything that talks to Supabase lives here.
// Converts database rows (snake_case) into the shapes the UI uses (camelCase).

(function () {
  const cfg = window.CHORKLIST_CONFIG || {};
  const configured = /^https:\/\/.+/.test(cfg.supabaseUrl || '') &&
    !/YOUR-PROJECT/.test(cfg.supabaseUrl) && cfg.supabaseAnonKey && !/YOUR-ANON-KEY/.test(cfg.supabaseAnonKey);

  const sb = configured && window.supabase
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    : null;

  const COLORS = ['#e76f51', '#2a9d8f', '#e9c46a', '#8e7dbe', '#f4a261', '#457b9d', '#d62887', '#6a994e'];

  function friendly(error) {
    if (!error) return null;
    const msg = error.message || String(error);
    if (error.code === '23505') return new Error('That name is already in the household');
    if (/repeats/.test(msg) && (error.code === 'PGRST204' || error.code === '42703')) {
      return new Error('One-time chores need a quick database update: run supabase/migrations/003_one_time_chores.sql in the Supabase SQL Editor.');
    }
    if (error.code === '23514') return new Error('Please check the values you entered');
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
      return new Error("Can't reach the server. Check your internet connection.");
    }
    return new Error(msg);
  }

  async function run(promise) {
    const { data, error } = await promise;
    if (error) throw friendly(error);
    return data;
  }

  // Lists arrived in a later update. If its database step hasn't been run yet,
  // keep chores working and let the Lists tab explain what to do.
  async function optional(promise) {
    const { data, error } = await promise;
    if (!error) return data;
    if (/PGRST205|42P01/.test(error.code || '') || /does not exist|schema cache/i.test(error.message || '')) return null;
    throw friendly(error);
  }

  const toMember = (r) => ({ id: r.id, name: r.name, color: r.color, createdAt: r.created_at });
  const toChore = (r) => ({
    id: r.id,
    name: r.name,
    notes: r.notes,
    room: r.room,
    every: r.every,
    unit: r.unit,
    assigneeId: r.assignee_id,
    rotate: r.rotate,
    repeats: r.repeats !== false, // missing before migration 003
    startDate: r.start_date,
    lastDone: r.last_done,
    lastDoneBy: r.last_done_by,
  });
  const toList = (r) => ({ id: r.id, name: r.name, createdAt: r.created_at });
  const toItem = (r) => ({
    id: r.id, listId: r.list_id, name: r.name, addedBy: r.added_by, done: r.done, createdAt: r.created_at,
  });
  const toCompletion = (r) => ({ id: r.id, choreId: r.chore_id, memberId: r.member_id, date: r.date, at: r.created_at });

  function choreRow(c) {
    const row = {};
    if ('name' in c) row.name = c.name.trim();
    if ('notes' in c) row.notes = c.notes.trim();
    if ('room' in c) row.room = c.room.trim();
    if ('every' in c) row.every = c.every;
    if ('unit' in c) row.unit = c.unit;
    if ('assigneeId' in c) row.assignee_id = c.assigneeId || null;
    if ('rotate' in c) row.rotate = c.rotate;
    if ('repeats' in c) row.repeats = c.repeats;
    if ('startDate' in c) row.start_date = c.startDate;
    return row;
  }

  window.ChorkDB = {
    configured: Boolean(sb),

    // ---------- accounts ----------

    async getUser() {
      const { data } = await sb.auth.getSession();
      return data.session ? data.session.user : null;
    },
    onAuthChange(cb) {
      sb.auth.onAuthStateChange((event, session) => cb(event, session ? session.user : null));
    },
    async signIn(email, password) {
      return run(sb.auth.signInWithPassword({ email, password }));
    },
    async signUp(email, password) {
      const data = await run(sb.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: location.origin + location.pathname },
      }));
      return { needsConfirmation: !data.session };
    },
    async resetPassword(email) {
      return run(sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }));
    },
    async updatePassword(password) {
      return run(sb.auth.updateUser({ password }));
    },
    async signOut() {
      await sb.auth.signOut();
    },

    // ---------- households ----------

    async getHousehold() {
      const rows = await run(sb.from('households').select('*').order('created_at').limit(1));
      return rows[0] || null;
    },
    async createHousehold(name) {
      return run(sb.rpc('create_household', { p_name: name.trim() }));
    },
    async joinHousehold(code) {
      return run(sb.rpc('join_household', { p_code: code }));
    },
    async resetInviteCode(householdId) {
      return run(sb.rpc('reset_invite_code', { p_household_id: householdId }));
    },
    async leaveHousehold(householdId, userId) {
      return run(sb.from('household_users').delete().eq('household_id', householdId).eq('user_id', userId));
    },
    async renameHousehold(householdId, name) {
      return run(sb.from('households').update({ name: name.trim() }).eq('id', householdId));
    },

    // ---------- chores data ----------

    async loadState(householdId, since) {
      const [members, chores, history, recent, accounts, lists, items] = await Promise.all([
        run(sb.from('members').select('*').eq('household_id', householdId).order('created_at').order('id')),
        run(sb.from('chores').select('*').eq('household_id', householdId)),
        run(sb.from('completions').select('*').eq('household_id', householdId)
          .order('date', { ascending: false }).order('created_at', { ascending: false }).limit(50)),
        run(sb.from('completions').select('member_id').eq('household_id', householdId).gte('date', since).limit(2000)),
        run(sb.from('household_users').select('user_id').eq('household_id', householdId)),
        optional(sb.from('lists').select('*').eq('household_id', householdId).order('created_at').order('id')),
        optional(sb.from('list_items').select('*').eq('household_id', householdId)
          .order('created_at').order('id').limit(5000)),
      ]);
      return {
        members: members.map(toMember),
        chores: chores.map(toChore),
        history: history.map(toCompletion),
        recent: recent.map((r) => r.member_id),
        accountCount: accounts.length,
        listsReady: Boolean(lists && items),
        lists: (lists || []).map(toList),
        items: (items || []).map(toItem),
      };
    },

    async addMember(householdId, name, existingCount) {
      return run(sb.from('members').insert({
        household_id: householdId,
        name: name.trim(),
        color: COLORS[existingCount % COLORS.length],
      }));
    },
    async removeMember(id) {
      return run(sb.from('members').delete().eq('id', id));
    },

    async addChore(householdId, chore) {
      return run(sb.from('chores').insert({ household_id: householdId, ...choreRow(chore) }));
    },
    async updateChore(id, chore) {
      return run(sb.from('chores').update(choreRow(chore)).eq('id', id));
    },
    async removeChore(id) {
      return run(sb.from('chores').delete().eq('id', id));
    },

    async completeChore(choreId, memberId, date) {
      const entry = await run(sb.rpc('complete_chore', { p_chore_id: choreId, p_member_id: memberId || null, p_date: date }));
      return toCompletion(entry);
    },
    async undoCompletion(id) {
      return run(sb.rpc('undo_completion', { p_completion_id: id }));
    },

    // ---------- shared lists ----------

    async addList(householdId, name) {
      return run(sb.from('lists').insert({ household_id: householdId, name: name.trim() }));
    },
    async renameList(id, name) {
      return run(sb.from('lists').update({ name: name.trim() }).eq('id', id));
    },
    async removeList(id) {
      return run(sb.from('lists').delete().eq('id', id));
    },
    async addItem(householdId, listId, name, memberId) {
      return run(sb.from('list_items').insert({
        household_id: householdId,
        list_id: listId,
        name: name.trim(),
        added_by: memberId || null,
      }));
    },
    async setItemDone(id, done) {
      return run(sb.from('list_items').update({ done }).eq('id', id));
    },
    async removeItem(id) {
      return run(sb.from('list_items').delete().eq('id', id));
    },
    async clearChecked(listId) {
      return run(sb.from('list_items').delete().eq('list_id', listId).eq('done', true));
    },

    // Calls cb whenever a housemate changes something.
    subscribe(householdId, cb) {
      const channel = sb.channel(`household-${householdId}`);
      for (const table of ['members', 'chores', 'completions', 'lists', 'list_items']) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table }, cb);
      }
      channel.subscribe();
      return () => sb.removeChannel(channel);
    },
  };
})();
