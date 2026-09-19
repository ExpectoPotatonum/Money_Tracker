import {
  getTransactions,
  getCategories,
  updateTransaction,
  deleteTransaction,
} from '../api/transactions.js';
import { getCurrencies } from '../api/currencies.js';
import { getLatestHeartbeat } from '../api/heartbeat.js';
import { getOpenAlerts, dismissAlert } from '../api/alerts.js';
import { listAccounts, assignAccount, deleteTransfer } from '../api/accounts.js';
import { convert } from '../utils/fx.js';
import { formatMoney, setCurrencySymbols } from '../utils/format.js';
import { alertBanner } from '../components/common.js';
import { transactionTable } from '../components/transactionTable.js';
import { openNlModal } from '../components/nlModal.js';
import { openTagManager } from '../components/tagManager.js';
import { openAccountManager } from '../components/accountManager.js';
import { openTransferDialog } from '../components/transferDialog.js';
import { getTagGroups, setTransactionTags } from '../api/tags.js';
import { t } from '../lib/i18n.js';

const OFFLINE_AFTER_HOURS = 6;

// Edit mode is a dashboard-level toggle (all rows editable at once). Edits are
// accumulated per-row in `dirtyRows` as the user types and PATCHed in one pass
// when edit mode is toggled off — no per-row Save buttons (whatnext #5).
let editMode = false;
let refresh = null;
const dirtyRows = new Map();
let hashchangeGuardInstalled = false;

