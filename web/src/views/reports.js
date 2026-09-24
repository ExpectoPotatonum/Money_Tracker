// views/reports.js — Phase 4 (§4.9): balance trends + charts.
//
// A separate hash route (#/reports) so the dashboard keeps its light 30-day
// fetch; this view pulls full history (getAllTransactions) and loads Chart.js
// via dynamic import — it becomes a code-split chunk only fetched when Reports
// opens. FX goes through utils/fx.js only (ADR 0001): per-transaction converts
// via the dated cache, whole-curve rates via one timeSeries() request.

import { getAllTransactions, getCategoryTree } from '../api/transactions.js';
import { getCurrencies } from '../api/currencies.js';
import { listAccounts } from '../api/accounts.js';
import { convert, timeSeries } from '../utils/fx.js';
import { formatMoney, setCurrencySymbols } from '../utils/format.js';
import { t } from '../lib/i18n.js';

// Part 6 — emerald-forward palette aligned to the bee-green tokens. Chart.js
// paints to a canvas, so colors must be literals, not CSS variables.
const PALETTE = [
  '#10b981', '#0ea5e9', '#f59e0b', '#ef4444', '#8b5cf6',
  '#14b8a6', '#f97316', '#d946ef', '#84cc16', '#94a3b8',
];

// All charts created this session, so a re-render can destroy the old ones
// (Chart.js leaks anything left attached to a removed canvas).
let charts = [];
let themeWatcherInstalled = false;

// ---------------------------------------------------------------- date utils

function monthKey(iso) {
  return (iso ?? '').slice(0, 7);
}

