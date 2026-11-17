# ADR 0005: Dashboard display currency (MYR default, TWD switchable)

**Status:** Accepted — 2026-11-17

## Context

Constraint 3 (AGENTS.md §2) fixes the schema: every transaction keeps its original
amount + currency, and the web UI unifies figures into **MYR** at display time.
ADR 0003 then froze the conversion at each transaction's own date so past rows
don't drift with the market.

That leaves one assumption unexamined: *which* currency the dashboard unifies
**into**. The owner now splits spending between Malaysia (MYR) and Taiwan (TWD)
and wants to read the same month's income/spent/net, trend, budgets and category
share in either currency, without re-entering anything or waiting for a schema
change. Both currencies are already in the reference table (v1 set: MYR, CNY,
TWD, USD, SGD), and Frankfurter serves MYR↔TWD directly, so this is a display
concern, not a data one.

The alternatives were rejected for the same reason:

- **Store a converted column** — violates constraint 3, and the Free-tier DB
  can't call an FX provider anyway.
- **A general currency dropdown** — every code costs a new rate pair on every
  page load and widens the "which column means what" problem in CSV and the
  Reports view for a second currency the owner doesn't report in.
- **Two dashboards / a query param** — duplicates state the month bar already
  owns.

## Decision

The dashboard has a **display currency** with exactly two options, **MYR**
(default) and **TWD**, switched from a control beside the month bar
(`#display-currency-toggle`) and persisted in `localStorage` under
`mt_display_currency`.

- The stored data is never touched. `dashboard.js` keeps a module-level
  `displayCurrency`; `readDisplayCurrency()` validates against
  `DISPLAY_CURRENCIES = ['MYR', 'TWD']` and falls back to `MYR` for an unset or
  unrecognised value.
- `totalsFor(rows, quote)` builds the id-keyed conversion map for the selected
  currency. Each foreign row is converted **at its own transaction date**
  (ADR 0003); rows already in the display currency short-circuit in
  `convert()`. A row with no available rate stays visible at its original
  amount and is counted in the existing "skipped" banner (now
  `dash.skippedCur`).
- Everything driven by that map follows the toggle: the three summary tiles and
  their labels (`dash.incomeCur` / `dash.spentCur` / `dash.netCur`), the
  month-over-month deltas, the per-day trend, category share, the budget bars,
  asset composition, and the table's muted `≈ <currency> …` subtext.
- **Budget limits are MYR by schema.** In TWD mode the limit is converted at the
  latest rate (a "now" snapshot) while spend stays frozen per transaction date,
  so the bar's ratio is approximate rather than auditable. That is accepted:
  budgets are targets, not accounting.
- **Out of scope on purpose:** CSV export keeps its dedicated always-MYR column;
  account balance chips keep each account's real currency (they describe an
  account, not the dashboard); the Reports view stays MYR.
- Switching currency **re-renders from already-loaded history** and flushes
  pending edit-mode rows first — the same guard as the month switch (ADR 0004).
  `#total-myr` keeps its id on the SPENT tile in both modes so existing e2e
  assertions keep passing.

## Consequences

- Reading the same month in TWD is one click and survives a reload, while the
  default view is byte-for-byte the old MYR dashboard.
- Two currencies means the e2e now has to cover the toggle (added in
  `web/tests/dashboard.spec.js`); a future third currency is a matter of
  extending `DISPLAY_CURRENCIES` plus the toggle, not a redesign.
- TWD figures cost additional FX lookups per distinct `(currency, date)` pair —
  cached for the page load, and MYR↔TWD is one Frankfurter pair. A data set
  already in TWD needs no lookup at all.
- Any future "money" panel added to the dashboard must take the display
  currency as an argument (or reuse `totalsFor`) instead of hard-coding
  `'MYR'`, or it will silently disagree with the tiles.
