import { test, expect } from '@playwright/test';

// The Supabase storage key supabase-js derives from the build-time URL. web.yml
// builds with VITE_SUPABASE_URL=https://placeholder.supabase.co, so the ref is
// "placeholder". Keep in sync with web.yml.
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
  { id: '44444444-4444-4444-8444-444444444444', name: 'Shopping' },
  { id: '11111111-1111-4111-8111-111111111111', name: 'Food & Dining' },
];

const TRANSACTIONS = [
  {
    id: 't-1',
    amount: 12.0,
    currency: 'MYR',
    direction: 'debit',
    merchant_display: 'Shopee',
    merchant_raw: 'SHOPEE',
    category_id: '44444444-4444-4444-8444-444444444444',
    transaction_date: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    source_app_label: 'TnG eWallet',
    status: 'confirmed',
  },
  {
    id: 't-2',
    amount: 10.0,
    currency: 'USD',
    direction: 'debit',
    merchant_display: 'Netflix',
    merchant_raw: 'Netflix',
    category_id: null,
    transaction_date: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    source_app_label: 'CIMB Octo MY',
    status: 'confirmed',
  },
  {
    id: 't-3',
    amount: 8.5,
    currency: 'MYR',
    direction: 'debit',
    merchant_display: 'Kopitiam',
    merchant_raw: 'kopitiam',
    category_id: '11111111-1111-4111-8111-111111111111',
    transaction_date: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    source_app_label: 'TnG eWallet',
    status: 'confirmed',
  },
];

function mockSupabase(page, { heartbeatAgeHours = 30, alerts = [] } = {}) {
  page.route('**/rest/v1/transactions**', (route) => {
    const method = route.request().method();
    if (method === 'PATCH' || method === 'DELETE') {
      return route.fulfill({
        status: 204,
        headers: { 'content-type': 'application/json' },
      });
    }
    return route.fulfill({ json: TRANSACTIONS, headers: { 'content-type': 'application/json' } });
  });
  page.route('**/rest/v1/categories**', (route) =>
    route.fulfill({ json: CATEGORIES, headers: { 'content-type': 'application/json' } }),
  );
  page.route('**/rest/v1/currencies**', (route) =>
    route.fulfill({
      json: [
        { code: 'MYR', symbol: 'RM', position: 10 },
        { code: 'USD', symbol: '$', position: 40 },
      ],
      headers: { 'content-type': 'application/json' },
    }),
  );
  page.route('**/rest/v1/dashboard_alerts**', (route) =>
    route.fulfill({ json: alerts, headers: { 'content-type': 'application/json' } }),
  );
  page.route('**/rest/v1/device_heartbeat**', (route) =>
    route.fulfill({
      json: [
        {
          device_id: 'test-device',
          last_seen_at: new Date(Date.now() - heartbeatAgeHours * 3_600_000).toISOString(),
          listener_connected: true,
          notification_access_granted: true,
          battery_unrestricted: true,
          app_version: '0.1.0',
        },
      ],
      headers: { 'content-type': 'application/json' },
    }),
  );
  // fx.js (ADRs 0001/0003): the dashboard now converts each non-MYR row with the
  // historical rate frozen at its transaction date (/v2/rates?base=&quotes=&date=).
  page.route('**/api.frankfurter.dev/**', (route) =>
    route.fulfill({
      json: [{ date: '2026-08-28', base: 'USD', quote: 'MYR', rate: 4.5 }],
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
  mockSupabase(page, options);
  await page.goto('/');
}

test('signed-in dashboard renders transactions and the MYR total', async ({ page }) => {
  const fxRequests = [];
  page.on('request', (req) => {
    if (req.url().includes('frankfurter.dev')) fxRequests.push(req.url());
  });
  await openDashboard(page);

  // 12.00 + 8.50 MYR, plus 10.00 USD converted at 4.5 = 45.00 -> 65.50.
  await expect(page.locator('#total-myr')).toHaveText('RM 65.50');
  await expect(page.locator('table')).toContainText('Shopee');
  await expect(page.locator('table')).toContainText('Kopitiam');
  await expect(page.locator('table')).toContainText('Netflix');

  // FX is frozen at the transaction's own date (ADR 0003), never "latest".
  expect(fxRequests.length).toBeGreaterThan(0);
  for (const url of fxRequests) {
    expect(url).toContain('date=');
    expect(url).toContain('base=USD');
    expect(url).toContain('quotes=MYR');
  }
});

test('stale heartbeat raises the tracker-may-be-offline banner', async ({ page }) => {
  await openDashboard(page, { heartbeatAgeHours: 30 });
  await expect(page.locator('.alert-warning').first()).toContainText('Tracker may be offline');
});

test('fresh heartbeat shows no offline banner', async ({ page }) => {
  await openDashboard(page, { heartbeatAgeHours: 1 });
  await expect(page.locator('.alert-warning')).toHaveCount(0);
});

test('edit-mode toggle reveals editable controls and a per-row Delete', async ({ page }) => {
  await openDashboard(page);
  await expect(page.locator('input[type="datetime-local"]')).toHaveCount(0);

  await page.click('#edit-mode-toggle');
  await expect(page.locator('input[type="datetime-local"]')).toHaveCount(3);
  // No per-row Save buttons — edits persist when edit mode is toggled off.
  await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(3);
});

test('toggling edit mode preserves read-only rendering when off', async ({ page }) => {
  await openDashboard(page);
  await page.click('#edit-mode-toggle');
  await expect(page.locator('input[type="datetime-local"]')).toHaveCount(3);
  await page.click('#edit-mode-toggle');
  await expect(page.locator('input[type="datetime-local"]')).toHaveCount(0);
});

test('toggling edit mode off issues a PATCH for every edited row', async ({ page }) => {
  const patched = [];
  page.on('request', (req) => {
    if (req.method() === 'PATCH' && req.url().includes('/rest/v1/transactions')) {
      patched.push({ url: req.url(), postData: req.postData() });
    }
  });
  await openDashboard(page);

  await page.click('#edit-mode-toggle');
  await page.locator('tbody tr').first().locator('input[type="number"]').fill('99');

  // Leaving edit mode auto-saves — no per-row Save button.
  await page.click('#edit-mode-toggle');

  await expect.poll(() => patched.length).toBe(1);
  expect(patched[0].url).toContain('transactions');
  expect(patched[0].postData).toContain('"amount":99');
});

test('clicking Delete issues a DELETE for that row', async ({ page }) => {
  let deleted = false;
  page.on('dialog', (dialog) => dialog.accept());
  page.on('request', (req) => {
    if (req.method() === 'DELETE' && req.url().includes('/rest/v1/transactions')) {
      deleted = true;
    }
  });
  await openDashboard(page);

  await page.click('#edit-mode-toggle');
  await page.locator('tbody tr').first().getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => deleted).toBe(true);
});
