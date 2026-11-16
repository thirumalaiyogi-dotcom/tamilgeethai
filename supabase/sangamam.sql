-- ============================================================
-- தமிழ் கீதை சங்கமம் 2026 — Supabase → SQL Editor → New query → RUN (ஒருமுறை)
-- Allows the new registration type "sangamam" (saved only by the pay function).
-- ============================================================
alter table public.registrations drop constraint if exists registrations_source_check;
alter table public.registrations
  add constraint registrations_source_check check (source in ('bcc','tamilgeethai','sangamam'));
