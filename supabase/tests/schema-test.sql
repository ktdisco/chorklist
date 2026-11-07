-- Behavioural tests for schema.sql. Any failed check raises an exception.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\o /dev/null
set client_min_messages = warning;

insert into auth.users values
  ('00000000-0000-0000-0000-00000000000a'),  -- Alex
  ('00000000-0000-0000-0000-00000000000b'),  -- Blair (same household, joins by code)
  ('00000000-0000-0000-0000-00000000000c');  -- Casey (a different household)

create function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', msg; end if;
end $$;

create function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, false);
  execute 'set role authenticated';
end $$;

-- Alex creates a household and sets it up.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select (public.create_household('Maple St')).invite_code as code \gset
select pg_temp.check(length(:'code') = 12, 'invite code generated');
select id as hid from public.households \gset
select set_config('chork.hid', :'hid', false);

insert into public.members (household_id, name, created_at) values
  (:'hid', 'Alex', now() - interval '3 min'),
  (:'hid', 'Blair', now() - interval '2 min'),
  (:'hid', 'Sam', now() - interval '1 min');
select id as alex from public.members where name = 'Alex' \gset
select id as blair from public.members where name = 'Blair' \gset
select id as sam from public.members where name = 'Sam' \gset

do $$ begin
  insert into public.members (household_id, name)
    select household_id, ' alex ' from public.members limit 1;
  raise exception 'FAILED: duplicate member name allowed';
exception when unique_violation then null;
end $$;

insert into public.chores (household_id, name, every, unit, start_date, assignee_id, rotate)
  values (:'hid', 'Trash', 1, 'week', '2026-11-01', :'sam', true);
select id as trash from public.chores where name = 'Trash' \gset

do $$ begin
  insert into public.chores (household_id, name, every, unit)
    select id, 'Bad', 0, 'week' from public.households;
  raise exception 'FAILED: every = 0 allowed';
exception when check_violation then null;
end $$;

-- Completing updates last_done and rotates Sam -> Alex (wraps around).
select id as c1 from public.complete_chore(:'trash', :'sam', '2026-11-03') \gset
select pg_temp.check(last_done = '2026-11-03' and last_done_by = :'sam' and assignee_id = :'alex',
  'complete updates schedule and wraps rotation') from public.chores where id = :'trash';
select id as c2 from public.complete_chore(:'trash', :'alex', '2026-11-10') \gset
select pg_temp.check(assignee_id = :'blair' and last_done = '2026-11-10', 'rotation advances')
  from public.chores where id = :'trash';

-- Undo the latest: schedule falls back to the earlier completion, assignee restored.
select public.undo_completion(:'c2');
select pg_temp.check(last_done = '2026-11-03' and last_done_by = :'sam' and assignee_id = :'alex',
  'undo restores previous state') from public.chores where id = :'trash';
select public.undo_completion(:'c1');
select pg_temp.check(last_done is null and last_done_by is null and assignee_id = :'sam',
  'undo all clears last_done') from public.chores where id = :'trash';

-- Blair joins with the invite code (lower case and dashes are fine) and sees everything.
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.chores) = 0, 'non-member sees nothing');
select public.join_household(lower(substr(:'code', 1, 6) || '-' || substr(:'code', 7)));
select pg_temp.check((select count(*) from public.chores) = 1, 'joined member sees chores');
select pg_temp.check((select count(*) from public.household_users) = 2, 'sees both housemates');

do $$ begin
  perform public.join_household('NOPE');
  raise exception 'FAILED: bad invite code accepted';
exception when raise_exception then
  if sqlerrm like 'FAILED%' then raise; end if;
end $$;

-- Casey, in another household, can't see or touch Maple St.
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select (public.create_household('Elm St')).id as other \gset
select pg_temp.check((select count(*) from public.chores) = 0, 'outsider sees no chores');
select pg_temp.check((select count(*) from public.members) = 0, 'outsider sees no members');
select pg_temp.check((select count(*) from public.households) = 1, 'outsider sees only own household');
update public.chores set name = 'hacked' where id = :'trash';
delete from public.members where id = :'alex';

do $$ begin
  execute format('insert into public.chores (household_id, name, every, unit) values (%L, %L, 1, %L)',
    current_setting('chork.hid'), 'Sneaky', 'day');
  raise exception 'FAILED: outsider inserted chore into another household';
exception when insufficient_privilege then null;
end $$;

do $$ begin
  perform public.complete_chore((select id from public.chores where name = 'Trash'), null, null);
  raise exception 'FAILED: outsider completed chore';
exception when raise_exception then
  if sqlerrm like 'FAILED%' then raise; end if;
end $$;

