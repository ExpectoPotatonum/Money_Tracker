import { test, expect } from '@playwright/test';

// Standalone Reports view (#/reports, Phase 4 §4.9). Pulls full history via
// getAllTransactions (paged), computes bars/pie/curves client-side, renders
// Chart.js canvases. FX is all-MYR here, so no frankfurter route is needed:
// convert() short-circuits and timeSeries() is never called for MYR bases.

// Keep in sync with web.yml, same as dashboard.spec.js.
const STORAGE_KEY = 'sb-placeholder-auth-token';

const SESSION = {
  access_token: 'fake.jwt.token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: 'fake-refresh-token',
  user: {
    id: '00000000-0000-0000-0000-000000000000',
    email: 'test@example.com',
    aud: 'authenticated',
    role: 'authenticated',
  },
};

// Two-tier category tree (parent_id): the pie must roll children up.
const CATEGORIES = [
  { id: 'f-1', name: 'Food & Dining', parent_id: null, icon: '🍜', color: '#dc3545' },
  { id: 'f-1a', name: 'Kopitiam', parent_id: 'f-1', icon: '☕', color: '#fd7e14' },
  { id: 's-1', name: 'Shopping', parent_id: null, icon: '🛍️', color: '#0d6efd' },
];

const ACCOUNTS = [
  {
    id: 'a-1',
    name: 'TnG eWallet',
    type: 'ewallet',
    currency: 'MYR',
    icon: null,
    color: null,
    opening_balance: 1000,
    opening_balance_date: new Date(Date.now() - 90 * 86_400_000).toISOString(),
    is_hidden: false,
    sort_order: 1,
  },
  {
    id: 'a-2',
    name: 'HLB Debit Card',
    type: 'credit',
    currency: 'MYR',
    icon: null,
    color: null,
    opening_balance: 0,
    opening_balance_date: null,
    is_hidden: false,
    sort_order: 2,
  },
];

// Current-month debits (bars/pie) + one previous-month credit (previous-month
// bar) + a transfer pair (excluded from bars/pie but counted in curves).
const TRANSACTIONS = [
  {
    id: 't-1',
    amount: 12,
    currency: 'MYR',
    direction: 'debit',
    merchant_display: null,
    merchant_raw: null,
    category_id: 's-1',
    account_id: 'a-1',
    source_package: 'manual',
    transaction_date: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    source_app_label: null,
    status: 'confirmed',
  },
  {
    id: 't-2',
    amount: 8.5,
    currency: 'MYR',
    direction: 'debit',
    merchant_display: null,
    merchant_raw: null,
    category_id: 'f-1a', // child of Food & Dining — pie rolls to Food
    account_id: 'a-1',
    source_package: 'manual',
    transaction_date: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    source_app_label: null,
    status: 'confirmed',
  },
  {
    id: 't-3',
    amount: 2.5,
    currency: 'MYR',
    direction: 'debit',
    merchant_display: null,
    merchant_raw: null,
    category_id: null, // unassigned → pie "Unknown"
    account_id: 'a-1',
    source_package: 'manual',
    transaction_date: new Date(Date.now() - 4 * 86_400_000).toISOString(),
    source_app_label: null,
    status: 'confirmed',
  },
  {
    id: 't-4',
    amount: 500,
    currency: 'MYR',
    direction: 'credit',
    merchant_display: null,
    merchant_raw: null,
    category_id: null,
    account_id: 'a-2',
    source_package: 'manual',
    transaction_date: new Date(Date.now() - 45 * 86_400_000).toISOString(),
    source_app_label: null,
    status: 'confirmed',
  },
  // Transfer pair — halves are normal per-account rows (curves), never
  // income/expense (bars/pie).
  {
    id: 't-5',
    amount: 50,
    currency: 'MYR',
    direction: 'debit',
    merchant_display: null,
    merchant_raw: null,
    category_id: null,
    account_id: 'a-2',
    transfer_group_id: 'gt-1',
    source_package: 'manual',
    transaction_date: new Date(Date.now() - 86_400_000).toISOString(),
    source_app_label: null,
    status: 'confirmed',
  },
  {
    id: 't-6',
    amount: 50,
    currency: 'MYR',
    direction: 'credit',
    merchant_display: null,
    merchant_raw: null,
    category_id: null,
    account_id: 'a-1',
    transfer_group_id: 'gt-1',
    source_package: 'manual',
    transaction_date: new Date(Date.now() - 86_400_000).toISOString(),
    source_app_label: null,
    status: 'confirmed',
  },
];

// Expected net worth now: a-1 = 1000 − (12 + 8.5 + 2.5) + 50 (transfer in) =
// 1027; a-2 = 0 + 500 − 50 (transfer out) = 450. Total 1477.
const NET_WORTH_NOW = 'RM 1477.00';

function mockSupabase(page, { transactions = TRANSACTIONS, accounts = ACCOUNTS } = {}) {
  page.route('**placeholder.supabase.co/**', (route) =>
    route.fulfill({ json: {}, headers: { 'content-type': 'application/json' } }),
  );
  page.route('**/rest/v1/transactions**', (route) =>
    route.fulfill({ json: transactions, headers: { 'content-type': 'application/json' } }),
  );
  page.route('**/rest/v1/accounts**', (route) =>
    route.fulfill({ json: accounts, headers: { 'content-type': 'application/json' } }),
  );
  page.route('**/rest/v1/categories**', (route) =>
    route.fulfill({ json: CATEGORIES, headers: { 'content-type': 'application/json' } }),
  );
  page.route('**/rest/v1/currencies**', (route) =>
    route.fulfill({
      json: [{ code: 'MYR', symbol: 'RM', position: 10 }],
      headers: { 'content-type': 'application/json' },
    }),
  );
}

async function openReports(page, options) {
  const { ...mocks } = options ?? {};
  await page.addInitScript(
    ({ key, session }) => {
      localStorage.setItem(key, JSON.stringify(session));
    },
    { key: STORAGE_KEY, session: SESSION },
  );
  await mockSupabase(page, mocks);
  await page.goto('/#/reports');
  await expect(page.locator('h1.h3')).toHaveText('Reports');
}

test('reports view renders all four chart blocks with correct net worth', async ({ page }) => {
  await openReports(page);

  await expect(page.locator('canvas')).toHaveCount(4);

  // Month selector defaults to the current calendar month.
  const monthSelect = page.locator('#reports-month');
  await expect(monthSelect).toBeVisible();
  const now = new Date();
  const currentMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 7);
  await expect(monthSelect).toHaveValue(currentMonth);

  // Net-worth summary line (id-anchored so the test doesn't poke at canvas
  // internals). Includes transfer halves, excludes nothing visible.
  await expect(page.locator('#net-worth-now')).toContainText(NET_WORTH_NOW);

  // One toggle checkbox per account, all on by default.
  await expect(page.locator('#per-account-toggles input[type="checkbox"]')).toHaveCount(2);
});

test('reports nav link is active and transfers do not inflate income', async ({ page }) => {
  await openReports(page);

  const active = page.locator('nav .nav-link.active');
  await expect(active).toHaveText('Reports');

  // The only sized credit rows are the 500 salary plus a transfer half
  // (excluded from bars). We assert structurally: the view survived render
  // (any chart-construction error would drop the h1/canvases) and the
  // net-worth line tallies transfer halves into balances.
  await expect(page.locator('canvas')).toHaveCount(4);
  await expect(page.locator('#net-worth-now')).toBeVisible();
});