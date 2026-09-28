-- Phase 2: a generated column so the "under N minutes" filter can compare one number instead
-- of combining prep_minutes and cook_minutes in every query.

alter table public.recipes
  add column total_minutes integer generated always as (coalesce(prep_minutes, 0) + coalesce(cook_minutes, 0)) stored;

create index recipes_total_minutes_idx on public.recipes (total_minutes);
