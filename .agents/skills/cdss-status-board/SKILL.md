---
name: cdss-status-board
description: Build or extend a disease-specific "status board" for the 個人化照護指引 tab — the view that puts a pack's safety inputs, phenotype, safety alerts and treatment pillars ahead of the generic module table. Use when asked to redesign a disease's CDSS view for at-a-glance reading (HF is the reference; dyslipidemia, CKD, AF… are next), to add a board for a new care pack, to add clinic-entered measurements to a board, or to reconcile a board with what its pack actually outputs.
---

# CDSS status board

A status board is the host's reading order for one care pack's output. It
answers, in this order, what a clinician asks before touching anything:

1. **Can I act on the numbers today?** — the inputs every decision in the
   pack reads, each with its date and age; missing ones hatched and named by
   how they are obtained.
2. **Is anything dangerous on the list?** — every safety module the pack
   marked actionable, as one alert row each.
3. **Which treatment pillar is missing?** — the pack's treatment tracks as
   tiles: what the patient is on, the pack's next step.
4. **Everything else, ranked by what I have to do** — actionable → data
   needed → clinical review → done (folded, but named).

The reference implementation is the heart-failure board
(`features/clinical-decision-support/renderers/heart-failure-board.ts`,
`HeartFailureStatusBoard.tsx`), shipped in `addfa353` and `90def2da`.
`references/hf-worked-example.md` walks through it; read it before starting
a second disease.

## Rules that do not bend

- **The pack owns every clinical word.** Statuses, titles, evidence values,
  next steps and missing-data text are printed as the pack wrote them. The
  host decides *placement only*. The one reading the HF board makes — a
  therapy fact starting 「目前用藥中」 means the class is taken — is the
  adapter's fixed wording, not a medical inference. Do not add thresholds,
  do not parse numbers into judgements, do not invent labels for states the
  pack did not name.
- **Nothing patches a rendered card.** A clinician input (evidence
  switches, clinic-entered vitals) reaches the pack only as part of the
  `CdssPatientProfile` the feature hands to `pack.build`; the whole result
  recomputes. See `utils/apply-clinic-vitals.ts` and
  `stores/clinic-vitals.store.ts`.
- **Gate on `result.packId`.** A board is built only for its pack; every
  other pack keeps the generic module table. Existing tests assert this.
- **No module disappears.** What the board consumes (`consumedIds`) is
  reachable from the board itself (tiles and alert rows expand the same
  `RecommendationDetail`); what it does not consume stays in the list.
  A folded group prints the names it hides. When the folded group is the
  whole list, it stays open.
- **DESIGN.md applies.** Neutral surfaces, one interaction blue, semantic
  colour only for state, no coloured card borders, 8px radii, 44px targets
  on touch surfaces, container queries (`@min-[40rem]`) because the panel
  width — not the viewport — decides the layout.
- **No new PHI persistence** without an approved path. Clinician-entered
  measurements are session-only, keyed by patient id, cleared on patient
  change.

## Workflow

1. **Dump the pack's real output first.** Never design from the module
   catalog alone. Run the pack against a synthetic profile (script in
   `references/hf-worked-example.md`) and against the fixture bundles under
   `mediprisma-cdss/__tests__/fixtures/` where the disease has
   them. Record for every module: `id`, `moduleName`, `moduleGroup`,
   `domain`, `status`, `overviewEvidenceFactKey(s)`, the `patientEvidence`
   fact keys, `evidenceTables` item ids, `missingData`, `nextActions[0]`.
2. **Map the four sections onto the pack.** Write the mapping down before
   coding:
   - *Headline*: which module states the phenotype / stage / risk category,
     and which single fact frames it (HF: `heart-failure-phenotype` + `LVEF`;
     CKD would be the G/A stage; dyslipidemia the risk category + `LDL`).
   - *Inputs strip*: the facts the pack's decisions read, in scan order,
     each with `kind: 'lab' | 'measure'`. Take them from the modules'
     `patientEvidence` fact keys, not from a wish list; a fact no module
     reads has no business on the strip. Note which arrive only as an
     evidence-table row (HF: NT-proBNP as `congestion:nt-probnp`).
   - *Alerts*: `domain === 'safety' && status === 'actionable'`. Generic;
     keep it generic.
   - *Pillars*: the treatment tracks. Two shapes exist —
     **(a) one module per pillar** (HF: four FMT modules, each with an
     `overviewEvidenceFactKey` naming its therapy fact), or
     **(b) one module listing several therapy rows** (dyslipidemia:
     `dyslipidemia-lipid-lowering-therapy` carries `statinTherapy`,
     `ezetimibeTherapy`, `pcsk9Therapy`, `bempedoicAcidTherapy` as
     evidence rows). Shape (b) tiles come from evidence rows of one module
     and all expand the same detail; the module's `status` and `nextActions`
     belong to the group heading, not to each tile.
   - *Remainder*: everything not consumed, grouped by status.
3. **Make the model config-driven before adding a second disease.** The HF
   files hard-code module ids. The second board is the moment to extract a
   `DiseaseBoardConfig` (`packId`, headline module + fact, metrics list,
   pillar shape (a)/(b) with ids or fact keys, section labels, which
   `measure` inputs the clinic form offers) and a `buildDiseaseBoard(result,
   config, locale, now)`. Keep `buildHeartFailureBoard` as a thin wrapper
   over the HF config so its tests keep passing unchanged. Rename the UI
   component only once two configs render through it.
4. **Wire the pack into the host switcher** if it is not there:
   `HOST_PACK_ORDER` in `features/clinical-decision-support/guideline-packs/registry.ts`
   (dyslipidemia is `hyperlipidemia-cdss`, not yet listed). A pack the
   package ships `enabled: false` shows only behind the Beta switch or a
   pilot id.
5. **Tests, in this order** (patterns in
   `__tests__/features/clinical-decision-support/heart-failure-board.test.tsx`):
   model from a hand-built `CdssResult` fixture (metrics order, dates and
   age, missing + kind, stale flag, pillar taking/not, alerts, consumedIds,
   non-pack → undefined); view (board present, summary hidden, list grouped
   by status, folded group names modules, tiles/alerts expand detail,
   whole-list-done stays open, other pack unchanged); wiring through
   `LiveFeature` for any new clinician input. Then run
   `display-heuristics.test.tsx` — it renders every pack's real output for
   a non-disease profile and demands at least one module cell.
6. **Verify like a change to a clinical surface** (AGENTS.md): focused
   tests, `npx tsc --noEmit`, `npx eslint`, `npm run build`, and a real
   browser at 390 / 640 / 880 panel widths. `references/hf-worked-example.md`
   has the browser recipe (Beta switch, fixture injection, temporary route)
   and the worktree overlay for a `@voho0000/*` version mismatch.

## What to leave out

- No numbers or icons that no decision reads ("data slop").
- No second copy of the clinical summary: the board replaces
  `cdss-clinical-summary` for its pack.
- No per-feature colour: group headers reuse `GROUP_TONES`, status badges
  reuse `status-presentation.tsx`.
- No fake chrome, no gradients, no hover-only affordances.
