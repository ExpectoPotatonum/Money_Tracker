-- 202609190002_accounts.sql — Phase 3 (import-candidate-features.md §4.8, owner
-- decisions confirmed 2026-09-19): a real `accounts` table + the package ->
-- account default mapping that the parse trigger resolves when a capture lands.
--
-- RLS + grants follow AGENTS.md §17 exactly (owner-scoped tables):
--   - every table carries user_id (default auth.uid()) and an owner_only policy
--   - authenticated gets SELECT/INSERT/UPDATE/DELETE so the web app can manage
--     accounts and the map within its own rows.
--
-- Owner decision #6: NO seeds in this migration. Migrations run as `postgres`
-- with auth.uid() = NULL, so a seeded account would be invisible under
-- owner_only RLS. Default accounts instead come from the web accounts manager's
-- "Add suggested accounts" action, which inserts under the real session.

create table accounts (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references auth.users(id),
  name                  text not null,
  type                  text not null
                          check (type in ('cash','checking','savings','credit','ewallet','virtual','investment')),
  currency              text not null default 'MYR',
  icon                  text,                 -- emoji, optional (e.g. '💵')
  color                 text,                 -- hex for a UI chip, optional
  opening_balance       numeric(12,2) not null default 0,
  opening_balance_date  date,                 -- when the opening balance anchor applies
  is_hidden             boolean not null default false,
  sort_order            int not null default 0,
  last_reconciled_at    timestamptz,          -- reserved for Phase 4 reconcile flows
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (user_id, name)
);

-- package -> account default mapping (§4.7.2 "package_account_map"). The parse
-- trigger joins this by (user_id, package_name) to auto-fill account_id on
-- freshly captured transactions. Resolution only — never auto-creates an
-- account (owner decision #2); unknown packages stay "Unassigned" until mapped
-- in the web accounts manager.
create table package_account_map (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id),
  package_name  text not null,
  account_id    uuid not null references accounts(id),
  created_at    timestamptz not null default now(),
  unique (user_id, package_name)
);

create index on package_account_map (account_id);
create index on package_account_map (user_id);

-- Transactions gain their account pointer here (nullable: legacy/captured rows
-- stay "Unassigned" until mapped; transfer halves require it via chk_transfer_half
-- in 202609190003). This column was missing from the original Phase 3 chain —
-- it must exist before the index below (and before 202609190003's constraint).
alter table transactions add column account_id uuid references accounts(id);

-- Per-account balance (Phase 4 reads) is a plain SUM over transactions.account_id.
create index on transactions (account_id);
-- A transfer_group_id index is added in migration 202609190003 right after the
-- column itself lands; it can't exist here (the column doesn't yet).
create index on transactions (user_id);

-- --- grants (§17: same migration as create table) ---
grant select, insert, update, delete on accounts to authenticated;
grant select, insert, update, delete on package_account_map to authenticated;

-- --- RLS (owner_only) ---
alter table accounts enable row level security;
alter table package_account_map enable row level security;

create policy "owner_only" on accounts
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "owner_only" on package_account_map
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);