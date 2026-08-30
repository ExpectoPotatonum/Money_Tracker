import { getTransactions, getCategories, updateTransaction, deleteTransaction } from '../api/transactions.js';
import { getCurrencies } from '../api/currencies.js';
import { getLatestHeartbeat } from '../api/heartbeat.js';
import { getOpenAlerts, dismissAlert } from '../api/alerts.js';
import { convert } from '../utils/fx.js';
import { formatMoney, setCurrencySymbols } from '../utils/format.js';
import { alertBanner } from '../components/common.js';
import { transactionTable } from '../components/transactionTable.js';

const OFFLINE_AFTER_HOURS = 6;

// Edit mode is a dashboard-level toggle (all rows editable at once). A save or
// delete re-renders the whole dashboard so totals and the MYR column refresh.
let editMode = false;
let refresh = null;

export async function renderDashboard(root) {
  root.replaceChildren();
  refresh = () => renderDashboard(root);

  const [transactions, categoryNames, heartbeat, alerts, currencies] = await Promise.all([
    getTransactions({ withinDays: 30, limit: 100 }),
    getCategories(),
    getLatestHeartbeat(),
    getOpenAlerts(),
    getCurrencies(),
  ]);
  setCurrencySymbols(currencies);

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

  // Every transaction normalized to MYR at display time (constraint 3 — the DB
  // only ever stores original amount + currency). Rows whose rate is unavailable
  // fall back to showing the original amount, never to hiding.
  const debits = transactions.filter((t) => t.direction === 'debit');
  const credits = transactions.filter((t) => t.direction === 'credit');
  const all = [...debits, ...credits];
  const myrTotals = new Map();
  let totalMyr = 0;
  let skipped = 0;

  for (const t of all) {
    let myr;
    if (t.currency === 'MYR') {
      myr = Number(t.amount);
    } else {
      myr = await convert(Number(t.amount), t.currency, 'MYR');
    }
    if (myr === null) {
      if (t.direction === 'debit') skipped += 1;
      myrTotals.set(t.id, null);
    } else {
      myrTotals.set(t.id, myr);
      if (t.direction === 'debit') totalMyr += myr;
    }
  }

  const header = document.createElement('div');
  header.className = 'd-flex justify-content-between align-items-center mb-3';
  const left = document.createElement('div');
  left.className = 'd-flex align-items-center gap-2';
  const h = document.createElement('h1');
  h.className = 'h3 mb-0';
  h.textContent = 'Dashboard';
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.id = 'edit-mode-toggle';
  editBtn.className = `btn btn-sm ${editMode ? 'btn-primary' : 'btn-outline-primary'}`;
  editBtn.textContent = editMode ? 'Edit mode: ON' : 'Edit mode';
  editBtn.addEventListener('click', () => {
    editMode = !editMode;
    editBtn.textContent = editMode ? 'Edit mode: ON' : 'Edit mode';
    editBtn.className = `btn btn-sm ${editMode ? 'btn-primary' : 'btn-outline-primary'}`;
    refresh();
  });
  left.append(h, editBtn);
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
  header.append(left, total);
  root.appendChild(header);

  if (skipped > 0) {
    root.appendChild(
      alertBanner({
        type: 'info',
        message: `${skipped} transaction(s) skipped from the MYR total — no rate for that currency.`,
      }),
    );
  }

  const tableProps = {
    categoryNames,
    myrTotals,
    editMode,
    onSave: async (id, patch) => {
      await updateTransaction(id, patch);
      refresh();
    },
    onDelete: async (id) => {
      await deleteTransaction(id);
      refresh();
    },
  };
  root.appendChild(transactionTable({ transactions: debits, ...tableProps }));

  if (credits.length > 0) {
    const creditHeading = document.createElement('h2');
    creditHeading.className = 'h5 mt-4';
    creditHeading.textContent = 'Money in';
    root.appendChild(creditHeading);
    root.appendChild(transactionTable({ transactions: credits, ...tableProps }));
  }
}
