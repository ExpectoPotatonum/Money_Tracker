const SYMBOLS = {
  MYR: 'RM',
  USD: '$',
  CNY: '¥',
  SGD: 'S$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
};

export function formatMoney(amount, currency) {
  const symbol = SYMBOLS[currency] ?? `${currency} `;
  const separator = /^[A-Za-z]{2,3}$/.test(symbol) ? ' ' : '';
  return `${symbol}${separator}${Number(amount).toFixed(2)}`;
}

export function formatDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}
