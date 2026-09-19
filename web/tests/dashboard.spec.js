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

const TAG_GROUPS = [
  {
    id: 'g-1',
    name: 'Work',
    sort_order: 1,
    tags: [{ id: 'tag-1', name: 'Deductible', color: '#198754', group_id: 'g-1' }],
  },
  {
    id: 'g-2',
    name: 'Travel',
    sort_order: 2,
    tags: [{ id: 'tag-2', name: 'Flight', color: '#0d6efd', group_id: 'g-2' }],
  },
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
    // M2M embed shape as returned by getTransactions' nested select.
    transaction_tags: [
      { tag_id: 'tag-1', tags: { id: 'tag-1', name: 'Deductible', color: '#198754' } },
    ],
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
  {
    // Real-data shape that used to break the dashboard: BOTH merchant fields
    // are null (nothing extracted). merchantCell() must fall through to the
    // i18n 'Unknown' label — regression guard for "t is not a function".
    id: 't-4',
    amount: 2.5,
    currency: 'MYR',
    direction: 'debit',
    merchant_display: null,
    merchant_raw: null,
    category_id: null,
    transaction_date: new Date(Date.now() - 4 * 86_400_000).toISOString(),
    source_app_label: 'HLB Connect',
    status: 'confirmed',
  },
];

function mockSupabase(page, { heartbeatAgeHours = 30, alerts = [] } = {}) {
  // Registered FIRST so the specific routes below still win (Playwright: last
  // registered route takes precedence). Anything unmocked that still targets
  // the fake project host gets a fast empty 200 instead of escaping to the
  // real network — a real request there can hang (or reject) a dashboard
  // render arbitrarily, which was the rare full-suite flake seen as a 30s
  // "#edit-mode-toggle never appeared". Specific assertions still fail loudly
  // if a real route is ever missed.
  page.route('**placeholder.supabase.co/**', (route) =>
    route.fulfill({ json: {}, headers: { 'content-type': 'application/json' } }),
  );

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
  page.route('**/rest/v1/tag_groups**', (route) =>
    route.fulfill({ json: TAG_GROUPS, headers: { 'content-type': 'application/json' } }),
  );
  // Tag links: POST insert / DELETE replace happen inside setTransactionTags.
  page.route('**/rest/v1/transaction_tags**', (route) => {
    const method = route.request().method();
    if (method === 'POST' || method === 'DELETE') {
      return route.fulfill({ status: 204, headers: { 'content-type': 'application/json' } });
    }
    return route.fulfill({ json: [], headers: { 'content-type': 'application/json' } });
  });
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
  // `theme` seeds the persisted preference (mt_theme) so a test can simulate
  // a returning visitor; everything else in `options` feeds mockSupabase.
  const { theme = null, ...mocks } = options ?? {};
  await page.addInitScript(
    ({ key, session, theme }) => {
      localStorage.setItem(key, JSON.stringify(session));
      if (theme) localStorage.setItem('mt_theme', theme);
    },
    { key: STORAGE_KEY, session: SESSION, theme },
  );
  mockSupabase(page, mocks);
  await page.goto('/');
}

test('signed-in dashboard renders transactions and the MYR total', async ({ page }) => {
  const fxRequests = [];
  page.on('request', (req) => {
    if (req.url().includes('frankfurter.dev')) fxRequests.push(req.url());
  });
  await openDashboard(page);

  // 12.00 + 8.50 + 2.50 MYR, plus 10.00 USD converted at 4.5 = 45.00 -> 68.00.
  await expect(page.locator('#total-myr')).toHaveText('RM 68.00');
  await expect(page.locator('table')).toContainText('Shopee');
  await expect(page.locator('table')).toContainText('Kopitiam');
  await expect(page.locator('table')).toContainText('Netflix');
  // The no-merchant row (both merchant fields null) renders the i18n fallback
  // label instead of throwing.
  await expect(page.locator('table')).toContainText('Unknown');

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
  await expect(page.locator('input[type="datetime-local"]')).toHaveCount(4);
  // No per-row Save buttons — edits persist when edit mode is toggled off.
  await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(4);
});

