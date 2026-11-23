# Gallery regression

The `gallery-regression` job in CI runs both the backend visibility migration test and `e2e/emulated/prompt-gallery.spec.ts`. A failure makes CI fail, which blocks the normal CI-triggered Pages deployment.

The browser uses real Firebase SDK queries against the named `mediprisma` emulator database with backend rules. Fixtures are synthetic. It covers the summary entry's initial type filter, legacy `insight` compatibility, clearing the filter to find a chat-only HMC template, search, login, and importing the complete content. Private, unmigrated, and patient-only fixtures must not appear in the medical public list.

The backend test executes the migration CLI, verifies dry-run, preservation of private documents and other fields, idempotence, and public query visibility before/after migration. CI pins the backend commit so changes to rules or migration require an explicit revision update.

To run locally, install both repositories' dependencies, then from the backend checkout:

```sh
npx firebase emulators:exec --config firebase.gallery-test.json --only auth,firestore --project demo-mediprisma "node --test tests/prompt-visibility-migration.test.mjs && cd ../mediprisma-app && npx playwright test -c playwright.gallery.config.ts"
```

Dedicated ports are Firestore 8188, Auth 9198, and app 3017. The emulator does not enforce production composite-index availability; the Jest query regression separately guards against composite-index-dependent queries. These checks do not certify that a migration was applied in production. Release verification still needs a read-only production data check.

Known separate finding: signing in from an already-open guest preview remounts the manager and loses the pending import. This regression logs in before browsing, matching the signed-in incident; it does not certify continuation of a guest's pending action across login.