export async function renderDashboard(root) {
  root.replaceChildren();
  refresh = () => renderDashboard(root);

  // If the user navigates away with edit mode on, don't silently drop edits —
  // flush them before the next view swaps in.
  if (!hashchangeGuardInstalled) {
    hashchangeGuardInstalled = true;
    window.addEventListener('hashchange', async () => {
      if (editMode) await flushDirty();
    });
  }

  const [
    transactions,
    categoryNames,
    heartbeat,
    alerts,
    currencies,
    tagGroups,
    accounts,
  ] = await Promise.all([
    getTransactions({ withinDays: 30, limit: 100 }),
    getCategories(),
    getLatestHeartbeat(),
    getOpenAlerts(),
    getCurrencies(),
    getTagGroups(),
    listAccounts(),
  ]);
  setCurrencySymbols(currencies);

  // Phase 3: account display names + a per-transfer pair map (which half is
  // the source = debit side, which is the destination = credit side). The pair
  // is what turns both halves into an "A → B" display in the table.
  const accountNames = new Map(accounts.map((a) => [a.id, a.name]));
  const transferPairs = new Map();
  for (const tx of transactions) {
    if (!tx.transfer_group_id) continue;
    const p = transferPairs.get(tx.transfer_group_id) ?? { source: null, dest: null };
    if (tx.direction === 'debit') p.source = tx.account_id;
    else p.dest = tx.account_id;
    transferPairs.set(tx.transfer_group_id, p);
  }

  // Flatten groups -> one ordered list for the edit-mode picker. Groups arrive
  // in sort_order then name; tags within each group in name order, so iterating
  // in place yields consecutive runs the table can chunk into optgroups.
  const allTags = tagGroups.flatMap((g) =>
    (g.tags ?? []).map((tag) => ({ ...tag, group: g.name })),
  );

  // agents.md §10 — turn the headless failure into something noticeable.
  if (heartbeat) {
    const hours = (Date.now() - new Date(heartbeat.last_seen_at).getTime()) / 3_600_000;
    if (hours > OFFLINE_AFTER_HOURS) {
      root.appendChild(
        alertBanner({
          type: 'warning',
          message: t('dash.offlinePrefix') + `${Math.round(hours)}` + t('dash.offlineSuffix'),
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

  // Every transaction converted to MYR at display time (constraint 3 — the DB
  // only ever stores original amount + currency). The rate is frozen at the
  // transaction's own date (ADR 0003) so past rows don't drift as live rates
  // move; rows whose historical rate is unavailable fall back to showing the
  // original amount, never to hiding.
  //
  // Transfers (two-row linked pairs) are excluded from the spending/income
  // tables AND the totals — moving money between own accounts isn't spending.
  // The halves still go through the MYR conversion below so the CSV export has
  // a MYR figure for every row, transfers included.
  const debits = transactions.filter(
    (t) => t.direction === 'debit' && !t.transfer_group_id,
  );
  const credits = transactions.filter(
    (t) => t.direction === 'credit' && !t.transfer_group_id,
  );
  const transfers = transactions.filter((t) => t.transfer_group_id);
  const all = [...debits, ...credits, ...transfers];
  const myrTotals = new Map();
  let totalMyr = 0;
  let skipped = 0;

  const results = await Promise.allSettled(
    all.map((t) =>
      t.currency === 'MYR'
        ? Promise.resolve(Number(t.amount))
        : convert(Number(t.amount), t.currency, 'MYR', t.transaction_date),
    ),
  );
  for (let i = 0; i < all.length; i++) {
    const t = all[i];
    const r = results[i];
    const myr = r.status === 'fulfilled' ? r.value : null;
    const isSpend = t.direction === 'debit' && !t.transfer_group_id;
    if (myr === null) {
      if (isSpend) skipped += 1;
      myrTotals.set(t.id, null);
    } else {
      myrTotals.set(t.id, myr);
      if (isSpend) totalMyr += myr;
    }
  }

  const header = document.createElement('div');
  header.className = 'd-flex justify-content-between align-items-center mb-3';
  const left = document.createElement('div');
  left.className = 'd-flex align-items-center gap-2';
  const h = document.createElement('h1');
  h.className = 'h3 mb-0';
  h.textContent = t('dash.title');
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.id = 'nl-add-btn';
  addBtn.className = 'btn btn-sm btn-outline-secondary';
  addBtn.textContent = t('nl.title');
  addBtn.addEventListener('click', () =>
    openNlModal({ categoryNames, accounts, onSaved: refresh }),
  );
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.id = 'edit-mode-toggle';
  editBtn.className = `btn btn-sm ${editMode ? 'btn-primary' : 'btn-outline-primary'}`;
  editBtn.textContent = editMode ? t('dash.editModeOn') : t('dash.editMode');
  editBtn.addEventListener('click', async () => {
    if (editMode) {
      // Leaving edit mode persists every pending change; on failure stay in
      // edit mode so the user's edits survive for another try.
      if (await flushDirty()) editMode = false;
    } else {
      editMode = true;
    }
    editBtn.textContent = editMode ? t('dash.editModeOn') : t('dash.editMode');
    editBtn.className = `btn btn-sm ${editMode ? 'btn-primary' : 'btn-outline-primary'}`;
    refresh();
  });
  left.append(
    h,
    addBtn,
    transferBtn(accounts),
    editBtn,
    tagsManageBtn(),
    accountsManageBtn(accounts, transactions),
    csvExportBtn(debits, credits, transfers, myrTotals, categoryNames, accountNames, transferPairs),
  );
  const total = document.createElement('div');
  total.className = 'text-end';
  const totalLabel = document.createElement('div');
  totalLabel.className = 'text-muted small';
  totalLabel.textContent = t('dash.spentLabel');
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
        message: `${skipped} ${t('dash.skippedSuffix')}`,
      }),
    );
  }

  const tableProps = {
    categoryNames,
    allTags,
    accounts,
    accountNames,
    transferPairs,
    myrTotals,
    editMode,
    onDirty: (id, patch) => {
      if (patch) dirtyRows.set(id, patch);
      else dirtyRows.delete(id);
    },
    onDelete: async (id) => {
      await deleteTransaction(id);
      refresh();
    },
    // Transfers delete BOTH halves in one request (app-enforced pairing) —
    // a per-half delete would orphan the other half. Confirmed separately
    // because it removes two rows, not one.
    onDeleteTransfer: async (groupId) => {
      if (!window.confirm(t('transfer.deleteConfirm'))) return;
      await deleteTransfer(groupId);
      refresh();
    },
    onToggleRecurring: async (id, value) => {
      await updateTransaction(id, { is_recurring: value });
      refresh();
    },
    // Blank-category rows show an inline picker (read-only mode); a choice
    // PATCHes that row immediately, like the recurring toggle.
    onCategorize: async (id, categoryId) => {
      await updateTransaction(id, { category_id: categoryId });
      refresh();
    },
    // Blank-account rows show an inline picker (read-only mode); a choice
    // PATCHes that row immediately, same pattern.
    onAssignAccount: async (id, accountId) => {
      await assignAccount(id, accountId);
      refresh();
    },
    // Tag toggles replace the row's tag set in the M2M table immediately —
    // tags are a separate table, so they can't ride the batched transactions
    // PATCH that flushes on edit-mode toggle-off.
    onSetTags: async (id, tagIds) => {
      await setTransactionTags(id, tagIds);
      refresh();
    },
  };
  root.appendChild(transactionTable({ transactions: debits, ...tableProps }));

  if (credits.length > 0) {
    const creditHeading = document.createElement('h2');
    creditHeading.className = 'h5 mt-4';
    creditHeading.textContent = t('dash.moneyIn');
    root.appendChild(creditHeading);
    root.appendChild(transactionTable({ transactions: credits, ...tableProps }));
  }

  if (transfers.length > 0) {
    const transferHeading = document.createElement('h2');
    transferHeading.className = 'h5 mt-4';
    transferHeading.textContent = t('dash.transfers');
    root.appendChild(transferHeading);
    root.appendChild(transactionTable({ transactions: transfers, ...tableProps }));
  }
}

// PATCH every dirty row in one pass. Clears the map first, then re-queues any
// that fail so a later toggle-off (or navigation flush) retries them. Returns
// true when everything saved (or there was nothing to save).
async function flushDirty() {
  const pending = [...dirtyRows.entries()];
  if (pending.length === 0) return true;

  dirtyRows.clear();
  const results = await Promise.allSettled(
    pending.map(([id, patch]) => updateTransaction(id, patch)),
  );

  const failures = [];
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      dirtyRows.set(pending[i][0], pending[i][1]);
      const reason = r.reason?.message ?? r.reason;
      failures.push(`${pending[i][0].slice(0, 8)}: ${reason}`);
    }
  });

  if (failures.length > 0) {
    window.alert(
      `Save failed for ${failures.length} row(s):\n${failures.join('\n')}` +
        '\n\nThey will be retried the next time you leave edit mode.',
    );
  }
  return failures.length === 0;
}

