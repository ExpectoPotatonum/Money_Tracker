// fx.js — the single point of contact with the FX provider (ADR 0001).
// Nothing else in /web should know this is Frankfurter specifically; swapping
// providers later is a change to this file only (ARCHITECTURE.md §5).

const API_BASE = 'https://api.frankfurter.dev/v2';

// sessionStorage key — survives navigation/refresh within the same tab, cleared
// on tab close. Rates are historical-frozen (ADR 0003), so stale entries are
// still correct for a past transaction's date.
const STORAGE_KEY = 'fx_rate_cache_v1';

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
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
