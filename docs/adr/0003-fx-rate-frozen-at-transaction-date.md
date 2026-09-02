# ADR 0003: FX rate frozen at the transaction's date

**Status:** Accepted — 2026-09-02

## Context

ADR 0001 fixed the FX *provider* (Frankfurter) and the caller contract: convert
at display time, degrade to the original amount when a rate is unavailable. But
it left the conversion timestamp open — `fx.js` used the **latest** live rate
for every row.

That makes a past transaction's MYR value drift: the same 10.00 USD row shows a
different MYR number and total every time the market moves. For a view whose
purpose is *comparing* money across time — budgets, trends, "spent this month
vs. last" (AGENTS.md §13) — a live rate quietly rewrites history on every page
load, which is worse than an occasionally-stale number.

Constraint 3 (AGENTS.md §2) still forbids storing a converted value in the DB:
the schema keeps original amount + currency only. So "freeze" can't mean "persist
the conversion at parse time" (and Postgres on the Free tier can't call out to an
FX provider anyway).

## Decision

Convert each transaction at display time using the **historical rate for the
transaction's own date**, not the latest rate.

- `web/src/utils/fx.js` gains an optional date parameter on
  `convert(amount, base, quote, date)`.
- With a date → `GET /v2/rates?base={base}&quotes={quote}&date={YYYY-MM-DD}`
  (Frankfurter's historical endpoint; returns an array of `{date, base, quote,
  rate}` rows). Frankfurter resolves weekend/holiday dates to the nearest
  working day, so the lookup is safe for any transaction Friday–Sunday.
- Without a date → the previous latest-rate path (`/v2/rate/{base}/{quote}`) is
  unchanged.
- Cache key becomes `{base}_{quote}_{YYYY-MM-DD}`; success only is cached, and
  failures still return `null` under ADR 0001's caller contract.
- `web/src/views/dashboard.js` passes `t.transaction_date` into every
  conversion, so the dashboard's MYR column and 30-day total are the sum of
  frozen per-date conversions.

The dashboard is the only consumer today; when budget/trend views land
(AGENTS.md §13) they inherit the frozen-at-transaction-date behavior with no
further change.

## Consequences

- Past rows are stable across page loads and market moves — the "spent last
  month" number doesn't change when the ringgit weakens.
- More de-duplicated API calls: one per distinct `(currency, date)` pair instead
  of one per distinct currency. A 30-day dashboard of hundreds of rows stays
  well within the in-memory cache's reach; Frankfurter's historical range
  (1999 onward) covers the data.
- A transaction whose date falls outside Frankfurter's data window (or a future
  scheduled transaction) gets no historical rate and degrades to showing the
  original amount — the same graceful fallback as before, not a failure.