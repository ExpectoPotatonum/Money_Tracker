-- 0001: initial schema
-- Canonical schema from agents.md §7, plus:
--   * the §8 `redactions_applied` addition (on-device redaction audit trail)
--   * the two immutability triggers from ARCHITECTURE.md §6
--   * RLS enabled with owner_only policies on every capture-related table
--
-- Forward-only per ARCHITECTURE.md §4: never edit this file once merged; a
-- correction becomes a new migration.

-- Supabase ships `auth.users` + `auth.uid()`. In CI the migrations job
-- applies these to a bare Postgres, so the harness first applies
-- tests/_bootstrap_auth.sql which creates the stubs these references need.
-- On a real Supabase project that bootstrap file is never run.

create table categories (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  parent_id     uuid references categories(id),
  icon          text,
  color         text,
  created_at    timestamptz not null default now()
);

-- merchant_rules — raw merchant text -> normalized name + category
create table merchant_rules (
  id                uuid primary key default gen_random_uuid(),
  match_pattern     text not null,           -- e.g. 'SHOPEE', or a regex
  match_type        text not null default 'contains'
                      check (match_type in ('exact','contains','regex')),
  normalized_name   text not null,           -- e.g. 'Shopee'
  category_id       uuid references categories(id),
  priority          int not null default 0,  -- higher = checked first
  created_at        timestamptz not null default now()
);

-- parser_templates — versioned, per-app regex definitions
create table parser_templates (
  id                uuid primary key default gen_random_uuid(),
  package_name      text not null,
  app_label         text not null,           -- 'Hong Leong Bank', 'TnG eWallet'...
  version           int not null default 1,
  active            boolean not null default true,
  title_pattern     text,                    -- optional, matched against notification title
  body_pattern      text not null,           -- named groups: amount, currency, merchant, txn_date, direction
  date_format       text,                    -- used if txn_date group is present
  default_currency  text not null default 'MYR',
  sample_input      text,                    -- real example, used as a regression-test fixture
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (package_name, version)
);

-- raw_notifications — durable, unconditional capture (source of truth)
create table raw_notifications (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references auth.users(id),
  client_uuid           text not null unique,   -- generated on-device at capture, sync idempotency key
  device_id             text not null,          -- Settings.Secure.ANDROID_ID
  package_name          text not null,
  app_label             text,
  notification_key      text,                   -- StatusBarNotification.getKey()
  title                 text,
  text_body             text,
  big_text              text,
  sub_text              text,
  is_group_summary      boolean not null default false,
  posted_at             timestamptz not null,
  captured_at           timestamptz not null default now(),
  content_hash          text not null,          -- sha256(package + title + text), near-dup detection
  redactions_applied    text[] not null default '{}', -- §8 audit trail, e.g. '{otp,balance}'
  parser_template_id    uuid references parser_templates(id),
  parse_status          text not null default 'pending'
                          check (parse_status in ('pending','success','failed','needs_review','ignored')),
  parse_error           text,
  linked_transaction_id uuid   -- fk added below, after transactions exists
);

-- transactions — parsed, structured output
create table transactions (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null default auth.uid() references auth.users(id),
  raw_notification_id     uuid not null references raw_notifications(id),
  source_package          text not null,
  source_app_label        text,
  amount                  numeric(12,2) not null,
  currency                text not null default 'MYR',
  direction               text not null check (direction in ('debit','credit')),
  merchant_raw            text,
  merchant_display        text,
  category_id             uuid references categories(id),
  transaction_date        timestamptz not null,   -- parsed txn time, falls back to notification time
  notification_posted_at  timestamptz not null,
  parser_template_id      uuid references parser_templates(id),
  confidence              text not null default 'high' check (confidence in ('high','medium','low')),
  status                  text not null default 'confirmed'
                            check (status in ('confirmed','needs_review','duplicate','ignored')),
  duplicate_of            uuid references transactions(id),
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  -- one transaction per raw_notification, by construction (agents.md §5:
  -- idempotent by construction, not by convention). This is what makes
  -- webhook re-delivery and parse backfills safe upserts instead of
  -- duplicate-inserters.
  unique (raw_notification_id)
);

alter table raw_notifications
  add constraint fk_raw_notifications_transaction
  foreign key (linked_transaction_id) references transactions(id);

-- device_heartbeat — lets the dashboard warn you if the worker goes dark
create table device_heartbeat (
  device_id                    text primary key,
  user_id                      uuid not null default auth.uid() references auth.users(id),
  last_seen_at                 timestamptz not null,
  listener_connected           boolean,
  notification_access_granted  boolean,
  battery_unrestricted         boolean,
  app_version                  text
);

create index on raw_notifications (parse_status);
create index on raw_notifications (package_name, posted_at desc);
create index on transactions (transaction_date desc);
create index on transactions (category_id);
create index on transactions (status);

-- row level security — every table, even for a single user
alter table raw_notifications enable row level security;
alter table transactions enable row level security;
alter table device_heartbeat enable row level security;

create policy "owner_only" on raw_notifications
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_only" on transactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_only" on device_heartbeat
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- ARCHITECTURE.md §6 — enforce §16 conventions at the database level, because
-- a convention is only as strong as everyone remembering it. The regression
-- harness catches a *bad* pattern; these triggers catch the *wrong kind of
-- change* regardless of whether the pattern itself was good.
-- ---------------------------------------------------------------------------

-- raw_notifications: the captured text and posted_at are the untouched source
-- of truth (§16). Only the parse-related columns may change post-insert.
create or replace function reject_raw_notification_text_mutation()
returns trigger as $$
begin
  if (new.title, new.text_body, new.big_text, new.sub_text, new.posted_at,
      new.content_hash, new.package_name, new.device_id)
     is distinct from
     (old.title, old.text_body, old.big_text, old.sub_text, old.posted_at,
      old.content_hash, old.package_name, old.device_id) then
    raise exception 'raw_notifications capture fields are immutable after insert';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger raw_notifications_immutable
  before update on raw_notifications
  for each row execute function reject_raw_notification_text_mutation();

-- parser_templates: a changed body_pattern must be a new row (version + 1),
-- never an edit to an existing one (§9, §16).
create or replace function reject_parser_template_pattern_edit()
returns trigger as $$
begin
  if new.body_pattern is distinct from old.body_pattern
     or new.title_pattern is distinct from old.title_pattern then
    raise exception 'parser_templates.body_pattern/title_pattern are immutable — insert a new version instead';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger parser_templates_pattern_immutable
  before update on parser_templates
  for each row execute function reject_parser_template_pattern_edit();
