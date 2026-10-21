import { defineConfig, devices } from '@playwright/test'

/** Build first. E2E_BASE_URL switches to the real deployed app without a local server. */
export default defineConfig<{ requireImportWorker: boolean }>({
  testDir: './e2e/tests',
  testMatch: ['merged-fhir-download.spec.ts', 'sdk-import-worker.spec.ts'],
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/import-production.json' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3022',
    locale: 'zh-TW', viewport: { width: 1440, height: 1000 },
    requireImportWorker: true, trace: 'retain-on-failure',
  },
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: 'node node_modules/next/dist/bin/next start -p 3022',
    url: 'http://localhost:3022', reuseExistingServer: false, timeout: 60_000,
  },
})
