-- Cooky: initial schema (plan §3) with row level security.
-- Paste into Supabase → SQL Editor → New query, then Run. Safe to run once on an empty project.
--
-- Access model:
--   * The Mini App uses a JWT issued by /api/auth with `sub` = users.id and a
--     `household_id` claim. Policies below scope every row to that household.
--   * /api and the bot use the service role, which bypasses RLS.
--   * Tables written only by the server (imports, assistant history, pending actions)
--     are read-only for the front end.

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.current_household_id()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'household_id', '')::uuid
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Households & users
-- ---------------------------------------------------------------------------

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- The app serves exactly one household.
create unique index households_single_row on public.households ((true));

create table public.users (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  telegram_id bigint not null unique,
  display_name text not null,
  photo_url text,
  locale text,
  unit_system text not null default 'metric' check (unit_system in ('metric', 'imperial')),
  -- Transcription language override (phase 7); null = auto-detect.
  voice_language text,
  created_at timestamptz not null default now()
);

create index users_household_id_idx on public.users (household_id);

-- ---------------------------------------------------------------------------
-- Recipes
-- ---------------------------------------------------------------------------

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null,
  description text,
  servings numeric,
  prep_minutes integer,
  cook_minutes integer,
  cuisine text,
  tags text[] not null default '{}',
  -- [{ id, qty, unit, item, note, store_section }]
  ingredients jsonb not null default '[]'::jsonb,
  -- [{ n, text, timer_seconds?, ingredient_ids[] }]
  steps jsonb not null default '[]'::jsonb,
  source_type text not null default 'manual' check (source_type in ('manual', 'pdf', 'assistant', 'url')),
  -- { book_title, page, url }
  source_ref jsonb,
  image_path text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector
);

create index recipes_household_id_idx on public.recipes (household_id);
create index recipes_search_idx on public.recipes using gin (search);
create index recipes_title_trgm_idx on public.recipes using gin (title gin_trgm_ops);
create index recipes_tags_idx on public.recipes using gin (tags);

-- Recipes keep their original language, so search uses the language-neutral 'simple' config.
create or replace function public.recipes_update_search()
returns trigger
language plpgsql
as $$
begin
  new.search :=
    setweight(to_tsvector('simple', coalesce(new.title, '')), 'A')
    || setweight(to_tsvector('simple', array_to_string(new.tags, ' ')), 'B')
    || setweight(to_tsvector('simple', coalesce(new.cuisine, '')), 'B')
    || setweight(
      to_tsvector(
        'simple',
        coalesce(
          (select string_agg(i ->> 'item', ' ') from jsonb_array_elements(new.ingredients) as i),
          ''
        )
      ),
      'C'
    )
    || setweight(to_tsvector('simple', coalesce(new.description, '')), 'D');
  return new;
end;
$$;

create trigger recipes_search_trigger
  before insert or update of title, tags, cuisine, ingredients, description
  on public.recipes
  for each row execute function public.recipes_update_search();

create trigger recipes_updated_at
  before update on public.recipes
  for each row execute function public.set_updated_at();

create table public.recipe_user_meta (
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  is_favorite boolean not null default false,
  rating smallint check (rating between 1 and 5),
  personal_note text,
  updated_at timestamptz not null default now(),
  primary key (recipe_id, user_id)
);

create index recipe_user_meta_user_id_idx on public.recipe_user_meta (user_id);

create trigger recipe_user_meta_updated_at
  before update on public.recipe_user_meta
  for each row execute function public.set_updated_at();

create table public.taste_preferences (
  user_id uuid primary key references public.users (id) on delete cascade,
  likes text[] not null default '{}',
  dislikes text[] not null default '{}',
  diet_notes text,
  updated_at timestamptz not null default now()
);

create trigger taste_preferences_updated_at
  before update on public.taste_preferences
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Cookbook import
-- ---------------------------------------------------------------------------

create table public.cookbooks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null,
  storage_path text not null,
  page_count integer,
  uploaded_by uuid references public.users (id) on delete set null,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'processing', 'ready', 'failed')),
  created_at timestamptz not null default now()
);

create index cookbooks_household_id_idx on public.cookbooks (household_id);

create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  cookbook_id uuid not null references public.cookbooks (id) on delete cascade,
  page_start integer not null,
  page_end integer not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  error text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index import_jobs_cookbook_id_idx on public.import_jobs (cookbook_id);
create index import_jobs_queued_idx on public.import_jobs (created_at) where status = 'queued';

create trigger import_jobs_updated_at
  before update on public.import_jobs
  for each row execute function public.set_updated_at();

create table public.import_candidates (
  id uuid primary key default gen_random_uuid(),
  cookbook_id uuid not null references public.cookbooks (id) on delete cascade,
  job_id uuid references public.import_jobs (id) on delete set null,
  recipe jsonb not null,
  page integer,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  duplicate_of uuid references public.recipes (id) on delete set null,
  created_at timestamptz not null default now()
);

create index import_candidates_cookbook_id_idx on public.import_candidates (cookbook_id);

-- ---------------------------------------------------------------------------
-- Grocery lists
-- ---------------------------------------------------------------------------

