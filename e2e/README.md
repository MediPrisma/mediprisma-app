# E2E tests (Playwright)

> Current test guide｜v0.40.0｜Reviewed 2026-07-14

The main Playwright suite drives the real app in Chromium, imports a committed fictional FHIR Bundle through the real file input, and mocks only the external AI stream when a test needs generation. It does not require SMART OAuth, a live FHIR server, or real model calls.

## Run

```bash
npx playwright install chromium   # first run
npm run test:e2e                  # headless, starts :3001
npm run test:e2e:ui               # Playwright UI
```

`playwright.config.ts` starts `npm run dev` on port 3001. Local runs use two workers; CI is serial and retries failed tests twice. Set `CI=true` to reproduce CI worker/retry behavior.

## Test data

- `fixtures/synthetic-bundle.json`: committed, fully fictional data used by CI. It includes encounters, conditions, resolved diagnoses, medications, observations, blood-pressure components, multi-date albumin, diagnostic reports and imaging text.
- `fixtures/import.ts`: presets zh-TW／medical audience, imports the Bundle, waits for the patient, and exposes chat-scoped helpers.
- `E2E_LOCAL_BUNDLE=/absolute/path/bundle.json`: optional local override. The file must remain gitignored; assertions that depend on 王小明 still use the synthetic fixture.
- `public/demo/demo-bundle.json`: built-in product demo, tested separately through the Welcome flow.

Never commit real patient exports, Playwright traces, screenshots or report artifacts that contain clinical data.

## Main suite coverage

| Spec | Behavior |
|---|---|
| `smoke.spec.ts` | Import Bundle and render patient |
| `original-fhir-download.spec.ts` | Original FHIR download preserves all source data and attachments across reload and repeated import; a new tab cannot download another tab's data |
| `merged-fhir-download.spec.ts` | Cloud + hospital source resources, provenance, unknown fields and four distinct embedded images remain byte-identical through download, reload and repeated reimport in a clean browser context |
| `sdk-import-worker.spec.ts` | Production Worker converts SDK JSON with distinct results; the downloaded FHIR is importable again |
| `medcloud-handoff.spec.ts` | Cloud Wildcatch observes the first stable import target, immediately transfers a Bundle with `DataTransfer`, receives the settled event, and renders the patient |
| `demo-data.spec.ts` | Load／identify／exit built-in demo |
| `medical-summary-cumulative-navigation.spec.ts` | AI summary → cumulative report navigation from every non-report clinical tab after Reports background pre-mount |
| `problem-list.spec.ts` | Encounter diagnoses and resolved-status filter |
| `reports-search.spec.ts` | Search report content, institution and numeric result; highlight and empty state |
| `trend-charts.spec.ts` | BP SBP／DBP and single-analyte labels／normal band |
| `list-search.spec.ts` | Medication and visit list search／empty state |
| `workspace-performance.spec.ts` | Loading + warm tab switching／trend open-close／medication scrolling／retained DOM budgets |
| `data-selection-preview.spec.ts` | Medical Summary data-scope entry and assembled-context preview |
| `guided-tour.spec.ts` | The tour hub and getting-started tour, plus the custom-summary detailed guide across the real editor, gallery, responsive layouts, keyboard focus and restored views |
| `medical-summary-model-picker.spec.ts` | Summary picker remains available in patient audience |
| `safety-alerts.spec.ts` | Unified summary + safety, model sync, auto-run and encrypted cache reuse |
| `slash-template.spec.ts` | `/` menu, shortcut filtering, Enter insertion and Escape |
| `ai-chat-agent-only.spec.ts` | Single Agent path and locked-model settings route |
| `ai-chat-fhir-tools.spec.ts` | Full Chat → tool call → imported FHIR data → tool result → final-answer loop for imaging and semantic lab categories |
| `ai-chat-stream.spec.ts` | Markdown streaming, large-block responsiveness and idle timeout |
| `multi-tab-import-isolation.spec.ts` | Bundle and AI-cache ownership across two MediPrisma tabs |
| `mobile-report-row-layout.spec.ts` | Compact lab row keeps value and source metadata legible from 320 to 1440px |
| `mobile-visit-layout.spec.ts` | Visit row statistics at phone and desktop widths |
| `mobile-back-gesture.spec.ts` | Android back／iOS edge swipe closes the top phone layer instead of the app |
| `firebase-isolation.spec.ts` | The anonymous session is served locally, never from the production project |

Auth-gated Firestore history, real SMART redirects and real provider answers are not part of the main suite.

The workspace performance spec also attaches a `performance-metrics` JSON object to each Playwright result. Current measured p95 values, environment details and the five-run baseline procedure are recorded in [`docs/PERFORMANCE_BASELINE.md`](../docs/PERFORMANCE_BASELINE.md).

## Deterministic AI stream

`fixtures/mock-stream.ts` installs a pre-navigation `window.fetch` shim. Requests to sentinel proxy hosts receive OpenAI Chat Completions SSE frames emitted over time; all unrelated requests pass through.

The helper supports:

- model selection;
- custom Markdown reply;
- chunk size and delay;
- prompt-specific replies for concurrent summary／safety calls;
- a stream that emits some frames and then never closes;
- per-page idle-timeout override;
- request count and Long Tasks observation.