test('toggling edit mode preserves read-only rendering when off', async ({ page }) => {
  await openDashboard(page);
  await page.click('#edit-mode-toggle');
  await expect(page.locator('input[type="datetime-local"]')).toHaveCount(4);
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

test('picking a category on a blank-category row issues a PATCH', async ({ page }) => {
  const patched = [];
  page.on('request', (req) => {
    if (req.method() === 'PATCH' && req.url().includes('/rest/v1/transactions')) {
      patched.push({ url: req.url(), postData: req.postData() });
    }
  });
  await openDashboard(page);

  // The Netflix row has category_id: null, so its category cell renders an
  // inline picker instead of the em-dash.
  const picker = page
    .locator('tbody tr', { hasText: 'Netflix' })
    .locator('select[aria-label="Set category"]');
  await expect(picker).toHaveCount(1);
  await picker.selectOption('44444444-4444-4444-8444-444444444444');

  await expect.poll(() => patched.length).toBe(1);
  expect(patched[0].url).toContain('transactions');
  expect(patched[0].postData).toContain('"category_id":"44444444-4444-4444-8444-444444444444"');
});

test('edit mode: renaming the source issues a PATCH for that label', async ({ page }) => {
  const patched = [];
  page.on('request', (req) => {
    if (req.method() === 'PATCH' && req.url().includes('/rest/v1/transactions')) {
      patched.push({ url: req.url(), postData: req.postData() });
    }
  });
  await openDashboard(page);

  await page.click('#edit-mode-toggle');
  // Every row's source is a notification app label (not a preset), so each
  // renders a pre-filled Custom… text input. Rename the first row's source.
  const custom = page.locator('input.source-picker-custom').first();
  await expect(custom).toBeVisible();
  await custom.fill('Cash');
  await page.click('#edit-mode-toggle');

  await expect.poll(() => patched.length).toBe(1);
  expect(patched[0].url).toContain('transactions');
  expect(patched[0].postData).toContain('"source_app_label":"Cash"');
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

test('read-only rows show tag chips with their colors', async ({ page }) => {
  await openDashboard(page);

  const row = page.locator('tbody tr', { hasText: 'Shopee' });
  const chip = row.locator('.badge', { hasText: 'Deductible' });
  await expect(chip).toBeVisible();
  // Colored badge name comes from the tag's color, not a class.
  await expect(chip).toHaveCSS('background-color', 'rgb(25, 135, 84)');

  // Rows without tags render the em-dash (no badge at all).
  const tied = page.locator('tbody tr', { hasText: 'Netflix' });
  await expect(tied.locator('.badge')).toHaveCount(0);
});

test('edit-mode tag picker saves the tag set via transaction_tags', async ({ page }) => {
  const tagPosts = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/rest/v1/transaction_tags')) {
      tagPosts.push(req.postData());
    }
  });
  await openDashboard(page);

  await page.click('#edit-mode-toggle');
  // The first rendered row is t-1 (Shopee): the merchant cell is an <input> in
  // edit mode, so `hasText: 'Shopee'` matches nothing there — target rows by
  // position instead (filtering by input values isn't supported).
  const picker = page
    .locator('tbody tr')
    .first()
    .locator('select[aria-label="Tags (select multiple; Ctrl/Cmd-click to toggle)"]');
  await expect(picker).toHaveCount(1);
  await expect(picker.locator('optgroup[label="Work"]')).toContainText('Deductible');
  await expect(picker.locator('optgroup[label="Travel"]')).toContainText('Flight');

  // Replace the set with both tags — saving is immediate (no batch PATCH).
  await picker.selectOption(['tag-1', 'tag-2']);
  await expect.poll(() => tagPosts.length).toBe(1);
  expect(tagPosts[0]).toContain('"tag_id":"tag-1"');
  expect(tagPosts[0]).toContain('"tag_id":"tag-2"');
  expect(tagPosts[0]).toContain('"transaction_id":"t-1"');
});

// --- Phase 2: dark mode + PWA ---

test('system dark preference renders the pure-black OLED theme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openDashboard(page);

  await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'dark');
  // Owner decision: OLED #000, not Bootstrap's #212529.
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
});

test('explicit light theme wins over a dark system preference', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openDashboard(page, { theme: 'light' });

  await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'light');
});

test('theme toggle cycles to dark and persists the preference', async ({ page }) => {
  await openDashboard(page); // no stored preference -> system; test default scheme is light
  await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'light');

  await page.click('#nav-theme-btn');
  await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('mt_theme'))).toBe('dark');

  // A reload must restore the persisted preference, not flip back to system.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'dark');
});

test('PWA manifest is linked and serves install metadata', async ({ page }) => {
  await openDashboard(page);

  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
  const resp = await page.request.get('/manifest.webmanifest');
  expect(resp.ok()).toBe(true);
  const manifest = await resp.json();
  expect(manifest.name).toBe('Expense Tracker');
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.length).toBeGreaterThan(0);
});
