-- ============================================================
-- Payment security upgrade — Supabase → SQL Editor → New query → RUN (ஒருமுறை)
-- After this, only the server ("pay" function) can mark a registration as paid.
-- ============================================================

alter table public.registrations
  add column if not exists order_id text,
  add column if not exists paid boolean not null default false,
  add column if not exists paid_at timestamptz,
  add column if not exists amount integer;

create unique index if not exists registrations_order_id_key
  on public.registrations (order_id) where order_id is not null;

-- Public (website) inserts can never claim payment.
drop policy if exists "public can register" on public.registrations;
create policy "public can register" on public.registrations
  for insert to anon, authenticated
  with check (
    status = 'new'
    and paid = false
    and paid_at is null
    and order_id is null
    and followup_note is null
    and followup_date is null
    and updated_at is null
    and coalesce(details->>'payment', '') not like '%செலுத்தப்பட்டது%'
    and (screenshot_path is null or screenshot_path like 'tg/%')
  );

-- Mark older test rows that claimed payment from the browser as unverified.
update public.registrations
  set details = details || jsonb_build_object('payment', '❔ சரிபார்க்கப்படாதது (பழைய பதிவு)')
  where paid = false and details->>'payment' like '%செலுத்தப்பட்டது%';