// Build the CSV export button. Named function so the column name for the
// recurring flag stays in sync with the actual data. Exports EVERY loaded row
// (debits, credits, and transfer halves — nothing hidden); transfer rows get
// Direction "Transfer" and the Account shows the pair "A → B".
function csvExportBtn(debits, credits, transfers, myrTotals, categoryNames, accountNames, transferPairs) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-sm btn-outline-secondary';
  btn.id = 'csv-export-btn';
  btn.textContent = t('dash.export');
  btn.addEventListener('click', () =>
    downloadCsv(debits, credits, transfers, myrTotals, categoryNames, accountNames, transferPairs),
  );
  return btn;
}

// "Move money" opens the transfer dialog; on save, pending edits flush first
// (if edit mode is on) so a re-render never drops them.
function transferBtn(accountList) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'transfer-add-btn';
  btn.className = 'btn btn-sm btn-outline-secondary';
  btn.textContent = t('col.transfer');
  btn.addEventListener('click', () =>
    openTransferDialog({
      accounts: accountList,
      onSaved: async () => {
        if (editMode) await flushDirty();
        refresh();
      },
    }),
  );
  return btn;
}

// "Manage tags" opens the tag manager modal; on close, pending edits flush
// first (if edit mode is on) so a re-render never drops them.
function tagsManageBtn() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'tags-manage-btn';
  btn.className = 'btn btn-sm btn-outline-secondary';
  btn.textContent = t('tags.manage');
  btn.addEventListener('click', () =>
    openTagManager({
      onChanged: async () => {
        if (editMode) await flushDirty();
        refresh();
      },
    }),
  );
  return btn;
}

// "Accounts" opens the accounts manager (list, add/edit, and the Unassigned
// assign flow). The loaded-window transactions are passed along so the manager
// can show per-account balance estimates without another fetch.
function accountsManageBtn(accountList, transactions) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'accounts-manage-btn';
  btn.className = 'btn btn-sm btn-outline-secondary';
  btn.textContent = t('accounts.manage');
  btn.addEventListener('click', () =>
    openAccountManager({
      transactions,
      onChanged: async () => {
        if (editMode) await flushDirty();
        refresh();
      },
    }),
  );
  return btn;
}

function downloadCsv(debits, credits, transfers, myrTotals, categoryNames, accountNames, transferPairs) {
  const rows = [...debits, ...credits, ...transfers];
  const header = [
    'Date',
    'Receiver',
    'Category',
    'Amount',
    'Currency',
    'MYR',
    'Direction',
    'Sent from',
    'Account',
    'Recurring',
    'Tags',
    'Notes',
  ];
  const body = rows.map((t) => {
    const myr = myrTotals.get(t.id);
    const isTransfer = Boolean(t.transfer_group_id);
    const pair = transferPairs.get(t.transfer_group_id) ?? {};
    const account = isTransfer
      ? `${accountNames.get(pair.source) ?? '?'} → ${accountNames.get(pair.dest) ?? '?'}`
      : accountNames.get(t.account_id) ?? '';
    return [
      t.transaction_date,
      t.merchant_raw ?? '',
      (t.category_id && categoryNames.get(t.category_id)) || '',
      t.amount,
      t.currency,
      myr !== null && myr !== undefined ? myr : '',
      isTransfer ? 'Transfer' : t.direction,
      t.source_app_label ?? '',
      account,
      t.is_recurring ? 'yes' : '',
      (t.tags ?? []).map((tag) => tag.name).join('; '),
      t.notes ?? '',
    ];
  });
  const csv = [header, ...body].map((r) => r.map(escapeCsv).join(',')).join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `transactions_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeCsv(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
