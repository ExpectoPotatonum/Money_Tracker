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
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
  },
});
