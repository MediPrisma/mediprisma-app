# The heart-failure board, section by section

Commits `addfa353` (board) and `90def2da` (clinic-entered vitals) on
`master`. Files:

| File | Role |
|---|---|
| `renderers/heart-failure-board.ts` | pure model: `buildHeartFailureBoard(result, locale, now)` → `HeartFailureBoardModel` |
| `renderers/HeartFailureStatusBoard.tsx` | the UI: status strip, alert rows, pillar tiles, clinic-vitals form |
| `renderers/status-presentation.tsx` | `statusStyle`, `StatusIcon`, `statusLabel` shared with the module list |
| `renderers/ClinicalDecisionSupportView.tsx` | builds the board when `packId === 'heart-failure-cdss'`, hides the clinical summary, groups the remainder by status, passes `renderDetail` |
| `stores/clinic-vitals.store.ts` | session-only `{systolic, diastolic, heartRate, bodyWeight, measuredOn}` per patient |
| `utils/apply-clinic-vitals.ts` | writes entered vitals into `profile.facts` + `freshnessContexts`; `CLINIC_ENTRY_PATTERN` marks them |
| `LiveFeature.tsx` | `applyClinicVitals({...recordProfile, evidenceOverrides}, clinicVitals)` before `pack.build` |

## The mapping that was written down first

| Section | Source in the pack output |
|---|---|
| Headline | `heart-failure-phenotype`: `title` (「進入 HFrEF（LVEF <50%） 路徑」) + evidence with factKey `LVEF` |
| Inputs strip | `bloodPressure`, `heartRate`, `potassium`, `eGFR`, `sodium`, `bodyWeight` (from `heart-failure-fmt-safety` / `heart-failure-congestion-diuretic` evidence) and `NTproBNP` (evidence-table item `congestion:nt-probnp` when no fact) |
| Strip footer | `heart-failure-fmt-safety`: `moduleName` + `title` + badge unless `no-action` |
| Alerts | any `domain: 'safety'` module with `status: 'actionable'` (`heart-failure-medication-safety`, and `fmt-safety` when K ≥ 5.5) |
| Pillars (shape a) | `heart-failure-ras-inhibition`, `-beta-blocker`, `-mra`, `-sglt2`; each tile's therapy row is the evidence whose factKey equals the module's `overviewEvidenceFactKey` |
| Pillar heading | `heart-failure-hfref-gdmt` `title` (「…已確認 3/4 類」) + its badge; expands its detail |
| Consumed | alerts + pillars + gdmt (only when pillars exist) |

Things the output taught that the catalog did not:

- Evidence values carry the collection date inline (`142/84 mmHg（2026-04-18）`)
  and, when past the window, a stale note (`（已 140 天，超過 30 天窗）`).
  `compactValue()` strips both and keeps them as `date` / `stale`; several
  modules print the same fact and only some annotate it, so `findEvidence`
  prefers the annotated row.
- `sources[].date` is the date to show when present; the inline date is
  the fallback (clinic-entered facts have no sources).
- `bloodPressure` has no `numericValue` — packs parse `systolic/diastolic`
  from the text — so an entered BP must reproduce the adapter's wording.
- A patient the pathway did not open for yields the phenotype card alone;
  a board that folds `no-action` by default then shows nothing. Rule:
  fold only when another group exists.
- The pillar module's `status` says gap vs. done only together with the
  therapy row: RAS is `actionable` while *on* an ARB (switch to ARNI), so
  "taking" is read from the therapy fact, never from status.
- Outside the HFrEF pathway the pack produces no pillar module at all, but
  the clinician still wants the four classes in view. The feature passes
  `profile.facts` down (`profileFacts`), and a pillar with no module is read
  from the adapter's therapy facts (`arniTherapy`/`aceArbTherapy`,
  `hfEvidenceBetaBlockerTherapy`, `mraTherapy`, `sglt2Therapy`) as a plain
  card: `evaluated: false`, badge 「本次未判定」, no next step, not
  expandable, and the section says the judgement belongs to the HFrEF
  pathway. Facts are data the pack read, not a rule the host added.

## Dumping a pack

