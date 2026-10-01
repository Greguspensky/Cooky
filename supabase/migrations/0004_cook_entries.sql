-- A simple cook log doubling as a calendar: each row is either a logged-as-cooked dish (date is
-- today or earlier) or a planned one (date is in the future). "Times cooked" and "previous dates"
-- on a recipe's page, and the Calendar tab's month grid, are both just queries over this table.
-- Paste into Supabase → SQL Editor and run once, after 0001–0003.

create table public.cook_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  entry_date date not null,
  status text not null default 'planned' check (status in ('planned', 'cooked')),
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index cook_entries_household_date_idx on public.cook_entries (household_id, entry_date);
create index cook_entries_recipe_idx on public.cook_entries (recipe_id, entry_date desc);

alter table public.cook_entries enable row level security;

-- Supabase grants new tables to anon/authenticated by default (see 0001_init.sql's note on this);
-- start from nothing, same as every other table. Any future migration that adds a public table
-- needs this same revoke — 0001 only covers the tables that existed when it ran.
revoke all on public.cook_entries from anon, authenticated;

-- Shared household data, full CRUD within the household (same shape as grocery_lists/recipes) —
-- scheduling and logging don't need AI or validation, so the front end writes directly via RLS.
create policy cook_entries_all on public.cook_entries
  for all to authenticated
  using (household_id = public.current_household_id())
  with check (household_id = public.current_household_id());

grant select, insert, update, delete on public.cook_entries to authenticated;
