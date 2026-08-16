import { getTransactions, getCategories } from '../api/transactions.js';
import { getLatestHeartbeat } from '../api/heartbeat.js';
import { getOpenAlerts, dismissAlert } from '../api/alerts.js';
import { convert } from '../utils/fx.js';
import { formatMoney } from '../utils/format.js';
import { alertBanner } from '../components/common.js';
import { transactionTable } from '../components/transactionTable.js';

const OFFLINE_AFTER_HOURS = 6;

export async function renderDashboard(root) {
  root.replaceChildren();

  const [transactions, categoryNames, heartbeat, alerts] = await Promise.all([
    getTransactions({ withinDays: 30, limit: 100 }),
    getCategories(),
    getLatestHeartbeat(),
    getOpenAlerts(),
  ]);

  // agents.md §10 — turn the headless failure into something noticeable.
  if (heartbeat) {
    const hours = (Date.now() - new Date(heartbeat.last_seen_at).getTime()) / 3_600_000;
    if (hours > OFFLINE_AFTER_HOURS) {
      root.appendChild(
        alertBanner({
          type: 'warning',
          message:
            `Tracker may be offline — last heartbeat ${Math.round(hours)}h ago. ` +
            `Check battery restrictions and notification access (agents.md §10).`,
        }),
      );
    }
  }

  for (const alert of alerts) {
    const severity = alert.severity === 'critical' ? 'danger' : alert.severity;
    root.appendChild(
      alertBanner({
        type: severity,
        message: alert.message,
        onDismiss: () => dismissAlert(alert.id).catch(() => {}),
      }),
    );
  }

  // Spent total: every debit normalized to MYR at display time (constraint 3 —
  // the DB only ever stores original amount + currency). Rows whose rate is
  // unavailable fall back to showing the original amount, never to hiding.
  const debits = transactions.filter((t) => t.direction === 'debit');
  const myrTotals = new Map();
  let totalMyr = 0;
  let skipped = 0;

  for (const t of debits) {
    let myr;
    if (t.currency === 'MYR') {
      myr = Number(t.amount);
    } else {
      myr = await convert(Number(t.amount), t.currency, 'MYR');
    }
    if (myr === null) {
      skipped += 1;
      myrTotals.set(t.id, null);
    } else {
      totalMyr += myr;
      myrTotals.set(t.id, myr);
    }
  }

  const header = document.createElement('div');
  header.className = 'd-flex justify-content-between align-items-center mb-3';
  const h = document.createElement('h1');
  h.className = 'h3 mb-0';
  h.textContent = 'Dashboard';
  const total = document.createElement('div');
  total.className = 'text-end';
  const totalLabel = document.createElement('div');
  totalLabel.className = 'text-muted small';
  totalLabel.textContent = 'Spent (last 30 days, MYR)';
  const totalValue = document.createElement('div');
  totalValue.id = 'total-myr';
  totalValue.className = 'fs-3 fw-bold';
  totalValue.textContent = formatMoney(totalMyr, 'MYR');
  total.append(totalLabel, totalValue);
  header.append(h, total);
  root.appendChild(header);

  if (skipped > 0) {
    root.appendChild(
      alertBanner({
        type: 'info',
        message: `${skipped} transaction(s) skipped from the MYR total — no rate for that currency.`,
      }),
    );
  }

  root.appendChild(transactionTable(debits, categoryNames, myrTotals));

  const credits = transactions.filter((t) => t.direction === 'credit');
  if (credits.length > 0) {
    const creditHeading = document.createElement('h2');
    creditHeading.className = 'h5 mt-4';
    creditHeading.textContent = 'Money in';
    root.appendChild(creditHeading);
    root.appendChild(transactionTable(credits, categoryNames, myrTotals));
  }
}
