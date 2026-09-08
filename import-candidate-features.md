# Import Candidate Features

Features harvested from two open-source projects

---

https://github.com/TNT-Likely/BeeCount/tree/main
https://github.com/mayswind/ezbookkeeping

## Licensing notes

| Project | License | Can we copy code? |
|---|---|---|
| **BeeCount** (`TNT-Likely/BeeCount`) | **Business Source License (BSL)** | Free for **personal / learning / OSS contribution** — NOT for commercial use. Money_Tracker appears to be personal, so borrowing *ideas* is fine; only copy/reuse code if you are 100% sure there's no commercial intent, and even then read `COMMERCIAL_LICENSE.md`. Also BeeCount is **Flutter/Dart**, your Android app is Kotlin + web is JS — so most things would be *reimplemented* rather than copied anyway. |
| **ezBookkeeping** (`mayswind/ezbookkeeping`) | **MIT** | Free to copy/adapt code. Golang + Vue backend; web logic (import parsers, MCP, charts) is the most portable to your JS web dashboard. |

we can copy all of them since it is self use

---

# Part 1 — BeeCount

Platform: Flutter app (Android/iOS) + self-hosted cloud. Local-first. Below = every feature found
in the source (`lib/`, `android/`, `pubspec.yaml`).

## A. Capture / input channels
- [ ] **AI chat / natural-language bookkeeping** — type/produce one sentence, AI parses into a transaction ("买菜花了50").
- [ ] **Voice capture** — hold-to-talk, speech-to-text → parse to a bill.
- [ ] **Image attachments on transactions** — attach the source image to each bill, preview page. (compress to below 2mb and never store to cloud, only local)
- [ ] **App Links deep linking** / quick actions.

## B. AI layer
- [ ] **Multi-provider AI factory** — provider-agnostic (GLM, OpenAI-style, vision, speech) with config UI.
- [ ] **AI privacy consent gate** — explicit consent before sending data to an LLM provider (⚠ relevant to our §8 sanitization constraints).
- [ ] **AI prompt builder with context injection** (categories/accounts/time injected into prompt).
- [ ] **JSON5-tolerant response parser** with sanitize fallbacks (amount=required, time=soft default now()).
- [ ] **Auto category / account / tag matching** from AI result (keyword dictionary → category).

## C. Bookkeeping model
- [ ] **Multi-ledger** — separate ledgers (life/work/investment), each with own currency.
- [ ] **Multi-account** — cash / card / credit; **transfer auto-updates both balances**.
- [ ] **Two-tier (parent-child) categories**.
- [ ] **Budgets** — total + per-category, overspending alerts, progress bars.
- [ ] **Recurring / scheduled transactions** — daily/weekly/monthly/yearly auto-records.
- [ ] **Tags** — multiple tags, color labels, filtering.
- [ ] **Note / description history** (`note_history`).
- [ ] **Custom icons / avatar** for categories & accounts.

## D. Analytics / reports
- [ ] **Charts** (fl_chart) — monthly reports, category rankings, trends.
- [ ] **Annual report** page.
- [ ] **Net-worth trend** page.
- [ ] **Calendar view** with daily totals / heatmap.
- [ ] **Shareable poster / visual share** of stats.

## E. Sync / cloud
- [ ] **Supabase** sync.
- [ ] **Sync conflict resolution / change tracking / device list**.

## F. Import / export

## G. Android platform features
- [ ] **Home-screen widgets** (6 types × 12 variants: overview / net assets / quick add / budget / recent / dashboard) — Kotlin `Glance`/`AppWidgetProvider`.
- [ ] **Notification receivers / foreground service / boot receiver**.
- [ ] **Battery-optimization exemption request** (`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`).
- [ ] **Auto-update / in-app update** flow.
- [ ] **Reminder / notification scheduling**.

## H. UI / UX
- [ ] **Dark mode** (OLED-friendly pure black).
- [ ] **Multi-language** (zh/en).
- [ ] **Theme / accent-color customization + header skins**.
- [ ] **Font-size / UI-scale settings**.
- [ ] **Settings screens**: storage mgmt, log center, data mgmt, orphan cleanup.

---

# Part 2 — ezBookkeeping

Platform: Golang backend + Vue (separate desktop/mobile UI), MIT. Every feature found in source.

## A. Transaction data model
- [ ] **Types**: Expense / Income / **Transfer** (separate source & destination amounts, enabling cross-currency) / Balance Modification.
- [ ] **Source + destination account & amount** on transfers.
- [ ] **Primary + secondary (parent/sub) category**.
- [ ] **Multiple tags** per transaction.
- [ ] **Comments / notes**.
- [ ] **Hide-amount flag** (privacy).
- [ ] **Image attachments** per transaction (configurable max size).

