-- 202611160001_categories_and_debit_card.sql
--
-- Two small schema/data changes requested by the owner (2026-11-16):
--
--   1. Categories gain Entertainment (already seeded, but idempotent for live
--      projects that diverged), Subscription and Household. The web app also
--      gains a category manager, so `authenticated` needs write privileges on
--      the shared `categories` table (previously SELECT-only, AGENTS §17).
--
--      NOTE: `categories` has no user_id — it is shared reference data. This
--      app is single-user today, so granting write access to every signed-in
--      user is safe for now. If multi-user ever ships, move writes behind an
--      operator/Edge Function or add an owner column first.
--
--   2. Accounts gain a `debit_card` type. The original check constraint only
--      allowed cash/checking/savings/credit/ewallet/virtual/investment, so
--      "HLB Debit Card" had to masquerade as `credit`.
--
-- Run this file in the Supabase SQL Editor (migrations are not auto-applied).
-- Re-runnable / idempotent.

-- ---------------------------------------------------------------------------
-- 1. New categories (insert-by-name so the live set and the seed can diverge).
-- ---------------------------------------------------------------------------
insert into categories (name, icon, color)
select 'Entertainment', 'movie', '#8e44ad'
where not exists (select 1 from categories where name = 'Entertainment');

insert into categories (name, icon, color)
select 'Subscription', 'autorenew', '#0d6efd'
where not exists (select 1 from categories where name = 'Subscription');

insert into categories (name, icon, color)
select 'Household', 'home', '#2f6f5e'
where not exists (select 1 from categories where name = 'Household');

-- ---------------------------------------------------------------------------
-- 2. Category manager write access (AGENTS §17: GRANT + RLS together).
--    The existing `categories_read_authenticated` policy stays; this new
--    permissive policy covers INSERT/UPDATE/DELETE.
-- ---------------------------------------------------------------------------
grant insert, update, delete on categories to authenticated;

drop policy if exists "categories_write_authenticated" on categories;
create policy "categories_write_authenticated"
  on categories
  for all
  to authenticated
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- 3. Accounts: allow debit cards alongside credit cards.
-- ---------------------------------------------------------------------------
alter table accounts drop constraint if exists accounts_type_check;
alter table accounts add constraint accounts_type_check
  check (type in ('cash','checking','savings','credit','debit_card','ewallet','virtual','investment'));
