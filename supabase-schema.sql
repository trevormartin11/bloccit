-- FlipCRM — run this once in the Supabase SQL editor.
--
-- 1. Go to your Supabase project → SQL editor → New query
-- 2. Paste this entire file and click "Run"
-- 3. Copy your Project URL + anon public key from Settings → API
-- 4. Set SUPABASE_URL and SUPABASE_ANON_KEY as env vars in Netlify
--    and redeploy. Every visitor then auto-syncs.

-- ===== Properties table =====

create table if not exists flipcrm_properties (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists flipcrm_properties_updated_idx
  on flipcrm_properties (updated_at desc);

alter table flipcrm_properties enable row level security;

drop policy if exists "flipcrm anon read/write" on flipcrm_properties;
create policy "flipcrm anon read/write" on flipcrm_properties
  for all using (true) with check (true);

-- ===== Property photos (Supabase Storage bucket) =====
-- Public bucket so browsers can load images without auth headers.
-- Anon can insert/read/delete, same open policy as the table.

insert into storage.buckets (id, name, public)
values ('flipcrm-photos', 'flipcrm-photos', true)
on conflict (id) do nothing;

drop policy if exists "flipcrm photos anon upload" on storage.objects;
create policy "flipcrm photos anon upload" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'flipcrm-photos');

drop policy if exists "flipcrm photos anon read" on storage.objects;
create policy "flipcrm photos anon read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'flipcrm-photos');

drop policy if exists "flipcrm photos anon delete" on storage.objects;
create policy "flipcrm photos anon delete" on storage.objects
  for delete to anon, authenticated
  using (bucket_id = 'flipcrm-photos');
