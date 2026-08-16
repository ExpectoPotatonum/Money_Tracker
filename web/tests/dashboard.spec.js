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
  page.route('**/rest/v1/transactions**', (route) =>
    route.fulfill({ json: TRANSACTIONS, headers: { 'content-type': 'application/json' } }),
  );
  page.route('**/rest/v1/categories**', (route) =>
    route.fulfill({ json: CATEGORIES, headers: { 'content-type': 'application/json' } }),
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
  // fx.js (ADR 0001): one mock rate for the cross-currency row.
  page.route('**/api.frankfurter.dev/**', (route) =>
    route.fulfill({ json: { rate: 4.5 }, headers: { 'content-type': 'application/json' } }),
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
  await openDashboard(page);

  // 12.00 + 8.50 MYR, plus 10.00 USD converted at 4.5 = 45.00 -> 65.50.
  await expect(page.locator('#total-myr')).toHaveText('RM 65.50');
  await expect(page.locator('table')).toContainText('Shopee');
  await expect(page.locator('table')).toContainText('Kopitiam');
  await expect(page.locator('table')).toContainText('Netflix');
});

test('stale heartbeat raises the tracker-may-be-offline banner', async ({ page }) => {
  await openDashboard(page, { heartbeatAgeHours: 30 });
  await expect(page.locator('.alert-warning').first()).toContainText('Tracker may be offline');
});

test('fresh heartbeat shows no offline banner', async ({ page }) => {
  await openDashboard(page, { heartbeatAgeHours: 1 });
  await expect(page.locator('.alert-warning')).toHaveCount(0);
});
