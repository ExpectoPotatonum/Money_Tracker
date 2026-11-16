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
import {
  currentMonthKey,
  mytNow,
  mytDateKey,
  parseMonthKey,
  monthLabel,
  shiftMonthKey,
  daysInMonth,
  monthRows,
} from '../utils/months.js';
import { alertBanner } from '../components/common.js';
import { transactionTable } from '../components/transactionTable.js';
import { openNlModal } from '../components/nlModal.js';
import { openTransferDialog } from '../components/transferDialog.js';
import { getTagGroups, setTransactionTags } from '../api/tags.js';
import { t } from '../lib/i18n.js';
import { icon } from '../utils/icons.js';

const OFFLINE_AFTER_HOURS = 6;

// The selected calendar month (`YYYY-MM`). `null` means "current month, MYT" —
// resolved on first render and kept across re-renders so an edit or a refresh
// doesn't jump back to today's month.
let selectedMonth = null;

// Edit mode is a dashboard-level toggle (all rows editable at once). Edits are
// accumulated per-row in `dirtyRows` as the user types and PATCHed in one pass
// when edit mode is toggled off — no per-row Save buttons (whatnext #5).
let editMode = false;
let refresh = null;
let softRefresh = null;
// Everything the current dashboard render was built from. Saves patch this in
// memory and re-render from it — never a network round-trip and never a route
// change, so the selected month and scroll position survive.
let loaded = null;
let currentRoot = null;
const dirtyRows = new Map();
let hashchangeGuardInstalled = false;
let dataChangedListenerInstalled = false;

// ------------------------------ calendar-month helpers (Malaysia time)
// Month boundaries live in utils/months.js — shared with the CSV export dialog.

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
  currentRoot = root;

  // Targeted updates: rebuild from the in-memory payload (no network) while
  // keeping the document scroll position and focus where they were. Inline
  // saves patch `loaded` first, then call this.
  softRefresh = async () => {
    if (!loaded) return;
    const scroll = window.scrollY;
    const active = document.activeElement;
    const focusId = active && active.id ? active.id : null;
    await renderLoaded(root, loaded);
    window.scrollTo(0, scroll);
    if (focusId) document.getElementById(focusId)?.focus();
  };
  // Full reload — only for create actions and sidebar managers, which may have
  // changed rows the dashboard doesn't hold (bulk account backfills, categories,
  // budgets).
  refresh = async () => {
    await loadDashboard(root);
  };

  // If the user navigates away with edit mode on, don't silently drop edits —
  // flush them before the next view swaps in.
  if (!hashchangeGuardInstalled) {
    hashchangeGuardInstalled = true;
    window.addEventListener('hashchange', async () => {
      if (editMode) await flushDirty();
    });
  }
  // Sidebar managers (tags/accounts/categories/budgets) dispatch this after a
  // change. Re-read only when THIS dashboard is the mounted view.
  if (!dataChangedListenerInstalled) {
    dataChangedListenerInstalled = true;
    window.addEventListener('mt:data-changed', () => {
      if (loaded && currentRoot?.isConnected) refresh();
    });
  }

  await loadDashboard(root);
}

async function loadDashboard(root) {
  const [
    allTransactions,
    categoryNames,
    categoryTree,
    heartbeat,
    alerts,
    currencies,
    tagGroups,
    accounts,
    budgets,
  ] = await Promise.all([
    getAllTransactions(),
    getCategories(),
    getCategoryTree(),
    getLatestHeartbeat(),
    getOpenAlerts(),
    getCurrencies(),
    getTagGroups(),
    listAccounts(),
    listBudgets(),
  ]);
  setCurrencySymbols(currencies);

  loaded = {
    allTransactions,
    categoryNames,
    categoryTree,
    heartbeat,
    alerts,
    tagGroups,
    accounts,
    budgets,
  };
  await renderLoaded(root, loaded);
}

