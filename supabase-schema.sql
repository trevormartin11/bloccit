-- FlipCRM — run this once in the Supabase SQL editor to enable team sync.
--
-- 1. Go to your Supabase project → SQL editor → New query
-- 2. Paste this entire file and click "Run"
-- 3. Copy your Project URL + anon public key from Settings → API
-- 4. In FlipCRM → Settings → Team sync, paste them and click "Save & connect"

create table if not exists flipcrm_properties (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists flipcrm_properties_updated_idx
  on flipcrm_properties (updated_at desc);

-- Enable row level security but allow the anon role full access.
-- For a small team tool this is fine; if you want real multi-tenant auth,
-- add a `team_id` column and a policy that matches on auth.uid().
alter table flipcrm_properties enable row level security;

drop policy if exists "flipcrm anon read/write" on flipcrm_properties;
create policy "flipcrm anon read/write" on flipcrm_properties
  for all using (true) with check (true);
