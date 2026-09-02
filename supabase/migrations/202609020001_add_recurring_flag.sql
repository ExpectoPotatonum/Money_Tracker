-- Phase 4: manual recurring-flag column on transactions.
-- No auto-detection — the owner flags transactions by hand.

alter table transactions
  add column is_recurring boolean not null default false;

create index on transactions (is_recurring) where is_recurring;
