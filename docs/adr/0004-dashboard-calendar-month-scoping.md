# ADR 0004: Dashboard figures scope to calendar months (Malaysia time)

**Status:** Accepted — 2026-11-14

## Context

The dashboard originally showed a rolling **last 30 days**: the transactions
query defaulted to `withinDays: 30` and every derived figure (income/spent/net
tiles, the spending trend, category share, budgets, the tables and CSV export)
was computed over that window.

A rolling window is a poor fit for the question the dashboard exists to answer.
"Spent" is a monthly concept for a household budget: it should reset when the
month changes, it should match the statement/mental model of "this month's
spending", and it should be comparable to *last* month. A rolling window instead
drifts continuously — on the 3rd of a month it still includes almost all of the
previous month, so the tile barely moves at the boundary, and "this month vs.
last month" isn't expressible at all. ADR 0003 already pins each row's MYR value
so history doesn't drift; a rolling *window* re-introduces drift at the
aggregate level.

Budgets (202609190005) are monthly by definition, so they and the tiles could
disagree about what period they were describing.

## Decision

Every dashboard figure is scoped to a **calendar month in Malaysia time**
(`Asia/Kuala_Lumpur`, UTC+8 — fixed offset, no DST), defaulting to the current
month and switchable from a month bar.

- Month boundaries are computed in MYT, not UTC: November 2026 is
  `2026-10-31T16:00:00Z` → `2026-11-30T16:00:00Z`. A transaction posted at
  `00:30 MYT` on the 1st belongs to the new month, which it wouldn't under a UTC
  boundary.
- The month bar (`‹` / month label / `›`, a native `<input type="month">`, and
  "This month") drives tiles, the per-day trend, category share, the budget
  bars, the CSV export and both tables.
- The trend stays **per-day inside the selected month**, zero-filled day 1 →
  today for the current month and day 1 → month-end for any other month.
- A muted month-over-month line under the tiles reports deltas against the
  previous month (spent rising is bad, income rising is good), and explicitly
  says "no data" when the previous month has no baseline rather than showing a
  misleading +100%.
- Labels are month-neutral (`Spent (MYR)`, `Category share`,
  `Budgets · <Month Year>`), and the month label is locale-aware via
  `getLocale()` in `lib/i18n.js`.
- Switching months **re-renders from already-loaded history** instead of
  refetching: the view loads full history once with `getAllTransactions()`
  (accounts and asset composition need every row anyway) and derives the visible
  month client-side. Pending edit-mode rows are flushed before the switch so no
  edit is dropped.
- CSV export is named `transactions_YYYY-MM.csv` to match the visible month.

## Consequences

- "Spent" now means "this calendar month", resetting on the 1st at 00:00 MYT,
  and is directly comparable with the previous month's figure.
- Month switching is instant and works offline against cached data — the
  Supabase read happens once per dashboard render, not once per month.
- Full-history fetching costs more rows per page load than the old 30-day query.
  It's paged (1000 rows/request) and fine at personal scale; if volume ever
  makes it slow, the fix is a server-side aggregate or a materialized view
  (ARCHITECTURE.md §10), not a return to a rolling window.
- Everything added later that is "monthly" (budgets, category share, new tiles)
  should derive from the same `monthRows()` slice rather than issuing its own
  date-ranged query, otherwise two panels can disagree about the month
  boundary.
- A transaction dated outside the selected month is invisible in that month's
  tables/CSV — the review inbox and the month picker are how you find it, not a
  "show everything" toggle.
