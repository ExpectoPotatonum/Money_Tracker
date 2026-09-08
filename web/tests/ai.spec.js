import { test, expect } from '@playwright/test';

// Mirrors dashboard.spec.js: supabase storage key derived from the build-time
// placeholder URL (web.yml) — keep in sync.
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

const LLM_JSON = JSON.stringify({
  usable: true,
  amount: 45.8,
  currency: 'MYR',
  direction: 'debit',
  merchant_raw: 'Tingkatz',
  category: 'Food & Dining',
  transaction_date: '2026-09-06T10:00:00+08:00',
  notes: null,
});

// The dashboards fetch categories/currencies/transactions/heartbeat/alerts and
// hit Frankfurter for FX. The AI specs add the Gemini endpoint and a POST-capable
// transactions route (insert returns a single row, PATCH/DELETE -> 204).
function mockSupabase(page, { rawNotifications = [] } = {}) {
  page.route('**/rest/v1/transactions**', (route) => {
    const method = route.request().method();
    if (method === 'POST') {
      return route.fulfill({
        status: 201,
        json: { id: 'inserted-id' },
        headers: { 'content-type': 'application/json' },
      });
    }
    if (method === 'PATCH' || method === 'DELETE') {
      return route.fulfill({ status: 204, headers: { 'content-type': 'application/json' } });
    }
    return route.fulfill({ json: [], headers: { 'content-type': 'application/json' } });
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
    route.fulfill({ json: [], headers: { 'content-type': 'application/json' } }),
  );
  page.route('**/rest/v1/device_heartbeat**', (route) =>
    route.fulfill({
      json: [
        {
          device_id: 'test-device',
          last_seen_at: new Date().toISOString(),
          listener_connected: true,
          notification_access_granted: true,
          battery_unrestricted: true,
          app_version: '0.1.0',
        },
      ],
      headers: { 'content-type': 'application/json' },
    }),
  );
  page.route('**/rest/v1/raw_notifications**', (route) => {
    const method = route.request().method();
    if (method === 'PATCH') {
      return route.fulfill({ status: 204, headers: { 'content-type': 'application/json' } });
    }
    return route.fulfill({ json: rawNotifications, headers: { 'content-type': 'application/json' } });
  });
  page.route('**/api.frankfurter.dev/**', (route) =>
    route.fulfill({
      json: [{ date: '2026-08-28', base: 'USD', quote: 'MYR', rate: 4.5 }],
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function mockLlm(page, { status = 200 } = {}) {
  const okBody = {
    candidates: [{ content: { parts: [{ text: LLM_JSON }] } }],
  };
  const errBody = { error: { message: 'models/gemini-2.0-flash is not found' } };
  page.route('**/generativelanguage.googleapis.com/**', (route) =>
    route.fulfill({
      status,
      json: status === 200 ? okBody : errBody,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

async function open(page, path = '/', options = {}) {
  await page.addInitScript(
    ({ key, session, speech }) => {
      localStorage.setItem(key, JSON.stringify(session));
      // Phase A settings (lib/settings.js) so the LLM is "configured": with no
      // key the parse button routes to the settings hint instead of the API.
      localStorage.setItem('mt_llm_key', 'fake-key');
      localStorage.setItem('mt_llm_model', 'gemini-2.0-flash');
      localStorage.setItem('mt_llm_parse_enabled', '1');
      if (speech) {
        // Minimal stand-in for the Web Speech API so the mic button shows and
        // can be driven: start() schedules a scripted transcription.
        class FakeSR {
          constructor() {
            this.lang = '';
            this.interimResults = false;
            this.maxAlternatives = 1;
            this.onresult = null;
            this.onend = null;
            this.onerror = null;
            this.onstart = null;
          }
          start() {
            this.onstart?.();
            setTimeout(() => {
              if (this.onresult) {
                this.onresult({ results: [{ 0: { transcript: speech }, isFinal: true }] });
              }
              this.onend?.();
            }, 10);
          }
          stop() {
            this.onend?.();
          }
        }
        window.SpeechRecognition = FakeSR;
        window.webkitSpeechRecognition = FakeSR;
      }
    },
    { key: STORAGE_KEY, session: SESSION, speech: options.speech ?? null },
  );
  mockSupabase(page, options);
  mockLlm(page, options.llm ?? {});
  await page.goto(path);
}

test('settings dialog opens from the nav and shows the AI fields', async ({ page }) => {
  await open(page);
  await page.click('#nav-settings-btn');
  const dialog = page.locator('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#settings-ai-key')).toBeVisible();
  await expect(dialog.locator('#settings-ai-enable')).toBeChecked();
  await expect(dialog.locator('#settings-lang')).toHaveValue('en');
});

test('NL bookkeeping: sentence -> AI preview -> insert a manual transaction', async ({ page }) => {
  const posts = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/rest/v1/transactions')) {
      posts.push(req.postData());
    }
  });
  await open(page);

  await page.click('#nl-add-btn');
  const dialog = page.locator('dialog');
  await dialog.locator('textarea').fill('paid RM 45.80 for Tingkatz at the kedai runcit');
  await page.click('#nl-parse-btn');

  // The AI-parsed preview appears (amount + receiver prefilled).
  await expect(page.locator('#nl-save-btn')).toBeVisible();
  await expect(dialog.locator('input[type="number"]')).toHaveValue('45.8');

  await page.click('#nl-save-btn');
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toContain('"amount":45.8');
  expect(posts[0]).toContain('"direction":"debit"');
  expect(posts[0]).toContain('"source_package":"manual"');
  expect(posts[0]).toContain('"source_app_label":"Cash"');
  expect(posts[0]).toContain('"confidence":"low"');
});

test('NL bookkeeping: the source can be switched to a custom label', async ({ page }) => {
  const posts = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/rest/v1/transactions')) {
      posts.push(req.postData());
    }
  });
  await open(page);

  await page.click('#nl-add-btn');
  const dialog = page.locator('dialog');
  await dialog.locator('textarea').fill('paid rm50 for koayiaoteng at 7village');
  await page.click('#nl-parse-btn');
  await expect(page.locator('#nl-save-btn')).toBeVisible();

  await dialog.locator('select.source-picker').selectOption('__custom__');
  await dialog.locator('input.source-picker-custom').fill('GrabPay');
  await page.click('#nl-save-btn');

  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toContain('"source_app_label":"GrabPay"');
  expect(posts[0]).toContain('"source_package":"manual"');
});

test('LLM model 404 shows a diagnostic instead of the generic parse failure', async ({ page }) => {
  await open(page, '/', { llm: { status: 404 } });

  await page.click('#nl-add-btn');
  const dialog = page.locator('dialog');
  await dialog.locator('textarea').fill('paid rm50 for koayiaoteng at 7village');
  await page.click('#nl-parse-btn');

  // The 404 (with the auto-fallback retry exhausted) surfaces as "model
  // unavailable", the sentence is never blamed, and the button stays retryable.
  await expect(dialog.locator('.text-danger')).toContainText('404');
  await expect(dialog.locator('.text-danger')).toContainText(
    'Settings',
  );
  await expect(page.locator('#nl-parse-btn')).toBeEnabled();
});

test('voice input transcribes into the NL textarea', async ({ page }) => {
  await open(page, '/', { speech: 'paid 12 for kopitiam' });

  await page.click('#nl-add-btn');
  const dialog = page.locator('dialog');
  const mic = dialog.locator('#nl-voice-btn');
  await expect(mic).toBeVisible();
  await mic.click();

  // The fake SpeechRecognition appends its transcript to the textarea.
  await expect(dialog.locator('textarea')).toHaveValue('paid 12 for kopitiam');
});

test('review inbox: Ask AI escalates a failed row into a linked transaction', async ({ page }) => {
  const rawNotifications = [
    {
      id: 'r-1',
      client_uuid: 'c-1',
      package_name: 'com.example.bank',
      app_label: 'TestBank',
      title: 'Payment successful',
      text_body: 'You paid RM 45.80 to Tingkatz',
      posted_at: new Date(Date.now() - 86_400_000).toISOString(),
      redactions_applied: [],
      parse_status: 'failed',
      parse_error: 'no template matched',
    },
  ];
  await open(page, '/#/review', { rawNotifications });

  await expect(page.locator('#ask-ai-r-1')).toBeVisible();
  const posts = [];
  const patches = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/rest/v1/transactions')) {
      posts.push(req.postData());
    }
    if (req.method() === 'PATCH' && req.url().includes('/rest/v1/raw_notifications')) {
      patches.push({ url: req.url(), data: req.postData() });
    }
  });

  await page.click('#ask-ai-r-1');
  await expect(page.locator('#ai-apply-btn')).toBeVisible();
  await page.click('#ai-apply-btn');

  // Inserted transaction links back to the raw row, and the raw row is marked
  // parsed so it leaves the inbox.
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toContain('"raw_notification_id":"r-1"');
  expect(posts[0]).toContain('"source_package":"com.example.bank"');
  await expect.poll(() => patches.length).toBe(1);
  expect(patches[0].data).toContain('"parse_status":"success"');
  expect(patches[0].data).toContain('"linked_transaction_id":"inserted-id"');
});