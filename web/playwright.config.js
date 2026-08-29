import { defineConfig } from '@playwright/test';

// Deliberately a handful of critical-path tests, not broad coverage — the
// dashboard is a thin read layer over data whose correctness is already
// guaranteed upstream by RLS and the schema (ARCHITECTURE.md §8). The Supabase
// REST layer is mocked via route interception so the suite runs without a
// live backend (web.yml passes placeholder VITE_* env at build time).
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_URL ?? 'http://localhost:4173',
  },
  webServer: {
    // Rebuild in "test" mode so the served bundle always carries the
    // placeholder URL (web/.env.test) regardless of any local .env.local with
    // a real project URL. Vite loads .env.test after .env.local, so it wins,
    // and the e2e suite's hardcoded storage key stays valid in both local and
    // CI runs. Keep in sync with the storage-key comment in dashboard.spec.js.
    // reuseExistingServer must stay false: a lingering preview from a prior
    // run would otherwise serve a stale bundle and mask the rebuild.
    command: 'npm run build -- --mode test && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
  },
});