// Re-renders the view from an ALREADY loaded payload. Month navigation goes
// through here, so switching months never re-fetches the whole history.
async function renderLoaded(root, data) {
  root.replaceChildren();

  const {
    allTransactions,
    categoryNames,
    categoryTree,
    heartbeat,
    alerts,
    tagGroups,
    accounts,
    budgets,
  } = data;

  if (!selectedMonth) selectedMonth = currentMonthKey();
  const month = selectedMonth;
  const transactions = monthRows(allTransactions, month);

  // id -> hex colour, from the category tree. Drives the tinted category pills
  // in the table and the per-category colours on the share bars; a category
  // with no colour falls back to the neutral home palette at the call site.
  const categoryColors = new Map(
    (categoryTree ?? []).filter((c) => c.color).map((c) => [c.id, c.color]),
  );

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
  const debits = transactions.filter((t) => t.direction === 'debit' && !t.transfer_group_id);
  const credits = transactions.filter((t) => t.direction === 'credit' && !t.transfer_group_id);
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
  header.className =
    'dash-header d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3';
  const left = document.createElement('div');
  left.className = 'd-flex flex-wrap align-items-center gap-2';
  const h = document.createElement('h1');
  h.className = 'h3 mb-0';
  h.textContent = t('dash.title');
  const addBtn = iconButton({
    id: 'nl-add-btn',
    iconName: 'textT',
    label: t('nl.title'),
    onClick: () =>
      openNlModal({
        categoryNames,
        accounts,
        onSaved: (saved) => {
          if (saved) mergeRows([saved]);
          softRefresh();
        },
      }),
  });
  // Edit mode is a CSS-drawn toggle switch (no .btn, no svg). It keeps
  // role="switch" + aria-checked because the e2e asserts aria-checked.
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.id = 'edit-mode-toggle';
  editBtn.className = 'edit-switch';
  editBtn.setAttribute('role', 'switch');
  editBtn.setAttribute('aria-checked', String(editMode));
  editBtn.setAttribute('aria-label', t('dash.editMode'));
  editBtn.title = t('dash.editMode');
  const knob = document.createElement('span');
  knob.className = 'edit-switch-knob';
  editBtn.appendChild(knob);
  const syncEditBtn = () => {
    editBtn.setAttribute('aria-checked', String(editMode));
    editBtn.classList.toggle('is-on', editMode);
    editBtn.setAttribute('aria-label', editMode ? t('dash.editModeOn') : t('dash.editMode'));
    editBtn.title = editBtn.getAttribute('aria-label');
  };
  editBtn.addEventListener('click', async () => {
    if (editMode) {
      // Leaving edit mode persists every pending change; on failure stay in
      // edit mode so the user's edits survive for another try.
      if (await flushDirty()) editMode = false;
    } else {
      editMode = true;
    }
    syncEditBtn();
    softRefresh();
  });
  syncEditBtn();
  left.append(h, addBtn, transferBtn(accounts), editBtn);
  header.append(left, monthBar(month, rerender));
  root.appendChild(header);

  // Part 6 — "one-screen overview": summary tiles + an accounts overview row.
  // `#total-myr` moves from the header into the expense tile — same id, same
  // value — so the e2e assertions are untouched. The month-over-month deltas
  // live inside the INCOME and SPENT tiles now; the `#month-compare` id stays
  // on the wrapper so the existing month-scoping assertions still resolve.
  root.appendChild(summaryStrip(stats, prevStats, prevMonth));
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
      categoryColors,
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
    root.appendChild(await budgetsSection(budgets, transactions, month, categoryTree));
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
    categoryColors,
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
      // Saves are targeted: drop the row from the in-memory payload and
      // rebuild from it. No refetch, no route change, month stays put.
      loaded.allTransactions = loaded.allTransactions.filter((r) => r.id !== id);
      await softRefresh();
    },
    // Transfers delete BOTH halves in one request (app-enforced pairing) —
    // a per-half delete would orphan the other half. Confirmed separately
    // because it removes two rows, not one.
    onDeleteTransfer: async (groupId) => {
      if (!window.confirm(t('transfer.deleteConfirm'))) return;
      await deleteTransfer(groupId);
      loaded.allTransactions = loaded.allTransactions.filter(
        (r) => r.transfer_group_id !== groupId,
      );
      await softRefresh();
    },
    onToggleRecurring: async (id, value) => {
      await updateTransaction(id, { is_recurring: value });
      patchRow(id, { is_recurring: value });
      await softRefresh();
    },
    // Blank-category rows show an inline picker (read-only mode); a choice
    // PATCHes that row immediately. The cell updates in place — totals don't
    // depend on category, so there is nothing else to recompute.
    onCategorize: async (id, categoryId) => {
      await updateTransaction(id, { category_id: categoryId });
      patchRow(id, { category_id: categoryId });
      setCellText(id, 'category', categoryNames.get(categoryId) ?? '');
    },
    // Blank-account rows show an inline picker (read-only mode); a choice
    // PATCHes that row immediately, same targeted pattern.
    onAssignAccount: async (id, accountId) => {
      await assignAccount(id, accountId);
      patchRow(id, { account_id: accountId });
      setCellText(id, 'account', accountNames.get(accountId) ?? '');
    },
    // Tag toggles replace the row's tag set in the M2M table immediately —
    // tags are a separate table, so they can't ride the batched transactions
    // PATCH that flushes on edit-mode toggle-off. Mirror the new set into the
    // in-memory row so the rebuild shows it without refetching.
    onSetTags: async (id, tagIds) => {
      await setTransactionTags(id, tagIds);
      const chosen = new Set(tagIds);
      patchRow(id, { tags: allTags.filter((tag) => chosen.has(tag.id)) });
      await softRefresh();
    },
  };
  // "Recent Transactions" — the main spending table, now under a heading with a
  // client-side search + category filter bar. The other two tables keep their
  // own headings and are unfiltered.
  root.appendChild(
    recentTransactions({
      transactions: debits,
      tableProps,
      categoryNames,
    }),
  );

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