`fixtures/mock-agent-tool-flow.ts` separately drives a deterministic two-step
tool-call loop. It mocks only the model responses: the browser executes the real
registered FHIR tool against the normally imported Bundle, sends that result
back through the agent loop, and receives a final response only when expected
clinical-result fragments are present. This guards imaging and semantic lab
category retrieval without relying on live-model behavior.

Tests therefore cover the app's streaming renderer, throttling, Markdown blocks, timeout and cache behavior without testing a provider's current model quality or wire compatibility.

`playwright.config.ts` injects sentinel OpenAI／Gemini／Claude proxy URLs so proxy routing is enabled. The mock recognizes `e2e-proxy.test` and, when reusing a local server with real env, common Functions hosts.

## Firebase emulator chain

`playwright.emulated.config.ts` runs `e2e/emulated/firebase-emulator.spec.ts` on port 3002. It verifies:

```text
anonymous Firebase sign-in -> ID token -> AI proxy Authorization: Bearer header
```

This config expects Auth on 9099 and Firestore on 8080 under project `demo-mediprisma`. It is normally orchestrated by the backend `firebase-smart-on-fhir` repo:

```bash
npm run test:e2e:emulated
```

Running this command in the app repo alone requires the emulators to already be available.

## Firebase isolation

The app mints an anonymous Firebase session on any load without one — that is
what makes the free proxy tier work — so the suite used to call
`accounts:signUp` against the PRODUCTION project once per test. That littered
the project with disposable accounts, and when the sign-up rate limit tripped
every AI spec failed together with `TOO_MANY_ATTEMPTS_TRY_LATER` and stayed
failing until the quota reset (the symptom: chat specs timing out on a 傳送
button that never enables, because `canUseChat` needs
`apiKeyAvailable || user || isAnonymous`).

`fixtures/firebase-auth.ts` now serves that session locally — identitytoolkit
is answered from the fixture, securetoken too, and a pre-navigation test flag
keeps Firestore uninitialized. That avoids both production traffic and the
Firestore SDK's WebChannel retry loop. It is wired in `fixtures/test.ts`, which
is why specs import `test`/`expect` from there and not from `@playwright/test`.
`firebase-isolation.spec.ts` asserts it is still in effect.

For the REAL chain (anonymous sign-in -> ID token -> proxy header), use the
emulator config above.

## Writing a test

1. Import `test` and `expect` from `../fixtures/test`, never straight from
   `@playwright/test` — that is what keeps the run off the real Firebase
   project. Type-only imports from `@playwright/test` are fine.
2. Reuse `importBundle(page)` unless the test specifically covers Welcome／Demo.
3. Prefer roles, accessible names and `data-testid` over CSS structure.
4. Scope chat messages to `chatPanel(page)`; several other features render `.prose`.
5. Call `mockAiStream()` before the first navigation or Bundle import.
6. Avoid arbitrary sleeps; wait for user-visible state or a request count.
7. Keep tests independent and safe for full parallelism.
8. Update the coverage table above when adding a new spec.

## CI

### Production import Worker

For a server build, use the fake Firebase variables from `playwright.config.ts`,
run `npm run build` without `GITHUB_PAGES` or `DEPLOY_BASE_PATH`, then run
`npx playwright test -c playwright.import-production.config.ts`. This mode
starts `next start` on port 3022 and requires native conversion Worker success,
including the transferred original-FHIR Blob, on every import. A successful
main-thread fallback cannot pass it. The default development profile still
tests the supported fallback path.

For deployment parity, run `npm run build:mediprisma` with the same fake Firebase
variables, set `E2E_STATIC_DIR=out` and `E2E_APP_PATH=/app`, then run the same
Playwright command. It serves the static artifact under `/app` on loopback;
it does not try to use `next start` for an `output: 'export'` build.

To verify the real deployed site instead of starting a server, set
`E2E_BASE_URL=https://mediprisma.tw` and `E2E_APP_PATH=/app` before running the
same command. Only synthetic input is used; Firebase anonymous authentication
is stubbed by the shared fixture, while app assets, conversion, local storage,
downloads and image decoding are real.
Set `E2E_IMPORT_FIXTURE_TIMESTAMP` to an ISO timestamp when replaying identical
merged-FHIR bytes across before/after builds; it defaults to the current time.

`.github/workflows/e2e.yml` runs the main suite on pushes to `master`, installs Chromium with system dependencies, and uploads `playwright-report/` for seven days. It is currently independent of the GitHub Pages deploy gate.

The normal CI workflow already runs typecheck, lint, Jest and static build. A change that affects an E2E flow should pass both workflows locally when practical.

## Troubleshooting

### First load times out

Cold Turbopack compilation may take time; the web server timeout is 180 seconds. Verify port 3001 is not occupied by a stale server with different env.

### AI request reaches the network

Ensure `mockAiStream()` ran before `page.goto()`／`importBundle()` and the request is a POST to a recognized proxy host.

### Tests pass alone but fail together

Do not depend on localStorage, Bundle state, request count or Firestore state from another test. Each Playwright test gets a fresh context but a reused dev server.