## B. Transaction operations / listing
- [ ] Batch delete / batch update category / batch update account / batch add-remove-clear tags.
- [ ] **Move all transactions between accounts** (migration).
- [ ] **Auto-save draft**.
- [ ] **Quick save button** (position configurable) + quick-add actions.
- [ ] **Edit scope restrictions** (None/All/Today+/24h+/This Week+/Month+/Year+/Last-Reconciled+).
- [ ] **Duplicate submission protection**.
- [ ] Rich filters: type, categories, accounts, tags (has-any/all/not), amount range, keyword search, must-have-pictures, show/hide tags, show total.
- [ ] **Calendar view** (heatmap + per-day grouping).
- [ ] **Gallery view**.

## C. Transaction templates / scheduled
- [ ] **Normal templates** — reusable quick-create presets.
- [ ] **Scheduled templates** — recurring daily/every-N-days/weekly/monthly/yearly, cron-driven auto-creation.

## D. Accounts
- [ ] 9 account types: Cash / Checking / Savings / Credit Card / Virtual / Debt / Receivables / Certificate of Deposit / Investment.
- [ ] Single-type account + **multi-currency account group** (sub-accounts).
- [ ] Per-account currency (any ISO 4217), custom icon/color, initial balance, credit-card statement date, last reconciled time, drag-to-reorder, show/hide.
- [ ] **Account balance trend charts** (area/column/boxplot/candlestick).
- [ ] **Reconciliation statements** (opening/closing balance, inflows/outflows).

## E. Categories
- [ ] Income / expense / transfer category sets; hierarchical; custom icon/color/comment/order/show-hide.
- [ ] **Batch preset category creation** per locale.

## F. Tags
- [ ] Flat tags organized in **tag groups**; multiple per txn; tag-based filtering; exported with transactions.

## G. Insights Explorer (powerful query engine)
- [ ] Saveable named queries; AND/OR/parenthesized condition builder.
- [ ] 17 condition field types (time-of-day, day-of-week/month, timezone, type, category, source/dest account, amount, geo box, tag, pictures, description).
- [ ] Many operators (in/not-in/contains/between/is-empty…).
- [ ] Chart dimensions + value metrics (count, sum, income, expense, net, savings rate, avg, median, percentiles, std-dev, Gini, HHI, outlier stats, top-5 share…).
- [ ] Result as chart / data table / **editable** data table.
- [ ] Batch ops from explorer; import/export queries.

## H. Dashboard (desktop, fully customizable widgets)
- [ ] Widgets: asset summary, period stats, calendar, calendar heatmap, expense category ranking, account balance list, monthly expense overview, monthly expense progress, income/expense trend, net-assets trend, period income/expense, net income & savings rate, recent transactions.
- [ ] **Drag-and-drop widget layout**, per-widget filters, desktop & mobile layouts.

## I. Analytics charts
- [ ] Pie / Bar / Radar, Area / Column / Bubble trends.
- [ ] **Hierarchy (Treemap / Sunburst)**, **Sankey** (account→category flow), **Calendar heatmap** (yearly + custom range), **Monthly income/expense**, **account balance trends**.
- [ ] 18 analytics dimensions + multiple value metrics.
- [ ] Custom color schemes / picker, timezone selection, data-range presets.


## K. Import (24+ formats)
- [ ] ezBookkeeping CSV/TSV/JSON, **OFX, QFX, QIF, IIF, CAMT.052, CAMT.053, MT940, GnuCash, Firefly III, Beancount, Feidee, Alipay app/web CSV, WeChat Pay XLSX/CSV, JD.com CSV**.
- [ ] **AI text recognition import** (paste freeform text → LLM extracts transactions).
- [ ] **AI image/receipt recognition import** (upload image → LLM extracts).
- [ ] **Custom CSV/TSV/SSV/XLS/XLSX with column mapping** (14 mappable column types).
- [ ] Auto-detection of encoding (50+), date format, timezone, amount format, decimal/grouping; header toggles; type-name mapping; **replace rules**; mapping JSON import/export; step-by-step import wizard + review.

## L. Export
- [ ] **CSV / TSV / SSV / Markdown table**; **Mermaid** (pie / XY bar / XY line chart code); **JSON** (full raw dump of txns/categories/tags/accounts/templates/explorers).
- [ ] Filter-based export; copy / download / preview before export.

## M. AI / LLM integration
- [ ] **10 LLM providers**: OpenAI (+compat, responses), Anthropic (+compat), OpenRouter, Ollama, LM Studio, Google AI/Gemini.
- [ ] **Text recognition** + **image/receipt recognition** (separate provider/model per mode).
- [ ] Configurable thinking mode, max tokens, proxy, extra prompt, dry-run, require-confirm.

