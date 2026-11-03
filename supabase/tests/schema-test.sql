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
