# Project Summary — Expense Tracker

> Status as of the `265c32d` scaffold commit. What's built, what's verified, and what comes next. The governing docs are `AGENTS.md` (what/why) and `ARCHITECTURE.md` (how).

## Goal

A personal finance tracker: an Android app that captures banking/e-wallet push notifications, a Supabase backend that turns raw text into structured transactions, and a web dashboard for viewing spending — all built to `AGENTS.md`/`ARCHITECTURE.md` (capture-unconditional, parsing-decoupled, sync-idempotent, redaction before upload, RLS everywhere, no `service_role` in the app).

## What's done

### Repo structure (ARCHITECTURE.md §2)

```
/android                  Kotlin capture app (Gradle 8.9, AGP 8.5.2, Kotlin 2.0.20)
/supabase                 migrations + Edge Functions + Deno tests + regression harness
/web                      Vite + Bootstrap dashboard + Playwright e2e
/.github/workflows        android.yml, supabase.yml, web.yml (path-filtered) + PR template
/docs/adr/0001            FX provider decision (Frankfurter)
```

### Supabase backend — verified green

- **Migrations (forward-only, versioned):**
  - `202608160000_initial_schema.sql` — all tables from AGENTS.md §7 (`categories`, `merchant_rules`, `parser_templates`, `raw_notifications`, `transactions`, `device_heartbeat`), RLS `owner_only` on every table, `redactions_applied[]`, two immutability triggers (capture fields; `body_pattern`/`title_pattern`), `unique(client_uuid)` + `unique(raw_notification_id)` for idempotency.
  - `202608160001_seed_categories.sql` — deterministic UUIDs.
  - `202608160002_dashboard_alerts.sql` — alerts table + `failed_parse_spikes` view.
  - `202608170000_fix_reference_table_rls.sql` — enables RLS on `categories`/`merchant_rules`/`parser_templates` + authenticated read policies (fixes "permission denied for table categories" in the dashboard).
- **Edge Functions:**
  - `parse-notification/` — thin webhook entry, pure `parser.ts` (named-group regex, token date formats), `merchantResolver.ts` (priority ordering), `redactionSpotCheck.ts`.
  - `check-alerts/` — scheduled runbook: device offline >6h, parse-spike ≥5/24h → `dashboard_alerts`.
  - `_shared/` — db client, typed discriminated unions, validation.
- **Regression harness** `scripts/replay-templates.ts` + `fixtures/templates.json` (2 placeholder templates with `sample_expected`) — resolves the §15 open TODO, wired as a required CI check.
- **Tests:** Deno 29/29 passing; `deno fmt`/`deno lint` clean; replay harness passes.

### Web dashboard — verified green

- Vite + Bootstrap + `@supabase/supabase-js`, no SPA framework (ARCHITECTURE.md §5).
- `src/lib/supabaseClient.js`, thin `src/api/` layer, `src/utils/fx.js` (Frankfurter, returns `null` on failure), `src/views/` (auth gate, dashboard with MYR conversion, review inbox), reusable components.
- Playwright e2e: auth gate + dashboard critical paths — 4/4 passing. Includes the `formatMoney` fix (`[A-Z]{3}` never matched 2-letter symbols like `RM` → `/^[A-Za-z]{2,3}$/`).
- ESLint + Prettier clean, production build passes, `netlify.toml` ready.

### Android app — written, NOT locally verified (no JDK/SDK on dev machine)

- **`capture/`** — `CaptureNotificationListenerService` (fast synchronous Room write on the binder thread, `getCharSequence()` for styled amounts, capture-time SHA-256 content hash + dedup window), foreground service (`dataSync` type, silent channel), `BootReceiver`, `SafeForegroundLauncher` (Android 12+ background-start guard), `TargetPackages`/`DeviceIdProvider`/`AppLabelResolver`.
- **`sanitize/Redactor.kt`** — the §8 redaction pass: pure and generic; OTP / balance / account patterns with directional keyword windows (tiny 4-char lookback so "You paid RM 65.50 … available balance RM 12,340.75" only strips the balance). Heaviest test coverage in the repo (13 JUnit5 cases).
- **`data/`** — Room entity/DAO/repository; sync bookkeeping (`pending`/`synced`/`failed`) stays on-device; text columns hold untouched originals.
- **`sync/`** — `NotificationSyncWorker` (batch 50, upsert `on_conflict=client_uuid`, `Result.retry()` on IO), `HeartbeatWorker`, `ListenerHealthWorker` (rebind), `SyncScheduler` (15/30/60-min cadences + expedited one-shot), hand-rolled OkHttp Supabase REST client (anon key + JWT only — zero `service_role` references), redaction runs at sync time on the untouched Room copy.
- **`di/`** Hilt incl. `HiltWorkerFactory`; Compose `ui/` (status + settings tabs, notification-access/battery deep links).
- **Tests:** unit (`RedactorTest`, `PayloadBuilderTest`, mapper) + instrumented (`RawNotificationDaoTest`, `NotificationSyncWorkerTest` using `@TestInstallIn` mocks + in-memory DB).
- Gradle wrapper committed (jar + scripts from the Gradle 8.9.0 tag).

### CI/CD

- Three path-filtered GitHub Actions workflows matching real directories.
- `supabase.yml` — Deno fmt/lint/test → replay-templates → migrations apply against an ephemeral Postgres service container + immutability-trigger verification.
- `web.yml` — build with placeholder env, ESLint, Prettier check, Playwright.
- `android.yml` — ktlint → detekt → JUnit5 unit tests → instrumented tests on an API 34 emulator.

## Verification status

| Subsystem | Result |
|---|---|
| Supabase (Deno tests, lint, fmt, replay harness) | ✅ 29/29, clean |
| Web (ESLint, Prettier, build, Playwright) | ✅ 4/4 |
| Migrations against a real Postgres | ⚠️ only via CI (no local Docker/psql) |
| Android build (ktlint / detekt / unit / instrumented) | ⚠️ only via CI (no local JDK/SDK) |

## Committed & synced

- `265c32d` — "feat: scaffold android app, supabase backend, and web dashboard", pushed to `main` (114 files, +7836/−73). Workflows are live on GitHub.

## What's next

1. **First green Android CI run** — the only subsystem never compiled anywhere yet; expect possible version-pinning or lint (ktlint/detekt) iterations.
2. **Migrations CI run** — confirm the schema + immutability triggers apply cleanly against the ephemeral Postgres; fix anything surfaced as a `migration:` commit.
3. **Phase-1 real-device capture (AGENTS.md §14)** — the load-bearing validation: confirm `TargetPackages` package ids, gather real notification samples, and validate all three redaction pattern classes (OTP / balance / account) against them.
4. **Replace placeholder `parser_templates`** with real per-app templates built from sanitized samples, each with a `sample_expected` fixture so the replay harness guards them.
5. **Live Supabase wiring** — run migrations on the real project, add the webhook + scheduled function, enter real credentials in the app's Settings tab.
6. **Later scope (deferred by design)** — budgets, recurring/subscription detection, CSV export, PWA install, chart library.

## Conventions that gate future work

- A changed `body_pattern` is a **new** `parser_templates` row (version+1), never an in-place edit — replayed against every `sample_input` first (harness + DB trigger enforce).
- `raw_notifications` rows are never deleted and their text never mutated post-insert (DB trigger enforces).
- No `service_role` key in the Android app, ever.
- A new bank/e-wallet = a new template row, never a per-package `if` in application code.
- `onNotificationPosted()` stays a fast synchronous write — no network, no regex, no heavy work on the binder thread.