// Last `n` calendar months, ending with the current one, ascending.
function lastMonths(n) {
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

function nextDay(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function chartPalette(isDark) {
  return {
    grid: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
    text: isDark ? '#adb5bd' : '#495057',
  };
}

// ------------------------------------------------------------------- view

export async function renderReports(root) {
  root.replaceChildren();
  charts.forEach((c) => c.destroy());
  charts = [];

  if (!themeWatcherInstalled) {
    themeWatcherInstalled = true;
    // Re-render when the theme flips so chart text stays readable. Charts are
    // cheap to rebuild; the observer survives navigation (module-level flag).
    new MutationObserver(() => renderReports(root)).observe(
      document.documentElement,
      { attributes: true, attributeFilter: ['data-bs-theme'] },
    );
  }

  const [txns, categories, currencies, accounts] = await Promise.all([
    getAllTransactions(),
    getCategoryTree(),
    getCurrencies(),
    listAccounts(),
  ]);
  setCurrencySymbols(currencies);

  if (accounts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'text-center text-muted py-5';
    empty.textContent = t('reports.noAccounts');
    root.appendChild(empty);
    return;
  }

  const { default: Chart } = await import('chart.js/auto');
  const isDark = document.documentElement.dataset.bsTheme === 'dark';
  const palette = chartPalette(isDark);

  // Track every instance so re-renders destroy the old ones (Chart.js leaks
  // resize listeners on destroyed-but-uncleaned instances).
  const makeChart = (canvas, config) => {
    const c = new Chart(canvas, config);
    charts.push(c);
    return c;
  };

  // Category shape: map id -> { id, name, parent_id, children: [] } plus a
  // root-first list for roll-ups.
  const byId = new Map(categories.map((c) => [c.id, { ...c, children: [] }]));
  for (const c of byId.values()) {
    if (c.parent_id && byId.has(c.parent_id)) byId.get(c.parent_id).children.push(c.id);
  }
  const topLevel = [...byId.values()].filter((c) => !c.parent_id).sort((a, b) => a.name.localeCompare(b.name));

  // id -> top-level ancestor id (used by the pie and budget roll-ups).
  const topOf = new Map();
  for (const c of byId.values()) {
    let node = c;
    while (node.parent_id && byId.has(node.parent_id)) node = byId.get(node.parent_id);
    topOf.set(c.id, node.id);
  }

  // ------------------------------------------------ monthly bars (12 months)
  // Transfers (transfer_group_id) never count as income/expense. `myrValues`
  // runs in parallel over the non-transfer list ONLY — every later consumer
  // (bars and the pie) must index it by position in that same filtered list,
  // never by indexIn(txns) (which would drift wherever transfers sit).
  const months = lastMonths(12);
  const income = new Map(months.map((m) => [m, 0]));
  const expense = new Map(months.map((m) => [m, 0]));
  const nonTransfer = txns.filter((tx) => !tx.transfer_group_id);
  const myrValues = await Promise.allSettled(
    nonTransfer.map((tx) =>
      tx.currency === 'MYR'
        ? Promise.resolve(Number(tx.amount))
        : convert(Number(tx.amount), tx.currency, 'MYR', tx.transaction_date),
    ),
  );
  for (let i = 0; i < nonTransfer.length; i++) {
    const tx = nonTransfer[i];
    const key = monthKey(tx.transaction_date);
    if (!income.has(key)) continue;
    const r = myrValues[i];
    const myr = r?.status === 'fulfilled' ? r.value : null;
    if (myr === null) continue;
    if (tx.direction === 'credit') income.set(key, income.get(key) + myr);
    else expense.set(key, expense.get(key) + myr);
  }

  // ------------------------------------------------------------- the layout
  const h1 = document.createElement('h1');
  h1.className = 'h3 mb-3';
  h1.textContent = t('reports.title');

  const monthRow = document.createElement('div');
  monthRow.className = 'd-flex align-items-center gap-2 mb-3';
  const monthLabel = document.createElement('label');
  monthLabel.className = 'form-label mb-0';
  monthLabel.setAttribute('for', 'reports-month');
  monthLabel.textContent = t('reports.month');
  const monthSelect = document.createElement('select');
  monthSelect.id = 'reports-month';
  monthSelect.className = 'form-select form-select-sm w-auto';
  for (const m of months) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    monthSelect.appendChild(opt);
  }
  monthSelect.value = months[months.length - 1];
  monthRow.append(monthLabel, monthSelect);

  root.append(h1, monthRow);

  const grid = document.createElement('div');
  grid.className = 'row g-3';

  const chartCard = (title) => {
    const col = document.createElement('div');
    col.className = 'col-12 col-lg-6';
    const card = document.createElement('div');
    card.className = 'card';
    const head = document.createElement('div');
    head.className = 'card-header';
    head.textContent = title;
    const body = document.createElement('div');
    body.className = 'card-body';
    const canvas = document.createElement('canvas');
    canvas.height = '220';
    body.appendChild(canvas);
    card.append(head, body);
    col.appendChild(card);
    return { col, canvas };
  };

  const monthly = chartCard(t('reports.chart.monthly'));
  const pieBox = chartCard(t('reports.chart.category'));
  grid.append(monthly.col, pieBox.col);

  const netWorth = chartCard(t('reports.chart.netWorth'));
  const accountsBox = chartCard(t('reports.chart.perAccount'));
  grid.append(netWorth.col, accountsBox.col);
  root.appendChild(grid);

  // ----------------------------------------------------------------- charts

  const barChart = () => {
    makeChart(monthly.canvas, {
      type: 'bar',
      data: {
        labels: months,
        datasets: [
          {
            label: t('reports.income'),
            data: months.map((m) => Math.round(income.get(m) * 100) / 100),
            backgroundColor: 'rgba(16,185,129,0.8)',
          },
          {
            label: t('reports.expense'),
            data: months.map((m) => Math.round(expense.get(m) * 100) / 100),
            backgroundColor: 'rgba(220,53,69,0.75)',
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { labels: { color: palette.text } },
        },
        scales: {
          x: { ticks: { color: palette.text, maxRotation: 0 }, grid: { color: palette.grid } },
          y: { ticks: { color: palette.text }, grid: { color: palette.grid } },
        },
      },
    });
  };

  const drawPie = () => {
    const key = monthSelect.value;
    const sums = new Map();
    // Index into `nonTransfer` (same filtered list myrValues was built from).
    for (let i = 0; i < nonTransfer.length; i++) {
      const tx = nonTransfer[i];
      if (tx.direction !== 'debit') continue;
      if (monthKey(tx.transaction_date) !== key) continue;
      const r = myrValues[i];
      const myr = r?.status === 'fulfilled' ? r.value : null;
      if (myr === null) continue;
      const top = tx.category_id && topOf.has(tx.category_id) ? topOf.get(tx.category_id) : null;
      const id = top ?? '__unassigned';
      sums.set(id, (sums.get(id) ?? 0) + myr);
    }
    const names = new Map(topLevel.map((c) => [c.id, c.name]));
    const labels = [...sums.keys()].map(
      (id) => (id === '__unassigned' ? t('col.unknown') : names.get(id) ?? t('col.unknown')),
    );
    makeChart(pieBox.canvas, {
      type: 'pie',
      data: {
        labels,
        datasets: [
          {
            data: [...sums.values()].map((v) => Math.round(v * 100) / 100),
            backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]),
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: palette.text } } },
      },
    });
  };

  // ------------------------------------------- balance curves / net worth
  const anchor = (acc) =>
    acc.opening_balance_date ? String(acc.opening_balance_date).slice(0, 10) : null;
  const txDate = (iso) => (iso ?? '').slice(0, 10);

  // Daily balance in the account's own currency, seeded at the anchor.
  const dailyBalances = (acc) => {
    const rows = txns
      .filter((tx) => tx.account_id === acc.id)
      .filter((tx) => !anchor(acc) || txDate(tx.transaction_date) >= anchor(acc))
      .sort((a, b) => (txDate(a.transaction_date) < txDate(b.transaction_date) ? -1 : 1));
    const firstTxDate = rows.length ? txDate(rows[0].transaction_date) : null;
    const start = anchor(acc) ?? firstTxDate ?? todayYmd();
    if (rows.length === 0) return new Map([[start, Number(acc.opening_balance ?? 0)]]);
    // NOTE: when anchor == first txn date, opening balance already covers
    // everything up to that date and the walk starts at row 1 on top of it.
    const map = new Map();
    let bal = Number(acc.opening_balance ?? 0);
    let ri = 0;
    let d = start;
    while (d <= todayYmd()) {
      while (ri < rows.length && txDate(rows[ri].transaction_date) <= d) {
        bal += rows[ri].direction === 'credit' ? Number(rows[ri].amount) : -Number(rows[ri].amount);
        ri++;
      }
      map.set(d, bal);
      d = nextDay(d);
    }
    return map;
  };

  const nonMyrCurrencies = [...new Set(accounts.map((a) => a.currency).filter((c) => c && c !== 'MYR'))];
  const startDate = (() => {
    const dates = [];
    for (const acc of accounts) {
      if (anchor(acc)) dates.push(anchor(acc));
      for (const tx of txns) if (tx.account_id === acc.id) dates.push(txDate(tx.transaction_date));
    }
    if (dates.length === 0) return todayYmd();
    return dates.sort()[0];
  })();
  const rateMaps = {};
  await Promise.all(
    nonMyrCurrencies.map(async (c) => {
      const rows = await timeSeries(c, 'MYR', startDate, todayYmd());
      rateMaps[c] = new Map(rows.map((r) => [r.date, r.rate]));
    }),
  );
  const toMyr = (amount, currency, date) => {
    if (currency === 'MYR') return Math.round(amount * 100) / 100;
    const rate = rateMaps[currency]?.get(date);
    if (rate === undefined) return null;
    return Math.round(amount * rate * 100) / 100;
  };

  // Per-account daily MYR series.
  const accountSeries = accounts.map((acc) => {
    const bal = dailyBalances(acc);
    const out = [];
    for (const [date, v] of bal) {
      const myr = toMyr(v, acc.currency, date);
      out.push({ date, myr: myr === null ? null : Math.round(myr * 100) / 100 });
    }
    return { acc, points: out };
  });

  // Net worth: visible-only accounts summed per day (decision 4).
  const visible = new Set(accounts.filter((a) => !a.is_hidden).map((a) => a.id));
  const netWorthPoints = (() => {
    const perDay = new Map();
    for (const { acc, points } of accountSeries) {
      if (!visible.has(acc.id)) continue;
      for (const p of points) {
        if (p.myr === null) continue;
        perDay.set(p.date, (perDay.get(p.date) ?? 0) + p.myr);
      }
    }
    return [...perDay.entries()]
      .map(([date, v]) => ({ date, value: Math.round(v * 100) / 100 }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  })();
  const netWorthNow = netWorthPoints.length ? netWorthPoints[netWorthPoints.length - 1].value : 0;

  const nowRow = document.createElement('div');
  nowRow.className = 'text-muted small mt-2';
  nowRow.id = 'net-worth-now';
  nowRow.textContent = `${t('reports.netWorthNow')} ${formatMoney(netWorthNow, 'MYR')}`;
  netWorth.col.querySelector('.card-body').appendChild(nowRow);

  // Account toggle row (visible accounts) for the per-account chart.
  const toggles = document.createElement('div');
  toggles.className = 'd-flex flex-wrap gap-3 mt-2';
  toggles.id = 'per-account-toggles';
  for (const acc of accounts) {
    const lab = document.createElement('label');
    lab.className = 'form-check form-check-inline small';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'form-check-input';
    cb.checked = true;
    const span = document.createElement('span');
    span.className = 'form-check-label';
    span.textContent = acc.name;
    lab.append(cb, span);
    toggles.appendChild(lab);
  }
  accountsBox.col.querySelector('.card-body').appendChild(toggles);

  const drawCurves = () => {
    const labels = [...new Set(accountSeries.flatMap((s) => s.points.map((p) => p.date)))].sort();
    const checkboxes = [...toggles.querySelectorAll('input')];
    const datasets = accountSeries
      .filter((s, i) => checkboxes[i]?.checked)
      .map(({ acc, points }) => ({
        label: acc.name,
        data: points.map((p) => p.myr),
        borderColor: PALETTE[accounts.indexOf(acc) % PALETTE.length],
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.1,
      }));
    makeChart(accountsBox.canvas, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: palette.text } } },
        scales: {
          x: { ticks: { color: palette.text, maxTicksLimit: 12 }, grid: { color: palette.grid } },
          y: { ticks: { color: palette.text }, grid: { color: palette.grid } },
        },
      },
    });
    makeChart(netWorth.col.querySelector('canvas'), {
      type: 'line',
      data: {
        labels: netWorthPoints.map((p) => p.date),
        datasets: [
          {
            label: t('reports.netWorth'),
            data: netWorthPoints.map((p) => p.value),
            borderColor: '#10b981',
            backgroundColor: 'rgba(16,185,129,0.1)',
            fill: true,
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.1,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: palette.text } } },
        scales: {
          x: { ticks: { color: palette.text, maxTicksLimit: 12 }, grid: { color: palette.grid } },
          y: { ticks: { color: palette.text }, grid: { color: palette.grid } },
        },
      },
    });
  };

  const rebuildCharts = () => {
    charts.forEach((c) => c.destroy());
    charts = [];
    barChart();
    drawPie();
    drawCurves();
  };

  monthSelect.addEventListener('change', () => {
    charts.forEach((c) => c.destroy());
    charts = [];
    barChart();
    drawPie();
    drawCurves();
  });
  toggles.addEventListener('change', () => {
    charts.forEach((c) => c.destroy());
    charts = [];
    barChart();
    drawPie();
    drawCurves();
  });

  rebuildCharts();
}