# Import Candidate Features

Features harvested from two open-source projects, listed exhaustively so YOU can decide
what (if anything) to integrate into Money_Tracker. Nothing has been built yet.

> Working file — mark keep / maybe / skip next to each item, or delete entries.

---

## Licensing notes (read first)

| Project | License | Can we copy code? |
|---|---|---|
| **BeeCount** (`TNT-Likely/BeeCount`) | **Business Source License (BSL)** | Free for **personal / learning / OSS contribution** — NOT for commercial use. Money_Tracker appears to be personal, so borrowing *ideas* is fine; only copy/reuse code if you are 100% sure there's no commercial intent, and even then read `COMMERCIAL_LICENSE.md`. Also BeeCount is **Flutter/Dart**, your Android app is Kotlin + web is JS — so most things would be *reimplemented* rather than copied anyway. |
| **ezBookkeeping** (`mayswind/ezbookkeeping`) | **MIT** | Free to copy/adapt code. Golang + Vue backend; web logic (import parsers, MCP, charts) is the most portable to your JS web dashboard. |

Both overlap heavily on dashboard/AI/MCP/charts. Priorities below are my read, not yours.

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

# Part 3 — Integration plan (review-only, nothing built)

Scope: the features flagged as *keep* in our discussion (AI chat/NL bookkeeping, voice capture,
image attachments, App Links, the AI-layer items, and the needs_review→LLM escalation you proposed),
plus verdicts on the adjacent candidates. This is a plan for *you* to read and approve — no code
written yet. The checklist above still shows raw `- [ ]` rows; this section records the decisions.

Verdict legend: ✅ adopt · ➕ extra (cheap, additive) · ⏸ defer · ❌ skip (flagged why)

## 1. Feature verdicts + feasibility

### 1.1 AI capture channels

| Feature | Verdict | Notes |
|---|---|---|
| **AI chat / NL bookkeeping** | ✅ adopt | Biggest convenience win. Text → one transaction. Borrow ezBookkeeping's server-side prompt architecture (inject your category list, merchant rules, today's date; demand strict JSON) — but it makes more sense hosted inside your own flow, not copied verbatim. |
| **Voice capture** | ⏸ defer | Builds directly on top of NL bookkeeping (Android `SpeechRecognizer` → the same parse path). Tiny marginal code, but worthless until 1.1 exists. Revisit after NL is live. |
| **Image attachments** | ⚠ blocked | Conflicts with its own note ("never store to cloud, only local") — our web dashboard is a static site with no local file store, and the only file store in the stack is Supabase Storage (cloud). Need your call: private RLS-protected Storage bucket, or drop attachments. See Open Q1. |
| **App Links deep linking** | ➕ extra | Android `<intent-filter>` + a URL scheme is a few hundred lines and gives a "quick-add" gesture. No refactor. Low urgency. |
| **needs_review → LLM escalation** | ✅ adopt | Your strongest idea and neither project has it. Escalate only `failed` / `needs_review` rows to a free LLM to shrink the review inbox. **Location matters (paid-tier constraint):** Edge Functions are a paid feature on our hosted Free project, so the trigger must live where a key can live — see Open Q2. Dashboard-side with your own free-tier key is the pragmatic pick. |

### 1.2 AI infrastructure (BeeCount B)

| Feature | Verdict | Notes |
|---|---|---|
| Multi-provider AI factory | ⏸ defer | BeeCount's 5-provider abstraction is real work and you have no provider preference. Start Gemini-flash-free-tier behind a ~30-line interface; add providers if ever needed. Don't build the factory now. |
| AI privacy consent gate | ➕ optional | You've deprioritized §8 for convenience, so the versioned consent screen is skippable — a single settings toggle "send text to LLM provider X" is enough if you want *any* gate. |
| AI prompt builder + context injection | ✅ adopt | This is the part that makes AI parse well: inject categories, merchant_rules, currency/locale, today's date so the LLM answers against real data. Copy the *pattern* from ezBookkeeping's `templates/prompt/*.tmpl`. |
| JSON5-tolerant response parser | ✅ adopt | BeeCount's `json_response_parser.dart` approach (tolerant parse, amount required / time defaults to now). Reimplement in JS for the dashboard. |
| Auto category matching from AI result | ✅ adopt | Easier than BeeCount's keyword-dictionary: we already have `merchant_rules` + categories server-side, so the AI can be asked to return `merchant_raw` and the existing rule resolution assigns category — or the LLM returns a category_id it was offered. |

### 1.3 Auth (your note under ez §O)

| Feature | Verdict | Notes |
|---|---|---|
| Register account | ⏸ hold | Supabase supports it but the project is single-user auth-gated. Re-enabling open signup removes a snow-globe guard for a convenience you don't need yet. |
| Forgot password | ✅ adopt | Supabase Auth has it built in (`.resetPasswordForEmail`); it's a small auth-gate UI addition. |
| Change password | ✅ adopt | Same — `updateUser`. Worth shipping with forgot-password. |

