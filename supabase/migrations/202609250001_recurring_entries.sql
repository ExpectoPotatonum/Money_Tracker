-- recurring_entries — Phase 6 recurring auto-entry (import-candidate-features.md
-- §4.5 / Q4). The Android RecurringCheckWorker is the scheduler: Free-tier
-- Supabase has no pg_cron and no scheduled Edge Functions, so the phone — not
-- the DB — owns the clock, materializing each due cycle as a manual
-- `is_recurring` transaction. This table holds the cycle definitions.
--
-- Exactly-once: each materialized transaction carries (recurring_entry_id,
-- recurring_due_date) and a partial unique index makes the worker's PostgREST
-- upsert (Prefer: resolution=ignore-duplicates) no-op on a retried cycle.
-- Deleting an entry unlinks past rows (on delete set null) instead of deleting
-- history — raw-notification-style durability for recurring rows too.
create table recurring_entries (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id),
  name            text not null,                    -- "Rent", "Salary", "Spotify"...
  amount          numeric(12, 2) not null check (amount > 0),
  currency        text not null default 'MYR',
  direction       text not null check (direction in ('debit', 'credit')),
  category_id     uuid references categories(id),
  account_id      uuid not null references accounts(id),  -- materialized rows point here (202609190002)
  frequency       text not null check (frequency in ('daily', 'weekly', 'monthly', 'yearly')),
  interval_step   int not null default 1 check (interval_step >= 1),
  day_of_month    int check (day_of_month is null or (day_of_month between 1 and 31)),
  merchant_raw    text,
  notes           text,
  next_due_date   date not null,                     -- the cycle the worker materializes next
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- §17: GRANT + RLS in the same migration as the create table (Supabase's
-- GitHub connection does not auto-apply migrations; run in SQL Editor).
alter table recurring_entries enable row level security;

create policy "owner_only" on recurring_entries
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on recurring_entries to authenticated;

-- Materialized transactions link back to the entry that produced them. The
-- unique (entry, due date) index is the dedup arbiter for the worker's
-- on_conflict=recurring_entry_id,recurring_due_date upsert.
alter table transactions
  add column recurring_entry_id uuid references recurring_entries(id) on delete set null,
  add column recurring_due_date date;

create unique index transactions_recurring_uq
  on transactions (recurring_entry_id, recurring_due_date)
  where recurring_entry_id is not null;

create index on transactions (recurring_entry_id);
create index on recurring_entries (next_due_date);
