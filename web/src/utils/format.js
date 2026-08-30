// Built-in fallbacks. These keep formatting working even if the `currencies`
// reference table is unreachable; the DB values (setCurrencySymbols) override
// them at runtime so adding a currency is a data change, not an app release.
let SYMBOLS = {
  MYR: 'RM',
  USD: '$',
  CNY: '¥',
  TWD: 'NT$',
  SGD: 'S$',
};

let CURRENCY_OPTIONS = ['MYR', 'CNY', 'TWD', 'USD', 'SGD'];

/** Populate the symbol map and dropdown options from the currencies table. */
export function setCurrencySymbols(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const nextSymbols = { ...SYMBOLS };
  const nextOptions = [];
  for (const r of rows) {
    if (r.code) {
      nextSymbols[r.code] = r.symbol || r.code;
      nextOptions.push(r.code);
    }
  }
  SYMBOLS = nextSymbols;
  if (nextOptions.length) CURRENCY_OPTIONS = nextOptions;
}

/** The codes available to pick from in edit mode (sorted by DB position). */
export function currencyOptions() {
  return [...CURRENCY_OPTIONS];
}

export function formatMoney(amount, currency) {
  const symbol = SYMBOLS[currency] ?? `${currency} `;
  const separator = /^[A-Za-z]{2,3}$/.test(symbol) ? ' ' : '';
  return `${symbol}${separator}${Number(amount).toFixed(2)}`;
}

export function formatDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Pin to Malaysian time regardless of the viewer's locale (constraint: single
  // user in MY; stable timestamps beat viewer-local rendering).
  return new Intl.DateTimeFormat('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}

// Converts an ISO timestamp to the value a <input type="datetime-local"> shows,
// rendered in Malaysian time (the dashboard's fixed display zone).
export function toDateTimeLocal(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

// Converts a datetime-local value back to an ISO string. Interprets the input
// as Malaysian time (UTC+8) so round-tripping preserves the wall-clock it was
// edited in.
export function fromDateTimeLocal(value) {
  if (!value) return null;
  const d = new Date(`${value}:00+08:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
