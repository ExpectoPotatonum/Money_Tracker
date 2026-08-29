-- Fix: owner_only policies were created on the `public` role, not
-- `authenticated`. Supabase's PostgREST runs the authenticated user as the
-- `authenticated` role, so a policy on `public` never applies to them ->
-- every authenticated request 403s ("permission denied"), even though the
-- policy exists. categories/merchant_rules/parser_templates policies were
-- correctly created `to authenticated` (visible in the diagnostic), so only
-- the four owner_only policies need to move role.
--
-- Idempotent: drops the wrongly-role'd policy, then recreates it for the
-- authenticated role.

do $$
declare
  t text;
begin
  foreach t in array array['raw_notifications','transactions',
                            'dashboard_alerts','device_heartbeat']
  loop
    -- Drop only a policy that is NOT already targeting authenticated
    -- (i.e. the broken public-role one). Leaving a correct one in place.
    if exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = t
        and policyname = 'owner_only'
        and not ('authenticated' = any(roles))
    ) then
      execute format('drop policy "owner_only" on %I', t);
    end if;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = t
        and policyname = 'owner_only'
    ) then
      execute format(
        'create policy "owner_only" on %I for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)',
        t);
    end if;
  end loop;
end $$;
