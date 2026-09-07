-- Wise (com.transferwise.android) card payment notification. First Wise sample
-- (2026-09-07):
--   title: "Card payment"
--   body:  "25.90 MYR spent at Apple. You're low on spending money. Tap to add more."
--
-- Format: "<amount> <CCY> spent at <merchant>." — note the amount comes FIRST
-- (unlike the loose fallback, which only matches "<CCY> <amount>"). No txn
-- date, so transaction_date falls back to notification posted_at. "spent"
-- infers debit. The merchant is the merchant name after "at".
--
-- body_pattern/title_pattern are immutable by trigger (§16) => a new row, not
-- an edit. Resync re-parses the failed Wise row (and any other failed row).

insert into parser_templates (
  package_name, app_label, version, active,
  title_pattern, body_pattern, date_format,
  default_currency, field_map, sample_input, notes
) values (
  'com.transferwise.android', 'Wise', 1, true,
  'Card payment',
  '^[[:space:]]*([0-9][0-9,]*\.[0-9][0-9]) (MYR) spent at ([^.]+)\.',
  null,
  'MYR',
  '{"amount":1,"currency":2,"merchant":3}',
  '25.90 MYR spent at Apple. You''re low on spending money. Tap to add more.',
  'Wise debit card payment: "<amount> <CCY> spent at <merchant>." (debit)'
)
on conflict (package_name, version) do nothing;

-- Re-parse failed/needs_review rows so the new template picks up the Wise row
-- (idempotent; ignored rows are left alone).
select backfill_resync();