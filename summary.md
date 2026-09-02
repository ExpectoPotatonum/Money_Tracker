# Project Summary — Expense Tracker

> Status as of 2026-09-02. What's built, what's verified live, and what comes next. Governing docs: `AGENTS.md` (what/why) and `ARCHITECTURE.md` (how) + `REPARSING.md` (parse re-run).

## Goal

A personal finance tracker: an Android app that captures banking/e-wallet push notifications, a Supabase backend that turns raw text into structured transactions, and a web dashboard for viewing/editing spending — built to `AGENTS.md` (capture-unconditional, parsing-decoupled, sync-idempotent, redaction before upload, RLS everywhere, no `service_role` in the app). Runs the capture→sanitize→sync→parse pipeline on the **free** Supabase tier.

## What's done & verified LIVE

### Capture → sync (Android, working)
- `NotificationListenerService` writes to Room synchronously on the binder thread; `Redactor` sanitizes at sync time (OTP/balance/account); WorkManager batches upserts keyed on `client_uuid`.
- **Verified on-device:** 2 real `raw_notifications` (TnG + CIMB) synced to Supabase; `client_uuid` matches the local Room rows (idempotent upsert); `device_heartbeat` writing.
- **Auth 401/403 fix (ADR 0002):** access tokens are short-lived JWTs; the app now caches the full session (access token + `user_id`), sends `user_id` explicitly in payloads for RLS `owner_only`, maps 401/403 to an `UnauthorizedException` that clears the stale token so the next worker run re-authenticates (no more permanent retry loop), and logs full Supabase error bodies. **Verified live:** notifications syncing (`Unsynced rows: 0`), heartbeat success (`Last heartbeat: 2026-08-30 21:59:01`), auth self-healing on token expiry.
- Earlier root-cause: a stale APK dropped the Hilt worker wiring → WorkManager reflection fallback (`NoSuchMethodException`). Fresh rebuild+reinstall (from Android Studio) fixed it; source wiring was correct.

### Parsing (free-tier Postgres trigger + PL/pgSQL — LIVE)
- Edge Functions/webhooks are paid-tier, so parsing moved into Postgres: `parse_raw_notification()` + `AFTER INSERT` trigger + `backfill_resync()` (migrations `202608180002`–`004`, extended `202609010001`/`005`). The Deno `parse-notification` Edge Function is kept as the paid-tier fallback.
- Postgres ARE caveats documented in `REPARSING.md` (no lazy quantifiers / `\b` / lookahead; `field_map` maps named fields to positional capture-group indices).
- **Verified live:** backfilled the 2 real rows → TNG credit (`HOO JET YUNG`, RM 1.00) and CIMB debit (`TnG eWallet`, RM 1.00), both `parse_status='success'`, `confidence=high`. Merchant rule `touch n go`→`TnG eWallet` works.

