-- Phase 1 (import-candidate-features.md §4.2 Item B, owner decisions):
-- hierarchical tag groups + tags with optional color labels, per-user.
-- Model mirrors ezBookkeeping: flat tags organized in tag groups (two-level
-- hierarchy via tags.group_id -> tag_groups.id; no deep nesting).
--
-- RLS + grants follow AGENTS §17 (owner-scoped capture tables):
--   - every table carries user_id (default auth.uid()) and an owner_only policy
--   - authenticated gets SELECT/INSERT/UPDATE/DELETE so the web app can manage
--     groups/tags and link/unlink tags on transactions within its own rows.

create table tag_groups (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id),
  name       text not null,
  sort_order int  not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table tags (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id),
  group_id   uuid references tag_groups(id) on delete set null,
  name       text not null,
  color      text,                 -- hex color for the badge, e.g. '#0d6efd'
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create index on tags (group_id);
create index on tags (user_id);

-- M2M between transactions and tags. Composite PK is the idempotency key (a
-- retried link can't double-insert). Deleting a tag or a transaction cleans up
-- its links automatically.
create table transaction_tags (
  transaction_id  uuid not null references transactions(id) on delete cascade,
  tag_id          uuid not null references tags(id) on delete cascade,
  user_id         uuid not null default auth.uid() references auth.users(id),
  created_at      timestamptz not null default now(),
  primary key (transaction_id, tag_id)
);

create index on transaction_tags (tag_id);
create index on transaction_tags (user_id);

-- --- grants (§17 checklist) ---
grant select, insert, update, delete on tag_groups to authenticated;
grant select, insert, update, delete on tags to authenticated;
grant select, insert, delete on transaction_tags to authenticated;

-- --- RLS (owner_only on every table) ---
alter table tag_groups enable row level security;
alter table tags enable row level security;
alter table transaction_tags enable row level security;

create policy "owner_only" on tag_groups
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "owner_only" on tags
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "owner_only" on transaction_tags
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);