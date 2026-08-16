# Coding Architecture, Style & Framework Guide

> Companion to `agents.md`. That file defines *what* the system does and *why* — data flow, schema, non-negotiable constraints. This file defines *how the code itself is organized, written, and kept healthy* so the three subsystems stay maintainable, scalable, and sustainable past v1. Same rule as `agents.md`: if anything here conflicts with a constraint stated there, `agents.md` wins.

**Contents**
1. Guiding principles for code
2. Repository layout — refined
3. Android app architecture
4. Supabase Edge Function architecture
5. Web dashboard architecture
6. Turning conventions into enforced constraints
7. Cross-cutting style conventions
8. Testing strategy
9. CI/CD
10. Scalability notes
11. Maintainability & sustainability practices
12. What this doc doesn't decide yet

## 1. Guiding principles for code

`agents.md` §5 gives three sentences the *data flow* follows. Code architecture follows the same three, translated into rules about where logic is allowed to live:

- **Capture code stays dumb.** Anything in the notification-posted path (Android) or the webhook entry point (Edge Function) does the minimum to persist input and returns. Parsing, redaction judgment calls, and merchant resolution never live inline in an entry point — they live in separate, pure, unit-testable functions the entry point calls.
- **Parsing logic is data, not branches.** The single highest-leverage rule in this codebase: a new bank or e-wallet is a new `parser_templates` row, never a new `if (packageName == ...)` conditional in application code. A PR that adds a per-package branch to the Edge Function is almost always solving the problem in the wrong layer.
- **Sync/parse logic is idempotent by construction, not by convention.** Every write that could plausibly retry (WorkManager sync, webhook re-delivery, a re-run backfill) is an upsert keyed on something stable (`client_uuid`, `(package_name, version)`) — not an insert guarded by an application-level "have I done this already?" check.

Two things follow that aren't explicit in `agents.md` but shape how the code itself is structured:

- **Anything that gets regression-tested has to be a pure function.** §9 says a changed `body_pattern` gets replayed against every `sample_input` before deploy. That's only cheap to script if parsing is a pure function `(text, template) → ParsedFields | null` with no DB or network calls inside it — see §4.
- **The redaction pass (§8) is the highest-stakes function in the repo.** It's the only thing standing between a phone and Supabase seeing an OTP. It gets the heaviest test coverage of anything in the Android codebase, and it's the one place where dense, "clever" regex consolidation is discouraged in favor of a few obviously-correct patterns.

## 2. Repository layout — refined

Builds on `agents.md` §3, adding what a maintainable repo needs once there's more than one contributor (human or agent) touching it: tests, CI, a place for ADRs, and the regression harness §15 leaves as an open TODO.

```
/android
  /app/src/main/kotlin/.../capture     NotificationListenerService, foreground service, boot receiver
  /app/src/main/kotlin/.../sanitize    redaction pass — pure functions, heaviest test coverage in the repo
  /app/src/main/kotlin/.../data        Room entities, DAOs, database
  /app/src/main/kotlin/.../sync        WorkManager workers (sync, heartbeat)
  /app/src/main/kotlin/.../ui          settings, permission onboarding, status screen
  /app/src/main/kotlin/.../di          Hilt modules
  /app/src/test                        unit tests (sanitize, content-hash, mappers)
  /app/src/androidTest                 instrumented tests (Room, WorkManager)
/supabase
  /migrations                         versioned SQL, one file per change — §7's schema is migration 0001
  /functions
    /_shared                          types, db client, shared validation
    /parse-notification
      index.ts                        thin webhook entry point only
      parser.ts                       pure parsing function — the regression-test target
      merchantResolver.ts             pure function against merchant_rules
      redactionSpotCheck.ts           flags rows where redactions_applied looks wrong for the package
  /tests                               Deno tests, fixtures pulled from parser_templates.sample_input
  /scripts
    replay-templates.ts                the §15 regression harness — run locally and in CI before merging a template change
/web
  /src
    /lib/supabaseClient.js             single client instance
    /api                                thin query functions (getTransactions, getReviewInbox, getHeartbeat)
    /views                              one file per page/section
    /components                         small render functions, reusable across views
    /utils/fx.js                        FX conversion, isolated behind one function so the provider is swappable
  /tests                                Playwright, a handful of critical-path e2e tests
/docs
  /adr                                  architecture decision records — one file per resolved "open decision"
.github
  /workflows                            android.yml, supabase.yml, web.yml — path-filtered
  PULL_REQUEST_TEMPLATE.md              checklist mirroring agents.md §16
agents.md
ARCHITECTURE.md                         this file
```