-- An outsider can't attach someone else's member to their own chore.
do $$ begin
  insert into public.chores (household_id, name, every, unit, assignee_id)
    select h.id, 'Steal', 1, 'day', '00000000-0000-0000-0000-000000000000'::uuid
    from public.households h;
  raise exception 'FAILED: foreign assignee allowed';
exception when foreign_key_violation then null;
end $$;

reset role;
select pg_temp.check(name = 'Trash', 'outsider update blocked') from public.chores where id = :'trash';
select pg_temp.check(count(*) = 3, 'outsider delete blocked') from public.members where household_id = :'hid';

-- Removing a member unassigns their chores but keeps everything else.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.complete_chore(:'trash', :'sam', '2026-11-03');
delete from public.members where id = :'sam';
reset role;
select pg_temp.check(assignee_id = :'alex' and last_done_by is null and household_id = :'hid',
  'member delete nulls only the member column') from public.chores where id = :'trash';
select pg_temp.check(count(*) = 1, 'history kept after member delete')
  from public.completions where chore_id = :'trash';

-- ---------- Shared lists (migrations/002_lists.sql) ----------

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.lists (household_id, name) values (:'hid', 'Groceries');
select id as groceries from public.lists where name = 'Groceries' \gset
select set_config('chork.groceries', :'groceries', false);
insert into public.list_items (household_id, list_id, name, added_by) values
  (:'hid', :'groceries', 'Milk', :'alex'),
  (:'hid', :'groceries', 'Eggs', :'blair'),
  (:'hid', :'groceries', 'Bread', null);
update public.list_items set done = true where name in ('Milk', 'Eggs');

-- Blair (same household) sees and can change the list.
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check(count(*) = 3, 'housemate sees list items') from public.list_items;
-- "Clear checked items" is a plain delete of done items in one list.
delete from public.list_items where list_id = :'groceries' and done;
select pg_temp.check(count(*) = 1, 'clear checked leaves unchecked items') from public.list_items;

-- Casey (other household) sees nothing and can't add to it.
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.lists) = 0, 'outsider sees no lists');
select pg_temp.check((select count(*) from public.list_items) = 0, 'outsider sees no list items');
do $$ begin
  execute format('insert into public.list_items (household_id, list_id, name) values (%L, %L, %L)',
    current_setting('chork.hid'), current_setting('chork.groceries'), 'Sneaky');
  raise exception 'FAILED: outsider added a list item';
exception when insufficient_privilege then null;
end $$;
-- Even in their own household, they can't point an item at someone else's list.
do $$ begin
  execute format('insert into public.list_items (household_id, list_id, name) select id, %L, %L from public.households',
    current_setting('chork.groceries'), 'Cross');
  raise exception 'FAILED: item attached to another household''s list';
exception when foreign_key_violation then null;
end $$;
update public.list_items set name = 'hacked';
delete from public.lists;

reset role;
select pg_temp.check(count(*) = 1 and min(name) = 'Bread', 'outsider changes blocked')
  from public.list_items where list_id = :'groceries';

-- Removing a person keeps their items; deleting a list removes its items.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.list_items (household_id, list_id, name, added_by) values (:'hid', :'groceries', 'Jam', :'blair');
delete from public.members where id = :'blair';
reset role;
select pg_temp.check(added_by is null, 'item kept after member delete') from public.list_items where name = 'Jam';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
delete from public.lists where id = :'groceries';
reset role;
select pg_temp.check(count(*) = 0, 'deleting a list removes its items') from public.list_items;

do $$ begin
  insert into public.lists (household_id, name)
    values (current_setting('chork.hid')::uuid, '   ');
  raise exception 'FAILED: blank list name allowed';
exception when check_violation then null;
end $$;

-- ---------- One-time chores (migrations/003_one_time_chores.sql) ----------

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check(repeats, 'existing chores keep repeating') from public.chores where id = :'trash';
insert into public.chores (household_id, name, every, unit, start_date, repeats)
  values (:'hid', 'Fix fence', 1, 'week', '2026-11-20', false);
select id as fence from public.chores where name = 'Fix fence' \gset
select id as f1 from public.complete_chore(:'fence', :'alex', '2026-11-08') \gset
select pg_temp.check(not repeats and last_done = '2026-11-08' and last_done_by = :'alex',
  'one-time chore records completion') from public.chores where id = :'fence';
select public.undo_completion(:'f1');
select pg_temp.check(last_done is null, 'undo reopens one-time chore') from public.chores where id = :'fence';
reset role;

-- Signed-out users get nothing.
set role anon;
do $$ begin
  perform public.create_household('x');
  raise exception 'FAILED: anon created household';
exception when insufficient_privilege then null;
end $$;
reset role;

\o
select 'ALL SCHEMA TESTS PASSED';
