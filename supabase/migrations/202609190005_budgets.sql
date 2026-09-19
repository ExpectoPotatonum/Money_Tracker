-- 202609190005_budgets.sql — Phase 4 (import-candidate-features.md §4.9, owner
-- decisions confirmed 2026-09-19): a `budgets` table for monthly budgets.
--
-- Design notes:
--   - category_id NULL = the OVERALL budget; a non-NULL value = that category's
--     budget. Parent budgets count child-category spend (decision 3) — that
--     roll-up is client-side in the dashboard (categories are two-tier).
--   - period is 'monthly' only in v1 (decision §4.3: "monthly period by
--     default"). The check is written as a single-value list so later periods
--     are an additive change.
--   - currency is fixed to MYR in v1 (decision 2): spend is converted to MYR at
--     each transaction's own date (ADR 0003) and compared against the amount.
--   - NO trigger/cron (free-tier sizing). Spend-vs-budget is computed at
--     display time from a read over transactions.
--   - GRANT + RLS follow AGENTS.md §17 exactly (owner_only), like accounts.
--
-- NULL category_id defeats a plain unique() (NULLs are distinct), so the
-- one-overall + one-per-category-per-period guarantees use partial unique
-- indexes.

create table budgets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id),
  category_id uuid references categories(id),      -- NULL = overall budget
  period      text not null default 'monthly' check (period in ('monthly')),
  amount      numeric(12,2) not null check (amount >= 0),
  currency    text not null default 'MYR',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

grant select, insert, update, delete on budgets to authenticated;

alter table budgets enable row level security;

create policy "owner_only" on budgets
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create unique index budgets_overall_uq on budgets (user_id, period)
  where category_id is null;
create unique index budgets_per_category_uq on budgets (user_id, category_id, period)
  where category_id is not null;