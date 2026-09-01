-- 024: surface low-confidence parses in the parse-spike alert
--
-- WHY: the failed_parse_spikes view (202608160002) only counted
--   parse_status = 'failed'. But a NEW / changed app format that still has an
--   amount (e.g. TnG "RM 50.00 has been successfully transferred to ONG POOK
--   HUN.") does NOT go 'failed' — the loose fallback gives it an amount, so it
--   lands in 'needs_review'. Those were invisible to the 5-per-day spike alert,
--   so a format change could go unnoticed for weeks with the dashboard showing
--   the transaction but NULL merchant/category.
--
-- Fix: count 'needs_review' (low-confidence) parses as an early-warning signal
-- too. This is the trash "app changed its format" heuristic (agents.md §9)
-- applied to the review net as well as hard failures.
--
-- Idempotent: create or replace view.
create or replace view failed_parse_spikes as
select
  user_id,
  package_name,
  count(*) as failures_24h
from raw_notifications
where parse_status in ('failed', 'needs_review')
  and captured_at > now() - interval '24 hours'
group by user_id, package_name;
