import {
  getAllTransactions,
  getCategories,
  getCategoryTree,
  updateTransaction,
  deleteTransaction,
} from '../api/transactions.js';
import { getCurrencies } from '../api/currencies.js';
import { getLatestHeartbeat } from '../api/heartbeat.js';
import { getOpenAlerts, dismissAlert } from '../api/alerts.js';
import { listAccounts, assignAccount, deleteTransfer } from '../api/accounts.js';
import { listBudgets } from '../api/budgets.js';
import { convert } from '../utils/fx.js';
import { formatMoney, setCurrencySymbols } from '../utils/format.js';
import { alertBanner } from '../components/common.js';
import { transactionTable } from '../components/transactionTable.js';
import { openNlModal } from '../components/nlModal.js';
import { openTagManager } from '../components/tagManager.js';
import { openAccountManager } from '../components/accountManager.js';
import { openBudgetManager } from '../components/budgetManager.js';
import { openTransferDialog } from '../components/transferDialog.js';
import { getTagGroups, setTransactionTags } from '../api/tags.js';
import { t, getLocale } from '../lib/i18n.js';

const OFFLINE_AFTER_HOURS = 6;

// Malaysia is a fixed UTC+8 with no DST, so calendar-month boundaries are a
// plain shift from UTC. Every month-scoped number on this view (totals, trend,
// budgets, table) uses these boundaries — a KL-pinned dashboard showing a row
// dated 1 Nov 00:30 MYT must count it in November, not October.
const MYT_OFFSET_MS = 8 * 3_600_000;

// The selected calendar month (`YYYY-MM`). `null` means "current month, MYT" —
// resolved on first render and kept across re-renders so an edit or a refresh
// doesn't jump back to today's month.
let selectedMonth = null;

// Edit mode is a dashboard-level toggle (all rows editable at once). Edits are
// accumulated per-row in `dirtyRows` as the user types and PATCHed in one pass
// when edit mode is toggled off — no per-row Save buttons (whatnext #5).
let editMode = false;
let refresh = null;
const dirtyRows = new Map();
let hashchangeGuardInstalled = false;

// ------------------------------ calendar-month helpers (Malaysia time)

function mytNow() {
  return new Date(Date.now() + MYT_OFFSET_MS);
}

// The current calendar month in Malaysia, as `YYYY-MM`.
function currentMonthKey() {
  const d = mytNow();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ISO timestamp -> the MYT calendar date it belongs to (`YYYY-MM-DD`).
function mytDateKey(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + MYT_OFFSET_MS).toISOString().slice(0, 10);
}

function txMonthKey(iso) {
  const day = mytDateKey(iso);
  return day ? day.slice(0, 7) : null;
}

function parseMonthKey(key) {
  const [year, month] = key.split('-').map(Number);
  return { year, month: month - 1 };
}

