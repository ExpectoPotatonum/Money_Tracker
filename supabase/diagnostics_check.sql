-- ============================================================
-- DIAGNOSTIC: RLS policies + auth user state on this project
-- Paste the OUTPUT (results table) of these two queries.
-- ============================================================

-- 1. Are the RLS policies actually present?
select
  tablename,
  policyname,
  roles::text        as roles,
  cmd
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- 2. Does your auth user exist and is it confirmed?
select
  id,
  email,
  email_confirmed_at
from auth.users;
