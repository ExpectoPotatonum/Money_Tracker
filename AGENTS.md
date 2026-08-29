# Notification-Based Expense Tracker — Agent Guide

> Working title only — rename freely. This file orients anyone, human or AI coding agent, working in this repo. Read it before touching the database, the Android app, or the Edge Function.

**Contents**
1. Overview
2. Non-negotiable constraints
3. Repository layout (proposed)
4. Tech stack
5. Core design principle
6. Data flow
7. Database schema
8. Sanitization & privacy
9. Parsing strategy
10. Android survival strategy (battery / OneUI)
11. Offline resilience & sync
12. Security
13. Scope: v1 vs. later
14. Rollout plan
15. Open decisions / TODO
16. Conventions

## 1. Overview

A personal finance tracker with three parts:

- **Android capture app** — listens for notifications from banking / e-wallet apps via `NotificationListenerService`, stores them locally, and syncs them to the cloud. It isn't trying to be smart; it's trying to never miss or lose anything.
- **Supabase backend** — Postgres, Auth, Row Level Security, and an Edge Function that turns raw notification text into structured transactions.
- **Web dashboard** — a static site (Netlify) that reads directly from Supabase and shows spending.

Single user today. The schema is built to support multiple devices per user from day one.

## 2. Non-negotiable constraints

Given directly by the project owner. If anything else in this file conflicts with these, these win.

1. **Scope** — Ignore email/SMS parsers for now. Rely strictly on native app push notifications, to avoid double-counting.
2. **Data privacy** — The Android app must discard or sanitize the raw notification text (e.g. stripping OTPs or balances) before sending the payload to Supabase.
3. **Multi-currency** — The DB schema stores the original amount and currency. The web UI handles unifying it into a base currency (MYR) for the main dashboard.
4. **Future-proofing** — Include a `device_id` column in the schema from day one, to support multiple devices later.

## 3. Repository layout (proposed)

Not yet established — a suggested starting point, change it if something else fits better:

```
/android              Kotlin app — listener service, Room DB, WorkManager sync
/supabase
  /migrations         versioned SQL — the schema in §7 belongs here
  /functions
    /parse-notification   Edge Function — turns raw_notifications rows into transactions
/web                  static dashboard — Bootstrap, deployed via Netlify
agent.md              this file
```

## 4. Tech stack

| Layer | Choice |
|---|---|
| Android | Kotlin, `NotificationListenerService`, Room, WorkManager, a foreground service |
| Backend | Supabase — Postgres, Auth, Row Level Security, Edge Functions, Database Webhooks |
| Web | Static site on Netlify, Bootstrap, Supabase JS client, queried directly from the browser under RLS |

## 5. Core design principle

> Capture is unconditional and durable. Parsing is decoupled and re-runnable. Sync is queued and idempotent.

Concretely:

- **Unconditional, durable capture** — `raw_notifications` rows are written for every matching notification, parseable or not, and are never deleted.
- **Decoupled, re-runnable parsing** — parsing lives server-side, in an Edge Function driven by `parser_templates`, not in the Android app. Fixing a broken regex is a data change, not an app release, and every historical row can be re-parsed once the fix lands.
- **Queued, idempotent sync** — every captured row gets a `client_uuid` generated on-device at capture time; syncing is an upsert on that key, so a retry after a partial failure can't create a duplicate.

Everything else in this file follows from these three sentences.

## 6. Data flow

1. The OS posts a notification from a tracked package.
2. `onNotificationPosted()` fires. This runs on the system's binder thread — it should do nothing beyond a fast, synchronous write to the local Room DB. No network, no regex, no blocking work here.
3. The row is sanitized (§8) before it becomes eligible for sync. The full original text stays in Room, on-device, and never leaves.
4. A WorkManager job batches pending rows and upserts them into Supabase's `raw_notifications` (sanitized text only), keyed on `client_uuid`.
5. A Database Webhook on insert triggers the `parse-notification` Edge Function, which:
   - loads the active `parser_templates` row for that `package_name`,
   - runs `title_pattern` / `body_pattern` against the sanitized text to extract amount, currency, `merchant_raw`, direction, and transaction date,
   - falls back to a loose per-currency regex and `confidence = 'low'` if no strict template matches,
   - resolves `merchant_raw` against `merchant_rules` (highest `priority` first) to get `merchant_display` and `category_id`,
   - writes a `transactions` row, and updates the source `raw_notifications` row's `parse_status`, `parser_template_id`, and `linked_transaction_id`.
6. The web dashboard queries `transactions` — and the review inbox over `raw_notifications` — directly via the Supabase client, under RLS.