```js
// node dump.cjs — run against the built dist so no ts loader is needed
const care = require('<repo>/node_modules/@voho0000/personalized-care/dist/index.js')
// or the packages repo: mediprisma-cdss/packages/personalized-care/dist/index.js
const fact = (v, n, date) => ({ zh: v, en: v, ...(n === undefined ? {} : { numericValue: n }), date,
  sources: [{ resourceType: 'Observation', resourceId: 'obs-' + v.replace(/\W/g, ''), date }] })
const med = (state, factKey, names = [], last) => ({ state, medicationNames: names, factKey,
  lastPrescriptionDate: last, dataWindowStartDate: '2026-05-01', dataWindowEndDate: '2026-08-30' })
const profile = { id: 'demo', evaluatedAt: '2026-09-05T00:00:00.000Z', demographics: { sex: 'male' },
  facts: { /* the facts the disease reads */ }, freshnessContexts: { /* factKey → {state, intervalDays, date, ageDays} */ },
  medicationClassContexts: { /* classId → med(...) */ } }
const r = care.<PACK>_GUIDELINE_PACK.build({ profile, locale: 'zh-TW' })
for (const rec of r.recommendations) {
  console.log('\n===', rec.id, '|', rec.moduleName, '|', rec.moduleGroup, '|', rec.domain, '|', rec.status, '|', rec.priority)
  console.log('  title:', rec.title)
  console.log('  overview:', rec.overviewEvidenceFactKeys ?? rec.overviewEvidenceFactKey)
  for (const e of rec.patientEvidence) console.log('  ev:', e.factKeys.join(','), '=', e.value.slice(0, 100))
  for (const t of rec.evidenceTables ?? []) console.log('  table:', t.concept, t.items.map(i => i.id + '|' + i.direction + '|' + (i.value ?? '')).join(' ;; '))
  if (rec.missingData?.length) console.log('  miss:', rec.missingData.join(' / '))
  console.log('  next:', rec.nextActions[0])
}
```

The adapter's fact keys for a medication class are `facts.<class>Therapy`
(`grep -n "facts\.[a-zA-Z0-9]*Therapy =" packages/personalized-care-fhir/src/profile/fhir-cdss-profile.ts`);
the wording for a taken class is 「目前用藥中：<names>」 / "Currently taking: …".

## Browser check without a signed-in user

1. Temporary route (delete before commit): `app/dev-<disease>-preview/page.tsx`
   wrapping `<LiveClinicalDecisionSupportFeature />` in `AppProviders`, inside
   a `@container` div of the width under test (`?w=880`).
2. Load a bundle: the welcome screen's hidden `<input type=file>` accepts a
   `File` set through `DataTransfer` from the browser console; fixtures in
   `mediprisma-cdss/__tests__/fixtures/<disease>/fhir/*.bundle.json`
   (copy one under `public/` temporarily and `fetch` it). Decline the AI
   consent dialog.
3. Beta tab: 設定 → 顯示與關於 → 開啟 Beta 功能 (no sign-in needed since
   `dab86c39`); an unreleased pack also shows behind `?pilotPacks=<packId>`.
4. Look at 880, 640 and 390; dark theme follows the app's `.dark` class,
   so use the in-app theme switch, not `prefers-color-scheme` emulation.

## When `node_modules/@voho0000/*` lags `package.json`

`npm ci` needs a GitHub Packages token. To verify against the versions the
repo pins, build a throwaway worktree and overlay the packages repo's
built `dist`:

```bash
git worktree add /tmp/wt <commit> && cd /tmp/wt && mkdir node_modules
for e in "$MAIN/node_modules"/* "$MAIN/node_modules"/.bin; do n=$(basename "$e"); [ "$n" = "@voho0000" ] || ln -s "$e" node_modules/$n; done
mkdir node_modules/@voho0000
ln -s "$PKGS/personalized-care" node_modules/@voho0000/personalized-care        # and -fhir; others from $MAIN
TZ=Asia/Taipei npx jest __tests__/features/clinical-decision-support && npx tsc --noEmit -p tsconfig.json
```

Two suites (`LiveFeature.test.tsx`, `EvidenceTablePanel.test.tsx`) fail on
a stale `node_modules` for reasons unrelated to the board; do not chase
them there.
