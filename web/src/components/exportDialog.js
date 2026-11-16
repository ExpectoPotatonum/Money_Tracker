// CSV export dialog (2026-11-16). Moved out of the dashboard header into the
// sidebar: pick a calendar month (MYT) and a scope, then download. Rows are
// fetched fresh here rather than leaning on whatever the dashboard happens to
// have loaded, so the export works from any page.
import { openModal } from './common.js';
import { getAllTransactions, getCategories } from '../api/transactions.js';
import { listAccounts } from '../api/accounts.js';
import { convert } from '../utils/fx.js';
import { buildTransactionsCsv, downloadCsvFile } from '../utils/csv.js';
import { currentMonthKey, monthRows } from '../utils/months.js';
import { t } from '../lib/i18n.js';

const SCOPES = ['all', 'spending', 'income'];

export function openExportDialog({ month = null } = {}) {
  const { dialog, body, footer } = openModal({ title: t('export.title') });
  body.className = 'modal-body';

  body.appendChild(hint(t('export.hint')));

  const field = (labelText, node) => {
    const grp = document.createElement('div');
    grp.className = 'mb-3';
    const label = document.createElement('label');
    label.className = 'form-label small mb-1';
    label.textContent = labelText;
    grp.append(label, node);
    body.appendChild(grp);
    return grp;
  };

  const monthInput = document.createElement('input');
  monthInput.type = 'month';
  monthInput.className = 'form-control form-control-sm';
  monthInput.value = month || currentMonthKey();
  field(t('export.month'), monthInput);

  // Scope: radio group (All rows / Spending / Money in).
  const scopeWrap = document.createElement('div');
  scopeWrap.className = 'd-flex flex-column gap-1';
  scopeWrap.setAttribute('role', 'radiogroup');
  scopeWrap.setAttribute('aria-label', t('export.scope'));
  let scope = 'all';
  for (const key of SCOPES) {
    const lbl = document.createElement('label');
    lbl.className = 'form-check small d-flex align-items-center gap-2';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.className = 'form-check-input mt-0';
    radio.name = 'export-scope';
    radio.value = key;
    radio.checked = key === 'all';
    radio.addEventListener('change', () => {
      if (radio.checked) scope = key;
    });
    const text = document.createElement('span');
    text.textContent = t(`export.scope.${key}`);
    lbl.append(radio, text);
    scopeWrap.appendChild(lbl);
  }
  field(t('export.scope'), scopeWrap);

  const errMsg = document.createElement('div');
  errMsg.className = 'small text-danger d-none';
  body.appendChild(errMsg);

  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'btn btn-primary';
  exportBtn.id = 'export-run-btn';
  exportBtn.textContent = t('export.run');
  exportBtn.addEventListener('click', async () => {
    const key = monthInput.value || currentMonthKey();
    exportBtn.disabled = true;
    errMsg.classList.add('d-none');
    try {
      await runExport(key, scope);
      dialog.close();
    } catch (err) {
      exportBtn.disabled = false;
      errMsg.textContent = String(err?.message ?? err);
      errMsg.classList.remove('d-none');
    }
  });

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-outline-secondary';
  cancel.textContent = t('nl.cancel');
  cancel.addEventListener('click', () => dialog.close());

  footer.append(exportBtn, cancel);
}

function hint(text) {
  const div = document.createElement('div');
  div.className = 'small text-muted mb-3';
  div.textContent = text;
  return div;
}

async function runExport(monthKey, scope) {
  const [all, categoryNames, accounts] = await Promise.all([
    getAllTransactions(),
    getCategories(),
    listAccounts(),
  ]);

  let rows = monthRows(all, monthKey);
  if (scope === 'spending') rows = rows.filter((r) => r.direction === 'debit');
  if (scope === 'income') rows = rows.filter((r) => r.direction === 'credit');
  // "Spending"/"Money in" are real money movement, not internal transfers — a
  // transfer would otherwise be counted twice (once on each side).
  if (scope !== 'all') rows = rows.filter((r) => !r.transfer_group_id);

  // MYR conversions frozen at each row's own date (ADR 0003).
  const myrTotals = new Map();
  await Promise.all(
    rows.map(async (r) => {
      if (r.currency === 'MYR') {
        myrTotals.set(r.id, Number(r.amount));
        return;
      }
      const myr = await convert(Number(r.amount), r.currency, 'MYR', r.transaction_date);
      myrTotals.set(r.id, myr);
    }),
  );

  const accountNames = new Map(accounts.map((a) => [a.id, a.name]));
  const transferPairs = new Map();
  for (const r of all) {
    if (!r.transfer_group_id) continue;
    const p = transferPairs.get(r.transfer_group_id) ?? { source: null, dest: null };
    if (r.direction === 'debit') p.source = r.account_id;
    else p.dest = r.account_id;
    transferPairs.set(r.transfer_group_id, p);
  }

  const csv = buildTransactionsCsv({
    rows,
    myrTotals,
    categoryNames,
    accountNames,
    transferPairs,
  });
  downloadCsvFile(csv, `transactions_${monthKey}_${scope}.csv`);
}
