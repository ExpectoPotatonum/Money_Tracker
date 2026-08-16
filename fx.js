// fx.js — the single point of contact with the FX provider (see
// /docs/adr/0001-fx-api-provider.md). Nothing else in /web should know
// this is Frankfurter specifically — swapping providers later is a
// change to this file only.

const API_BASE = 'https://api.frankfurter.dev/v2';

// In-memory, per-page-load cache. Good enough for a static single-page
// dashboard (ADR 0001) — move to sessionStorage only if the dashboard
// grows into multiple pages and a rate needs to survive navigation.
let rateCache = new Map(); // `${base}_${quote}` -> rate

/**
 * Convert an amount from one currency to another using the latest
 * available rate.
 *
 * Returns `null` — never throws — if the pair can't be resolved, so
 * callers can fall back to showing the original amount instead of
 * breaking the whole dashboard render.
 */
export async function convert(amount, base, quote) {
  if (base === quote) return amount;

  const rate = await getRate(base, quote);
  if (rate === null) return null;

  return Math.round(amount * rate * 100) / 100;
}

async function getRate(base, quote) {
  const cacheKey = `${base}_${quote}`;
  if (rateCache.has(cacheKey)) return rateCache.get(cacheKey);

  try {
    const res = await fetch(`${API_BASE}/rate/${base}/${quote}`);
    if (!res.ok) {
      // Unsupported/unknown currency pair — let the caller decide the
      // fallback rather than throwing here.
      return null;
    }
    const data = await res.json();
    rateCache.set(cacheKey, data.rate);
    return data.rate;
  } catch {
    // Network failure gets the same fallback contract as an
    // unsupported pair — the caller doesn't need to distinguish them.
    return null;
  }
}

/** Clears the in-memory cache. Exposed for tests only. */
export function _resetCacheForTests() {
  rateCache = new Map();
}