Three different mechanisms guard against duplicates, at three different layers:

- `client_uuid` — sync-level idempotency, so a retried batch can't double-insert the same captured row.
- `content_hash` — near-duplicate detection at capture time, checked on-device before a new local row is written, catching the OS reposting or updating what is logically the same notification within a short window.
- `transactions.status = 'duplicate'` / `duplicate_of` — cross-app duplicate transactions: an e-wallet top-up and the underlying bank-card charge can both legitimately notify the same real-world payment. Still relevant even with SMS/email out of scope, since two in-scope apps can overlap.

## 7. Database schema

Canonical schema — save this as the first migration under `/supabase/migrations` when implementation starts.

```sql
-- categories -------------------------------------------------
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
  parser_template_id    uuid references parser_templates(id),
  parse_status          text not null default 'pending'
                          check (parse_status in ('pending','success','failed','needs_review','ignored')),
  parse_error           text,
  linked_transaction_id uuid   -- fk added below, after transactions exists
);

create index on raw_notifications (parse_status);
create index on raw_notifications (package_name, posted_at desc);

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
  confidence               text not null default 'high' check (confidence in ('high','medium','low')),
  status                   text not null default 'confirmed'
                             check (status in ('confirmed','needs_review','duplicate','ignored')),
  duplicate_of             uuid references transactions(id),
  notes                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

alter table raw_notifications
  add constraint fk_raw_notifications_transaction
  foreign key (linked_transaction_id) references transactions(id);

create index on transactions (transaction_date desc);
create index on transactions (category_id);
create index on transactions (status);

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
```

Proposed addition — not in the original spec, added to support §8:

```sql
-- lets the review inbox spot-check the on-device redaction pass.
alter table raw_notifications
  add column redactions_applied text[] not null default '{}';
  -- e.g. '{otp}', '{balance}', '{account}', '{otp,balance}', or '{}' if
  -- nothing matched. A row from an app known to send OTPs, with an empty
  -- array here, is a signal the redaction pass missed that app's phrasing
  -- — worth checking.
```

## 8. Sanitization & privacy

*Confirmed. Generic, on-device redaction + server-side parsing is the lower-memory, lower-battery option — a few regex passes over short text on the phone, versus running a growing library of full per-app parsing rules on-device. Parsing stays server-side as originally designed.*

The constraint is that raw text must be sanitized **before** it reaches Supabase. Read literally, that's in tension with §5 — "capture is unconditional and durable" was justified specifically because untouched text lets you re-run parsing later against anything a regex missed. The resolution used here:

- **On-device, in Room, text is never sanitized.** The full, untouched notification is the local source of truth, and it never leaves the device.
- **Only the sync payload is sanitized.** Before a row is eligible for upload, a generic, app-agnostic redaction pass runs over `title` / `text_body` / `big_text` / `sub_text`:
  - digit sequences (4–8 digits) next to OTP-indicating words (*otp, code, verification, pin, one-time*) → replaced with `[REDACTED-OTP]`.
  - currency-amount-shaped tokens next to balance-indicating words (*balance, available balance, avail bal, baki*) → replaced with `[REDACTED-BALANCE]`.
  - partial account/card numbers — long digit runs (8+ digits) and masked patterns like `**** 1234` or `ending 5678` → replaced with `[REDACTED-ACCOUNT]`.
  - the transaction amount itself is left alone — it sits next to different keywords (*debited, paid, charged, received*, etc.), which is what makes it possible to strip a balance figure without also stripping the number the whole pipeline exists to capture.
- The pass is deliberately **generic**, not per-package like `parser_templates` — it has to stay simple enough to live in app code, since it can't be fixed centrally after the fact the way parsing can.
- Consequence for `parser_templates`: `sample_input` and `body_pattern` must be built from the **sanitized** form of a real notification (with OTPs, balances, *and* account/card numbers already stripped) — not the raw original — since that's what the Edge Function actually sees. When gathering samples (§14), capture both forms locally so the redaction pass itself can be checked, then discard the raw form once satisfied.
- If any bank's phrasing ever puts the transaction amount and the balance too close together for this generic pass to tell apart safely, treat that as a one-off carve-out for that specific phrasing — don't loosen the general rule.

This satisfies the letter of the privacy constraint — Supabase never receives an OTP or a balance — while keeping the reparseability guarantee intact for everything else.

## 9. Parsing strategy