function monthLabel(key) {
  const { year, month } = parseMonthKey(key);
  // Intl is already used for the KL-pinned dates in utils/format.js; UTC keeps
  // the label from drifting by a day in a negative-offset browser.
  return new Date(Date.UTC(year, month, 1)).toLocaleDateString(getLocale(), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function shiftMonthKey(key, delta) {
  const { year, month } = parseMonthKey(key);
  const d = new Date(Date.UTC(year, month + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function daysInMonth(key) {
  const { year, month } = parseMonthKey(key);
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

// Rows belonging to one MYT calendar month, newest first (getAllTransactions
// is ascending, the tables have always rendered descending).
function monthRows(rows, key) {
  return rows
    .filter((r) => txMonthKey(r.transaction_date) === key)
    .sort((a, b) => new Date(b.transaction_date) - new Date(a.transaction_date));
}

// MYR conversion + income/expense totals for one set of rows. The Map is keyed
// by transaction id so the table/CSV/share strip reuse the same conversions.
async function totalsFor(rows) {
  const myrTotals = new Map();
  let income = 0;
  let expense = 0;
  let skipped = 0;

  const results = await Promise.allSettled(
    rows.map((r) =>
      r.currency === 'MYR'
        ? Promise.resolve(Number(r.amount))
        : convert(Number(r.amount), r.currency, 'MYR', r.transaction_date),
    ),
  );

  rows.forEach((r, i) => {
    const myr = results[i].status === 'fulfilled' ? results[i].value : null;
    const isSpend = r.direction === 'debit' && !r.transfer_group_id;
    const isIncome = r.direction === 'credit' && !r.transfer_group_id;
    if (myr === null) {
      if (isSpend) skipped += 1;
      myrTotals.set(r.id, null);
      return;
    }
    myrTotals.set(r.id, myr);
    if (isSpend) expense += myr;
    else if (isIncome) income += myr;
  });

  return { myrTotals, income, expense, skipped };
}

// Per-day debit spend for the selected month, zero-filled from day 1 through
// today (current month) or the month's last day (past/future months).
function buildTrend(rows, myrTotals, key) {
  const { year, month } = parseMonthKey(key);
  const isCurrent = key === currentMonthKey();
  const count = isCurrent ? mytNow().getUTCDate() : daysInMonth(key);
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;

  const byDay = new Map();
  for (const r of rows) {
    if (r.direction !== 'debit' || r.transfer_group_id) continue;
    const myr = myrTotals.get(r.id);
    if (myr === null || myr === undefined) continue;
    const day = mytDateKey(r.transaction_date);
    if (!day) continue;
    byDay.set(day, (byDay.get(day) ?? 0) + myr);
  }

  const days = [];
  const values = [];
  for (let d = 1; d <= count; d++) {
    const ymd = `${prefix}-${String(d).padStart(2, '0')}`;
    days.push(ymd);
    values.push(Math.round((byDay.get(ymd) ?? 0) * 100) / 100);
  }
  return { days, values };
}

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
    allTransactions,
    categoryNames,
    heartbeat,
    alerts,
    currencies,
    tagGroups,
    accounts,
    budgets,
  ] = await Promise.all([
    getAllTransactions(),
    getCategories(),
    getLatestHeartbeat(),
    getOpenAlerts(),
    getCurrencies(),
    getTagGroups(),
    listAccounts(),
    listBudgets(),
  ]);
  setCurrencySymbols(currencies);

  await renderLoaded(root, {
    allTransactions,
    categoryNames,
    heartbeat,
    alerts,
    tagGroups,
    accounts,
    budgets,
  });
}

// Re-renders the view from an ALREADY loaded payload. Month navigation goes
// through here, so switching months never re-fetches the whole history.
async function renderLoaded(root, data) {
  root.replaceChildren();

  const {
    allTransactions,
    categoryNames,
    heartbeat,
    alerts,
    tagGroups,
    accounts,
    budgets,
  } = data;

  if (!selectedMonth) selectedMonth = currentMonthKey();
  const month = selectedMonth;
  const transactions = monthRows(allTransactions, month);

  // Phase 3: account display names + a per-transfer pair map (which half is
  // the source = debit side, which is the destination = credit side). The pair
  // is what turns both halves into an "A → B" display in the table. Built from
  // the full history so a pair whose halves sit in different months still
  // resolves both sides.
  const accountNames = new Map(accounts.map((a) => [a.id, a.name]));
  const transferPairs = new Map();
  for (const tx of allTransactions) {
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

  // Month figures + the month-before figures (for the comparison line under
  // the tiles). Both go through the same FX-at-tx-date helper.
  const stats = await totalsFor(transactions);
  const prevMonth = shiftMonthKey(month, -1);
  const prevStats = await totalsFor(monthRows(allTransactions, prevMonth));
  const trend = buildTrend(transactions, stats.myrTotals, month);

  const rerender = async (key) => {
    // Leaving edit mode mid-switch would drop accumulated edits — save first
    // and stay on the current month if the save fails.
    if (editMode && !(await flushDirty())) return;
    selectedMonth = key;
    await renderLoaded(root, data);
  };

  const header = document.createElement('div');
  header.className = 'd-flex flex-wrap justify-content-between align-items-center gap-2 mb-3';
  const left = document.createElement('div');
  left.className = 'd-flex flex-wrap align-items-center gap-2';
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
    accountsManageBtn(accounts, allTransactions),
    budgetsManageBtn(),
    csvExportBtn(
      debits,
      credits,
      transfers,
      stats.myrTotals,
      categoryNames,
      accountNames,
      transferPairs,
      month,
    ),
  );
  header.append(left, monthBar(month, rerender));
  root.appendChild(header);

  // Part 6 — "one-screen overview": summary tiles + an accounts overview row.
  // `#total-myr` moves from the header into the expense tile — same id, same
  // value — so the e2e assertions are untouched.
  root.appendChild(summaryStrip(stats.income, stats.expense));
  root.appendChild(comparisonLine(stats, prevStats, prevMonth));
  // Balances are a full-history estimate (opening balance + every loaded
  // flow), not a per-month figure — a one-month window would understate them.
  const visibleAccounts = accounts.filter((a) => !a.is_hidden);
  if (visibleAccounts.length > 0) {
    root.appendChild(accountsOverview(visibleAccounts, allTransactions));
  }

  // Part 6 (exact) — BeeCount one-screen home widgets. All three panels
  // (asset composition, category share, spending trend) compute EXCLUSIVELY
  // from data already loaded above — no new fetches — so the e2e fixtures
  // that only mock the dashboard's normal routes keep passing untouched.
  try {
    await homeOverview(root, {
      accounts,
      transactions: allTransactions,
      debits,
      myrTotals: stats.myrTotals,
      categoryNames,
      trend,
    });
  } catch (err) {
    // A widget failure must never take down the dashboard render.
    console.error('home overview failed:', err);
  }

  if (stats.skipped > 0) {
    root.appendChild(
      alertBanner({
        type: 'info',
        message: `${stats.skipped} ${t('dash.skippedSuffix')}`,
      }),
    );
  }

  // Phase 4 budgets (§4.9): inline progress bars, computed at display time
  // from the SAME month rows as the tiles — no extra fetch, and switching the
  // month switches the budget spend with it.
  if (budgets.length > 0) {
    root.appendChild(await budgetsSection(budgets, transactions, month));
  }

  if (debits.length === 0 && credits.length === 0 && transfers.length === 0) {
    const empty = document.createElement('p');
    empty.id = 'dash-empty-month';
    empty.className = 'text-center text-muted py-4';
    empty.textContent = `${t('dash.emptyMonth')} ${monthLabel(month)}`;
    root.appendChild(empty);
  }

  const tableProps = {
    categoryNames,
    allTags,
    accounts,
    accountNames,
    transferPairs,
    myrTotals: stats.myrTotals,
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
// recurring flag stays in sync with the actual data. Exports every row of the
// SELECTED month (debits, credits, and transfer halves — nothing hidden);
// transfer rows get Direction "Transfer" and the Account shows the pair "A → B".
function csvExportBtn(debits, credits, transfers, myrTotals, categoryNames, accountNames, transferPairs, month) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-sm btn-outline-secondary';
  btn.id = 'csv-export-btn';
  btn.textContent = t('dash.export');
  btn.addEventListener('click', () =>
    downloadCsv(debits, credits, transfers, myrTotals, categoryNames, accountNames, transferPairs, month),
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

// "Budgets" opens the budget manager (overall + per-category targets). The
// spend-vs-budget bars render from the same table the manager edits.
function budgetsManageBtn() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'budgets-manage-btn';
  btn.className = 'btn btn-sm btn-outline-secondary';
  btn.textContent = t('budgets.manage');
  btn.addEventListener('click', () =>
    openBudgetManager({
      onChanged: async () => {
        if (editMode) await flushDirty();
        refresh();
      },
    }),
  );
  return btn;
}

// Budgets section (Phase 4, §4.9): one progress bar per budget — overall
// (category_id NULL) or per-category. Parent budgets count child-category
// spend (decision 3). Read-only, computed at display time; over-budget bars
// turn danger-coloured. Spend comes from the SAME month rows as the tiles, so
// the section follows the month selector without another fetch.
async function budgetsSection(budgets, monthTxns, month) {
  const tree = await getCategoryTree();
  const rows = await computeBudgetSpend(budgets, tree, monthTxns);

  const box = document.createElement('div');
  box.id = 'budgets-section';
  box.className = 'card mb-3';
  const head = document.createElement('div');
  head.className = 'card-header';
  head.textContent = `${t('budgets.sectionTitle')} · ${monthLabel(month)}`;
  const body = document.createElement('div');
  body.className = 'card-body py-3';

  for (const r of rows) {
    const pct = r.amount > 0 ? Math.min(100, (r.spent / r.amount) * 100) : 0;
    const over = r.spent > r.amount;
    const row = document.createElement('div');
    row.className = 'mb-3';
    row.style.maxWidth = '520px';
    const top = document.createElement('div');
    top.className = 'd-flex justify-content-between small mb-1';
    const name = document.createElement('span');
    name.textContent = r.label;
    const meta = document.createElement('span');
    meta.className = over ? 'text-danger fw-semibold' : 'text-muted';
    meta.textContent = `${formatMoney(r.spent, 'MYR')} / ${formatMoney(r.amount, 'MYR')}`;
    top.append(name, meta);
    const bar = document.createElement('div');
    bar.className = 'progress';
    bar.style.height = '8px';
    const fill = document.createElement('div');
    fill.className = `progress-bar${over ? ' bg-danger' : ''}`;
    fill.style.width = `${pct}%`;
    fill.setAttribute('role', 'progressbar');
    bar.appendChild(fill);
    row.append(top, bar);
    body.appendChild(row);
  }
  box.append(head, body);
  return box;
}

// Compute spend per budget for the selected month. Debits only, transfers
// excluded, every amount converted to MYR at its own date (ADR 0003).
// `ids = null` means the overall budget (all debits); otherwise the category +
// descendants.
async function computeBudgetSpend(budgets, tree, txns) {
  const childrenOf = new Map();
  for (const c of tree) {
    if (!c.parent_id) continue;
    if (!childrenOf.has(c.parent_id)) childrenOf.set(c.parent_id, []);
    childrenOf.get(c.parent_id).push(c.id);
  }
  const descendantSet = (rootId) => {
    const set = new Set([rootId]);
    const stack = [rootId];
    while (stack.length) {
      const id = stack.pop();
      for (const ch of childrenOf.get(id) ?? []) {
        if (!set.has(ch)) {
          set.add(ch);
          stack.push(ch);
        }
      }
    }
    return set;
  };

  const debits = txns.filter((tx) => tx.direction === 'debit' && !tx.transfer_group_id);
  const converted = await Promise.allSettled(
    debits.map((tx) =>
      tx.currency === 'MYR'
        ? Promise.resolve(Number(tx.amount))
        : convert(Number(tx.amount), tx.currency, 'MYR', tx.transaction_date),
    ),
  );
  const names = new Map(tree.map((c) => [c.id, c.name]));

  return budgets.map((b) => {
    const ids = b.category_id ? descendantSet(b.category_id) : null;
    let spent = 0;
    for (let j = 0; j < debits.length; j++) {
      const tx = debits[j];
      if (ids && !(tx.category_id && ids.has(tx.category_id))) continue;
      const myr = converted[j].status === 'fulfilled' ? converted[j].value : null;
      if (myr === null) continue;
      spent += myr;
    }
    return {
      label: b.category_id ? (names.get(b.category_id) ?? t('col.unknown')) : t('budgets.overall'),
      amount: Number(b.amount),
      spent: Math.round(spent * 100) / 100,
    };
  });
}

function downloadCsv(debits, credits, transfers, myrTotals, categoryNames, accountNames, transferPairs, month) {
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
  a.download = `transactions_${month ?? new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeCsv(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Part 6 — summary tile strip: month income / expense (`#total-myr`) / net.
function summaryStrip(income, expense) {
  const strip = document.createElement('div');
  strip.className = 'row g-2 mb-3';
  strip.id = 'summary-strip';

  const tile = (label, value, extra) => {
    const col = document.createElement('div');
    col.className = 'col-6 col-md-4';
    const card = document.createElement('div');
    card.className = 'summary-tile';
    const lbl = document.createElement('div');
    lbl.className = 'tile-label';
    lbl.textContent = label;
    const val = document.createElement('div');
    val.className = `tile-value${extra ? ` ${extra}` : ''}`;
    val.textContent = value;
    card.append(lbl, val);
    col.appendChild(card);
    return col;
  };

  strip.appendChild(tile(t('dash.income'), formatMoney(income, 'MYR')));
  const expenseTile = tile(t('dash.spentLabel'), formatMoney(expense, 'MYR'));
  expenseTile.querySelector('.tile-value').id = 'total-myr';
  strip.appendChild(expenseTile);
  const net = income - expense;
  strip.appendChild(tile(t('dash.net'), formatMoney(net, 'MYR'), net >= 0 ? 'pos' : 'neg'));
  return strip;
}

// Month selector: ‹ / label / › plus a native month picker and a "This month"
// reset. Changing the month re-renders from the already-loaded rows — the
// history is fetched once per dashboard render, not per month.
function monthBar(month, onSelect) {
  const bar = document.createElement('div');
  bar.id = 'dash-month-bar';
  bar.className = 'd-flex flex-wrap align-items-center gap-2';

  const navBtn = (id, label, text, delta) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = id;
    btn.className = 'btn btn-sm btn-outline-secondary';
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.textContent = text;
    btn.addEventListener('click', () => onSelect(shiftMonthKey(month, delta)));
    return btn;
  };

  const label = document.createElement('div');
  label.id = 'dash-month-label';
  label.className = 'fw-semibold px-1';
  label.textContent = monthLabel(month);

  const picker = document.createElement('input');
  picker.type = 'month';
  picker.id = 'month-picker';
  picker.className = 'form-control form-control-sm';
  picker.style.maxWidth = '9.5rem';
  picker.value = month;
  picker.setAttribute('aria-label', t('dash.monthJump'));
  picker.addEventListener('change', () => {
    if (/^\d{4}-\d{2}$/.test(picker.value)) onSelect(picker.value);
  });

  const thisMonth = document.createElement('button');
  thisMonth.type = 'button';
  thisMonth.id = 'month-this';
  thisMonth.className = 'btn btn-sm btn-link text-decoration-none';
  thisMonth.textContent = t('dash.monthThis');
  thisMonth.disabled = month === currentMonthKey();
  thisMonth.addEventListener('click', () => onSelect(currentMonthKey()));

  bar.append(
    navBtn('month-prev', t('dash.monthPrev'), '‹', -1),
    label,
    navBtn('month-next', t('dash.monthNext'), '›', 1),
    picker,
    thisMonth,
  );
  return bar;
}

// Month-over-month deltas under the tiles: "vs October 2026 · Spent ▼ 12.3% ·
// Income ▲ 4.0%". Rising spending is bad (danger), rising income is good
// (success); a month with no spend/income baseline shows "no data" instead of a
// divide-by-zero percentage.
function comparisonLine(current, previous, prevKey) {
  const line = document.createElement('div');
  line.id = 'month-compare';
  line.className = 'small text-muted mb-3 d-flex flex-wrap align-items-center gap-3';

  const vs = document.createElement('span');
  vs.textContent = `${t('dash.compare.vs')} ${monthLabel(prevKey)}`;
  line.appendChild(vs);

  const change = (label, cur, prev, higherIsBad) => {
    const chip = document.createElement('span');
    if (prev === 0) {
      chip.textContent = `${label} — ${t('dash.compare.noBaseline')}`;
      return chip;
    }
    const pct = ((cur - prev) / prev) * 100;
    const up = pct > 0.05;
    const down = pct < -0.05;
    const good = higherIsBad ? down : up;
    const bad = higherIsBad ? up : down;
    chip.className = good ? 'text-success' : bad ? 'text-danger' : 'text-muted';
    const arrow = up ? '▲' : down ? '▼' : '·';
    chip.textContent = `${label} ${arrow} ${Math.abs(pct).toFixed(1)}%`;
    return chip;
  };

  line.appendChild(change(t('dash.compare.spent'), current.expense, previous.expense, true));
  line.appendChild(change(t('dash.compare.income'), current.income, previous.income, false));
  return line;
}

// Part 6 — accounts overview row: per-account estimated balance (opening +
// loaded-window flow, same math as the account manager) + a currency chip.
function accountsOverview(accounts, transactions) {
  const wrap = document.createElement('div');
  wrap.className = 'mb-3';
  wrap.id = 'accounts-overview';

  const label = document.createElement('div');
  label.className = 'overview-label';
  label.textContent = t('dash.accounts');
  wrap.appendChild(label);

  const row = document.createElement('div');
  row.className = 'd-flex flex-wrap gap-2';
  for (const acc of accounts) {
    const chip = document.createElement('span');
    chip.className = 'account-chip';

    const name = document.createElement('span');
    name.className = 'chip-name';
    name.textContent = acc.name;

    const balance = document.createElement('span');
    balance.className = 'chip-balance';
    balance.textContent = formatMoney(estBalance(acc, transactions), acc.currency || 'MYR');

    const cur = document.createElement('span');
    cur.className = 'chip-cur';
    cur.textContent = acc.currency || 'MYR';

    chip.append(name, balance, cur);
    row.appendChild(chip);
  }
  wrap.appendChild(row);
  return wrap;
}

// Same estimate the account manager shows: opening balance + net flow across
// the full loaded history (transfers included — a transfer half moves its own
// account's balance, which is exactly what we want here).
function estBalance(account, txns) {
  let sum = Number(account.opening_balance ?? 0);
  for (const tx of txns) {
    if (tx.account_id !== account.id) continue;
    sum += tx.direction === 'credit' ? Number(tx.amount) : -Number(tx.amount);
  }
  return sum;
}

// --------------------------- Part 6 (exact) — BeeCount one-screen home widgets

// Three panels rendered right under the summary tiles: asset composition
// (doughnut of est. balances over full history), category share (top-5 spend
// bar strip for the selected month) and a per-day spending trend for that same
// month. Everything is computed from data renderDashboard ALREADY loaded — no
// new fetches — so the e2e fixtures that only mock the dashboard's normal
// routes keep passing untouched.
//
// Chart.js is loaded via dynamic import (shared chunk with Reports) and every
// instance is tracked so re-renders destroy old canvases; a theme flip
// rebuilds the charts in-place (never the whole dashboard — edit mode locks
// in dirty rows and a full re-render would drop them).
let homeCharts = [];
let homeRebuild = null;
let homeThemeWatcherInstalled = false;

const HOME_PALETTE = [
  '#10b981', '#0ea5e9', '#f59e0b', '#8b5cf6', '#ef4444',
  '#14b8a6', '#f97316', '#d946ef', '#84cc16', '#94a3b8',
];

async function homeOverview(root, { accounts, transactions, debits, myrTotals, categoryNames, trend }) {
  homeCharts.forEach((c) => c.destroy());
  homeCharts = [];
  homeRebuild = null;

  const wrap = document.createElement('div');
  wrap.className = 'row g-3 mb-3';
  wrap.id = 'home-overview';

  const panel = (labelText) => {
    const col = document.createElement('div');
    col.className = 'col-12 col-lg-4';
    const card = document.createElement('div');
    card.className = 'home-panel';
    const label = document.createElement('div');
    label.className = 'overview-label';
    label.textContent = labelText;
    const box = document.createElement('div');
    box.className = 'chart-box';
    card.append(label, box);
    col.appendChild(card);
    wrap.appendChild(col);
    return box;
  };

  const assetBox = panel(t('dash.assetComposition'));
  const shareBox = panel(t('dash.categoryShare'));
  const trendBox = panel(t('dash.trend'));
  root.appendChild(wrap);

  // ---- asset composition: visible accounts, balances to MYR (MYR short-
  // circuits in convert(); non-MYR balances use the latest rate — a balance
  // snapshot is a "now" view, per ADR 0001).
  const visible = accounts.filter((a) => !a.is_hidden);
  const balanceRows = await Promise.all(
    visible.map(async (acc) => {
      const bal = estBalance(acc, transactions);
      if (bal <= 0) return null;
      const myr = acc.currency === 'MYR'
        ? bal
        : await convert(bal, acc.currency, 'MYR').catch(() => null);
      return myr === null ? null : { name: acc.name, myr: Math.round(myr * 100) / 100 };
    }),
  );
  const assetSlices = balanceRows.filter(Boolean);

  // ---- category share: top 5 debits by MYR spend.
  const sums = new Map();
  for (const tx of debits) {
    const myr = myrTotals.get(tx.id);
    if (myr === null || myr === undefined) continue;
    const name = tx.category_id && categoryNames.get(tx.category_id)
      ? categoryNames.get(tx.category_id)
      : t('col.unknown');
    sums.set(name, (sums.get(name) ?? 0) + myr);
  }
  const ranked = [...sums.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const shareTotal = ranked.reduce((s, [, v]) => s + v, 0);

  // ---- trend: per-day debit spend for the selected month, zero-filled
  // across the month (day 1 → today for the current month).
  const trendDays = trend?.days ?? [];
  const trendValues = trend?.values ?? [];

  // ---- static share strip (CSS bars, no canvas → theme-safe).
  if (ranked.length === 0 || shareTotal <= 0) {
    const empty = document.createElement('div');
    empty.className = 'home-empty';
    empty.textContent = t('dash.noTrendData');
    shareBox.appendChild(empty);
  } else {
    for (const [name, value] of ranked) {
      const row = document.createElement('div');
      row.className = 'share-row';
      const top = document.createElement('div');
      top.className = 'share-top';
      const nm = document.createElement('span');
      nm.className = 'share-name';
      nm.textContent = name;
      const amt = document.createElement('span');
      amt.className = 'share-amount';
      amt.textContent = formatMoney(value, 'MYR');
      top.append(nm, amt);
      const bar = document.createElement('div');
      bar.className = 'progress share-bar';
      const fill = document.createElement('div');
      fill.className = 'progress-bar';
      fill.style.width = `${Math.round((value / shareTotal) * 100)}%`;
      fill.setAttribute('role', 'progressbar');
      bar.appendChild(fill);
      row.append(top, bar);
      shareBox.appendChild(row);
    }
  }

  // ---- canvases: doughnut + trend. Built by one closure so a theme flip can
  // destroy + redraw both with the active palette, in place.
  const { default: Chart } = await import('chart.js/auto');

  const drawCharts = async () => {
    homeCharts.forEach((c) => c.destroy());
    homeCharts = [];
    const isDark = document.documentElement.dataset.bsTheme === 'dark';
    const palette = {
      grid: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
      text: isDark ? '#adb5bd' : '#495057',
    };

    // Assets: only render a doughnut when there is at least one positive slice.
    if (assetSlices.length > 0) {
      assetBox.replaceChildren();
      const canvas = document.createElement('canvas');
      assetBox.appendChild(canvas);
      homeCharts.push(
        new Chart(canvas, {
          type: 'doughnut',
          data: {
            labels: assetSlices.map((s) => s.name),
            datasets: [
              {
                data: assetSlices.map((s) => s.myr),
                backgroundColor: assetSlices.map((_, i) => HOME_PALETTE[i % HOME_PALETTE.length]),
                borderWidth: 2,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '62%',
            plugins: {
              legend: { labels: { color: palette.text, boxWidth: 12, padding: 14 } },
            },
          },
        }),
      );
    } else {
      assetBox.replaceChildren();
      const empty = document.createElement('div');
      empty.className = 'home-empty';
      empty.textContent = t('dash.noAssetData');
      assetBox.appendChild(empty);
    }

    // Trend: line over the loaded days; flat empty-state when nothing spent.
    if (trendDays.length > 0 && trendValues.some((v) => v > 0)) {
      trendBox.replaceChildren();
      const canvas = document.createElement('canvas');
      trendBox.appendChild(canvas);
      homeCharts.push(
        new Chart(canvas, {
          type: 'line',
          data: {
            labels: trendDays.map((d) => d.slice(8)),
            datasets: [
              {
                label: t('dash.trend'),
                data: trendValues,
                borderColor: '#10b981',
                backgroundColor: 'rgba(16,185,129,0.12)',
                fill: true,
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.25,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { ticks: { color: palette.text, maxTicksLimit: 6 }, grid: { display: false } },
              y: { ticks: { color: palette.text }, grid: { color: palette.grid } },
            },
          },
        }),
      );
    } else {
      trendBox.replaceChildren();
      const empty = document.createElement('div');
      empty.className = 'home-empty';
      empty.textContent = t('dash.noTrendData');
      trendBox.appendChild(empty);
    }
  };

  homeRebuild = drawCharts;
  await drawCharts();

  // Theme watcher: charts paint with literals (canvas), so a theme flip must
  // redraw them. The observer survives navigation (module-level flag) and only
  // rebuilds charts — never the whole dashboard, so edit-mode rows survive.
  if (!homeThemeWatcherInstalled) {
    homeThemeWatcherInstalled = true;
    new MutationObserver(() => {
      if (homeRebuild) homeRebuild().catch(() => {});
    }).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-bs-theme'],
    });
  }
}