## 3. Android app architecture

The app is mostly headless — the UI surface is small (permission onboarding, settings, a status screen). A full Clean Architecture with use-case objects would be more ceremony than the app needs. A pragmatic four-layer split instead:

| Layer | Responsibility | Depends on |
|---|---|---|
| `capture` | `NotificationListenerService`, boot receiver, foreground service lifecycle | `data` |
| `sanitize` | Pure redaction functions (§8) — text in, redacted text + `redactions_applied` out | nothing |
| `data` | Room entities/DAOs, repository that mediates between `capture` and `sync` | Room only |
| `sync` | WorkManager workers — batch upsert to Supabase, periodic heartbeat | `data`, Supabase client |

**Recommendations:**
- **DI: Hilt.** It has first-class `HiltWorkerFactory` support, which matters here because WorkManager workers are a core part of the architecture (§10–11), not an edge case.
- **UI: Jetpack Compose** for the small UI surface that exists. Less boilerplate than XML/View-based screens for three simple screens, and there's no legacy View code to stay consistent with.
- **Concurrency: Kotlin Coroutines + Flow** throughout — Room already exposes Flow-based queries natively, and WorkManager's `CoroutineWorker` avoids callback-based code in the sync path.
- **Enforce §16's rule mechanically, not just by convention:** `onNotificationPosted()` should visibly do one thing — construct a value from the `StatusBarNotification` and hand it to the repository. Anything longer than that in the override itself is a code-review flag. `detekt`'s complexity rules (§7) catch this automatically if the function grows.

## 4. Supabase Edge Function architecture

The entry point (`index.ts`) is intentionally thin — its only job is to read the webhook payload, call the pure functions, and write the result. Everything that needs to be regression-tested against `sample_input` lives outside it:

```ts
// parser.ts — pure, no IO, this is what replay-templates.ts calls in a loop
export function parseNotification(
  text: SanitizedText,
  template: ParserTemplate,
): ParsedFields | null { ... }
```

