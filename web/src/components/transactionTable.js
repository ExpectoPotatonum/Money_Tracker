import { formatMoney, formatDateTime } from '../utils/format.js';
import { badge } from './common.js';

const DIRECTION_BADGES = {
  debit: 'bg-danger',
  credit: 'bg-success',
};

/**
 * Renders the transactions table. `myrTotals` maps transaction id -> MYR
 * equivalent (null when the rate was unavailable), so the table can show the
 * conversion column without knowing anything about the FX provider.
 */
export function transactionTable(transactions, categoryNames, myrTotals = new Map()) {
  const table = document.createElement('table');
  table.className = 'table table-sm table-striped align-middle';

  const thead = document.createElement('thead');
  thead.innerHTML = `<tr>
    <th>Date</th>
    <th>Merchant</th>
    <th>Category</th>
    <th class="text-end">Amount</th>
    <th class="text-end">MYR</th>
    <th>Source</th>
    <th></th>
  </tr>`;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const t of transactions) {
    const tr = document.createElement('tr');

    const dateTd = document.createElement('td');
    dateTd.textContent = formatDateTime(t.transaction_date);
    tr.appendChild(dateTd);

    const merchantTd = document.createElement('td');
    const merchantName = t.merchant_display ?? t.merchant_raw ?? 'Unknown';
    merchantTd.textContent = merchantName;
    if (t.merchant_raw && t.merchant_display && t.merchant_raw !== t.merchant_display) {
      merchantTd.title = `matched from: ${t.merchant_raw}`;
    }
    tr.appendChild(merchantTd);

    const categoryTd = document.createElement('td');
    categoryTd.textContent = (t.category_id && categoryNames.get(t.category_id)) || '—';
    tr.appendChild(categoryTd);

    const amountTd = document.createElement('td');
    amountTd.className = 'text-end';
    amountTd.textContent = formatMoney(t.amount, t.currency);
    tr.appendChild(amountTd);

    const myrTd = document.createElement('td');
    myrTd.className = 'text-end';
    const myr = myrTotals.get(t.id);
    myrTd.textContent = myr !== null && myr !== undefined ? formatMoney(myr, 'MYR') : '—';
    tr.appendChild(myrTd);

    const sourceTd = document.createElement('td');
    sourceTd.className = 'text-muted small';
    sourceTd.textContent = t.source_app_label ?? t.source_package;
    tr.appendChild(sourceTd);

    const dirTd = document.createElement('td');
    dirTd.className = 'text-end';
    dirTd.appendChild(badge(t.direction, DIRECTION_BADGES[t.direction] ?? 'bg-secondary'));
    tr.appendChild(dirTd);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}
