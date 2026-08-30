-- 020: seed parser_templates + merchant_rules for the first real samples
--
-- Built from the sanitized text of the two Phase-1 captures (agents.md §8:
-- patterns are written against the SANITIZED form, which is all the parser
-- ever sees). Both samples were verified against these regexes (see
-- db_parser_test5 / REPARSING.md). A changed pattern is a NEW version row,
-- never an edit (§9, §16 — enforced by the parser_templates_pattern_immutable
-- trigger). field_map maps a field to its 1-based capture-group index, because
-- Postgres regexp_match returns a positional array without named groups.

insert into parser_templates (
  package_name, app_label, version, active,
  title_pattern, body_pattern, date_format,
  default_currency, field_map, sample_input, notes
) values
(
  'my.com.tngdigital.ewallet', 'TNG eWallet', 1, true,
  'received',
  '^(.+) has transferred RM[[:space:]]*([0-9][0-9,]*\.[0-9][0-9]) to you',
  null,
  'MYR',
  '{"merchant":1,"amount":2}',
  'HOO JET YUNG has transferred RM 1.00 to you. Tap here to check the transaction details.',
  'p2p receive: <sender> has transferred RM <amount> to you' 
),
(
  'com.cimb.cimbocto', 'CIMB OCTO MY', 1, true,
  null,
  'DuitNow to Acct RM[[:space:]]*([0-9][0-9,]*\.[0-9][0-9]) to (.+) on ([0-9]{1,2}-[A-Za-z]{3}-[0-9]{4},[[:space:]]*[0-9]{2}:[0-9]{2}:[0-9]{2})',
  'DD-Mon-YYYY, HH24:MI:SS',
  'MYR',
  '{"amount":1,"merchant":2,"txn_date":3}',
  'DuitNow to Acct RM 1.00 to HOO JET YUNG/Touch n Go on 30-Aug-2026, 01:22:56. Call the no at the back of your card for queries.',
  'DuitNow outbound transfer to an account/wallet' 
)
on conflict (package_name, version) do nothing;

-- Merchant normalization. category_id is resolved by name at insert time so
-- the seed survives whichever category set is actually present in the live
-- project (the seed migration 0002 was not applied verbatim to this project).
-- merchant_rules has no unique constraint, so guard with NOT EXISTS instead of
-- ON CONFLICT (which needs a unique conflict target to be valid).
insert into merchant_rules (match_pattern, match_type, normalized_name, category_id, priority)
select 'touch n go', 'contains', 'TnG eWallet',
       (select id from categories where name = 'Finance & Transfer'),
       10
where not exists (
  select 1 from merchant_rules where match_pattern = 'touch n go'
);