- Parsing happens **server-side**, in the Edge Function, never on-device. A regex fix is a redeploy of the function and a re-run over history, not an app release.
- `parse_status`: `pending → success`, or `pending → failed / needs_review / ignored`.
  - `failed` — nothing matched at all; unrecognized or reformatted notification.
  - `needs_review` — the loose fallback matched, not the strict template; low confidence.
  - `ignored` — deliberately not a transaction (e.g. a notification with nothing left to extract after redaction).
- Build the **review inbox** early: `select * from raw_notifications where parse_status in ('failed','needs_review')`. It's the safety valve for the whole design, not an afterthought.
- Every `parser_templates` row keeps a real `sample_input`. Before deploying a changed `body_pattern`, replay it against every stored sample for that `package_name` — a cheap regression test that stops "fixed HLB, broke TnG." Worth scripting once there's more than a couple of templates (§15).
- A new regex version is a new `parser_templates` row (`version` increments), not an edit of an existing one — keeps history, makes rollback trivial.
- Optional but cheap: alert if failed parses for one package spike (5+ in a day) — usually means the app changed its notification format, and it's better to know that day than to notice a gap in a spending chart three weeks later.

## 10. Android survival strategy (battery / OneUI)

OneUI's battery management is more aggressive than stock Android — treat this as layered defense, not one fix.

**One-time manual setup** — do this first, it matters more than any code:
- Settings > Apps > [app] > Battery → **Unrestricted**, not Optimized.
- Settings > Battery and device care > Background usage limits → make sure the app isn't in *Sleeping* / *Deep sleeping apps*; add to *Never sleeping apps* if that list exists on this OneUI version.
- Settings > Battery and device care > More battery settings → turn off any scheduled "clean up unused apps" behavior (wording drifts between OneUI releases).
- Recents → tap the app's icon on its card → **Lock this app**.
- This is sideloaded, so Auto Blocker may block install by default on newer OneUI (allow once) — and being outside the Play Store means more room to be assertive about requesting battery exemptions than a published app would have.

**In the app:**
- Pair the listener with a small foreground service (`startForeground()`, low-importance silent channel) as soon as `onListenerConnected()` fires.
- On API 34+, declare a `foregroundServiceType` in the manifest — `dataSync` or `specialUse` both fit.
- A `BOOT_COMPLETED` receiver so everything restarts after a reboot.
- A periodic WorkManager health check (every 30–60 min) that verifies the listener is still bound and calls `NotificationListenerService.requestRebind()` if not.

**Know when it's dead:**
- Headless failures are invisible by design. Write to `device_heartbeat` on every wake: `last_seen_at`, listener-connected, notification-access-granted, battery-unrestricted.
- Dashboard banner when `last_seen_at` is more than a few hours stale: "tracker may be offline." Turns a silent failure into something noticeable.

## 11. Offline resilience & sync

A different failure mode from §10 — this is "captured fine, but no signal right now," not "the service was dead and missed it."

- Room is the real source of truth for capture; Supabase is a synced mirror.
- `onNotificationPosted()` writes to Room synchronously and does nothing else (§6, step 2).
- Each local row carries `sync_status` (`pending` / `synced` / `failed`) and the `client_uuid` generated at capture.
- A WorkManager job (`NetworkType.CONNECTED`, expedited) pushes pending rows in batches of ~50, so a week offline doesn't produce one oversized payload.
- A dumb periodic sync (~every 15 min) runs as a safety net, independent of any specific trigger.
- Sync is `upsert ... on conflict (client_uuid) do nothing` — WorkManager *will* retry failures, and without the idempotency key that turns one real transaction into two.

## 12. Security

- The anon key in a static site is public — visible to anyone who opens dev tools. RLS is not optional, even for one user. Every capture-related table carries an `auth.uid() = user_id` policy (§7).
- The dashboard sits behind Supabase Auth (even a single email/password account), not a fully open page.
- The Supabase `service_role` key never goes in the Android app — it bypasses RLS entirely, and APKs decompile trivially. The phone authenticates and writes under RLS the same way the dashboard does.
- §8's sanitization is a second, independent layer on top of RLS — OTPs and balances are meant to never exist in Supabase at all, not just to be access-controlled once there.

## 13. Scope: v1 vs. later

**In v1:**
- Native app push notifications only.
- One device, on a schema that already supports more.
- MYR conversion happens in the web UI at display time; the database only ever stores original amount + currency.

**Explicitly deferred:**
- Gmail / email receipts — notification text for email is a thin, truncated first line; if e-receipts matter later, the Gmail API (full message bodies) is a better source than the notification listener for this one channel specifically.
- SMS parsing.
- Budget thresholds, recurring/subscription detection, CSV export, PWA install, chart library wiring.

Still in scope despite the SMS/email exclusion: cross-app duplicate detection (§6) — an e-wallet and its underlying bank card can both legitimately notify the same real-world payment.

