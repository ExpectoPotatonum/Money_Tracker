-- Remediation: guarantee RLS is enabled and every policy exists on your real
-- Supabase project. Idempotent — safe to run repeatedly. Mirrors the policies
-- from the migrations that may not have been applied (the GitHub connection
-- does not auto-apply migrations).
--
-- Run this in Supabase > SQL Editor, then hard-refresh the dashboard.

do $$
declare
  t text;
  p text;
begin
  -- 1. Enable RLS everywhere it's meant to be on.
  foreach t in array array['categories','merchant_rules','parser_templates',
                            'raw_notifications','transactions',
                            'dashboard_alerts','device_heartbeat']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;

  -- 2. Create any policy that is missing (idempotent via pg_policies check).
  foreach p in array array[
    'categories|categories_read_authenticated',
    'merchant_rules|merchant_rules_read_authenticated',
    'parser_templates|parser_templates_read_authenticated',
    'raw_notifications|owner_only',
    'transactions|owner_only',
    'dashboard_alerts|owner_only',
    'device_heartbeat|owner_only'
  ]
  loop
    t := split_part(p, '|', 1);
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t
        and policyname = split_part(p, '|', 2)
    ) then
      if t in ('categories','merchant_rules','parser_templates') then
        execute format(
          'create policy %I on %I for select to authenticated using (true)',
          split_part(p, '|', 2), t);
      else
        execute format(
          'create policy %I on %I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)',
          split_part(p, '|', 2), t);
      end if;
    end if;
  end loop;
end $$;
