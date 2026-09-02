// fx.js — the single point of contact with the FX provider (ADR 0001).
// Nothing else in /web should know this is Frankfurter specifically; swapping
// providers later is a change to this file only (ARCHITECTURE.md §5).

const API_BASE = 'https://api.frankfurter.dev/v2';

// In-memory, per-page-load cache. Good enough for a static single-page
// dashboard (ADR 0001) — move to sessionStorage only if the dashboard grows
// into multiple pages and a rate needs to survive navigation.
let rateCache = new Map();

/**
 * Convert an amount from one currency to another. Without a date it uses the
 * latest available rate; with a date it freezes the rate at that date (ADR
 * 0003) so a past transaction's MYR value doesn't drift as live rates move.
 * Returns `null` — never throws — if the pair/date can't be resolved, so
 * callers can fall back to showing the original amount instead of breaking
 * the whole dashboard render (ADR 0001's caller contract).
 */
export async function convert(amount, base, quote, date = null) {
  if (base === quote) return amount;

  const rate = await getRate(base, quote, date);
  if (rate === null) return null;

  return Math.round(amount * rate * 100) / 100;
}

async function getRate(base, quote, date) {
  const day = dateKey(date);
  const cacheKey = `${base}_${quote}_${day}`;
  if (rateCache.has(cacheKey)) return rateCache.get(cacheKey);

  try {
    let rate = null;
    if (day) {
      // Historical lookup — Frankfurter returns the nearest working day's rate
      // for weekend/holiday dates, so a per-transaction-date call is safe.
      const res = await fetch(`${API_BASE}/rates?base=${base}&quotes=${quote}&date=${day}`);
      if (!res.ok) return null;
      const data = await res.json();
      const row = Array.isArray(data) ? data.find((r) => r.quote === quote) : null;
      rate = row ? row.rate : null;
    } else {
      const res = await fetch(`${API_BASE}/rate/${base}/${quote}`);
      if (!res.ok) return null;
      const data = await res.json();
      rate = data.rate;
    }
    if (rate === null) return null;
    rateCache.set(cacheKey, rate);
    return rate;
  } catch {
    return null;
  }
}

// Normalize an ISO timestamp to a YYYY-MM-DD key; invalid dates fall back to
// the unkeyed (latest) lookup rather than firing a malformed request.
function dateKey(date) {
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/** Clears the in-memory cache. Exposed for tests only. */
export function _resetCacheForTests() {
  rateCache = new Map();
}
