// fx.js — the single point of contact with the FX provider (ADR 0001).
// Nothing else in /web should know this is Frankfurter specifically; swapping
// providers later is a change to this file only (ARCHITECTURE.md §5).

const API_BASE = 'https://api.frankfurter.dev/v2';

// sessionStorage key — survives navigation/refresh within the same tab, cleared
// on tab close. Rates are historical-frozen (ADR 0003), so stale entries are
// still correct for a past transaction's date.
const STORAGE_KEY = 'fx_rate_cache_v1';

// Series cache (Phase 4 Reports): full date-range rate tables keyed by
// base_quote_start_end. Same sessionStorage discipline as STORAGE_KEY.
const SERIES_STORAGE_KEY = 'fx_series_cache_v1';

// In-memory cache seeded from sessionStorage; the "latest" (undated) entries
// are excluded on load so a live rate never goes stale for the whole session.
let rateCache = new Map();

// In-flight requests, deduped by cache key so parallel convert() calls for the
// same (base, quote, date) share one HTTP fetch instead of N identical ones.
const pending = new Map();

try {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (raw) {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [key, value] of Object.entries(parsed)) {
        if (/^[A-Z]{3}_[A-Z]{3}_\d{4}-\d{2}-\d{2}$/.test(key)) {
          rateCache.set(key, value);
        }
      }
    }
  }
} catch {
  // sessionStorage unavailable or corrupt — start empty, everything still works.
}

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
  if (pending.has(cacheKey)) return pending.get(cacheKey);

  const promise = (async () => {
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
      if (day) persistCache();
      return rate;
    } catch {
      return null;
    } finally {
      pending.delete(cacheKey);
    }
  })();

  pending.set(cacheKey, promise);
  return promise;
}

// Write the dated (historical) entries to sessionStorage. The undated "latest"
// entries are not persisted — a live rate has a TTL of one page load by design.
function persistCache() {
  const out = {};
  for (const [key, value] of rateCache) {
    if (/^[A-Z]{3}_[A-Z]{3}_\d{4}-\d{2}-\d{2}$/.test(key)) out[key] = value;
  }
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(out));
  } catch {
    // Quota exceeded / unavailable — non-fatal.
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

/** Clears the in-memory and sessionStorage caches. Exposed for tests only. */
export function _resetCacheForTests() {
  rateCache = new Map();
  pending.clear();
  seriesCache = new Map();
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(SERIES_STORAGE_KEY);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Phase 4 (Reports): time-series rates. One request per (base, quote, range)
// instead of N per-date convert() calls — a balance curve needs a rate for
// every day in the window. Kept behind fx.js so adr-0001's "single FX
// touchpoint" rule still holds: callers never talk to Frankfurter directly.
// ---------------------------------------------------------------------------

const SERIES_KEY_RE = /^[A-Z]{3}_[A-Z]{3}_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/;

let seriesCache = new Map();
const pendingSeries = new Map();

try {
  const raw = sessionStorage.getItem(SERIES_STORAGE_KEY);
  if (raw) {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [key, value] of Object.entries(parsed)) {
        if (SERIES_KEY_RE.test(key) && Array.isArray(value)) {
          seriesCache.set(key, value);
        }
      }
    }
  }
} catch {
  // sessionStorage unavailable or corrupt — start empty, everything still works.
}

/**
 * Daily rates for a date range, e.g. `[{date:'2024-01-01', rate:3.5}, …]`
 * ascending. One HTTP request per (base, quote, range); frozen in sessionStorage
 * (ADR 0003 — historical series never go stale). Returns `[]` — never throws —
 * if the range can't be resolved, so callers can degrade gracefully.
 */
export async function timeSeries(base, quote, startDate, endDate) {
  if (base === quote) return [];
  const start = dateKey(startDate);
  const end = dateKey(endDate);
  if (!start || !end || start > end) return [];
  const key = `${base}_${quote}_${start}_${end}`;

  if (seriesCache.has(key)) return seriesCache.get(key);
  if (pendingSeries.has(key)) return pendingSeries.get(key);

  const promise = (async () => {
    try {
      const res = await fetch(
        `${API_BASE}/${start}..${end}?base=${base}&symbols=${quote}`,
      );
      if (!res.ok) return [];
      const data = await res.json();
      const rates = data?.rates ?? null;
      if (!rates || typeof rates !== 'object') return [];
      const rows = Object.entries(rates)
        .filter(([, v]) => v && typeof v === 'object')
        .map(([date, v]) => ({ date, rate: Number(v[quote]) }))
        .filter((r) => Number.isFinite(r.rate))
        .sort((a, b) => (a.date < b.date ? -1 : 1));
      seriesCache.set(key, rows);
      persistSeriesCache();
      return rows;
    } catch {
      return [];
    } finally {
      pendingSeries.delete(key);
    }
  })();

  pendingSeries.set(key, promise);
  return promise;
}

function persistSeriesCache() {
  const out = {};
  for (const [key, value] of seriesCache) {
    if (SERIES_KEY_RE.test(key)) out[key] = value;
  }
  try {
    sessionStorage.setItem(SERIES_STORAGE_KEY, JSON.stringify(out));
  } catch {
    // Quota exceeded / unavailable — non-fatal.
  }
}
