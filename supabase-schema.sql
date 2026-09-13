-- Paste this whole file into Supabase -> SQL Editor -> New query -> Run.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table scenarios (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  counterpart text not null,
  context     text not null,
  goal        text not null,
  created_at  timestamptz not null default now()
);

create table rehearsals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  scenario_id uuid not null references scenarios(id) on delete cascade,
  transcript  jsonb not null,
  score       int,
  feedback    text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- This is the data isolation your rubric asks about. Without these policies,
-- the anon key would let any signed-in user read every row in the table.
-- With them, the database itself filters every query down to the rows whose
-- user_id matches the person making the request.
-- ---------------------------------------------------------------------------

alter table scenarios  enable row level security;
alter table rehearsals enable row level security;

create policy "own scenarios: read"
  on scenarios for select using (auth.uid() = user_id);

create policy "own scenarios: write"
  on scenarios for insert with check (auth.uid() = user_id);

create policy "own scenarios: update"
  on scenarios for update using (auth.uid() = user_id);

create policy "own scenarios: delete"
  on scenarios for delete using (auth.uid() = user_id);

create policy "own rehearsals: read"
  on rehearsals for select using (auth.uid() = user_id);

create policy "own rehearsals: write"
  on rehearsals for insert with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Speed
-- ---------------------------------------------------------------------------

create index scenarios_user_idx  on scenarios (user_id, created_at desc);
create index rehearsals_user_idx on rehearsals (user_id, created_at desc);
