-- 202609050001_cimb_debit_tng_paid_for.sql
-- Two new templates for notifications landing in needs_review:
--   CIMB v3: card debit ("RM X was charged to your Debit Card on <date> at <merchant>")
--   TnG v7:  "paid for"  ("You have paid RM X for <merchant>.")
-- Plus a merchant_rules seed for PANAXIS-SNWY CA.
--
-- Idempotent (safe to re-run):
--   - CIMB v2 (flawed, captured txn_date -> midnight timestamp) is deactivated.
--   - CIMB v3 is the corrected card-debit template. The card date (05-09-26)
--     carries no time of day, so txn_date is NOT captured in field_map —
--     transaction_date falls back to posted_at to keep the real 17:05 MYT time.
--   - body_pattern/title_pattern are immutable by trigger, so a correction is a
--     new version (v3), never an in-place edit (§9/§16).

-- ── CIMB OCTO v2 — flawed card-debit attempt, deactivate ─────────
update parser_templates
set    active = false, updated_at = now()
where  package_name = 'com.cimb.cimbocto' and version = 2;

-- ── CIMB OCTO v3 — card debit (corrected) ─────────────────────────
insert into parser_templates (
  package_name, app_label, version, active,
  title_pattern, body_pattern, date_format,
  default_currency, sample_input, notes, field_map
) values (
  'com.cimb.cimbocto',
  'CIMB OCTO MY',
  3,
  true,
  null,
  'CIMB:RM[[:space:]]*([0-9][0-9,]*\.[0-9][0-9]) was charged to your Debit Card on [0-9]{1,2}-[0-9]{1,2}-[0-9]{2} at (.+)\.[[:space:]]*Pls',
  null,
  'MYR',
  'CIMB:RM 4.00 was charged to your Debit Card on 05-09-26 at PANAXIS-SNWY CA. Pls call the no. at the back of your card for any enquiry',
  'CIMB card debit: "RM X was charged to your Debit Card on <date> at <merchant>." The date carries no time of day, so transaction_date falls back to notification posted_at to preserve the real timestamp.',
  '{"amount":1,"merchant":2}'
)
on conflict (package_name, version) do nothing;

-- ── TNG eWallet v7 — "paid … for <merchant>" ──────────────────────
insert into parser_templates (
  package_name, app_label, version, active,
  title_pattern, body_pattern, date_format,
  default_currency, sample_input, notes, field_map,
  reject_pattern
) values (
  'my.com.tngdigital.ewallet',
  'TNG eWallet',
  7,
  true,
  'Payment successful|paid',
  '^You have paid RM[[:space:]]*([0-9][0-9,]*\.[0-9][0-9]) for (.+)\.$',
  null,
  'MYR',
  'You have paid RM40.00 for RON95.',
  'TnG outbound "paid … for <item>" (e.g. petrol, bill).',
  '{"amount":1,"merchant":2}',
  'points|cashback|voucher|reward|earned|redeem|balance|reload|scan & pay'
)
on conflict (package_name, version) do nothing;

-- ── merchant_rules: PANAXIS ────────────────────────────────────────
delete from merchant_rules where match_pattern = 'PANAXIS';

insert into merchant_rules (match_pattern, match_type, normalized_name, category_id, priority)
select 'PANAXIS-SNWY CA', 'contains', 'Panaxis Sunway CA',
       (select id from categories where name = 'Others'), 0
where not exists (
  select 1 from merchant_rules where match_pattern = 'PANAXIS-SNWY CA' and match_type = 'contains'
);

-- ── Reset the two stuck notifications so backfill_resync picks them up ──
update raw_notifications
set    parse_status = 'pending', parse_error = null, parser_template_id = null, linked_transaction_id = null
where  client_uuid in (
  'a08f4228-4e9a-4eda-ae65-3fc766346191',   -- CIMB card debit
  'f2a694f1-8e24-4543-8147-a02019a339f6'    -- TNG "paid for RON95"
);

-- Delete the orphaned low-confidence transactions (idempotent no-op if already gone)
delete from transactions
where  id in (
  '9dd219c3-fa17-4873-be67-1d392cc7d851',   -- CIMB card debit
  'd4696d4e-a9d6-4c94-9b59-9b41ba640be3'    -- TNG "paid for RON95"
);

select backfill_resync();