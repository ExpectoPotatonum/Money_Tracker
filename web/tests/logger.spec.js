import { test, expect } from '@playwright/test';

// Logger (web/src/lib/logger.js) records failed Supabase calls to IndexedDB
// so an operator can see authorization/observability errors that are otherwise
// invisible in a headless SPA. This test simulates 403s (the RLS-anon case
// that produced the "permission denied" / Forbidden banner) and asserts the
// error row lands in the rotating CSV store.

// Storage key must match the URL the built bundle is configured with. The
// webServer builds with mode=test (placeholder URL), so the ref is
// "placeholder". Keep in sync with web/.env.test and dashboard.spec.js.
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

function mock403(page) {
  for (const table of ['transactions', 'categories', 'dashboard_alerts', 'device_heartbeat']) {
    page.route(`**/rest/v1/${table}**`, (route) =>
      route.fulfill({ status: 403, body: 'Forbidden' }),
    );
  }
}

async function readLogText(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('tracker-log');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const row = await new Promise((resolve, reject) => {
      const tx = db.transaction('errors', 'readonly');
      const get = tx.objectStore('errors').get('current');
      get.onsuccess = () => resolve(get.result || null);
      get.onerror = () => reject(get.error);
    });
    db.close();
    return row ? row.rows || '' : '';
  });
}

async function authenticated(page) {
  await page.addInitScript(
    ({ key, session }) => localStorage.setItem(key, JSON.stringify(session)),
    { key: STORAGE_KEY, session: SESSION },
  );
}

test('403s from Supabase are captured in the rotating CSV log', async ({ page }) => {
  await authenticated(page);
  mock403(page);
  await page.goto('/');

  // The dashboard render throws on the first 403 and main.js routes it through
  // logApiError -> IndexedDB. Wait until at least one error row appears.
  await expect
    .poll(async () => (await readLogText(page)).split('\n').length - 1, { timeout: 10_000 })
    .toBeGreaterThan(0);

  const text = await readLogText(page);
  expect(text.startsWith('timestamp,')).toBe(true);
  expect(text).toContain('render'); // source column from main.js
  // The 403 surfaces as the supabase/client error message; assert the actual
  // failure text landed rather than a specific numeric status code.
  expect(text).toContain('Forbidden');
});