- **Strict TypeScript** (`strict: true`, no `any`) — the payload from a Database Webhook is untrusted input from the app's own pipeline, but it's still worth validating its shape before use (a malformed row shouldn't crash the function or silently write garbage).
- **`parse_status` as a discriminated union in code**, even though it's `text` with a `check` constraint in Postgres — mapping the DB string to a typed union at the boundary catches typos at compile time instead of at 2am when a row silently falls through every branch.
- **The regression harness (`scripts/replay-templates.ts`)** is the concrete answer to §15's open TODO: load every `sample_input` for a `package_name`, run the candidate `body_pattern` against each, and fail loudly if a previously-matching sample stops matching. This is cheap specifically *because* `parser.ts` is a pure function — no test database, no mocking, just strings in and structured data out. Worth writing before there's a second template, not after — retrofitting tests onto template #6 after "fixed HLB, broke TnG" happens once is a much worse time to start.
- **Migrations are forward-only, one file per change**, named `YYYYMMDDHHMM_description.sql`. No editing a merged migration — a mistake becomes a new migration that corrects it, same immutability principle as §16 applies to `raw_notifications` and `parser_templates`.

## 5. Web dashboard architecture

`agents.md` has already decided the stack: static site, Bootstrap, Supabase JS client, Netlify. That's the right call for a single-user v1 dashboard, and nothing here overrides it — this section is about keeping that code organized as the "later" scope (§13: charts, budgets, PWA) lands.

- **No SPA framework yet.** Introducing React/Vue now would be solving a problem the app doesn't have. Instead: plain ES modules, small render functions, and a thin `/api` layer so every Supabase query lives in one place — if the schema changes, there's one file per query type to update, not a grep through view code.
- **A light build step (Vite) is worth it even for a static site** — dev-server hot reload and ES module bundling for Netlify's static output, without pulling in a framework. This is a build-tooling choice, not an architecture one; it doesn't change the folder structure above.
- **If UI complexity outgrows this** (once charts/budgets/PWA land per §13), the honest next step is a lightweight reactive layer (Preact or Alpine.js) rather than jumping straight to React — proportionate to how much the UI has actually grown, not to what's fashionable. Revisit this decision at that point rather than pre-deciding it now.
- **`utils/fx.js` isolates the still-open FX provider choice (§15).** Whichever API gets picked, it's a single function with one signature (`convert(amount, from, to) → number`) and its own caching — nothing else in `/web` should know which provider it is.

## 6. Turning conventions into enforced constraints

`agents.md` §16 states several rules as conventions — "never mutated after insert," "a new regex is a new row." Conventions are only as strong as everyone remembering them. Two are worth enforcing at the database level instead, since Postgres can guarantee what code review might miss:

```sql
-- raw_notifications: the captured text and posted_at are the untouched
-- source of truth (§16). Only the parse-related columns may change post-insert.
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
```

This doesn't replace the regression harness in §4 — it's a backstop for the case where someone (or some agent) reaches for `UPDATE` out of habit. The harness catches a *bad* pattern before deploy; these triggers catch the *wrong kind of change* regardless of whether the pattern itself was good.

## 7. Cross-cutting style conventions

| Layer | Language | Formatter | Linter / static analysis |
|---|---|---|---|
| Android | Kotlin | `ktlint` (official Kotlin style) | `detekt` |
| Edge Functions | TypeScript (Deno) | `deno fmt` | `deno lint` |
| Web | JavaScript | Prettier | ESLint |
| Migrations | SQL | manual — match §7's existing style: lowercase keywords, `snake_case` | `sqlfluff` optional |

- **Naming:** DB stays `snake_case` (already established in §7). Kotlin: `PascalCase` types, `camelCase` members. TypeScript: `camelCase` functions/variables, `PascalCase` types/interfaces. Keep DB column names and their in-code field names identical where they cross a boundary (e.g. `parse_status` maps to a `parseStatus` field, not a renamed one) — a name change at the boundary is exactly the kind of thing that causes a silent mismatch six months later.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, and a `migration:` type for anything under `/supabase/migrations`). Branch naming: `type/short-description`.
- **PR template** (`.github/PULL_REQUEST_TEMPLATE.md`) mirrors `agents.md` §16 as a literal checklist: *Does this bump `parser_templates.version` instead of editing a pattern in place? Does `onNotificationPosted()` still do nothing but a synchronous write? Does the Android app still contain zero references to the `service_role` key?* A checklist a reviewer (or an agent reviewing its own PR) can tick mechanically catches more than relying on memory of a doc read once.
- **ADRs** (`/docs/adr/`) for anything in `agents.md` §15's "still open" list once it's resolved — FX provider choice, the validated redaction regex set, the finished regression harness. One markdown file per decision: context, options considered, choice, consequences. This is what keeps a `git blame` archaeology session from being the only way to find out *why* Frankfurter over exchangerate.host six months from now.

## 8. Testing strategy

| Subsystem | What's tested | Tooling |
|---|---|---|
| Android | Redaction pass (heaviest coverage), content-hash logic, entity mappers | JUnit5 + MockK |
| Android | Room DAOs, WorkManager worker behavior | Instrumented tests / `androidx.work:work-testing` |
| Edge Functions | `parser.ts` against every `sample_input` per package | Deno.test, table-driven, run by `replay-templates.ts` |
| Edge Functions | `merchantResolver.ts` priority ordering | Deno.test |
| Web | A handful of critical paths only: auth gate, transaction list renders, review-inbox filter | Playwright |
| DB | Migrations apply cleanly against a fresh Postgres; both immutability triggers (§6) reject the mutation they're meant to reject | CI job against an ephemeral Postgres service container |

