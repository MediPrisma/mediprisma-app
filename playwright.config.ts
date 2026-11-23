import { defineConfig, devices } from '@playwright/test'

// E2E config. Drives the app headless in Chromium against `next dev` on :3001.
// Tests live in e2e/tests and exercise CLIENT-ONLY flows by importing a
// synthetic FHIR bundle through the real file input — no SMART OAuth, no live
// FHIR server, no Firebase/AI needed. See e2e/README.md.
export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Keep local cold-start compilation from being saturated by every spec at
  // once. Five parallel Chromium workers regularly pushed initial tab clicks
  // past Playwright's 30s test timeout; two preserves parallel coverage without
  // the false failures. CI remains deliberately serial for determinism.
  workers: process.env.CI ? 1 : 2,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
    locale: 'zh-TW',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
    // First Turbopack compile can be slow on a cold CI runner.
    timeout: 180_000,
    // Pin the AI proxy URLs to sentinels so `hasChatProxy` is true (a no-user-
    // key model routes through the proxy) AND the mock-stream test knows the
    // exact host to intercept. @next/env won't override an already-set
    // process.env var, so these win over any real value in .env.local.
    env: {
      NEXT_PUBLIC_CHAT_URL: 'https://e2e-proxy.test/chat',
      NEXT_PUBLIC_GEMINI_URL: 'https://e2e-proxy.test/gemini',
      NEXT_PUBLIC_CLAUDE_URL: 'https://e2e-proxy.test/claude',
      // Sentinel hospital interaction service; medication-interactions.spec
      // answers it, every other spec leaves it unreachable (section stays off).
      NEXT_PUBLIC_DDI_SERVICE_ORIGIN: 'https://ddi.e2e.test',
      // Public, deliberately fake Firebase metadata. The request fixture
      // answers Auth locally and leaves Firestore uninitialized, so a clean
      // checkout can run without inheriting a developer's `.env.local`.
      NEXT_PUBLIC_FIREBASE_API_KEY: 'e2e-fake-api-key',
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'e2e-mediprisma.firebaseapp.com',
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'e2e-mediprisma',
      NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'e2e-mediprisma.appspot.com',
      NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '1234567890',
      NEXT_PUBLIC_FIREBASE_APP_ID: '1:1234567890:web:e2e000000000000000000',
    },
  },
})