## N. MCP server (Model Context Protocol)
- [ ] **7 MCP tools**: add_transaction (dry-run), query_transactions, list accounts, account balances, list categories, list tags, latest exchange rates.
- [ ] **IP-based access control**; HTTP server mode; schema generation.
  - ⚠ Both projects do MCP. For Supabase, SupaMCP gives this near-free.

## O. Security / auth
provide new user register account, forgot password, change password etc

## R. UI / UX / i18n
- [ ] Separate desktop (Vuetify) & mobile (Framework7) interfaces.
- [ ] Dark/light/auto theme, font size, RTL.
- [ ] Date/time format, first-day-of-week, fiscal-year start.
- [ ] **PWA** support.
- [ ] Preview gallery for transaction pictures; custom uploaded icons.

## S. System / ops
- [ ] Health endpoint, request IDs, structured logging (console/file, rotation), SQL query log.
- [ ] GZip, CORS, trusted proxy, HTTP/HTTPS/Unix socket.
- [ ] Docker + build scripts; cron jobs (token cleanup, scheduled txn creation).

---

# Quick comparison to Money_Tracker (what we already have)

Already in Money_Tracker (from AGENTS.md / ARCHITECTURE.md):
- Notification-capture pipeline (listener + Room + WorkManager sync), idempotent sync (client_uuid), near-dup (content_hash).
- Regex-template parsing (parser_templates) server-side in Postgres trigger; `reject_pattern`; review inbox.
- On-device sanitization/redaction (§8).
- Multi-currency (original amount+currency stored; FX unified to MYR in UI, Frankfurter historical-at-date).
- Categories (incl. credit side), merchant_rules, device_heartbeat.
- Manual edit mode with batch PATCH, delete, CSV export, recurring flag (manual), MYR/fx polish, currencies reference table.
- Supabase Auth + RLS.

So the "new" things these two projects add (candidate gaps):
1. **Import** (CSV column-mapped, bank/wallet formats, AI text/image) — ezBookkeeping MIT, high value, fills the "no backfill before listener" gap. ✅ biggest gap-filler.
2. **MCP server** over Supabase — both do it; near-turnkey via SupaMCP.
3. **Charts / analytics / Insights Explorer** — richer than our current list; deferred in our plan.
4. **Multi-account + transfer model** — schema + app change; big; conflicts with current simplicity.
5. **AI text/image/voice capture + LLM parsing** — new capture paths; tension with notification-only scope AND §8 privacy (third-party LLM exposure).
6. **Scheduled/recurring auto-entry** — extends our manual is_recurring flag.
7. **Budgets** — on our "later" list.
8. **Tags, 2FA, app-lock/PIN, PWA, dark mode** — lighter wins.
9. **Screenshot OCR auto-capture** — biggest scope change; recommend skip given no-double-count constraint.

---

# Part 3 — Integration plan

> ⚠ **STALE AS OF THE CODEBASE AUDIT (2026-09-09).** This section was written before
> Phase A–F shipped. Many "✅ adopt" and "⏸ defer" items are **already built** in the current
> codebase (see the reconciliation in Part 4). Read Part 4 first; the verdicts below that still
> hold are called out there. The raw `- [ ]` checkboxes in Parts 1–2 remain the TODO list; Part 4
> marks each one done/new/deferred/skip.

Verdict legend: ✅ adopt · ➕ extra (cheap, additive) · ⏸ defer · ❌ skip (flagged why)

## 1. Feature verdicts + feasibility

### 1.1 AI capture channels

| Feature | Verdict | Notes |
|---|---|---|
| **AI chat / NL bookkeeping** | ✅ DONE | `web/src/components/nlModal.js` + `web/src/utils/ai.js` `parseTransactionText` — freeform sentence → one transaction, context-injected prompt (`utils/prompts.js`), JSON5-tolerant parse (`utils/json5.js`). |
| **Voice capture** | ✅ web-half DONE / ⏸ Android half | Web 🎤 click-to-talk in the NL modal (`hookUpVoice`, Web Speech API, `en-US`) shipped (commit `ed33a10`, `4fe7ab7`, `fff8d6d`). Only the **Android `SpeechRecognizer`** half (full on-phone voice) remains deferred. |
| **Image attachments** | ⚠ blocked | Unchanged — see Open Q1 (needs your call on private Supabase Storage bucket vs. drop). |
| **App Links deep linking** | ➕ extra | Android `<intent-filter>` + URL scheme; a few hundred lines, no refactor. Low urgency. Still open. |
| **needs_review → LLM escalation** | ✅ DONE | `web/src/views/reviewInbox.js` per-row Ask AI → `parseNotificationTransaction` (`utils/ai.js`), preview-then-apply, dashboard-side with your own free-tier key (Q2 in Part 3 was resolved: dashboard-side, key in localStorage, matches `utils/llm.js`). |