// The main spending table + a heading and a search / category filter bar. The
// filter is purely client-side: it shows/hides already-rendered rows, so typing
// never triggers a re-render (which would drop the search field's focus).
function recentTransactions({ transactions, tableProps, categoryNames }) {
  const section = document.createElement('section');
  section.id = 'recent-transactions';
  section.className = 'mt-4';

  const head = document.createElement('div');
  head.className =
    'dash-section-head d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2';
  const title = document.createElement('h2');
  title.className = 'h5 mb-0';
  title.textContent = t('dash.recent');
  head.appendChild(title);

  const toolbar = document.createElement('div');
  toolbar.className = 'd-flex flex-wrap align-items-center gap-2';

  const searchWrap = document.createElement('div');
  searchWrap.className = 'input-group input-group-sm tx-search';
  const searchIcon = document.createElement('span');
  searchIcon.className = 'input-group-text';
  searchIcon.appendChild(icon('search', { size: 15 }));
  const search = document.createElement('input');
  search.type = 'search';
  search.id = 'tx-search';
  search.className = 'form-control';
  search.placeholder = t('dash.search');
  search.setAttribute('aria-label', t('dash.search'));
  searchWrap.append(searchIcon, search);

  const filter = document.createElement('select');
  filter.id = 'tx-category-filter';
  filter.className = 'form-select form-select-sm w-auto';
  filter.setAttribute('aria-label', t('dash.filterCategory'));
  const allOpt = document.createElement('option');
  allOpt.value = '';
  allOpt.textContent = t('dash.filterCategory');
  filter.appendChild(allOpt);
  // Only categories that actually appear in this month's rows (and, when the
  // tree carries colours, in a stable alphabetical order via categoryNames).
  const present = new Set(transactions.map((tx) => tx.category_id).filter(Boolean));
  for (const [id, name] of categoryNames) {
    if (!present.has(id)) continue;
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = name;
    filter.appendChild(opt);
  }

  toolbar.append(searchWrap, filter);
  head.appendChild(toolbar);

  const table = transactionTable({ transactions, ...tableProps });

  const apply = () => {
    const q = search.value.trim().toLowerCase();
    const cat = filter.value;
    const rows = table.querySelectorAll('tbody tr');
    let shown = 0;
    for (const tr of rows) {
      const matchesText = !q || tr.textContent.toLowerCase().includes(q);
      const matchesCat = !cat || tr.dataset.cat === cat;
      const ok = matchesText && matchesCat;
      tr.classList.toggle('d-none', !ok);
      if (ok) shown += 1;
    }
    empty.classList.toggle('d-none', shown > 0);
  };
  search.addEventListener('input', apply);
  filter.addEventListener('change', apply);

  const empty = document.createElement('p');
  empty.className = 'text-center text-muted py-4 d-none';
  empty.textContent = t('dash.noMatches');

  section.append(head, table, empty);
  return section;
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
    } else {
      // Keep the in-memory payload in step with what was just PATCHed, so the
      // read-mode rebuild after toggle-off shows the new values without a
      // second fetch.
      patchRow(pending[i][0], pending[i][1]);
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

// In-memory mutation helpers — the backing store for targeted updates.
function patchRow(id, patch) {
  const row = loaded?.allTransactions.find((r) => r.id === id);
  if (row) Object.assign(row, patch);
}

function mergeRows(rows) {
  if (!loaded || !Array.isArray(rows)) return;
  for (const row of rows) {
    if (!row) continue;
    const existing = loaded.allTransactions.findIndex((r) => r.id === row.id);
    if (existing >= 0) loaded.allTransactions[existing] = row;
    else loaded.allTransactions.push(row);
  }
}

// Replace one cell's text in place (used by the inline pickers, where a full
// rebuild would discard the very dropdown the user just used).
function setCellText(id, col, text) {
  const tr = currentRoot?.querySelector(`tr[data-tx-id="${id}"]`);
  const td = tr?.querySelector(`td[data-col="${col}"]`);
  if (td) td.textContent = text;
}

// Icon-only header action with an accessible name and a tooltip.
function iconButton({ id, iconName, label, onClick }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = id;
  btn.className = 'btn btn-sm btn-outline-secondary icon-btn';
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.appendChild(icon(iconName, { size: 18 }));
  btn.addEventListener('click', onClick);
  return btn;
}

// "Move money" opens the transfer dialog. New halves are merged into the
// in-memory payload so the tables refresh without a refetch.
function transferBtn(accountList) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'transfer-add-btn';
  btn.className = 'btn btn-sm btn-outline-secondary icon-btn';
  btn.title = t('col.transfer');
  btn.setAttribute('aria-label', t('col.transfer'));
  btn.appendChild(icon('transfer', { size: 18 }));
  btn.addEventListener('click', () =>
    openTransferDialog({
      accounts: accountList,
      onSaved: async (halves) => {
        if (editMode) await flushDirty();
        mergeRows(halves);
        softRefresh();
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
async function budgetsSection(budgets, monthTxns, month, categoryTree = null) {
  const tree = categoryTree ?? (await getCategoryTree());
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

// Part 6 — summary tile strip: month income / expense (`#total-myr`) / net.
// The month-over-month deltas live INSIDE the income and spent tiles (owner
// request) rather than on a separate line. `#month-compare` stays on the
// wrapper so the existing month-scoping e2e assertions still resolve.
function summaryStrip(current, previous, prevKey) {
  const wrap = document.createElement('div');
  wrap.id = 'month-compare';
  wrap.className = 'mb-3';

  const strip = document.createElement('div');
  strip.className = 'row g-2';
  strip.id = 'summary-strip';

  // Delta chip: "<arrow> <pct>% vs <Month Year>" — rising spending is bad
  // (danger), rising income is good (success). No baseline -> "no data".
  const delta = (cur, prev, higherIsBad) => {
    const el = document.createElement('div');
    el.className = 'tile-delta';
    if (!prev) {
      el.classList.add('text-muted');
      el.textContent = t('dash.compare.noBaseline');
      return el;
    }
    const pct = ((cur - prev) / prev) * 100;
    const up = pct > 0.05;
    const down = pct < -0.05;
    const good = higherIsBad ? down : up;
    const bad = higherIsBad ? up : down;
    el.classList.add(good ? 'text-success' : bad ? 'text-danger' : 'text-muted');
    const arrow = up ? '▲' : down ? '▼' : '·';
    el.textContent = `${arrow} ${Math.abs(pct).toFixed(1)}% ${t('dash.compare.vs')} ${monthLabel(prevKey)}`;
    return el;
  };

  const tile = (label, value, extra, deltaEl) => {
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
    if (deltaEl) card.appendChild(deltaEl);
    col.appendChild(card);
    return col;
  };

  strip.appendChild(
    tile(
      t('dash.income'),
      formatMoney(current.income, 'MYR'),
      null,
      delta(current.income, previous.income, false),
    ),
  );
  const expenseTile = tile(
    t('dash.spentLabel'),
    formatMoney(current.expense, 'MYR'),
    null,
    delta(current.expense, previous.expense, true),
  );
  expenseTile.querySelector('.tile-value').id = 'total-myr';
  strip.appendChild(expenseTile);
  const net = current.income - current.expense;
  strip.appendChild(tile(t('dash.net'), formatMoney(net, 'MYR'), net >= 0 ? 'pos' : 'neg'));

  wrap.appendChild(strip);
  return wrap;
}

// Month selector: ‹ / clickable label (backed by a transparent native month
// input) / › plus a "This month" reset that only appears when you're not
// already on the current month. Changing the month re-renders from the
// already-loaded rows — the history is fetched once per dashboard render, not
// per month.
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

  // The visible label is a button-styled chip; the real <input type="month"> is
  // overlaid transparently on top of it, so clicking the label opens the native
  // picker (no separate control) and the `#month-picker` id survives for e2e.
  const labelWrap = document.createElement('span');
  labelWrap.className = 'month-label-wrap';

  const label = document.createElement('span');
  label.id = 'dash-month-label';
  label.className = 'month-label';
  label.textContent = monthLabel(month);
  labelWrap.appendChild(label);

  const picker = document.createElement('input');
  picker.type = 'month';
  picker.id = 'month-picker';
  picker.className = 'month-picker';
  picker.value = month;
  picker.setAttribute('aria-label', t('dash.monthJump'));
  picker.title = t('dash.monthJump');
  picker.addEventListener('change', () => {
    if (/^\d{4}-\d{2}$/.test(picker.value)) onSelect(picker.value);
  });
  labelWrap.appendChild(picker);

  bar.append(
    navBtn('month-prev', t('dash.monthPrev'), '‹', -1),
    labelWrap,
    navBtn('month-next', t('dash.monthNext'), '›', 1),
  );

  // Only offer the reset when it would actually do something.
  if (month !== currentMonthKey()) {
    const thisMonth = document.createElement('button');
    thisMonth.type = 'button';
    thisMonth.id = 'month-this';
    thisMonth.className = 'btn btn-sm btn-outline-secondary month-this';
    thisMonth.textContent = t('dash.monthThis');
    thisMonth.addEventListener('click', () => onSelect(currentMonthKey()));
    bar.appendChild(thisMonth);
  }
  return bar;
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
  '#10b981',
  '#0ea5e9',
  '#f59e0b',
  '#8b5cf6',
  '#ef4444',
  '#14b8a6',
  '#f97316',
  '#d946ef',
  '#84cc16',
  '#94a3b8',
];

async function homeOverview(
  root,
  { accounts, transactions, debits, myrTotals, categoryNames, categoryColors = new Map(), trend },
) {
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
      const myr =
        acc.currency === 'MYR' ? bal : await convert(bal, acc.currency, 'MYR').catch(() => null);
      return myr === null ? null : { name: acc.name, myr: Math.round(myr * 100) / 100 };
    }),
  );
  const assetSlices = balanceRows.filter(Boolean);

  // ---- category share: top 5 debits by MYR spend, each keyed by its category
  // so it can carry that category's own colour.
  const sums = new Map(); // key: category id, or '__unknown__'
  for (const tx of debits) {
    const myr = myrTotals.get(tx.id);
    if (myr === null || myr === undefined) continue;
    const hasCat = tx.category_id && categoryNames.get(tx.category_id);
    const key = hasCat ? tx.category_id : '__unknown__';
    const entry = sums.get(key) ?? {
      name: hasCat ? categoryNames.get(tx.category_id) : t('col.unknown'),
      color: hasCat ? categoryColors.get(tx.category_id) : null,
      value: 0,
    };
    entry.value += myr;
    sums.set(key, entry);
  }
  const ranked = [...sums.values()].sort((a, b) => b.value - a.value).slice(0, 5);
  const shareTotal = ranked.reduce((s, e) => s + e.value, 0);

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
    ranked.forEach((entry, i) => {
      const color = entry.color ?? HOME_PALETTE[i % HOME_PALETTE.length];
      const row = document.createElement('div');
      row.className = 'share-row';
      const top = document.createElement('div');
      top.className = 'share-top';
      const nm = document.createElement('span');
      nm.className = 'share-name';
      const dot = document.createElement('span');
      dot.className = 'share-dot';
      dot.style.backgroundColor = color;
      const nmText = document.createElement('span');
      nmText.textContent = entry.name;
      nm.append(dot, nmText);
      const pct = document.createElement('span');
      pct.className = 'share-pct';
      pct.textContent = `${Math.round((entry.value / shareTotal) * 100)}%`;
      const amt = document.createElement('span');
      amt.className = 'share-amount';
      amt.textContent = formatMoney(entry.value, 'MYR');
      top.append(nm, pct, amt);
      const bar = document.createElement('div');
      bar.className = 'progress share-bar';
      const fill = document.createElement('div');
      fill.className = 'progress-bar';
      fill.style.backgroundColor = color;
      fill.style.width = `${Math.round((entry.value / shareTotal) * 100)}%`;
      fill.setAttribute('role', 'progressbar');
      bar.appendChild(fill);
      row.append(top, bar);
      shareBox.appendChild(row);
    });
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
