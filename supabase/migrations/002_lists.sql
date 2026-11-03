-- Chorklist update: shared household lists (groceries, wish lists, movies to watch...).
-- Run once in Supabase → SQL Editor, after schema.sql. Existing chores data is not touched.

create table public.lists (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now(),
  unique (household_id, id)
);
create index lists_household_idx on public.lists (household_id, created_at);

create table public.list_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  list_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  added_by uuid,
  done boolean not null default false,
  created_at timestamptz not null default now(),
  -- Composite keys keep items, lists and people inside the same household.
  foreign key (household_id, list_id)
    references public.lists (household_id, id) on delete cascade,
  foreign key (household_id, added_by)
    references public.members (household_id, id) on delete set null (added_by)
);
create index list_items_list_idx on public.list_items (list_id, done, created_at);
create index list_items_household_idx on public.list_items (household_id);

-- Same rule as chores: you can only see and change your own household's lists.
alter table public.lists enable row level security;
alter table public.list_items enable row level security;

create policy "household lists" on public.lists
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy "household list items" on public.list_items
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

-- Live updates between phones.
alter publication supabase_realtime add table public.lists, public.list_items;