### 1.2 AI infrastructure (BeeCount B)

| Feature | Verdict | Notes |
|---|---|---|
| Multi-provider AI factory | 🚫 WON'T DO | BeeCount's 5-provider abstraction is real work and you have no provider preference. `utils/llm.js` is a ~40-line single-Gemini wrapper with dead-model auto-fallback — exactly the "thin interface" the plan wanted. Keep as-is. |
| AI privacy consent gate | ➕ optional | You've deprioritized §8 for convenience, so a versioned consent screen is skippable. Revisit ONLY if we add image-receipt recognition (a receipt image sent to a third-party LLM is a new privacy surface — see Open Q2). |
| AI prompt builder + context injection | ✅ DONE | `web/src/utils/prompts.js` (`buildNlPrompt`, `buildEscalationPrompt`) injects categories + currency options. Pattern matches ezBookkeeping's `templates/prompt/*`. |
| JSON5-tolerant response parser | ✅ DONE | `web/src/utils/json5.js` `extractJsonObject` (tolerant parse) + `ai.js` `normalize()` (amount required, date defaults to now). |
| Auto category matching from AI result | ✅ DONE | `ai.js` `categoryIdForName` (LLM returns a category name from the offered list) AND server-side `merchant_rules` resolution. Both routes exist. |

### 1.3 Auth (your note under ez §O)

| Feature | Verdict | Notes |
|---|---|---|
| Register account | ✅ DONE | `authGate.js` already has a sign-up mode (toggle). Supabase open signup is available whenever you want it. |
| Forgot password | ✅ DONE | `authGate.js` reset mode → `api/auth.js` `resetPassword` (`.resetPasswordForEmail`). |
| Change password | ✅ DONE | `components/settingsDialog.js` Account section → `api/auth.js` `updatePassword` (`.updateUser`). |

> Auth is therefore fully covered — nothing to build here. Optional future: 2FA (Supabase TOTP), but low value for a single user (§4 phasing flags it).

---

# Part 4 — Reconcile with the real codebase, migration/refactor check, feasibility & proposed phasing

**Audit date: 2026-09-09.** This section is the source of truth for what to actually build. It
(a) reconciles the checklist against what already shipped, (b) checks each *new* candidate for
migration/refactor needs, (c) gives a feasibility + free-tier verdict, and (d) proposes a phased
order. Nothing here is built yet — it's a plan to approve.

Legend (per item): ✅ **done** in tree · 🔨 **build** (cheap/additive) · 🟠 **needs migration + build** ·
💀 **skip / not feasible** (why) · ⏸ **defer**

## 4.1 What is already done (reconciled, nothing to build)

| Candidate | Status | Where |
|---|---|---|
| AI chat / NL bookkeeping (BeeCount A1, ez M) | ✅ done | `nlModal.js`, `utils/ai.js` `parseTransactionText` |
| Voice capture — **web** half (BeeCount A2) | ✅ done | `hookUpVoice` in `nlModal.js` |
| needs_review → LLM escalation | ✅ done | `reviewInbox.js` → `ai.js` `parseNotificationTransaction` |
| Register + forgot + change password (ez O) | ✅ done | `authGate.js`, `settingsDialog.js`, `api/auth.js` |
| AI prompt builder + context injection (BeeCount B3) | ✅ done | `utils/prompts.js` |
| JSON5-tolerant response parser (BeeCount B4) | ✅ done | `utils/json5.js` + `ai.js` `normalize()` |
| Auto category matching from AI (BeeCount B5) | ✅ done | `ai.js` `categoryIdForName` + server `merchant_rules` |
| Multi-language zh/en (BeeCount H2) | ✅ done | `lib/i18n.js` |
| Multi-provider AI factory (BeeCount B1) | 🚫 won't do | keep the thin `utils/llm.js` Gemini wrapper |
| CSV export (BeeCount F / ez L) | ✅ done | dashboard header button |
| Recurring **flag** (manual), FX cache/polish | ✅ done | `is_recurring`, `utils/fx.js` |

## 4.2 New candidates — migration / refactor check + feasibility