Deliberately not aiming for high coverage on the web dashboard — it's a thin read layer over data whose correctness is already guaranteed upstream by RLS and the schema's constraints. Test the things that are actually likely to break silently (the redaction pass, the parser) heavily; test the things that fail loudly and obviously (a broken dashboard page) lightly.

## 9. CI/CD

Three path-filtered GitHub Actions workflows so a web-only change doesn't trigger an Android build:

- **`android.yml`** — `ktlint`, `detekt`, unit tests, instrumented tests on a matrix of API levels.
- **`supabase.yml`** — `deno fmt --check`, `deno lint`, `deno test`, then `replay-templates.ts` as a **required** check whenever a PR touches `parser_templates` or `parser.ts` — this is what makes the regression harness from §4 actually load-bearing instead of a script someone forgets to run. Migrations apply against an ephemeral Postgres service container before merge.
- **`web.yml`** — build, ESLint, Playwright smoke run. Netlify handles deploy on merge to `main` independently.

## 10. Scalability notes

The design in `agents.md` already scales further than v1's single-user, single-device scope needs to — worth naming explicitly *why*, so future changes don't accidentally undo it:

- **`parser_templates` is the real scalability mechanism**, not the database sizing. Adding bank #20 costs one INSERT and a regression-harness run, not a code review of branching logic. The architecture rule in §1 (no per-package conditionals) is what preserves this — it's the one rule in this whole document most worth defending in review.
- **RLS + `user_id` on every table means multi-tenancy is a product decision, not a rearchitecture**, if this ever stops being single-user. Auth is already the boundary.
- **`device_id` (already in schema per the non-negotiable in §2) means multi-device is additive** — sync and dedup logic key off `client_uuid`, which is generated per-device, so a second phone doesn't require touching the sync path.
- **One thing to watch, not fix now:** a webhook fires per inserted row, so a batch of 50 pending rows syncing after a week offline means 50 individual Edge Function invocations. Fine at personal scale; if that ever becomes a bottleneck, a scheduled poll of `pending` rows (rather than a webhook per row) is the natural next step — noted here so it's a deliberate future change, not a surprise.
- **A materialized view or summary table for dashboard aggregates** is a reasonable future optimization once transaction volume is large enough that recomputing category sums per page load is noticeably slow. Premature at v1's data volume — mentioned so it's not forgotten, not because it's needed today.

## 11. Maintainability & sustainability practices

- **Dependency hygiene:** Renovate or Dependabot on a weekly cadence, but pin major versions of Gradle/AGP, Kotlin, and the Deno runtime explicitly rather than auto-merging majors — a low-maintenance personal project is better served by deliberate, occasional major bumps than by silently drifting.
- **The runbook is already half-written in `agents.md` §10** (device_heartbeat, the "tracker may be offline" banner) and §9 (failed-parse spike alert). What's still unspecified is *where the alert-evaluation logic runs*. A small scheduled Edge Function (or `pg_cron` job) checking both thresholds and writing to a `dashboard_alerts` table is a concrete, low-effort implementation — the web dashboard then just reads one more table instead of computing anything itself.
- **The PR template + ADR practice (§7) is what makes this sustainable by someone other than whoever designed it** — including a future coding agent picking the repo back up after a long gap. Reading `agents.md` explains the *design*; reading `/docs/adr` explains the *decisions*; the PR checklist enforces the *conventions* without requiring either to be re-read every time.

## 12. What this doc doesn't decide yet

Carried over from `agents.md` §15 — noted here only where the choice has a specific architectural landing spot, so resolving it later is a contained change:

- **FX API choice** — lands entirely inside `/web/src/utils/fx.js` (§5). No other module needs to know which provider was picked.
- **Redaction regex validation against real samples** — a data/testing exercise during rollout phase 1 (§14), not an architecture change; the `sanitize` layer (§3) is already isolated and heavily tested, ready to absorb whatever the validated pattern set turns out to be.
- **The regression harness's own reporting/output format** — this doc fixes *where* it lives and *that* it's a required CI check (§4, §9); the harness's internal diffing/reporting logic is still open.