### TnG outbound + Samsung merchant/category fix (migrations `202609010001`–`005`, applied live)
- `parse_raw_notification` now tries **every active template** per package (highest `version` first), not just `version desc limit 1` — one app (TnG) can have many format rows (v1 receive, v2 paid…to, v3 paid…at, v4 successfully transferred, v5 …: RM X deducted, v6 RM X…transferred). Installed new outbound TnG templates + a MUJI buying template.
- **`reject_pattern`** (202609010005) marks marketing/reward bodies (TnG `points|cashback|voucher|reward|earned|redeem|balance|reload|scan & pay`) as `ignored` before parsing — stops reward pushes with decimal amounts from becoming phantom `needs_review` rows. Verified 0 real TnG transactions rejected.
- **`source_suffix_title`** (202609010002) renders the Sent from column as `<app> - <title>`, so Samsung Wallet debits show "Samsung Wallet - HLB Debit Card" (the notification title is the card name).
- **Direction fix:** bare "transferred" is **not** credit — only "transferred … to you" is (202609010005); "transferred RM X to <name>" is a real debit.
- **`failed_parse_spikes` view** (202609010004) counts `needs_review` too, so a new format that still carries a decimal amount triggers the spike alert instead of hiding silently.
- **Verified live after re-parse:** PINDUODUO→Shopping, FP-AEON→AEON→Shopping, MUJI→Shopping, KEDAI KOPI 66 & LEMON KOAY TEOW THNG→Food & Dining, Berjaya Starbucks→Starbucks→Food & Dining, HOO JET YUNG→Finance & Transfer — all `high`/`confirmed`. Samsung row still needing a targeted re-run so its Sent from reads "Samsung Wallet - HLB Debit Card" (see §What's next).

### Web dashboard (working on localhost — architecture & implementation detail)

**Stack & architecture:** Plain ES modules, no SPA framework, no client-side router (`ARCHITECTURE.md` §5). Hash-based navigation (`#/` → dashboard, `#/review` → review inbox) via a `hashchange` listener in `main.js`. Vite is used only for dev-server hot reload and ES module bundling for Netlify's static output — it's a build tool, not a framework. All UI is constructed programmatically via `document.createElement`; there are zero HTML templates and zero `innerHTML` calls (every user-supplied value is set via `textContent`).

**File structure follows `ARCHITECTURE.md` §5 exactly:**

| Path | Role |
|---|---|
| `lib/supabaseClient.js` | Single Supabase client instance (`VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`) — every API module imports it |
| `lib/logger.js` | Client-side error auto-logger — IndexedDB-backed CSV logs, max 5 files / 5 MB, auto-rotating. `installLogger()` hooks `window.error` + `unhandledrejection`; `logApiError()` is called from `main.js` catch blocks |
| `api/auth.js` | `getSession`, `onAuthStateChange`, `signIn`, `signUp`, `signOut` — thin wrappers around `supabase.auth.*` |
| `api/transactions.js` | `getTransactions({ withinDays, limit, status })`, `getCategories()` (returns `Map<id,name>`), `updateTransaction(id, patch)`, `deleteTransaction(id)` |
| `api/currencies.js` | `getCurrencies()` — fetches `code, symbol` from DB reference table; **gracefully degrades to `[]`** if the table doesn't exist yet |
| `api/heartbeat.js` | `getLatestHeartbeat()` — single most recent row from `device_heartbeat` |
| `api/alerts.js` | `getOpenAlerts()` (unresolved from `dashboard_alerts`), `dismissAlert(id)` (sets `resolved_at`) |
| `api/reviewInbox.js` | `getReviewInbox({ status, packageName, limit })` — `raw_notifications` where `parse_status IN ('failed','needs_review')`; `getReviewPackages()` exists but unused currently |
| `utils/format.js` | Currency formatting (`formatMoney`), date formatting (`formatDateTime`, `toDateTimeLocal`, `fromDateTimeLocal`) — all pinned to `Asia/Kuala_Lumpur`. Module-level mutable state: `SYMBOLS` map + `CURRENCY_OPTIONS` array, updated at runtime from the `currencies` DB table via `setCurrencySymbols()` |
| `utils/fx.js` | `convert(amount, base, quote, date?)` — Frankfurter API (`api.frankfurter.dev/v2`), in-memory `Map` cache per (pair, date). With a date it freezes the rate at the transaction's own date (ADR 0003); without one it uses the latest rate. Returns `null` (never throws) on unavailable rates (ADR 0001) |
| `components/common.js` | `alertBanner`, `emptyState`, `badge`, `confirmDelete` — pure DOM builders, no API calls |
| `components/transactionTable.js` | 320 lines — the largest component. Renders a full `<table>` in two modes (read-only / edit). Internally: `draftFor()`, per-cell builders (date, receiver, category, amount, MYR, sent from, notes, actions), `normalizeDraft()` (diffs draft vs. original, returns only changed fields as a Supabase-ready patch object), and `onDirty(id, patch)` so the view accumulates edits and saves them when edit mode toggles off — no per-row Save buttons |
| `views/authGate.js` | Login/signup form — centered Bootstrap card, email+password, toggles between sign-in and sign-up modes. Handles email-confirmation-required flow |
| `views/dashboard.js` | 195 lines — the main view. Fetches transactions, categories, heartbeat, alerts, currencies in parallel via `Promise.all`. Splits into debits ("Spending") + credits ("Money in"), converts each to MYR via `convert()`, accumulates totals, renders the table(s). Edit mode: toggle button → all rows inline-editable; edits accumulate per-row and are PATCHed in one batch when toggled **off** (and flushed on navigation); Delete is the only per-row action (red-cross icon). Shows heartbeat offline banner (>6h stale) and server-side alert banners |
| `views/reviewInbox.js` | Filterable table (All / Failed / Needs review) of `raw_notifications` with `parse_status` failures. Shows sanitized text (prefers `big_text` > `text_body` > `sub_text`), redaction badges (otp=red, balance=yellow, account=gray), parse error note |

**Implemented features:**
- **Auth gate** — email/password sign-in + sign-up with email confirmation flow.
- **Transaction table** — read-only mode (Date, Receiver, Category, Amount, MYR, Sent from, Notes) and edit mode (all cells become inline inputs: `<input type="datetime-local">`, receiver raw merchant text, category `<select>`, amount number + currency `<select>` + direction `<select>`, notes `<textarea>` with 255-char limit, no visible counter).
- **MYR FX conversion** — every non-MYR transaction converted via Frankfurter using the **historical rate frozen at the transaction's own date** (ADR 0003), so past rows don't drift as live rates move; unavailable historical rates degrade to showing the original amount (never throws). Skipped-rate info banner shown when counts > 0.
- **Split view** — debits shown under "Spending", credits under "Money in" (separate tables if any credits exist).
- **Edit mode** — toggle button enables inline per-cell editing on all rows. The Receiver cell edits only `merchant_raw` (raw text). `normalizeDraft()` diffs each draft against the original. **No per-row Save** — edits accumulate and are PATCHed in one batch when edit mode is toggled off (also flushed on navigation so edits are never silently dropped). Delete is the only per-row action, gated behind `window.confirm()` via a red-cross image button (`web/public/red-cross-mark.png`). Table columns read **Receiver** / **Sent from**.
- **`status` is deliberately not user-editable** — the status dropdown was removed as useless to the owner; `status` stays a DB column, written only by the parse layer.
- **Heartbeat offline banner** — shows warning when `device_heartbeat.last_seen_at` is >6 hours old, with "Xh ago" text.
- **Dashboard alerts** — server-side alerts from `dashboard_alerts` table rendered as dismissible Bootstrap banners; severity `critical` maps to `alert-danger`.
- **Currencies are a DB reference table** (`currencies`, migration `202608300003`, GRANT+RLS read policy). The app reads it at runtime (`api/currencies.js` → `setCurrencySymbols`/`currencyOptions` in `utils/format.js`) to build the edit dropdown + display symbols, with built-in fallbacks. **Adding a currency = one `INSERT`, no app release.** v1: MYR, CNY, TWD, USD, SGD.
- **Credit-side categories + merchant rules** (migrations `202608300001`/`202608300002`): Salary, Transfers, Refunds, Cashback & Rewards, Investments/Interest, Gifts + recognizable incoming-sender rules. P2P receives carry the sender's *name* as merchant (e.g. TnG "HOO JET YUNG"), which no generic rule matches — set by hand in edit mode.
- **Review inbox** — filterable table of failed/needs_review `raw_notifications`, showing sanitized notification text, redaction badges, parse errors. Safety valve for unrecognized formats.
- **Client-side error logging** — all uncaught errors and API failures auto-captured to IndexedDB CSV logs for offline inspection.

**Architecture principle (`ARCHITECTURE.md` §5):** No SPA framework yet. Plain ES modules + small render functions + thin `/api` layer. *"If UI complexity outgrows this (once charts/budgets/PWA land), the honest next step is a lightweight reactive layer (Preact or Alpine.js) rather than jumping straight to React."* Revisit at that point, not now.

**Testing:** Playwright e2e tests (auth gate, transaction list rendering, review inbox filter, edit mode + delete) — run via `npm run test:e2e`. ESLint + Prettier enforced. Deliberately light test coverage per `ARCHITECTURE.md` §8: *"it's a thin read layer over data whose correctness is already guaranteed upstream by RLS and the schema's constraints."*

## Key decisions made this session (AGENTS.md §15)
- No automated cross-app dedup — an e-wallet + its underlying card both notify the same real transfer; the owner deletes the duplicate in edit mode instead.
- FX provider: **Frankfurter** (`docs/adr/0001-fx-api-provider.md`); unavailable rates degrade to the original amount. Rate now **frozen at each transaction's date** (ADR 0003) instead of recomputed live.
- Cashback decision (2026-09-02): TnG reward/cashback pushes stay `ignored` — deliberately not treated as income; `cashback` stays in the `reject_pattern`.
- Auth session lifecycle: access tokens are short-lived JWTs; the Android app caches the full session, maps 401/403 to `UnauthorizedException` that clears stale tokens (`docs/adr/0002-auth-session-lifecycle.md`).
- Parsing lives in Postgres on the free tier, not an Edge Function.

## Supabase migrations to run (SQL Editor) — applied live
- `202608180002_db_parser_field_map.sql`, `202608180003_db_parser_infra.sql`, `202608180004_seed_templates.sql` — **applied live** (parsing verified).
- `202608300001_seed_credit_categories.sql`, `202608300002_seed_credit_merchant_rules.sql`, `202608300003_seed_currencies.sql` — **applied live** (user ran them).
- `202609010001_outbound_templates_and_resync.sql`, `202609010002_samsung_source_label.sql`, `202609010003_tng_transferred_leading_amount.sql`, `202609010004_parse_spike_includes_needs_review.sql`, `202609010005_reject_marketing.sql` — **applied live** (user ran them).

## Verification status
| Subsystem | Result |
|---|---|
| Capture → sync → parse → display | ✅ verified live (TnG + CIMB) |
| TnG outbound + Samsung merchant/category parse | ✅ re-parsed, merchants/categories resolved — except one Samsung row still showing Sent from "Samsung Wallet" pending the targeted re-run in §What's next |
| Web: auth gate | ✅ email/password sign-in + sign-up with email confirmation |
| Web: dashboard (read-only) | ✅ debits/credits split, MYR FX conversion (frozen at transaction date), heartbeat banner, alert banners, currency symbols from DB |
| Web: edit mode (inline) | ✅ date, receiver (raw merchant text only), category dropdown, amount/currency/direction, notes (255-char, no counter), auto-save on toggle-off, red-cross Delete |
| Web: review inbox | ✅ filterable table (All/Failed/Needs review), redaction badges, parse error display |
| Web: client-side logging | ✅ IndexedDB-backed CSV auto-logger, error + unhandledrejection hooks |
| Web: ESLint + build | ✅ clean |
| Web: Playwright e2e | ✅ 3 spec files (auth, dashboard, logger) — run via `npm run test:e2e` |
| Android | ✅ built + installed by the user; capture verified |

## What's next
1. **Targeted Samsung re-parse** so Sent from renders "Samsung Wallet - HLB Debit Card": `update raw_notifications set parse_status='pending' where linked_transaction_id='0316042e-2c2e-4a81-90cf-974069c267f2'; select backfill_resync();` (the row is now `success`, so `backfill_resync()` won't pick it up automatically).
2. **More parser templates / more apps** — only TnG + CIMB are live. Adding banks/wallets needs **real captured samples first** (AGENTS.md §14 rollout) — the next real-world gap.
3. **Validate the redaction regex library** (§8) against real samples — still an open TODO.
4. **Regression-test harness for `parser_templates`** (§9) — script the "replay vs `sample_input`" step once there are more templates.
5. **Later scope (deferred by design)** — budgets, recurring detection, CSV export, PWA install, chart library. Budget/trend views inherit the frozen-at-transaction-date FX (ADR 0003) automatically.

## Conventions that gate future work
- A changed `body_pattern` is a **new** `parser_templates` row (version+1), never an in-place edit — replayed against every `sample_input` first.
- `raw_notifications` re-parsing uses `select backfill_resync();` — it resets `failed`/`needs_review`, never `success` (so manual edits aren't clobbered); flip a specific `success` row to `pending` by hand to reprocess just that one.
- `raw_notifications` rows are never deleted and text never mutated post-insert (only `parse_status`/`parse_error`/`parser_template_id`/`linked_transaction_id` change).
- No `service_role` key in the Android app, ever.
- A new bank/e-wallet = a new template row, never per-package `if` in app code.
- `onNotificationPosted()` stays a fast synchronous write.
- Every new table = matching `GRANT` + RLS policy in the same migration (§17).
- Undecided: whether the diagnostic `2a–2e / 3 / 4 / DIAGNOSTIC` scratch SQL + `results.txt` stay as reference or get gitignored (committing them costs no extra Netlify build minutes; Netlify builds only on push to the deployed branch, and `supabase/` isn't in the deploy path anyway).
