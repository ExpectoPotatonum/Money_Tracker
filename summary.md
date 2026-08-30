# Project Summary — Expense Tracker

> Status as of 2026-08-30. What's built, what's verified live, and what comes next. Governing docs: `AGENTS.md` (what/why) and `ARCHITECTURE.md` (how) + `REPARSING.md` (parse re-run).

## Goal

A personal finance tracker: an Android app that captures banking/e-wallet push notifications, a Supabase backend that turns raw text into structured transactions, and a web dashboard for viewing/editing spending — built to `AGENTS.md` (capture-unconditional, parsing-decoupled, sync-idempotent, redaction before upload, RLS everywhere, no `service_role` in the app). Runs the capture→sanitize→sync→parse pipeline on the **free** Supabase tier.

## What's done & verified LIVE

### Capture → sync (Android, working)
- `NotificationListenerService` writes to Room synchronously on the binder thread; `Redactor` sanitizes at sync time (OTP/balance/account); WorkManager batches upserts keyed on `client_uuid`.
- **Verified on-device:** 2 real `raw_notifications` (TnG + CIMB) synced to Supabase; `client_uuid` matches the local Room rows (idempotent upsert); `device_heartbeat` writing.
- Earlier root-cause: a stale APK dropped the Hilt worker wiring → WorkManager reflection fallback (`NoSuchMethodException`). Fresh rebuild+reinstall (from Android Studio) fixed it; source wiring was correct.

### Parsing (free-tier Postgres trigger + PL/pgSQL — LIVE)
- Edge Functions/webhooks are paid-tier, so parsing moved into Postgres: `parse_raw_notification()` + `AFTER INSERT` trigger + `backfill_parse_pending()` (migrations `202608180002`–`004`). The Deno `parse-notification` Edge Function is kept as the paid-tier fallback.
- Postgres ARE caveats documented in `REPARSING.md` (no lazy quantifiers / `\b` / lookahead; `field_map` maps named fields to positional capture-group indices).
- **Verified live:** backfilled the 2 real rows → TNG credit (`HOO JET YUNG`, RM 1.00) and CIMB debit (`TnG eWallet`, RM 1.00), both `parse_status='success'`, `confidence=high`. Merchant rule `touch n go`→`TnG eWallet` works.

### Web dashboard (working on localhost)
- Auth gate, transaction table (debits "Spending" + credits "Money in"), MYR FX conversion (Frankfurter) at display time, review inbox, heartbeat offline banner, alerts.
- **Manual edit/delete mode** — inline per-cell editing behind an **Edit mode** toggle: date (MYT), merchant display+raw, category dropdown, amount/currency/direction, and a **255-char comment** field. Per-row **Save** (PATCH) and **Delete** (gated behind edit mode). Dates pinned to `Asia/Kuala_Lumpur`.
  - **`status` is deliberately not user-editable** — the status dropdown was removed as useless to the owner; `status` stays a DB column, written only by the parse layer.
- **Currencies are a DB reference table** (`currencies`, migration `202608300003`, GRANT+RLS read policy). The app reads it at runtime (`api/currencies.js` → `setCurrencySymbols`/`currencyOptions` in `utils/format.js`) to build the edit dropdown + display symbols, with built-in fallbacks. **Adding a currency = one `INSERT`, no app release.** v1: MYR, CNY, TWD, USD, SGD.
- **Credit-side categories + merchant rules** (migrations `202608300001`/`202608300002`): Salary, Transfers, Refunds, Cashback & Rewards, Investments/Interest, Gifts + recognizable incoming-sender rules. P2P receives carry the sender's *name* as merchant (e.g. TnG "HOO JET YUNG"), which no generic rule matches — set by hand in edit mode.

## Key decisions made this session (AGENTS.md §15)
- No automated cross-app dedup — an e-wallet + its underlying card both notify the same real transfer; the owner deletes the duplicate in edit mode instead.
- FX provider: **Frankfurter** (ADR 0001); unavailable rates degrade to the original amount.
- Parsing lives in Postgres on the free tier, not an Edge Function.

## Supabase migrations to run (SQL Editor) — not yet applied live
- `202608180002_db_parser_field_map.sql`, `202608180003_db_parser_infra.sql`, `202608180004_seed_templates.sql` — **already applied live** (parsing verified).
- `202608300001_seed_credit_categories.sql`, `202608300002_seed_credit_merchant_rules.sql`, `202608300003_seed_currencies.sql` — **applied live** (user ran them).

## Verification status
| Subsystem | Result |
|---|---|
| Capture → sync → parse → display | ✅ verified live (TnG + CIMB) |
| Web edit/delete + currencies + comment field | ✅ working on localhost:5173 |
| Web ESLint + build | ✅ clean |
| Web Playwright e2e | ✅ (7 tests incl. edit-mode/delete; run via `npm run test:e2e` on the user's machine — the shell here couldn't run Playwright) |
| Android | ✅ built + installed by the user; capture verified |

## What's next
1. **More parser templates / more apps** — only TnG + CIMB are live. Adding banks/wallets needs **real captured samples first** (AGENTS.md §14 rollout) — the next real-world gap.
2. **Validate the redaction regex library** (§8) against real samples — still an open TODO.
3. **Regression-test harness for `parser_templates`** (§9) — script the "replay vs `sample_input`" step once there are more templates.
4. **Later scope (deferred by design)** — budgets, recurring detection, CSV export, PWA install, chart library.

## Conventions that gate future work
- A changed `body_pattern` is a **new** `parser_templates` row (version+1), never an in-place edit — replayed against every `sample_input` first.
- `raw_notifications` rows are never deleted and text never mutated post-insert (only `parse_status`/`parse_error`/`parser_template_id`/`linked_transaction_id` change).
- No `service_role` key in the Android app, ever.
- A new bank/e-wallet = a new template row, never per-package `if` in app code.
- `onNotificationPosted()` stays a fast synchronous write.
- Every new table = matching `GRANT` + RLS policy in the same migration (§17).
- Undecided: whether the diagnostic `2a–2e / 3 / 4 / DIAGNOSTIC` scratch SQL + `results.txt` stay as reference or get gitignored (committing them costs no extra Netlify build minutes; Netlify builds only on push to the deployed branch, and `supabase/` isn't in the deploy path anyway).
