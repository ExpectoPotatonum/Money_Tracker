# Project Summary — Expense Tracker

> Status as of 2026-11-16. What's built, what's verified live, and what comes next. Governing docs: `AGENTS.md` (what/why) and `ARCHITECTURE.md` (how) + `REPARSING.md` (parse re-run).

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

**Stack & architecture:** Plain ES modules, no SPA framework, no client-side router (`ARCHITECTURE.md` §5). Hash-based navigation (`#/` → dashboard, `#/reports` → reports, `#/review` → review inbox, `#/raw` → raw notifications) via a `hashchange` listener in `main.js`. Vite is used only for dev-server hot reload and ES module bundling for Netlify's static output — it's a build tool, not a framework. All UI is constructed programmatically via `document.createElement`; there are zero HTML templates and zero `innerHTML` calls (every user-supplied value is set via `textContent`).

**File structure follows `ARCHITECTURE.md` §5, plus the sidebar/category-manager additions of 2026-11-16:**

| Path | Role |
|---|---|
| `lib/supabaseClient.js` | Single Supabase client instance (`VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`) — every API module imports it |
| `lib/logger.js` | Client-side error auto-logger — IndexedDB-backed CSV logs, max 5 files / 5 MB, auto-rotating. `installLogger()` hooks `window.error` + `unhandledrejection`; `logApiError()` is called from `main.js` catch blocks |
| `api/auth.js` | `getSession`, `onAuthStateChange`, `signIn`, `signUp`, `signOut` — thin wrappers around `supabase.auth.*` |
| `api/transactions.js` | `getTransactions({ withinDays, limit, status })`, `getAllTransactions()` (paged full history, 1000 rows/page — the dashboard groups it by month client-side), `getCategories()` (returns `Map<id,name>`), `updateTransaction(id, patch)`, `deleteTransaction(id)`. `updateTransaction`/`insertTransaction` reject a non-positive amount (`amount must be greater than zero`, mirrored by the DB CHECK `transactions_amount_positive`) |
| `api/accounts.js` | `listAccounts`, `saveAccount`, `deleteAccount`, `assignAccount`, `assignPackageRows`, `assignSourceRows`, `insertTransfer`, `deleteTransfer`. Account writes are plain CRUD; the `assign*` helpers backfill `transactions.account_id` for a package or a **Sent-from label** |
| `api/categories.js` | `listCategories` (sorted, `Other` last), `saveCategory`, `deleteCategory`. Writes require the GRANT + write policy from `202611160001`; `categories` has no `user_id`, so this is single-user-only today |
| `api/rawNotifications.js` | `getRawNotificationsPage({ limit, offset })` — read-only page of the durable capture log (newest first) |
| `api/budgets.js` | `listBudgets`, `saveBudget`, `deleteBudget` — overall (`category_id` NULL) + per-category |
| `api/tags.js` | Tag groups + tags CRUD (optional colour per tag) |
| `api/recurring.js` | `listRecurringEntries`, `saveRecurringEntry`, `deleteRecurringEntry` — the web management path for the Android worker |
| `api/currencies.js` | `getCurrencies()` — fetches `code, symbol` from DB reference table; **gracefully degrades to `[]`** if the table doesn't exist yet |
| `api/heartbeat.js` | `getLatestHeartbeat()` — single most recent row from `device_heartbeat` |
| `api/alerts.js` | `getOpenAlerts()` (unresolved from `dashboard_alerts`), `dismissAlert(id)` (sets `resolved_at`) |
| `api/reviewInbox.js` | `getReviewInbox({ status, packageName, limit })` — `raw_notifications` where `parse_status IN ('failed','needs_review')`; `getReviewPackages()` exists but unused currently |
| `utils/format.js` | Currency formatting (`formatMoney`), date formatting (`formatDateTime`, `toDateTimeLocal`, `fromDateTimeLocal`) — all pinned to `Asia/Kuala_Lumpur`. Module-level mutable state: `SYMBOLS` map + `CURRENCY_OPTIONS` array, updated at runtime from the `currencies` DB table via `setCurrencySymbols()` |
| `utils/fx.js` | `convert(amount, base, quote, date?)` — Frankfurter API (`api.frankfurter.dev/v2`). With a date it freezes the rate at the transaction's own date (ADR 0003); without one it uses the latest rate. Returns `null` (never throws) on unavailable rates (ADR 0001). **Historical (dated) rates persist to `sessionStorage`** (survive refresh; undated "latest" stay in-memory so they never go stale) and in-flight requests are deduped so parallel `convert()` calls for the same (pair, date) share one HTTP request |
| `components/common.js` | `alertBanner`, `emptyState`, `badge`, `confirmDelete` — pure DOM builders, no API calls |
| `components/transactionTable.js` | The largest component. Renders a full `<table>` in two modes (read-only / edit). Internally: `draftFor()`, per-cell builders (date, receiver, category, amount, MYR, sent from, notes, actions), `normalizeDraft()` (diffs draft vs. original, returns only changed fields as a Supabase-ready patch object), and `onDirty(id, patch)` so the view accumulates edits and saves them when edit mode toggles off — no per-row Save buttons. The action column, in **edit mode only**, holds a 🔁 recurring toggle and the delete red-cross. Rows carry `data-tx-id` and cells `data-col` so a save can patch one cell in place without a re-render |
| `components/accountManager.js` | Accounts list/form (cash/checking/savings/credit/**debit card**/e-wallet/virtual/investment), colour swatches with names, duplicate-name handling, sort-order hint, and **Sent-from grouping** — assign every transaction carrying one `source_app_label` to an account at once |
| `components/categoryManager.js` | Category tree — add/edit/delete with an optional parent (cycle-guarded), icon and colour; friendly errors when a category is still in use or has children |
| `components/exportDialog.js` | Export dialog — month + scope (all / spending / money in); fetches fresh, converts MYR at each row's date, respects transfer pairs, downloads `transactions_<month>_<scope>.csv` |
| `components/tagManager.js` | Tag groups + tags manager, colour swatches |
| `components/budgetManager.js` | Overall + per-category budget manager |
| `utils/categories.js` | Category ordering (alphabetical, catch-all `Other` pinned last), `categoryNameMap`, tree builder |
| `utils/colors.js` | Colour presets + `colorName`/`colorSwatches` shared by accounts, categories and tags — the UI shows names and swatches, never hex |
| `utils/csv.js` | `buildTransactionsCsv` / `downloadCsvFile` — escaping, BOM, pair-aware labels |
| `utils/icons.js` | Inline SVG icon set used by the sidebar and header buttons |
| `utils/months.js` | Malaysia-time calendar-month helpers (`currentMonthKey`, `monthRows`, month bounds/labels) |
| `views/authGate.js` | Login/signup form — centered Bootstrap card, email+password, toggles between sign-in and sign-up modes. Handles email-confirmation-required flow |
| `views/dashboard.js` | The main view. Fetches **full history** (`getAllTransactions()`), categories, heartbeat, alerts, currencies, tag groups, accounts and budgets in parallel via `Promise.all`, then scopes everything to a **calendar month in Malaysia time** (`Asia/Kuala_Lumpur`): a month bar (‹ / month label / › + native `<input type="month">` + "This month") picks the month and re-renders from the already-loaded history — no refetch — flushing pending edit-mode rows first. Tiles, the per-day spend trend (zero-filled day 1 → today, or month-end for other months), category share, budgets and the tables all read the selected month; a muted month-over-month line shows deltas under the tiles. Account balances/asset composition still use full history. Splits into debits ("Spending") + credits ("Money in"), converting each to MYR via `convert()` in parallel (`Promise.allSettled`) with the rate frozen at the transaction's own date (ADR 0003). Edit mode: switch in the header → all rows inline-editable; edits accumulate per-row and are PATCHed in one batch when toggled **off** (and flushed on navigation). **Export** now lives in the sidebar and opens a month + scope dialog (`transactions_<month>_<scope>.csv`); the header carries icon buttons for Add from text / Move money. A write patches the loaded payload with the returned row(s), re-renders from memory, and restores scroll + focus — no refetch, no remount. Shows heartbeat offline banner (>6h stale) and server-side alert banners |
| `views/reviewInbox.js` | Filterable table (All / Failed / Needs review) of `raw_notifications` with `parse_status` failures. Shows sanitized text (prefers `big_text` > `text_body` > `sub_text`), redaction badges (otp=red, balance=yellow, account=gray), parse error note |
| `views/rawNotifications.js` | `#/raw` — read-only, paginated (50/page) `raw_notifications` audit view |

