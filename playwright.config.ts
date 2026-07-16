import { defineConfig, devices } from '@playwright/test';

// E2E du module Reporting. Nécessite l'app démarrée (`npm run dev:full`) et une session admin.
// Variables : E2E_BASE_URL (défaut http://localhost:5173), E2E_EMAIL, E2E_PASSWORD.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
