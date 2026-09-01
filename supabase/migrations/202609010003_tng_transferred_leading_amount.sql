-- 023: TnG "RM X has been successfully transferred to <M>." template (v6)
--
-- WHY: a new TnG outbound format arrived that v2–v5 don't cover:
--     title: "Transfer Successful."
--     body:  "RM 50.00 has been successfully transferred to ONG POOK HUN."
-- Unlike v4 ("You have successfully transferred RM X to <M>."), the amount is
-- at the START, so it fell through to the loose fallback (amount only, no
-- merchant/category/date) — the exact recurring symptom.
--
-- Add TnG v6 (a NEW version row, never an in-place edit — §§9/16) and re-parse
-- the affected rows. The row is 'needs_review', so backfill_resync() picks it
-- up. Idempotent (on conflict + resync safe to re-run).

insert into parser_templates (
  package_name, app_label, version, active,
  title_pattern, body_pattern, date_format,
  default_currency, field_map, sample_input, notes
) values (
  'my.com.tngdigital.ewallet', 'TNG eWallet', 6, true,
  'Transfer Successful|transferred',
  '^RM[[:space:]]*([0-9][0-9,]*\.[0-9][0-9]) has been successfully transferred to (.+)\.$',
  null,
  'MYR',
  '{"amount":1,"merchant":2}',
  'RM 50.00 has been successfully transferred to ONG POOK HUN.',
  'TnG outbound "<amount> has been successfully transferred to <recipient>."'
)
on conflict (package_name, version) do nothing;

select backfill_resync();
