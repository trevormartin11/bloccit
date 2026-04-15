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

-- ===== Storage buckets (photos + documents) =====
-- Both are public so browsers can load files without auth headers.
-- Anon role has full read/write/delete, same open policy as the table.

insert into storage.buckets (id, name, public)
values
  ('flipcrm-photos',    'flipcrm-photos',    true),
  ('flipcrm-documents', 'flipcrm-documents', true)
on conflict (id) do nothing;

-- Unified storage policies: anon + authenticated can CRUD objects in
-- either flipcrm bucket. Uses IN (...) so one policy covers both buckets.

drop policy if exists "flipcrm storage anon upload" on storage.objects;
drop policy if exists "flipcrm photos anon upload"  on storage.objects;
create policy "flipcrm storage anon upload" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id in ('flipcrm-photos', 'flipcrm-documents'));

drop policy if exists "flipcrm storage anon read" on storage.objects;
drop policy if exists "flipcrm photos anon read"  on storage.objects;
create policy "flipcrm storage anon read" on storage.objects
  for select to anon, authenticated
  using (bucket_id in ('flipcrm-photos', 'flipcrm-documents'));

drop policy if exists "flipcrm storage anon delete" on storage.objects;
drop policy if exists "flipcrm photos anon delete"  on storage.objects;
create policy "flipcrm storage anon delete" on storage.objects
  for delete to anon, authenticated
  using (bucket_id in ('flipcrm-photos', 'flipcrm-documents'));