### 1.4 Adjacent candidates — where they land now

- **Geolocation** ❌ skip — verified in both codebases: BeeCount has *no* geolocation anywhere; ezBookkeeping only does a one-shot `navigator.geolocation.getCurrentPosition()` on edit (no background tracking). A "where did I spend this" field with zero signal behind it isn't worth schema+UI.
- **Multi-ledger / multi-account + transfer model** ⏸ defer — biggest schema+app change (a ledgers table, join tables, an RLS rewrite, and a transfer flow); directly conflicts with current "single-account simplicity". Keep on the shelf.
- **AI text/receipt import from ez** ⏸ — the *text* half merges into 1.1 anyway. Receipt-image import needs attachments (Open Q1) first; OCR itself is step 2.
- **CSV/OFX/QIF bank-format import** ⏸ — still fills the pre-listener backfill gap, but it's MIT-ported work independent of the AI features; treat as its own track.
- **Screenshot OCR auto-capture** ❌ skip — reintroduces the double-count risk the notification-only scope exists to avoid.
- **MCP server** ⏸ maybe-later via SupaMCP, not custom code.
- **i18n / multi-language** ❌ skip unless you actually confirm a second locale — single-language removes whole classes of `t()` plumbing. See Open Q3.
- **FX manual-rate override** ➕ optional — ezBookkeeping's one manual-rate table is the only FX thing worth borrowing; it coexists with Frankfurter historical-at-date (we do *not* switch providers).

## 2. Refactoring assessment

Checked against the actual repo layout (android `com.expensetracker.{capture,sync,sanitize,data,ui}`, web `src/{api,views,utils,lib,components}`, `supabase/migrations`). Verdict: **no full-codebase refactor is needed for any kept item — every one is additive.**

- **Web (bulk of the work):** NL bookkeeping, the LLM escalation, and password/forgot-password are new views and a new `utils/llm.js`/`api/` layer. Existing `dashboard.js`, `reviewInbox.js`, and `transactionTable.js` only gain buttons/modal entries. Writes go into the existing `transactions` and `raw_notifications` tables — no schema change for 1.1 or the escalation.
- **Android:** only voice capture (a new screen + `SpeechRecognizer`) and App Links (a manifest intent-filter) touch the app. The battery-sensitive capture pipeline (`NotificationCaptureService`, workers, retries) is untouched by every feature here.
- **Supabase:** no new tables for 1.1/1.2 (the escalation can write its verdict back into `transactions` with `confidence`/`status` set directly). Attachments are the *only* item that needs new storage (Open Q1).
- **Strictly additive, no interplay:** App Links, auth-recovery UI, JSON5 parser, prompt builder.

## 3. Open decisions — RESOLVED (user-confirmed 2026-09-06)

| Decision | Answer | Consequence |
|---|---|---|
| **Q1 — Attachments** | **(b) local-only on the Android device** — never to cloud | Receipts live in Room/app storage on the phone; web dashboard shows only a metadata `has_attachment` flag, never the image bytes. |
| **Q2 — needs_review→LLM escalation location** | **(a) dashboard-side** with your own free-tier LLM key in a settings field | Key lives in localStorage in the browser (same trust model as the anon key). No Edge Function (paid-tier). |
| **Q3 — i18n** | **Simplified Chinese needed** | Build the `t()` dict (en + zh-CN) from day one; retrofit existing views. |
| **Q4 — AI provider** | **Gemini Flash free-tier only** (single provider, thin interface) | No multi-provider factory in v1. Provider swap later = new `llm.js` backend. |
| **Q5 — signup** | **Open registration** | Signup code already exists in `authGate.js`; just confirm the Supabase project setting + add forgot/change-password UI. RLS already isolates accounts. |

## 4. Approved build plan (phases)

- **Phase A — AI foundation (web):** `lib/settings.js` (LLM key/model/locale in localStorage), `lib/i18n.js` (`t()` en/zh), `utils/json5.js` (tolerant LLM-JSON parser), `utils/llm.js` (Gemini wrapper, in-flight dedupe, timeout→null), `utils/prompts.js` (context-injected prompt), `insertTransaction()` in `api/transactions.js`, Settings dialog in nav.
- **Phase B — NL bookkeeping (web):** "Add from text" dialog on the dashboard: sentence → parsed preview (editable) → insert. Needs `raw_notification_id` nullable → migration `202609060003_manual_transactions.sql`.
- **Phase C — Review-inbox LLM escalation (web):** per failed/needs_review row, "Ask AI" → parse → apply (insert transaction linked to the raw row + mark `parse_status='success'`).
- **Phase D — Auth expansion (web):** forgot-password + change-password + recovery handling.
- **Phase E — i18n retrofit (web):** wrap existing dashboard/reviewInbox/authGate strings in `t()`.
- **Phase F — Android (later):** quick-add + voice on a manual-entry sync path; local-only attachments per Q1.

Mark Q1–Q5 (and strike anything you disagree with above) and I'll turn this into a phased build plan.