### Item A — AI freeform **text** import / capture (BeeCount A1, ez M) — ❗ OWNER DECISION 2026-09-09
- **DECISION**: CSV/TSV/**bank-format** import (the old "biggest gap-filler") is **DROPPED** —
  you don't want it (Q5). Multi-format parsers (OFX/QIF/MT940/Alipay/etc.) are **removed** (Q3).
  Image/receipt LLM import is **DROPPED** (Q2). The import formats question is deleted.
- **What remains**: **voice + AI freeform-text** capture — i.e. the NL "Add from text" modal (already
  built) plus the **Android** side of voice (`SpeechRecognizer`). "Text import" here means pasting
  freeform text into the existing NL path (already done on web); the only truly new build is
  **Android full voice** (the web voice half is done).
- **Migration?**: **None.** Text/voice capture writes *manual* transactions (no `raw_notification_id`),
  which `chk_manual_source` already allows (202609060003): `source_package='manual'`,
  `confidence='low'`. `authenticated` already has INSERT (owner_only, 202608180001) — **no new GRANT**.
- **Feasibility verdict**: 🔨 **build Android voice** (SpeechRecognizer → same `parseTransactionText`
  path); text import is already done on web.

### Item B — Tags (BeeCount C6, ez F) — cheap, high value
- **OWNER DECISION (2026-09-09)**: **tag groups** (hierarchical, ezBookkeeping model) with optional
  **color labels** per tag (BeeCount) — not a flat list.
- **Migration**: **YES** — `tag_groups` (or a self-referencing `parent_id`), `tags`
  (`group_id`, `color`, `user_id`), `transaction_tags` (M2M) — each with **GRANT + RLS** per AGENTS
  §17 (reference-style: SELECT for authenticated; transactions-owned: owner_only). Per-user + owner_only.
- **Refactor**: `transactionTable.js` edit-mode (grouped tag editor), `api/transactions.js` (embed
  tags via Supabase `*->tags` or a second query), FX/CSV export column. Moderate web-only.
- **Feasibility verdict**: 🟠 **build** (one migration + web).

### Item C — Budgets (BeeCount C4) — medium, no cron needed
- **Migration**: **YES** — a `budgets` table (category_id, period, amount). GRANT + RLS per §17.
- **Refactor**: dashboard progress bars; read-only computation of spend-to-date vs budget (no cron).
- **OWNER DECISION (2026-09-09)**: budgets surface as **inline progress bars** only — computed at
  display time, no `dashboard_alerts` banner (avoids the paid-tier Edge Function feeding that table).
- **Feasibility verdict**: 🟠 **build** — but lower priority than Tags/Dark/PWA.

### Item D — Dark mode (BeeCount H1) — cheap, no data
- **Migration**: none. **Refactor**: CSS variables + a `data-bs-theme` toggle in Bootstrap 5.3,
  persisted in `lib/settings.js`, i18n label. No tables.
- **Feasibility verdict**: 🔨 **build** (cheap win).

### Item E — PWA install (ez R) — cheap
- **Migration**: none. **Refactor**: add `manifest.webmanifest` + a tiny service worker to
  `web/public`, register in `main.js`. Already Netlify-served static. Note: the Alert/AGENTS
  "PWA install deferred" note is superseded — it's cheap to do now.
- **Feasibility verdict**: 🔨 **build** (cheap).

### Item F — Charts / analytics (BeeCount D, ez I) — medium, big optional
- **Migration**: none (reads existing `transactions`). **Refactor**: add a free chart lib
  (Chart.js MIT, or ECharts Apache-2.0) and a monthly trend + category-pie view. The full
  ezBookkeeping "Insights Explorer" (17 condition fields, 24+ metrics, editable result tables) is a
  **huge** build — recommend starting with 2–3 simple charts and deferring the explorer.
- **Feasibility verdict**: 🔨 **build (simple)** / ⏸ **full explorer deferred**.

### Item G — Home-screen widgets (BeeCount G1) — 💀/⏸ questionable fit
- **Refactor**: pure Android Kotlin (Glance / AppWidgetProvider). **Feasible**, but the Android app
  is a headless capture service with a nearly-empty `MainScreen.kt` — there's no app UI to mirror,
  and the data for "overview/net assets" lives behind Supabase (widgets would need a network fetch +
  cached Room data). 6 types × 12 variants is a big, low-urgency build for a capture-first app.
- **Feasibility verdict**: ⏸ **defer** (revisit only if you want the phone as a dashboard, not a
  capture device). Flagged as not-practical-now.

### Item H — Multi-account + transfer model (BeeCount C2, ez A/D) — ❗ OWNER DECISION: BUILD
- **DECISION 2026-09-09**: **build the full accounts + transfer model** (option 3 in 4.6). This is
  the largest item in the plan. Noted caveat: the notification pipeline *cannot* produce two-sided
  transfer rows (a notification names one app), so transfers will come only from manual/voice entry.
- **Migration**: **MAJOR** — a new `accounts` table (GRANT + RLS, §17), a nullable `account_id` on
  `transactions`, plus `source_account_id` + `destination_account_id` + a `transfer` direction.
  Ripples through the parse trigger, review inbox, manual/voice write path, edit mode, CSV export,
  FX, and dashboard totals. Plan as a dedicated phase; design the migration before writing it.

### Item I — Scheduled / recurring **auto-entry** (BeeCount C5, ez C2) — **free-tier constraint**
- **Constraint**: auto-recording needs a cron. Supabase **Free plan has no `pg_cron`** (it's a paid
  add-on) and scheduled Edge Functions are a paid tier feature. A web-side scheduler only runs while
  the dashboard is open (unreliable). The **Android WorkManager** already has periodic workers and
  *could* shoulder this (a worker that materializes due recurring rows) — that's the only free,
  always-on option, but it makes the *phone* — not the DB — the scheduler.
- **Feasibility verdict**: ⏸ **defer** unless you accept either (a) Android-workermaterialized
  entries, or (b) "materialize on dashboard open" (gaps when the app isn't visited). See Open Q4.

### Item J — Image attachments (BeeCount A3, ez A) — **DROPPED (owner decision 2026-09-09)**
- **DECISION**: dropped for now — the "local-only vs. cloud" conflict wasn't worth it (Q1). No build.
  (Revisit only if you later accept a private RLS-protected Supabase Storage bucket.)

### Item K — MCP server (BeeCount/ez N) — optional, near-turnkey
- **Feasibility**: SupaMCP gives this near-free against your existing Supabase. But it's a
  developer-facing capability — only useful if you run AI agents/editors against your own data.
  Zero code, a config step.
- **Feasibility verdict**: ➕ **extra, optional** — only on request.

### Item L — 2FA / app-lock-PIN (BeeCount G, ez O) — low value
- 2FA via Supabase TOTP is cheap; app-lock-PIN on a static site is cosmetic (localStorage isn't
  real security). **Feasibility verdict**: 🟠/💀 — 2FA optional/cheap; PIN skip (not real security).

### Item M — Settings: storage mgmt / log center / data mgmt / orphan cleanup (BeeCount H5)
- Storage & log center are relevant to the Android app (it's the one that stores data). Data mgmt
  (export/wipe) mostly maps to existing CSV export. Orphan cleanup = server-side check for txn
  rows with missing raw/linked refs. **Feasibility verdict**: 🔨 **build (Android storage/log)** /
  ⏸ data-mgmt polish.

## 4.3 Proposed phasing (owner decisions 2026-09-09: drop CSV import, drop image attachments; approve/reorder below)

> Everything proposed is **free** (no paid tier): all builds are browser-side web + new RLS-guarded
> tables + optional Android Kotlin. **Removed** by owner decision: CSV/TSV/bank-format import (Q5)
> and image attachments (Q1). Captured from here: **voice + AI-text** only (web text half done; only
> Android voice is new).

1. **Phase 1 — Tags** — one migration (tables + GRANT + RLS) + edit-mode UI.
2. **Phase 2 — Dark mode + PWA** — cheap, no data changes.
3. **Phase 3 — Accounts + transfer model** — owner decisions (Q6 + follow-up): pulled *before* balance
   trends. New `accounts` table (+GRANT +RLS, §17), `account_id` on transactions, transfer direction
   with cross-currency source/dest amounts, package→account default mapping + backfill, opening
   balance + reconcile adjustment. Largest item; designed carefully as its own phase.
4. **Phase 4 — Balance trends + budgets + charts** — reads accounts; net-worth + per-account lines,
   budgets table, Chart.js views.
5. **Phase 5 — Android voice (SpeechRecognizer)** — completes the deferred half of voice; on-device
   Gemini key (owner decision), quick-add voice UI.
6. **Phase 6 — Recurring auto-entry (Android WorkManager)** — owner decision (Q4): phone-driven
   materialization of due recurring rows. New Android worker + a manual-insert path.
7. **Deferred / hold**: widgets (defer), Insights Explorer, MCP (on request).

## 4.4 Resolved + documentation (Q1–Q6 now all decided)

**Resolved by owner (2026-09-09):**
- **Q1 (image attachments)** — **DROPPED.** No Supabase Storage, no local-only IndexedDB; don't build.
- **Q2 (AI privacy)** — **voice + text only.** No image/receipt LLM import; no consent gate needed
  beyond the existing text LLM toggle in Settings (the text path is unchanged and already consented
  by using the app).
- **Q3 (import formats)** — **deleted.** Multi-format import (CSV/OFX/QIF/MT940/etc.) removed.
- **Q5 (priority)** — **drop CSV import**; proceed with Tags → Dark+PWA → Budgets/charts → Android voice.
- **Q4 (recurring auto-entry)** — **Android WorkManager-driven.** The phone materializes due recurring
  rows (the only free always-on scheduler). See 4.5. Confirmed 2026-09-09.
- **Q6 (multi-account)** — **full accounts + transfer model** (option 3 in 4.6), the largest item in the
  plan. See 4.6. Confirmed 2026-09-09.

## 4.5 — Q4 (resolved): scheduled / recurring **auto-entry**, decision record

**What the feature is** (BeeCount C5, ez C2): a recurring transaction (e.g. "$50 rent on the 1st")
that the system itself creates each cycle, without you entering it. We already have the **manual**
`is_recurring` flag; **auto-creation** is the part that records the row *by itself* each period.

**The free-tier constraint is the whole story:**
- We're on Supabase **Free**. Free has **no `pg_cron`** (scheduled SQL) and **no scheduled Edge
  Functions** — both are paid-tier. So the *database* cannot clock-trigger a recurring insert.
- A **web-side** scheduler only ticks while a dashboard tab is open. Since you open the dashboard
  occasionally, it would silently miss cycles if you didn't visit.
- The **Android app already runs periodic WorkManager jobs** (sync ~15 min, listener health,
  heartbeat). It is the *only always-on, free* executor in the stack. It could materialize due
  recurring rows (compute "which recurring entries are due, insert them as manual transactions").

**So the real decision is *who owns the clock*:**
- **(a) Android materialization** — durable + always-on, but the *phone* is the scheduler: entries
  only appear while the phone's app worker runs (works with the existing foreground service / battery
  exemption). New Android code that inserts manual `is_recurring → due` rows.
- **(b) Materialize-on-dashboard-open** — simplest, zero Android; the web dashboard computes & fills
  any due recurring rows when you visit. Downside: no entry is created on the due date itself, only on
  the *next visit* (a rent entry might appear 3 days late).
- **(c) Defer** — keep only the manual recurring flag (category/CSV still reflect it); no auto-creation.

**Trade-off summary**: (a) truest to "auto", needs Android effort + phone must be healthy; (b) nearly
free but not truly automatic; (c) nothing now. My lean: **(c) defer** for v1 — the manual flag already
covers the common "I'll remember it's recurring" case, and auto-creation's value is low until you
actually have recurring bills you keep forgetting. But you decide.

## 4.6 — Q6 (resolved): multi-account + transfer model — decision record

**Plain version.** Right now, a transaction only knows *which app sent the notification*
(`source_app_label` = "TnG eWallet", "Samsung Wallet – HLB Debit Card", …). That is your de-facto
"account" already — it's enough to tell *where* money came/goes from.

Multi-account would add a real `accounts` table (Cash, HLB card, TnG wallet, Wise) and point each
transaction at one. A **transfer** (move money between two of your own accounts) needs the transaction
to point at **two** accounts at once.

**Why this is awkward for us:**
1. **No table exists** — adding it is a real schema change with grants/RLS (§17 AGENTS.md).
2. **Notifications can't do transfers.** A TnG→HLB transfer generates a notification from *each* app,
   separately — the capture pipeline still sees two single-app lines, not one linked
   source→destination pair. So transfers would only ever come from manual/voice entry.
3. **The only real benefit** (balance trends / net-worth over time) is a feature we're not building
   anyway.

**Your 3 choices:**
- **(1) Do nothing** — keep `source_app_label` as the "account". Smallest; fits everything we do.
- **(2) Just add an optional `account_id`** — an accounts table + one nullable column on
  transactions, filled by manual/voice entries now. No transfer model. Medium; future-proofs balance
  trends later.
- **(3) Full accounts + transfers** — big refactor of the whole write path. I don't recommend this.

> **OWNER DECISION 2026-09-09: chose (3) — full accounts + transfer model.** Recorded, even though it
> is the largest item in this plan. This means: a new `accounts` table (with GRANT + RLS, §17), an
> `account_id` on transactions for single-account rows, and `source_account_id` +
> `destination_account_id` + a `transfer` direction for transfers. It ripples through the parse
> trigger, review inbox, manual/voice write path, edit mode, CSV export, FX, and dashboard totals —
> and transfers will come only from manual/voice entry (notifications can't produce two-sided rows).
> I'll plan it as its own dedicated phase and design it carefully before writing any migration.
>
> **Follow-up decisions (same day, see §4.7):** account source = **auto default per package + manual
> override**; balance trends = **opening balance + reconcile adjustment**; view = **net worth +
> per-account**; **accounts phase moved first** (balance trends need it); **cross-currency transfers
> supported** (source & destination amounts — full ezBookkeeping model).

## 4.7 — Accounts + balance trends (follow-up design, owner decisions 2026-09-09)

This section homes in on the **real purpose** of the Q6 decision — you need balance trends — and the
follow-up decisions you made. It also records the honest constraint (balances never reach Supabase,
§8) and the design that works inside it.

### 4.7.1 The constraint that shapes everything
`Redactor.kt` strips balances (`[REDACTED-BALANCE]`) before any payload leaves the phone (§8), so
Supabase can **never see a real balance**. Balance trends therefore can't *read* balances — they are
**computed**:

```
per-account balance(date) = opening_balance + Σ(credits) − Σ(debits) up to date
```

This is free (a read over `transactions`, FX at each date per ADR 0003) and accurate **relative**
movement. The absolute level is only as good as the manual anchor + capture completeness, so drift is
corrected by reconciliation.

### 4.7.2 Schema deltas (transactions already has the base; new tables need GRANT + RLS per §17)
- **`accounts`**: `id`, `user_id`, `name`, `type` (cash / checking / savings / credit / e-wallet /
  virtual / investment), `currency` (single currency per account, default MYR), `icon`, `color`,
  `opening_balance` + `opening_balance_date` (manual, one-time), `is_hidden`, `sort_order`.
- **`transactions`** gains `account_id` (nullable) for single-account rows, and for transfers a
  distinct `transfer_id` (or `direction='transfer'` with `source_account_id` + `dest_account_id`),
  plus **`source_amount`/`source_currency` and `dest_amount`/`dest_currency`** to support
  **cross-currency transfers** (ezBookkeeping model). The existing `direction` check
  (`debit`/`credit`) widens to include `transfer`.
- **Reconciliation**: rather than a parallel table, a reconcile writes an **adjustment transaction**
  into the account (category `Reconciliation`, `notes` with the real balance + as-of date). The whole
  balance curve stays *one* computation over `transactions` — history, audit, and CSV all keep
  working. `accounts` also stores `last_reconciled_at` for a quick "stale" indicator.
- **Package → account mapping**: equivalent of `merchant_rules` but for accounts — a
  `package_account_map` (or columns on `accounts` listing default `package_name`s) so a capture from
  `my.com.hongleongconnect.mobileconnect` auto-fills `account_id`. Auto-created on first sighting,
  overridable in edit mode. Unknown package → `account_id = NULL` (the existing "Unassigned" view).

### 4.7.3 Balance trend views (owner decisions)
- **Net worth** line = sum across all accounts, converted to MYR at each transaction's own date
  (ADR 0003) — transfers net to zero at the account level.
- **Per-account** lines = each account in its own currency (converted to MYR on the chart for
  comparison).
- Cross-currency transfer implies an FX rate at transfer time; store it so the two books agree.

### 4.7.4 What this means for the notification pipeline (unchanged guarantees)
- `raw_notifications` is untouched — durable, never deleted (§5). Accounts live on the
  **transaction**, not the notification.
- A capture still writes one row, but now also gets an `account_id` from the package map (default,
  editable). Nothing disappears; unknown accounts render as "Unassigned".

### 4.7.5 Remaining minor defaults (state now; change anytime before build)
- Budgets: monthly period by default, per-category + total, read-only computation on the dashboard
  (no cron). **Inline progress bars only** (owner decision) — no `dashboard_alerts` banner.
- Charts: monthly income/expense + category share + the two balance lines above.
- Tags: **tag groups** (hierarchical) + optional **color labels** (owner decision) — per-user, edit-mode
  picker only (no imports).
- Reconcile UX: "type your real balance" modal → inserts the adjustment transaction, shown as a
  row (can be deleted if the entry was wrong).

### 4.7.6 NL "Add from text" / voice entry with accounts (owner decision)
- **The account is chosen BEFORE the sentence is parsed** — the NL modal (and Android voice quick-add)
  prompts for the account first, then parses text/voice against that account.
- So the account is a fixed context for the parse, *not* a field the AI guesses and not an
  after-the-fact "Unassigned" default. The draft pins to the chosen account.
- This keeps the flow deterministic (no AI guessing accounts) and matches "allow choose account
  before data entry".

### 4.7.7 UI / export / FX decisions (owner decisions)
- **Edit mode & columns**: Account is the **editable** field; the "Sent from" app label stays as
  **read-only provenance** (where the notification came from). Account does not replace Sent from in
  the data model — Sent from just stops being an edit control.
- **CSV export**: gains **Account** and **Tags** columns alongside the existing ones once those
  features exist.
- **Dark mode**: **pure black / OLED** (#000) theme; follows the **system** with a **manual override**
  toggle (stored in `lib/settings.js`).
- **PWA**: Netlify static; installable manifest + **offline shell** (service worker serving the last-
  loaded bundle/data), online for fresh reads.
- **Cross-currency transfer FX**: **freeze the rate at the transfer's date** (consistent with ADR
  0003) and **store it on the transfer row**; both account books use that stored rate. No live
  re-conversion for transfers.



