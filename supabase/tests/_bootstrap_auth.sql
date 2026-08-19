-- CI-ONLY bootstrap. Creates the Supabase auth-schema stubs that the
-- migrations reference (auth.users FK, auth.uid()), so the migration job can
-- run against a bare Postgres 16 service container. NEVER apply this to a real
-- Supabase project — it would replace the real auth.uid() with a constant.
--
-- auth.uid() returns a fixed uuid so RLS "with check" inserts in CI fixtures
-- can reference it deterministically.

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select '00000000-0000-0000-0000-000000000000'::uuid;
$$;

-- The FK on raw_notifications.user_id requires this row to exist.
insert into auth.users (id)
values ('00000000-0000-0000-0000-000000000000')
on conflict do nothing;
