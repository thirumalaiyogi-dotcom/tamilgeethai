-- ============================================================
-- பாரதிய பண்பாட்டு வகுப்பு + தமிழ் கீதை — Admin Panel அமைப்பு
-- Supabase → SQL Editor → New query → இதை முழுவதுமாக ஒட்டி → RUN
-- (ஒருமுறை மட்டும் ஓட்டினால் போதும்)
-- ============================================================

-- 1. பதிவுகள் அட்டவணை (இரண்டு படிவங்களும் இங்கே வரும்)
create table if not exists public.registrations (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  source          text not null check (source in ('bcc','tamilgeethai')),
  name            text not null check (char_length(name) between 1 and 120),
  whatsapp        text not null check (whatsapp ~ '^[6-9][0-9]{9}$'),
  district        text check (char_length(district) <= 80),
  town            text check (char_length(town) <= 80),
  details         jsonb not null default '{}'::jsonb,
  screenshot_path text,
  status          text not null default 'new'
                  check (status in ('new','contacted','joined','not_interested')),
  followup_note   text,
  followup_date   date,
  updated_at      timestamptz
);
create index if not exists registrations_created_idx on public.registrations (created_at desc);
create index if not exists registrations_source_status_idx on public.registrations (source, status);

-- 2. Admin பட்டியல் (இந்த email-களில் login செய்பவர்கள் மட்டுமே தரவைப் பார்க்க முடியும்)
create table if not exists public.admins (
  email text primary key
);

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- 3. பாதுகாப்பு (RLS)
alter table public.registrations enable row level security;
alter table public.admins enable row level security;

drop policy if exists "public can register" on public.registrations;
create policy "public can register" on public.registrations
  for insert to anon, authenticated
  with check (
    status = 'new'
    and followup_note is null
    and followup_date is null
    and updated_at is null
    and (screenshot_path is null or screenshot_path like 'tg/%')
  );

drop policy if exists "admins read" on public.registrations;
create policy "admins read" on public.registrations
  for select to authenticated using (public.is_admin());

drop policy if exists "admins update" on public.registrations;
create policy "admins update" on public.registrations
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins delete" on public.registrations;
create policy "admins delete" on public.registrations
  for delete to authenticated using (public.is_admin());

drop policy if exists "admin sees self" on public.admins;
create policy "admin sees self" on public.admins
  for select to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

revoke all on public.registrations from anon;
grant insert on public.registrations to anon;
grant select, insert, update, delete on public.registrations to authenticated;
revoke all on public.admins from anon;
grant select on public.admins to authenticated;

-- 4. தமிழ் கீதை கட்டண screenshot சேமிப்பு (private bucket)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payments', 'payments', false, 5242880, array['image/jpeg','image/png'])
on conflict (id) do nothing;

drop policy if exists "public upload payment screenshot" on storage.objects;
create policy "public upload payment screenshot" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'payments' and name like 'tg/%');

drop policy if exists "admins view payment screenshot" on storage.objects;
create policy "admins view payment screenshot" on storage.objects
  for select to authenticated
  using (bucket_id = 'payments' and public.is_admin());

-- 5. Admin email-கள் (தேவைப்பட்டால் மேலும் சேர்க்கலாம்)
insert into public.admins (email) values
  ('thirumalaiyogi@gmail.com'),
  ('lahi100000@gmail.com')
on conflict do nothing;
