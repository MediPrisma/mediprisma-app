/**
 * The suite's entry point instead of `@playwright/test` directly.
 *
 * Every spec gets the Firebase anonymous session served locally — see
 * fixtures/firebase-auth.ts for why. Applying it here rather than inside
 * `importBundle` means a spec cannot opt out by accident: the three specs that
 * drive the welcome screen without importing a bundle are covered too, and so
 * is any spec added later.
 */
import { test as base } from '@playwright/test'
import { stubFirebaseAnonymousAuth } from './firebase-auth'
import { observeImportWorkers } from './import-worker'

export const test = base.extend<{ initializeFirebaseFirestore: boolean; requireImportWorker: boolean }>({
  initializeFirebaseFirestore: [false, { option: true }],
  requireImportWorker: [false, { option: true }],
  // The second argument is Playwright's "hand this to the test" callback. It is
  // conventionally named `use`, but positional — and that name trips
  // react-hooks/rules-of-hooks, which reads it as React's `use`.
  context: async ({ context, initializeFirebaseFirestore, requireImportWorker }, runTest) => {
    // The explicit FHIR Firebase profile signs in a synthetic real account.
    // Its chat repositories require an initialized db; all Firestore network calls stay blocked by the fixture.
    await stubFirebaseAnonymousAuth(context, { initializeFirestore: initializeFirebaseFirestore || process.env.FHIR_E2E_AUTH_MODE === 'firebase' })
    if (requireImportWorker) await observeImportWorkers(context)
    await runTest(context)
  },
})

export { expect } from '@playwright/test'