**Implemented features:**
- **Auth gate** — email/password sign-in + sign-up with email confirmation flow.
- **Transaction table** — read-only mode (Date, Receiver, Category, Amount, MYR, Sent from, Notes) and edit mode (all cells become inline inputs: `<input type="datetime-local">`, receiver raw merchant text, category `<select>`, amount number + currency `<select>` + direction `<select>`, notes `<textarea>` with 255-char limit, no visible counter).
- **MYR FX conversion** — every non-MYR transaction converted via Frankfurter using the **historical rate frozen at the transaction's own date** (ADR 0003), so past rows don't drift as live rates move; unavailable historical rates degrade to showing the original amount (never throws). Skipped-rate info banner shown when counts > 0.
- **Split view** — debits shown under "Spending", credits under "Money in" (separate tables if any credits exist).
- **Edit mode** — the header switch enables inline per-cell editing on all rows. The Receiver cell edits only `merchant_raw` (raw text). `normalizeDraft()` diffs each draft against the original. **No per-row Save** — edits accumulate and are PATCHed in one batch when edit mode is toggled off (also flushed on navigation so edits are never silently dropped). Delete is the only per-row destructive action, gated behind `window.confirm()` via a red-cross image button (`web/public/red-cross-mark.png`). Table columns read **Receiver** / **Sent from**.
- **`status` is deliberately not user-editable** — the status dropdown was removed as useless to the owner; `status` stays a DB column, written only by the parse layer.
- **Heartbeat offline banner** — shows warning when `device_heartbeat.last_seen_at` is >6 hours old, with "Xh ago" text.
- **Dashboard alerts** — server-side alerts from `dashboard_alerts` table rendered as dismissible Bootstrap banners; severity `critical` maps to `alert-danger`.
- **Currencies are a DB reference table** (`currencies`, migration `202608300003`, GRANT+RLS read policy). The app reads it at runtime (`api/currencies.js` → `setCurrencySymbols`/`currencyOptions` in `utils/format.js`) to build the edit dropdown + display symbols, with built-in fallbacks. **Adding a currency = one `INSERT`, no app release.** v1: MYR, CNY, TWD, USD, SGD.
- **Credit-side categories + merchant rules** (migrations `202608300001`/`202608300002`): Salary, Transfers, Refunds, Cashback & Rewards, Investments/Interest, Gifts + recognizable incoming-sender rules. P2P receives carry the sender's *name* as merchant (e.g. TnG "HOO JET YUNG"), which no generic rule matches — set by hand in edit mode.
- **Review inbox** — filterable table of failed/needs_review `raw_notifications`, showing sanitized notification text, redaction badges, parse errors. Safety valve for unrecognized formats.
- **Client-side error logging** — all uncaught errors and API failures auto-captured to IndexedDB CSV logs for offline inspection.
- **Manual recurring flag** (`transactions.is_recurring`, migration `202609020001`) — a 🔁 toggle in the **edit-mode** action column only (no auto-detection). Visible nowhere on read-only rows. The generic `updateTransaction(id, patch)` PATCHes it; no new mutation needed.
- **CSV export** — **Export** in the sidebar opens a dialog: calendar month + scope (all / spending / money in) → `transactions_<month>_<scope>.csv` with columns Date, Receiver, Category, Amount, Currency, MYR, Direction, Sent from, Recurring, Notes. It fetches fresh, freezes MYR at each row's own date, shows transfer rows as an `A → B` pair, and filters transfers out of the single-sided scopes so they aren't double-counted. UTF-8 BOM so Excel opens it cleanly; fields are CSV-escaped (quotes/comma/newline).
- **FX polish** — historical rates persist to `sessionStorage` (survive refresh; undated "latest" stay in-memory-only so they never go stale) and in-flight `convert()` calls are deduped per (pair, date), so the dashboard's parallel MYR loop (`Promise.allSettled`) fires one HTTP request per distinct rate instead of N.
- **Monthly grouping (2026-11-14)** — every dashboard figure is scoped to a **calendar month in Malaysia time** (`Asia/Kuala_Lumpur`, UTC+8) instead of the old rolling 30-day window: income/spent/net tiles, the per-day spend trend, category share, budget bars and both tables. The month bar (‹ / label / ›, native `<input type="month">`, "This month") re-renders from the already-loaded full history (no refetch) and flushes pending edit-mode rows first; a month-over-month delta line sits under the tiles ("no data" with no baseline). The trend stays per-day inside the month and is zero-filled day 1 → today (current month) or month-end. Labels are month-neutral (`Spent (MYR)`, `Category share`, `Budgets · <Month Year>`), `getLocale()` keeps the month label locale-aware, and an empty month shows "No transactions in <Month Year>". Covered by the month-scoping test in `web/tests/dashboard.spec.js` (fixtures anchored inside MYT months).
- **Amounts are strictly positive (2026-11-14)** — a transaction is never RM 0.00. `check (amount > 0)` → `transactions_amount_positive` (migration `202611140001`); `parse_raw_notification` marks a `<= 0` amount `ignored` (`'non-positive amount'`) instead of writing a row and marks a non-numeric amount `failed`; `trigger_parse_raw_notification` wraps the parser in `exception when others` so a parser/CHECK error can never lose the capture; web `updateTransaction`/`insertTransaction`/`insertTransfer` reject non-positive amounts, the edit-mode amount cell has `min="0.01"` + an inline `is-invalid` flag, and the dormant Edge Function's `parseAmount` returns `null` for `<= 0`. Existing zero rows are cleaned by the migration (phantom transaction deleted, raw row kept and flipped to `ignored`). See `REPARSING.md` → "Amounts are never zero".
- **Navigation + management UI batch (2026-11-16)** — the dashboard header became a compact toolbar and the manage/export actions moved into a **collapsible sidebar**:
  - **Sidebar** — Dashboard / Reports / Review / Raw links, with Tags · Accounts · Categories · Budgets · Export under Dashboard. Collapses to icons; the state persists in `localStorage` (`mt_sidebar_collapsed`). Inline SVG icons (`utils/icons.js`), no icon font.
  - **Header** — "Add from text" and "Move money" are now **icon buttons**; Edit mode is a **switch** (`role="switch"`, `aria-checked`) instead of a text button.
  - **Category manager** (`components/categoryManager.js`, new) — add/edit/delete categories with an optional parent (cycle-guarded), icon and colour. Category dropdowns everywhere are alphabetical with the catch-all **`Other` last**, and the inline empty-category picker now reads **“—— Pick ——”**. Adds **Entertainment / Subscription / Household** categories.
  - **Accounts** — new **debit-card** type, colour picker that shows **names + swatches, never hex**, and **Sent-from grouping**: transactions are grouped by their `source_app_label` and a whole label can be assigned to an account in one action (`assignSourceRows`). New `source_account_map` makes the parser prefer the label over the package default.
  - **Export** — now a sidebar dialog: pick a calendar month + scope (all / spending / money in) → `transactions_<month>_<scope>.csv` with pair-aware transfer labels and MYR frozen at each row's date.
  - **Raw notifications** (`views/rawNotifications.js`, new) — read-only paginated (`#/raw`, 50/page) audit view over `raw_notifications`, newest first.
  - **SPA-style saves** — a write no longer refetches or remounts the view. The dashboard patches its loaded payload with the row(s) the API returns, re-renders from memory, restores scroll position + focus, and inline pickers update just the affected cell (`tr[data-tx-id] td[data-col]`). Sidebar managers dispatch `mt:data-changed`, which reloads the dashboard only while it is mounted.
  - **British spelling** throughout the English UI ("Colour", "Grey"). DB columns and internal identifiers keep `color`.

