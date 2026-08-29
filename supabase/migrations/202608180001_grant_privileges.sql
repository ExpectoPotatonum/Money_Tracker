-- Fix: the `authenticated` role has no GRANT (table privilege) on the
-- capture/dashboard tables. Tables created via raw SQL (SQL Editor) do not
-- get Supabase's automatic GRANTs to anon/authenticated, so every request
-- fails with Postgres 42501 "permission denied for table", independent of RLS
-- policies (which were already fixed separately to target `authenticated`).
--
-- Postsgres 42501 + auth_user:null in the logs is the signature of this:
-- RLS filters rows, but GRANT decides whether the role may touch the table.
--
-- Grant base privileges. Writes are still safe per-row because every
-- write-capable table carries an owner_only RLS policy (auth.uid() = user_id).
-- Reference tables (categories/merchant_rules/parser_templates) get SELECT
-- only — they are read by the dashboard and are managed by the operator.
-- Idempotent: GRANT is idempotent in Postgres (reapplying is a no-op).
-- Run in Supabase > SQL Editor.

grant usage on schema public to authenticated;

grant select on categories, merchant_rules, parser_templates to authenticated;

grant select on raw_notifications, transactions, device_heartbeat, dashboard_alerts
  to authenticated;
-- Writes under RLS (owner_only). The Android app inserts raw_notifications
-- and device_heartbeat; the check-alerts edge function writes dashboard_alerts
-- (via service_role which bypasses RLS anyway). Granting insert/update to
-- authenticated is safe because RLS restricts each row to its owner.
grant insert, update, delete on raw_notifications, transactions,
  device_heartbeat, dashboard_alerts to authenticated;

select 'GRANTs applied successfully' as status;
