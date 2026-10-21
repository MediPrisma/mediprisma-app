import { defineConfig, devices } from '@playwright/test'

const staticDirectory = process.env.E2E_STATIC_DIR
if (staticDirectory && !process.env.E2E_APP_PATH) {
  throw new Error('Set E2E_APP_PATH to the static export basePath when using E2E_STATIC_DIR')
}

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
    command: staticDirectory ? 'node e2e/fixtures/static-export-server.mjs' : 'node node_modules/next/dist/bin/next start -p 3022',
    url: `http://localhost:3022${process.env.E2E_APP_PATH || '/'}`, reuseExistingServer: false, timeout: 60_000,
  },
})