## 14. Rollout plan

1. **Capture-only, 1–2 weeks.** Ship the listener + Room + sync pipeline with no parsing at all, across every target app. Real notification formats vary by account type and language setting in ways that are hard to predict from memory — build `parser_templates` and the §8 redaction patterns from real samples, not assumptions. Confirm exact package names on-device (`adb shell pm list packages`, or a package-viewer app) before finalizing the listener's filter list — regional variants of the same bank can share a display name but not a package id.
2. **Parsing + sanitization, from real samples.** Write `parser_templates` and validate the §8 redaction pass against what was actually gathered. Backfill-parse the phase-1 backlog once templates exist.
3. **Dashboard read views.** Transaction list, review inbox, heartbeat banner.
4. **Later:** budgets, recurring detection, CSV export, PWA, FX polish (§15).

## 15. Open decisions / TODO

**Resolved:**
- Sanitization stays generic/on-device with parsing server-side (§8) — confirmed as the lower-memory, lower-battery option over moving parsing on-device.
- FX conversion for the MYR dashboard total uses a live/cached API, not manual entry or a static table.
- Account and card numbers are redacted on-device alongside OTPs and balances (§8).

**Still open:**
- **Which FX API**, specifically, and how it's cached — a free-tier provider (e.g. exchangerate.host, Frankfurter) fetched once and cached client-side per session is a reasonable default; pick one and confirm it has the currencies you need (MYR, USD, CNY, and whatever Wise/Alipay add).
- **Redaction regex library** (§8) — OTP, balance, *and* now account/card patterns — is a proposed design, not yet validated against real notification samples. Treat phase 1 of the rollout (§14) as the point to validate all three, not just the parsing templates.
- **Regression-test harness** for `parser_templates` (§9) — currently a manual "replay against `sample_input`" step; worth scripting once there's more than a couple of templates.

## 16. Conventions

- Never hand-edit a `parser_templates.body_pattern` without replaying it against every `sample_input` for that `package_name` first.
- A new regex is a new `parser_templates` row (bump `version`), not an in-place edit — keeps history, makes rollback trivial.
- `raw_notifications` rows are never deleted, and their text is never mutated after insert — only `parse_status`, `parse_error`, `parser_template_id`, and `linked_transaction_id` change post-insert.
- No Supabase `service_role` key in the Android app, ever.
- `onNotificationPosted()` stays fast — no network calls, no remote DB writes, no heavy regex work on that thread.
- Every `create table` in a migration must be followed by the matching `GRANT` for the `authenticated` role (§17). Tables created via raw migration SQL do **not** get Supabase's automatic grants (those only apply to tables created through the dashboard UI), so a new table with no grants fails with Postgres `42501 permission denied` for every logged-in request — even with correct RLS policies.

## 17. Adding a new table (database checklist)

Supabase authorizes in **two independent layers**; a new table needs both:

1. **GRANT (base privilege)** — decides whether the `authenticated` role may touch the table at all.
2. **RLS policy** — decides which rows that role may see/change once granted.

Forgetting either produces 403s on every request; the two fail in different ways:
- **Missing GRANT** → Postgres log: `permission denied for table X`, status `42501`, `auth_user: null`.
- **Missing / mis-role'd RLS policy** → RLS rejection (row filter), often 403 with a valid user.

### Template for any new table

```sql
-- 1. Grant base privileges. Reference/lookup tables: SELECT only.
--    Owner-scoped capture tables: also INSERT/UPDATE/DELETE so the app can
--    write — safe because the owner_only RLS policy confines rows to auth.uid().
grant select on my_new_table to authenticated;

-- (if the app writes to it, extend with:)
grant insert, update, delete on my_new_table to authenticated;

-- 2. Enable RLS and add a policy. Reference tables (no user_id): read for
--    authenticated, writes stay operator-only. Owner tables: owner_only.
alter table my_new_table enable row level security;

create policy "owner_only" on my_new_table
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
  -- OR, for a shared reference table without user_id:
  -- create policy "read_authenticated" on my_new_table
  --   for select to authenticated using (true);
```

Useful diagnostics (previously run to debug this exact issue):

```sql
-- Are the base grants in place?
select grantee, privilege_type, table_name
from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'authenticated'
order by table_name, privilege_type;

-- Are the RLS policies in place, and for which roles?
select tablename, policyname, roles::text, cmd
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

Put the `GRANT` in the same migration as the `create table`, so the two never drift — and note that Supabase's GitHub connection does not auto-apply migrations to the live project; run each new migration manually in SQL Editor.
