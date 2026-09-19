import { test, expect } from '@playwright/test';

// Phase 4 budgets (§4.9): dashboard progress bars + budget manager modal.
// Spend is computed client-side from the current calendar month; transfers are
// never spend; parent budgets roll child-category spend up (decision 3).

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
    opening_balance: 0,
    opening_balance_date: null,
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

// Budget spend math:
//   Food & Dining = 120 (f-1) + 30 (child f-1a, rolled up) = 150 / 200 → 75%
//   Overall       = 120 + 30 + 400 (s-1) = 550 / 500 → over budget (danger)
// Credit + transfer halves never count as spend.
const BUDGETS = [
  { id: 'b-1', category_id: null, period: 'monthly', amount: 500, currency: 'MYR', created_at: '2026-09-01T00:00:00Z', categories: null },
  { id: 'b-2', category_id: 'f-1', period: 'monthly', amount: 200, currency: 'MYR', created_at: '2026-09-01T00:00:00Z', categories: CATEGORIES[0] },
];

const TX = (id, amount, direction, categoryId, accountId, transferGroupId = null) => ({
  id,
  amount,
  currency: 'MYR',
  direction,
  merchant_display: null,
  merchant_raw: null,
  category_id: categoryId,
  account_id: accountId,
  transfer_group_id: transferGroupId,
  source_package: 'manual',
  transaction_date: new Date().toISOString(),
  source_app_label: null,
  status: 'confirmed',
});

const TRANSACTIONS = [
  TX('t-1', 120, 'debit', 'f-1', 'a-1'),
  TX('t-2', 30, 'debit', 'f-1a', 'a-1'),
  TX('t-3', 400, 'debit', 's-1', 'a-1'),
  TX('t-4', 60, 'credit', null, 'a-1'),
  TX('t-5', 50, 'debit', null, 'a-1', 'gt-1'),
  TX('t-6', 50, 'credit', null, 'a-2', 'gt-1'),
];

function mockSupabase(
  page,
  { transactions = TRANSACTIONS, accounts = ACCOUNTS, budgets = BUDGETS } = {},
) {
  page.route('**placeholder.supabase.co/**', (route) =>
    route.fulfill({ json: {}, headers: { 'content-type': 'application/json' } }),
  );
  page.route('**/rest/v1/transactions**', (route) => {
    const method = route.request().method();
    if (method === 'PATCH' || method === 'DELETE') {
      return route.fulfill({ status: 204, headers: { 'content-type': 'application/json' } });
    }
    return route.fulfill({ json: transactions, headers: { 'content-type': 'application/json' } });
  });
  page.route('**/rest/v1/accounts**', (route) => {
    const method = route.request().method();
    if (method === 'PATCH' || method === 'DELETE') {
      return route.fulfill({ status: 204, headers: { 'content-type': 'application/json' } });
    }
    return route.fulfill({ json: accounts, headers: { 'content-type': 'application/json' } });
  });
  page.route('**/rest/v1/categories**', (route) =>
    route.fulfill({ json: CATEGORIES, headers: { 'content-type': 'application/json' } }),
  );
  page.route('**/rest/v1/budgets**', (route) => {
    const method = route.request().method();
    if (method === 'POST') {
      return route.fulfill({
        status: 201,
        json: { id: 'created-budget', ...JSON.parse(route.request().postData() ?? '{}') },
        headers: { 'content-type': 'application/json' },
      });
    }
    if (method === 'PATCH' || method === 'DELETE') {
      return route.fulfill({ status: 204, headers: { 'content-type': 'application/json' } });
    }
    return route.fulfill({ json: budgets, headers: { 'content-type': 'application/json' } });
  });
  page.route('**/rest/v1/dashboard_alerts**', (route) =>
    route.fulfill({ json: [], headers: { 'content-type': 'application/json' } }),
  );
  page.route('**/rest/v1/device_heartbeat**', (route) =>
    route.fulfill({
      json: [
        {
          device_id: 'test-device',
          last_seen_at: new Date(Date.now() - 30 * 3_600_000).toISOString(),
          listener_connected: true,
          notification_access_granted: true,
          battery_unrestricted: true,
          app_version: '0.1.0',
        },
      ],
      headers: { 'content-type': 'application/json' },
    }),
  );
  page.route('**/rest/v1/tag_groups**', (route) =>
    route.fulfill({ json: [], headers: { 'content-type': 'application/json' } }),
  );
  page.route('**/rest/v1/currencies**', (route) =>
    route.fulfill({
      json: [{ code: 'MYR', symbol: 'RM', position: 10 }],
      headers: { 'content-type': 'application/json' },
    }),
  );
}

async function openDashboard(page, options) {
  await page.addInitScript(
    ({ key, session }) => {
      localStorage.setItem(key, JSON.stringify(session));
    },
    { key: STORAGE_KEY, session: SESSION },
  );
  await mockSupabase(page, options ?? {});
  await page.goto('/');
  // No `#dashboard` id exists in the app — the budgets section (rendered only
  // after the full dashboard render completes) is the deterministic signal.
  await expect(page.locator('#budgets-section')).toBeVisible();
}

test('dashboard renders inline budget bars with roll-up and over-budget state', async ({ page }) => {
  await openDashboard(page);

  const section = page.locator('#budgets-section');
  await expect(section).toContainText('Overall');
  await expect(section).toContainText('Food & Dining');

  // Overall (b-1) is first in the list: 550 spent of 500 → over budget.
  // Browsers serialize inline styles with a trailing ';' — match with a regex.
  const overall = section.locator('div.mb-3', { hasText: 'Overall' });
  await expect(overall.locator('.progress-bar')).toHaveAttribute('style', /width:\s*100%/);
  await expect(overall.locator('.progress-bar.bg-danger')).toHaveCount(1);
  await expect(overall.locator('.text-danger')).toContainText('RM 550.00 / RM 500.00');

  // Food & Dining (b-2) second: 150 of 200 (child spend rolled up) → 75%.
  const food = section.locator('div.mb-3', { hasText: 'Food & Dining' });
  await expect(food.locator('.progress-bar')).toHaveAttribute('style', /width:\s*75%/);
  await expect(food.locator('.bg-danger')).toHaveCount(0);
  await expect(food).toContainText('RM 150.00 / RM 200.00');
});

test('budget manager lists budgets and adds a per-category budget', async ({ page }) => {
  const posts = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/rest/v1/budgets')) {
      posts.push(req.postData());
    }
  });
  await openDashboard(page);

  await page.click('#budgets-manage-btn');
  const manager = page.locator('dialog').first();
  await expect(manager).toBeVisible();
  await expect(manager).toContainText('Manage budgets');
  await expect(manager).toContainText('Overall');
  await expect(manager).toContainText('Food & Dining');

  // Add form: a second <dialog> stacked above the manager.
  await manager.getByRole('button', { name: 'Add budget' }).click();
  const form = page.locator('dialog').last();
  // The radio's label span has no `for`, so check the input directly.
  await form.locator('input[value="category"]').check();
  await form.locator('select.form-select').selectOption('s-1');
  await form.locator('input[type="number"]').fill('300');
  await form.getByRole('button', { name: 'Save budget' }).click();

  await expect.poll(() => posts.length).toBe(1);
  const body = JSON.parse(posts[0]);
  expect(body.category_id).toBe('s-1');
  expect(body.amount).toBe(300);
  expect(body.period).toBe('monthly');
  expect(body.currency).toBe('MYR');
});