create table public.grocery_lists (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null,
  status text not null default 'active' check (status in ('active', 'done')),
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index grocery_lists_household_id_idx on public.grocery_lists (household_id);

create table public.grocery_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.grocery_lists (id) on delete cascade,
  item text not null,
  qty numeric,
  unit text,
  store_section text not null default 'other'
    check (store_section in ('produce', 'dairy', 'meat_fish', 'pantry', 'frozen', 'bakery', 'other')),
  checked boolean not null default false,
  checked_by uuid references public.users (id) on delete set null,
  added_by uuid references public.users (id) on delete set null,
  source_recipe_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create index grocery_items_list_id_idx on public.grocery_items (list_id);

-- ---------------------------------------------------------------------------
-- Assistant
-- ---------------------------------------------------------------------------

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index conversations_user_id_idx on public.conversations (user_id, updated_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  -- Claude content blocks (text, tool_use, tool_result).
  content jsonb not null,
  -- Where the message was sent from.
  channel text not null default 'app' check (channel in ('app', 'bot')),
  created_at timestamptz not null default now()
);

create index messages_conversation_id_idx on public.messages (conversation_id, created_at);

create table public.pending_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  action_type text not null,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'cancelled', 'expired')),
  expires_at timestamptz not null default now() + interval '15 minutes',
  created_at timestamptz not null default now()
);

create index pending_actions_user_id_idx on public.pending_actions (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.households enable row level security;
alter table public.users enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_user_meta enable row level security;
alter table public.taste_preferences enable row level security;
alter table public.cookbooks enable row level security;
alter table public.import_jobs enable row level security;
alter table public.import_candidates enable row level security;
alter table public.grocery_lists enable row level security;
alter table public.grocery_items enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.pending_actions enable row level security;

-- Supabase grants everything to anon/authenticated by default. Start from nothing:
-- the front end never uses anon, and `authenticated` gets the grants at the end.
revoke all on all tables in schema public from anon, authenticated;

-- households: read your own.
create policy households_select on public.households
  for select to authenticated
  using (id = public.current_household_id());

-- users: see your household; edit only your own row.
create policy users_select on public.users
  for select to authenticated
  using (household_id = public.current_household_id());
create policy users_update on public.users
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and household_id = public.current_household_id());

-- recipes: full access within the household.
create policy recipes_all on public.recipes
  for all to authenticated
  using (household_id = public.current_household_id())
  with check (household_id = public.current_household_id());

-- recipe_user_meta: see both partners' ratings; write only your own.
create policy recipe_user_meta_select on public.recipe_user_meta
  for select to authenticated
  using (exists (
    select 1 from public.recipes r
    where r.id = recipe_id and r.household_id = public.current_household_id()
  ));
create policy recipe_user_meta_write on public.recipe_user_meta
  for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.recipes r
      where r.id = recipe_id and r.household_id = public.current_household_id()
    )
  );

-- taste_preferences: see the household's; write only your own.
create policy taste_preferences_select on public.taste_preferences
  for select to authenticated
  using (exists (
    select 1 from public.users u
    where u.id = user_id and u.household_id = public.current_household_id()
  ));
create policy taste_preferences_write on public.taste_preferences
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- cookbooks: read within the household (uploads are registered via /api).
create policy cookbooks_select on public.cookbooks
  for select to authenticated
  using (household_id = public.current_household_id());

create policy import_jobs_select on public.import_jobs
  for select to authenticated
  using (exists (
    select 1 from public.cookbooks c
    where c.id = cookbook_id and c.household_id = public.current_household_id()
  ));

create policy import_candidates_select on public.import_candidates
  for select to authenticated
  using (exists (
    select 1 from public.cookbooks c
    where c.id = cookbook_id and c.household_id = public.current_household_id()
  ));

-- grocery lists and items: full access within the household.
create policy grocery_lists_all on public.grocery_lists
  for all to authenticated
  using (household_id = public.current_household_id())
  with check (household_id = public.current_household_id());

create policy grocery_items_all on public.grocery_items
  for all to authenticated
  using (exists (
    select 1 from public.grocery_lists l
    where l.id = list_id and l.household_id = public.current_household_id()
  ))
  with check (exists (
    select 1 from public.grocery_lists l
    where l.id = list_id and l.household_id = public.current_household_id()
  ));

-- Assistant history and pending actions: read your own; the server writes them.
create policy conversations_select on public.conversations
  for select to authenticated
  using (user_id = auth.uid());

create policy messages_select on public.messages
  for select to authenticated
  using (exists (
    select 1 from public.conversations c
    where c.id = conversation_id and c.user_id = auth.uid()
  ));

create policy pending_actions_select on public.pending_actions
  for select to authenticated
  using (user_id = auth.uid());

-- Table privileges for the `authenticated` role (RLS still applies on top).
grant select on public.households to authenticated;
grant select, update (display_name, unit_system, voice_language) on public.users to authenticated;
grant select, insert, update, delete on public.recipes to authenticated;
grant select, insert, update, delete on public.recipe_user_meta to authenticated;
grant select, insert, update, delete on public.taste_preferences to authenticated;
grant select on public.cookbooks, public.import_jobs, public.import_candidates to authenticated;
grant select, insert, update, delete on public.grocery_lists, public.grocery_items to authenticated;
grant select on public.conversations, public.messages, public.pending_actions to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime (live grocery checkboxes) and storage
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.grocery_items;

-- Private bucket for cookbook PDFs. Uploads use signed URLs issued by /api.
insert into storage.buckets (id, name, public)
values ('cookbooks', 'cookbooks', false)
on conflict (id) do nothing;
