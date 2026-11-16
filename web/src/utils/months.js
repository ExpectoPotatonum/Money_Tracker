// Malaysia is a fixed UTC+8 with no DST, so calendar-month boundaries are a
// plain shift from UTC. Every month-scoped number (totals, trend, budgets,
// table, CSV export) uses these helpers — a KL-pinned dashboard showing a row
// dated 1 Nov 00:30 MYT must count it in November, not October.
import { getLocale } from '../lib/i18n.js';

export const MYT_OFFSET_MS = 8 * 3_600_000;

export function mytNow() {
  return new Date(Date.now() + MYT_OFFSET_MS);
}

// The current calendar month in Malaysia, as `YYYY-MM`.
export function currentMonthKey() {
  const d = mytNow();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ISO timestamp -> the MYT calendar date it belongs to (`YYYY-MM-DD`).
export function mytDateKey(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + MYT_OFFSET_MS).toISOString().slice(0, 10);
}

export function txMonthKey(iso) {
  const day = mytDateKey(iso);
  return day ? day.slice(0, 7) : null;
}

export function parseMonthKey(key) {
  const [year, month] = key.split('-').map(Number);
  return { year, month: month - 1 };
}

export function monthLabel(key) {
  const { year, month } = parseMonthKey(key);
  // Intl is already used for the KL-pinned dates in utils/format.js; UTC keeps
  // the label from drifting by a day in a negative-offset browser.
  return new Date(Date.UTC(year, month, 1)).toLocaleDateString(getLocale(), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function shiftMonthKey(key, delta) {
  const { year, month } = parseMonthKey(key);
  const d = new Date(Date.UTC(year, month + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function daysInMonth(key) {
  const { year, month } = parseMonthKey(key);
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

// Rows belonging to one MYT calendar month, newest first (the history fetch is
// ascending; the tables have always rendered descending).
export function monthRows(rows, key) {
  return rows
    .filter((r) => txMonthKey(r.transaction_date) === key)
    .sort((a, b) => new Date(b.transaction_date) - new Date(a.transaction_date));
}
