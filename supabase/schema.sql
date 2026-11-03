-- Chorklist database schema for Supabase.
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- It is safe to run on a fresh project; it does not touch other tables.

-- ============================================================
-- Tables
-- ============================================================

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  -- 12 random hex characters; share it with people you want to invite.
  invite_code text not null unique
    default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
  created_at timestamptz not null default now()
);

-- Which sign-in accounts belong to which household.
create table public.household_users (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index household_users_user_idx on public.household_users (user_id);

-- The people who share chores (they don't each need an account).
create table public.members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  color text not null default '#2a9d8f' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  unique (household_id, id)
);
create unique index members_unique_name on public.members (household_id, lower(btrim(name)));

create table public.chores (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  notes text not null default '' check (char_length(notes) <= 500),
  room text not null default '' check (char_length(room) <= 40),
  every integer not null check (every between 1 and 365),
  unit text not null check (unit in ('day', 'week', 'month', 'year')),
  assignee_id uuid,
  rotate boolean not null default false,
  start_date date not null default current_date,
  last_done date,
  last_done_by uuid,
  created_at timestamptz not null default now(),
  unique (household_id, id),
  -- Composite keys make sure a chore can only point at people in its own household.
  foreign key (household_id, assignee_id)
    references public.members (household_id, id) on delete set null (assignee_id),
  foreign key (household_id, last_done_by)
    references public.members (household_id, id) on delete set null (last_done_by)
);

create table public.completions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  chore_id uuid not null,
  member_id uuid,
  date date not null,
  previous_assignee_id uuid,
  created_at timestamptz not null default now(),
  foreign key (household_id, chore_id)
    references public.chores (household_id, id) on delete cascade,
  foreign key (household_id, member_id)
    references public.members (household_id, id) on delete set null (member_id),
  foreign key (household_id, previous_assignee_id)
    references public.members (household_id, id) on delete set null (previous_assignee_id)
);
create index completions_chore_idx on public.completions (chore_id, date desc, created_at desc);
create index completions_household_idx on public.completions (household_id, date desc);

-- ============================================================
-- Row level security: you can only see your own household's data
-- ============================================================

create function public.is_household_member(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_users
    where household_id = hid and user_id = auth.uid()
  );
$$;

alter table public.households enable row level security;
alter table public.household_users enable row level security;
alter table public.members enable row level security;
alter table public.chores enable row level security;
alter table public.completions enable row level security;

create policy "read own households" on public.households
  for select to authenticated using (public.is_household_member(id));
create policy "rename own households" on public.households
  for update to authenticated
  using (public.is_household_member(id)) with check (public.is_household_member(id));

create policy "see housemates" on public.household_users
  for select to authenticated using (public.is_household_member(household_id));
create policy "leave household" on public.household_users
  for delete to authenticated using (user_id = auth.uid());

create policy "household members" on public.members
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy "household chores" on public.chores
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy "household completions" on public.completions
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

-- ============================================================
-- Functions the app calls
-- ============================================================

-- Create a household and join it.
create function public.create_household(p_name text)
returns public.households
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.households;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into public.households (name) values (btrim(p_name)) returning * into h;
  insert into public.household_users (household_id, user_id) values (h.id, auth.uid());
  return h;
end;
$$;

-- Join an existing household using its invite code.
create function public.join_household(p_code text)
returns public.households
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.households;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into h from public.households
    where invite_code = upper(regexp_replace(p_code, '[^0-9A-Za-z]', '', 'g'));
  if not found then raise exception 'No household found with that invite code'; end if;
  insert into public.household_users (household_id, user_id)
    values (h.id, auth.uid()) on conflict do nothing;
  return h;
end;
$$;

-- Give the household a fresh invite code (the old one stops working).
create function public.reset_invite_code(p_household_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  code text;
begin
  if not public.is_household_member(p_household_id) then raise exception 'Not allowed'; end if;
  update public.households
    set invite_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
    where id = p_household_id
    returning invite_code into code;
  return code;
end;
$$;

create function public.refresh_last_done(p_chore_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.chores c
  set (last_done, last_done_by) = (
    select h.date, h.member_id from public.completions h
    where h.chore_id = c.id
    order by h.date desc, h.created_at desc
    limit 1
  )
  where c.id = p_chore_id;
$$;

-- Mark a chore done: records history, updates the schedule and rotates the assignee.
create function public.complete_chore(p_chore_id uuid, p_member_id uuid, p_date date)
returns public.completions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c public.chores;
  entry public.completions;
  next_assignee uuid;
begin
  select * into c from public.chores where id = p_chore_id for update;
  if not found then raise exception 'Chore not found'; end if;

  insert into public.completions (household_id, chore_id, member_id, date, previous_assignee_id)
    values (c.household_id, c.id, p_member_id, coalesce(p_date, current_date), c.assignee_id)
    returning * into entry;

  perform public.refresh_last_done(c.id);

  if c.rotate then
    -- Next person after the current assignee (in the order they were added), wrapping around.
    select m.id into next_assignee from public.members m
      where m.household_id = c.household_id
        and (m.created_at, m.id) > (
          select m2.created_at, m2.id from public.members m2 where m2.id = c.assignee_id)
      order by m.created_at, m.id
      limit 1;
    if next_assignee is null then
      select m.id into next_assignee from public.members m
        where m.household_id = c.household_id
        order by m.created_at, m.id
        limit 1;
    end if;
    update public.chores set assignee_id = next_assignee where id = c.id;
  end if;

  return entry;
end;
$$;

-- Undo a completion: removes it from history and restores the schedule and assignee.
create function public.undo_completion(p_completion_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  entry public.completions;
  c public.chores;
begin
  select * into entry from public.completions where id = p_completion_id;
  if not found then raise exception 'History entry not found'; end if;
  select * into c from public.chores where id = entry.chore_id for update;

  delete from public.completions where id = entry.id;
  perform public.refresh_last_done(c.id);

  if c.rotate then
    update public.chores set assignee_id = entry.previous_assignee_id where id = c.id;
  end if;
end;
$$;

-- Only signed-in users may call these.
revoke execute on function public.is_household_member(uuid) from public, anon;
grant execute on function public.is_household_member(uuid) to authenticated;
revoke execute on function public.create_household(text) from public, anon;
grant execute on function public.create_household(text) to authenticated;
revoke execute on function public.join_household(text) from public, anon;
grant execute on function public.join_household(text) to authenticated;
revoke execute on function public.reset_invite_code(uuid) from public, anon;
grant execute on function public.reset_invite_code(uuid) to authenticated;
revoke execute on function public.refresh_last_done(uuid) from public, anon;
grant execute on function public.refresh_last_done(uuid) to authenticated;
revoke execute on function public.complete_chore(uuid, uuid, date) from public, anon;
grant execute on function public.complete_chore(uuid, uuid, date) to authenticated;
revoke execute on function public.undo_completion(uuid) from public, anon;
grant execute on function public.undo_completion(uuid) to authenticated;

-- ============================================================
-- Live updates: phones refresh when someone else makes a change
-- ============================================================

alter publication supabase_realtime add table public.members, public.chores, public.completions;
