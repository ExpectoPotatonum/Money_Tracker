-- 018: parser_templates.field_map — support DB-side parsing (agents.md §9 / §14)
--
-- WHY: the originally-planned parse-notification Edge Function + Database
-- Webhook are paid-tier features on Supabase's hosted platform. On the Free
-- project used here, parsing must run inside Postgres instead (a trigger + a
-- PL/pgSQL function) so rows turn into transactions without a subscription.
-- See REPARSING.md §DB-parser for the full rationale.
--
-- Postgres POSIX/ARE regexes do not expose capture groups BY NAME the way JS
-- named groups do (`regexp_match` returns a positional text[]). To keep each
-- app's body_pattern self-describing despite that, every rule records a
-- `field_map` JSON mapping a semantic field to its 1-based group index, e.g.
--   body_pattern: "RM\s*(\d[\d,]*\.\d{2})"
--   field_map:    {"amount":1}
-- Fields may be any subset of: amount, currency, merchant, txn_date, direction.

alter table parser_templates
  add column if not exists field_map jsonb not null default '{}'::jsonb;