**Architecture principle (`ARCHITECTURE.md` §5):** No SPA framework yet. Plain ES modules + small render functions + thin `/api` layer. *"If UI complexity outgrows this (once charts/budgets/PWA land), the honest next step is a lightweight reactive layer (Preact or Alpine.js) rather than jumping straight to React."* Revisit at that point, not now.

**Testing:** Playwright e2e suites (`auth`, `dashboard`, `budgets`, `reports`, `ai`, `logger`) — run via `npm run test:e2e`; 35/35 pass against a local `vite preview` build. ESLint is clean. (Note: Playwright's build+preview `webServer` teardown can hang on Windows — run against an already-running preview with a config that sets `webServer: undefined`.)

## Key decisions made this session (AGENTS.md §15)
- No automated cross-app dedup — an e-wallet + its underlying card both notify the same real transfer; the owner deletes the duplicate in edit mode instead.
- FX provider: **Frankfurter** (`docs/adr/0001-fx-api-provider.md`); unavailable rates degrade to the original amount. Rate now **frozen at each transaction's date** (ADR 0003) instead of recomputed live.
- Cashback decision (2026-09-02): TnG reward/cashback pushes stay `ignored` — deliberately not treated as income; `cashback` stays in the `reject_pattern`.
- Auth session lifecycle: access tokens are short-lived JWTs; the Android app caches the full session, maps 401/403 to `UnauthorizedException` that clears stale tokens (`docs/adr/0002-auth-session-lifecycle.md`).
- Parsing lives in Postgres on the free tier, not an Edge Function.
- Dashboard figures are grouped by **calendar month in Malaysia time** (not a rolling 30-day window), switchable from a month bar; month switching re-renders from already-loaded history.
- A transaction amount is **always > 0** — enforced by the parser (non-positive → `ignored`), the DB CHECK `transactions_amount_positive`, and the web API/edit-mode guards; zero-amount notifications are not transactions.
- **Category dropdowns sort alphabetically with `Other` last**, and categories are now editable from a sidebar manager; `categories` is shared reference data (no `user_id`), so the write grant is explicitly single-user-only.
- **Sent-from resolves label first, then package** (`source_account_map` → `package_account_map` → unassigned), so one app can notify for several cards and each label can map to its own account.
- **Saves are in-memory and targeted** — the dashboard patches its loaded payload with the returned rows and re-renders from memory (scroll and focus preserved), rather than refetching the whole history.

## Supabase migrations (SQL Editor) — status
- `202608180002_db_parser_field_map.sql`, `202608180003_db_parser_infra.sql`, `202608180004_seed_templates.sql` — **applied live** (parsing verified).
- `202608300001_seed_credit_categories.sql`, `202608300002_seed_credit_merchant_rules.sql`, `202608300003_seed_currencies.sql` — **applied live** (user ran them).
- `202609010001_outbound_templates_and_resync.sql`, `202609010002_samsung_source_label.sql`, `202609010003_tng_transferred_leading_amount.sql`, `202609010004_parse_spike_includes_needs_review.sql`, `202609010005_reject_marketing.sql` — **applied live** (user ran them).
- `202609020001_add_recurring_flag.sql` — **applied live** (the dashboard selects `is_recurring`).
- `202611140001_amount_must_be_positive.sql` — **NOT yet applied** — adds `check (amount > 0)` (`transactions_amount_positive`), the parser's non-positive-amount guard, the hardened parse trigger, and the cleanup of existing zero/negative rows. Run in SQL Editor; the deploy of the web app does **not** apply it. The file's header carries the diagnostic query to inspect the affected rows before the cleanup deletes the phantom transactions.
- `202611160001_categories_and_debit_card.sql` — **NOT yet applied** — idempotent **Entertainment / Subscription / Household** categories, a `GRANT` + write policy so the web category manager can write to `categories` (single-user caveat in the file header), and the `accounts.type` check constraint widened for **`debit_card`**. Until it runs, adding categories from the UI and saving a debit-card account both fail.
- `202611160002_source_account_map.sql` — **NOT yet applied** — creates `source_account_map` (owner-scoped, GRANT + RLS) and refreshes `parse_raw_notification` to resolve **Sent-from label first, package second**, carrying forward the `amount > 0` guard. Until it runs, assigning a Sent-from label still writes transactions, but new parses resolve by package only.

## Verification status
| Subsystem | Result |
|---|---|
| Capture → sync → parse → display | ✅ verified live (TnG, CIMB, Wise) |
| TnG outbound + Samsung merchant/category parse | ✅ re-parsed, merchants/categories resolved — except one Samsung row still showing Sent from "Samsung Wallet" pending the targeted re-run in §What's next |
| Web: auth gate | ✅ email/password sign-in + sign-up with email confirmation |
| Web: dashboard (read-only) | ✅ debits/credits split, MYR FX conversion (frozen at transaction date), heartbeat banner, alert banners, currency symbols from DB |
| Web: edit mode (inline) | ✅ date, receiver (raw merchant text only), category dropdown, amount/currency/direction (amount must be > 0 — `min="0.01"` + inline flag; the API refuses a zero), notes (255-char, no counter), auto-save on toggle-off, red-cross Delete |
| Web: monthly grouping | ✅ calendar-month scoping (MYT) for tiles/trend/category share/budgets/tables + month bar and month-over-month line — e2e-verified, deployed |
| Amounts strictly positive | ⏳ web-side guards live; the DB CHECK + parser guard land with `202611140001` (run in SQL Editor) |
| Web: recurring flag + CSV export | ✅ 🔁 toggle in edit mode; sidebar Export dialog (month + scope) → `transactions_<month>_<scope>.csv` |
| Web: sidebar + header toolbar | ✅ collapsible sidebar (persisted), sidebar-hosted managers/export, icon buttons, edit-mode switch |
| Web: category manager + `debit_card` + Sent-from mapping | ⏳ UI, lint/build and e2e pass; writes need `202611160001` (categories grant, debit-card type) and label mapping needs `202611160002` — run both in SQL Editor |
| Web: Raw notifications page | ✅ read-only, paginated (`#/raw`, 50/page) |
| Web: review inbox | ✅ filterable table (All/Failed/Needs review), redaction badges, parse error display |
| Web: client-side logging | ✅ IndexedDB-backed CSV auto-logger, error + unhandledrejection hooks |
| Web: ESLint + build | ✅ clean |
| Web: Playwright e2e | ✅ 35/35 tests across 6 spec files (auth, dashboard, budgets, reports, ai, logger) |
| Android | ✅ built + installed by the user; capture verified |

## What's next
1. **Run the pending migrations in SQL Editor** — `202611140001` (positive amounts), `202611160001` (Entertainment/Subscription/Household, categories write grant, `debit_card` type), `202611160002` (`source_account_map` + label-first parser). Nothing deploys them automatically. Then create a `debit_card` account, add a category from the manager, and assign a Sent-from label to confirm the two new write paths.
2. **Targeted Samsung re-parse** so Sent from renders "Samsung Wallet - HLB Debit Card": `update raw_notifications set parse_status='pending' where linked_transaction_id='0316042e-2c2e-4a81-90cf-974069c267f2'; select backfill_resync();` (the row is now `success`, so `backfill_resync()` won't pick it up automatically). Running `202611160002` also re-parses with label precedence — assign the label to its account first so the new rows land correctly.
3. **More parser templates / more apps** — TnG, CIMB, Wise, and HLB Connect are live. Wise uses amount-first format (`25.90 MYR spent at Apple`), which the loose fallback missed; a Wise v1 template was added (migration `202609080001`). HLB Connect (`my.com.hongleongconnect.mobileconnect`) was added to the Android capture allow-list — its `parser_templates` still need building from real samples, and an HLB card spend may now notify twice (HLB app + Samsung Wallet), expect the rare duplicate to delete by hand. Adding more banks/wallets still needs real captured samples first (AGENTS.md §14 rollout).
4. **Validate the redaction regex library** (§8) against real samples — still an open TODO.
5. **Grow the regression fixtures** — the harness (`supabase/scripts/replay-templates.ts`, run in `supabase.yml` CI) works, but `fixtures/templates.json` still holds placeholder samples (TnG v1 + CIMB v1). Export real sanitized captures for the live formats (TnG v2–v6, Samsung, Wise, CIMB v2, HLB Connect) into it so the harness actually guards them. Note the fixture file uses JS named-group patterns while the live PL/pgSQL templates use positional groups + `field_map`, so DB rows are not a drop-in.
6. **Still-later scope (deferred by design)** — subscription *auto*-detection. Budgets, charts/reports, PWA install, dark mode, tags, accounts/transfers, recurring entries, category management, the raw-notification log and the sidebar shell are done. Until `202611140001` is applied, the parser can still create a zero-amount row for a `0.00`-only notification (the web-side guards are already live).

## Conventions that gate future work
- A changed `body_pattern` is a **new** `parser_templates` row (version+1), never an in-place edit — replayed against every `sample_input` first.
- `raw_notifications` re-parsing uses `select backfill_resync();` — it resets `failed`/`needs_review`, never `success` (so manual edits aren't clobbered); flip a specific `success` row to `pending` by hand to reprocess just that one.
- `raw_notifications` rows are never deleted and text never mutated post-insert (only `parse_status`/`parse_error`/`parser_template_id`/`linked_transaction_id` change).
- No `service_role` key in the Android app, ever.
- A new bank/e-wallet = a new template row, never per-package `if` in app code.
- `onNotificationPosted()` stays a fast synchronous write.
- Every new table = matching `GRANT` + RLS policy in the same migration (§17).
- Undecided: whether the diagnostic `2a–2e / 3 / 4 / DIAGNOSTIC` scratch SQL + `results.txt` stay as reference or get gitignored (committing them costs no extra Netlify build minutes; Netlify builds only on push to the deployed branch, and `supabase/` isn't in the deploy path anyway).
