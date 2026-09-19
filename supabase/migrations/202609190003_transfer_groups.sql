-- 202609190003_transfer_groups.sql — Phase 3 (§4.8): two-row LINKED transfers.
--
-- A transfer between two of the owner's accounts is stored as two ordinary
-- single-account transaction rows sharing a transfer_group_id (mirrors
-- ezBookkeeping's on-disk TRANSFER_OUT / TRANSFER_IN pair):
--   - source half:  account_id = source account, direction 'debit',
--                   amount = source_amount (+ source currency)
--   - dest half:    account_id = destination account, direction 'credit',
--                   amount = dest_amount (+ dest currency)
-- Each half is a NORMAL row in its own account's ledger, so per-account balance
-- stays a plain SUM over account_id (Phase 4) and cross-currency is free (each
-- half stores its own amount/currency — the two books agree by construction).
--
-- Transfers come only from manual/voice entry (web Transfer dialog): halves are
-- manual rows (raw_notification_id NULL, source_package 'manual',
-- confidence 'low' — passes the existing chk_manual_source), carry no merchant
-- or category (owner decision #4), and MUST have account_id (their own ledger).
--
-- Pairing is app-enforced (decision #5): the web writes both halves in one
-- insert and deletes both by transfer_group_id. transfer_orphans below is the
-- QA view that surfaces any half left without a partner; no DB pair trigger
-- (an AFTER INSERT trigger would fire mid-pair and reject valid writes).

alter table transactions add column transfer_group_id uuid;

alter table transactions add constraint chk_transfer_half check (
  (transfer_group_id is null)
  or
  (transfer_group_id is not null and direction in ('debit','credit')
     and account_id is not null
     and raw_notification_id is null and merchant_raw is null and category_id is null)
);

-- Transfers resolve both halves through transfer_group_id (purge-by-group,
-- pair lookups).
create index on transactions (transfer_group_id);

-- QA view: transfer groups that aren't a clean 1-debit + 1-credit pair. Not
-- granted to authenticated (it would bypass RLS on transactions); it's an
-- owner/SQL-editor diagnostic only.
create view transfer_orphans as
select
  transfer_group_id,
  count(*)                                as halves,
  count(*) filter (where direction = 'debit')  as debits,
  count(*) filter (where direction = 'credit') as credits
from transactions
where transfer_group_id is not null
group by transfer_group_id
having count(*) <> 2
    or count(*) filter (where direction = 'debit') <> 1
    or count(*) filter (where direction = 'credit') <> 1;