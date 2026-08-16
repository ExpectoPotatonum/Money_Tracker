-- 0003: dashboard_alerts
-- Home for the §11 runbook: a scheduled Edge Function (supabase/functions/
-- check-alerts) evaluates the "tracker may be offline" and failed-parse-spike
-- thresholds here, and the web dashboard just reads one table instead of
-- computing anything itself.
--
-- `alert_key` is the idempotency key: the same condition writing twice
-- upserts rather than stacking up duplicates.

create table dashboard_alerts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id),
  alert_key   text not null,                -- 'device_offline:<device_id>' | 'parse_spike:<package>:<yyyymmdd>'
  alert_type  text not null check (alert_type in ('device_offline','parse_spike')),
  severity    text not null default 'warning' check (severity in ('info','warning','critical')),
  message     text not null,
  context     jsonb not null default '{}',
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, alert_key)
);

create index on dashboard_alerts (alert_type, resolved_at);

-- View the check-alerts Edge Function reads to find parse-failure spikes
-- (agents.md §9's "5+ in a day" heuristic). Queried via PostgREST, which has
-- no GROUP BY, so the aggregation lives here where it belongs.
create or replace view failed_parse_spikes as
select
  user_id,
  package_name,
  count(*) as failures_24h
from raw_notifications
where parse_status = 'failed'
  and captured_at > now() - interval '24 hours'
group by user_id, package_name;

alter table dashboard_alerts enable row level security;

create policy "owner_only" on dashboard_alerts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
