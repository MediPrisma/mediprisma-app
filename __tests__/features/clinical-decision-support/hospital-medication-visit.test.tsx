/**
 * An anticoagulant known only from an unconfirmed hospital prescription, from
 * the imported bundle to the AF decision map (決策地圖 v2; the first map is retired).
 *
 * Safety checks read the prescription as possible exposure (an earlier review
 * of this policy: never 「未使用口服抗凝」, never a second OAC offered); the map
 * must not read the same regimen as a settled decision either (「已抗凝」, DP-07
 * 已定, CHA₂DS₂-VA 「已在用」). DP-07 stays 待核對, with the order's agent and
 * dose as information and no action. A confirmed MedicationStatement settles it
 * as before. Every record here is fictional.
 */
import fs from 'node:fs'
import path from 'node:path'
import { render, within } from '@testing-library/react'
import { ATRIAL_FIBRILLATION_GUIDELINE_PACK, HEART_FAILURE_GUIDELINE_PACK, buildVisitDecisionModel } from '@voho0000/personalized-care'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { ClinicalDecisionSupportView } from '@/features/clinical-decision-support/renderers/ClinicalDecisionSupportView'
import { VisitBookChromeContext } from '@/features/clinical-decision-support/renderers/visit/visit-book-chrome'
import { buildVisitModel } from '@/features/clinical-decision-support/renderers/visit/visit-model.source'
import { applyAfCalculatorResults } from '@/features/clinical-decision-support/utils/af-calculators'
import { createHospitalAwareCdssPatientProfile, type HospitalAwareCdssProfile } from '@/features/clinical-decision-support/utils/hospital-medication-profile'
import { buildHospitalAwareCdssResult } from '@/features/clinical-decision-support/utils/hospital-medication-review'
import { applyHospitalMedicationVisitReview } from '@/features/clinical-decision-support/utils/hospital-medication-visit'
import type { CdssLocale, CdssResult, DecisionPointView, VisitDecisionModel } from '@/features/clinical-decision-support/types'

jest.mock('@/src/application/hooks/clinical-data/use-clinical-data-query.hook', () => ({
  useClinicalData: () => ({ diagnosticReports: [] }),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const webStreams = require('node:stream/web')
for (const name of ['TransformStream', 'ReadableStream', 'WritableStream'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[name] === 'undefined') {
    ;(globalThis as Record<string, unknown>)[name] = webStreams[name]
  }
}

const NOW = new Date('2026-10-01T04:00:00Z')
const APIXABAN = 'Apixaban (Eliquis) FC tab 5 mg'
const BID_5_MG = [{ timing: { repeat: { frequency: 2, period: 1, periodUnit: 'd' } }, doseAndRate: [{ doseQuantity: { value: 5, unit: 'mg' } }] }]

interface Medication {
  resourceType: 'MedicationRequest' | 'MedicationStatement'
  status: string
  name?: string
  dosage?: unknown[]
}

/** The e2e hospital fixture as an AF patient (79 y, HF, HTN, DM: CHA₂DS₂-VA 5) with the given hospital records. */
function bundleWith(medications: readonly Medication[]) {
  const bundle = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'e2e/fixtures/hospital-cdss-bundle.json'), 'utf8')) as {
    entry: { resource: Record<string, unknown> & { resourceType: string; id: string } }[]
  }
  bundle.entry = bundle.entry.filter(({ resource }) => resource.resourceType !== 'MedicationRequest' && resource.resourceType !== 'MedicationStatement')
  const patient = bundle.entry.find(({ resource }) => resource.resourceType === 'Patient')!.resource
  patient.birthDate = '1947-01-01'
  patient.gender = 'male'
  const subject = { reference: `Patient/${patient.id}` }
  for (const code of ['I48.91', 'I10', 'E11.9']) {
    bundle.entry.push({ resource: {
      resourceType: 'Condition', id: `fictional-visit-${code}`, subject,
      clinicalStatus: { coding: [{ code: 'active' }] },
      code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code }] },
    } })
  }
  medications.forEach((medication, index) => {
    const name = medication.name ?? APIXABAN
    const request = medication.resourceType === 'MedicationRequest'
    bundle.entry.push({ resource: {
      resourceType: medication.resourceType, id: `fictional-visit-oac-${index}`, subject, status: medication.status,
      ...(request ? { authoredOn: '2026-09-25' } : { effectiveDateTime: '2026-09-25' }),
      medicationCodeableConcept: { text: name, coding: [{ system: 'urn:oid:vgh.medication.generic', display: name }] },
      [request ? 'dosageInstruction' : 'dosage']: medication.dosage ?? BID_5_MG,
    } })
  })
  return bundle
}

/** What LiveFeature builds for the AF page: profile, calculators, result and the map, all through the app's seams. */
function afPage(medications: readonly Medication[], locale: CdssLocale = 'zh-TW') {
  const parsed = LocalBundleService.parse(bundleWith(medications))
  if (!parsed) throw new Error('the fictional bundle did not parse')
  const { patient, collection } = parsed
  // The AF calculators add their results as facts and keep the hospital fields, as LiveFeature relies on.
  const profile = applyAfCalculatorResults(createHospitalAwareCdssPatientProfile({
    patient,
    conditions: collection.conditions,
    encounters: collection.encounters,
    observations: collection.observations,
    medications: collection.medications,
    allergies: collection.allergies,
    carePlans: collection.carePlans,
    now: NOW,
  })) as HospitalAwareCdssProfile
  const result = buildHospitalAwareCdssResult(ATRIAL_FIBRILLATION_GUIDELINE_PACK, profile, locale)
  const input = { packId: result.packId, result, profile, locale }
  return { profile, result, input, model: buildVisitModel(input)! }
}

const dp07 = (model: VisitDecisionModel) => model.points.find((point) => point.dp === 'DP-07' && point.source === 'af')!
const allActions = (model: VisitDecisionModel) => model.points.flatMap((point) => [...point.actions, ...(point.next?.actions ?? [])])
const moduleOf = (result: CdssResult, id: string) => [
  ...result.recommendations,
  ...(result.automatedChecks ?? []).flatMap((check) => (check.recommendation ? [check.recommendation] : [])),
].find((item) => item.id === id)

const unconfirmed = (status: string): Medication => ({ resourceType: 'MedicationRequest', status })
const confirmedStatement: Medication = { resourceType: 'MedicationStatement', status: 'active' }

describe('an anticoagulant known only from an unconfirmed hospital prescription', () => {
  it.each(['unknown', 'active'])('keeps AF DP-07 待核對 for a hospital apixaban order with status %s', (status) => {
    const { profile, result, model } = afPage([unconfirmed(status)])
    // Possible exposure stays where the safety checks read it (the earlier P1).
    expect(profile.afMedicationRegimens?.[0]).toMatchObject({ ingredient: 'apixaban', doseMg: 5, timesPerDay: 2 })
    expect(profile.hospitalMedicationUnconfirmedAnticoagulation?.regimens.map((regimen) => regimen.ingredient)).toEqual(['apixaban'])
    expect(profile.hospitalMedicationUnconfirmedAnticoagulation?.sources).toEqual([
      expect.objectContaining({ resourceType: 'MedicationRequest', resourceId: 'fictional-visit-oac-0', status, date: '2026-09-25' }),
    ])
    const concordance = moduleOf(result, 'af-anticoagulation-concordance')!
    expect(concordance.title).not.toMatch(/not taking|未使用/)
    expect(concordance.visitDecision).toBeUndefined()

    const point = dp07(model)
    expect(point.state).not.toBe('done')
    expect(point).toMatchObject({
      state: 'info',
      headline: 'apixaban 5 mg bid：使用待核對',
      why: '院內處方（2026-09-25），目前使用待確認；開始或調整抗凝前先核對實際用藥',
      actions: [],
      needsData: ['核對目前用藥'],
    })
    expect(point.next).toBeUndefined()
    expect(point.changesIf).toBeUndefined()
    // The agent and dose remain, as information, not as a settled step.
    expect(point.chain).toEqual([
      { id: 'whether', state: 'current', text: '使用待核對' },
      { id: 'which', state: 'later', text: 'apixaban 5 mg bid' },
      { id: 'dose', state: 'later', text: '見 DP-09' },
    ])
    expect(point.scoreTable).toMatchObject({ title: 'CHA₂DS₂-VA', total: 5, verdict: '≥2 建議抗凝 · 院內處方待核對', pending: true })

    // Neither conclusion anywhere on the map: not 「已抗凝」, not 「未用抗凝」, and no OAC to start or choose.
    const text = JSON.stringify(model)
    expect(text).not.toContain('已抗凝')
    expect(text).not.toContain('已在用')
    expect(text).not.toContain('目前未用口服抗凝')
    expect(allActions(model).filter((action) => /^af-dp0[789]-/.test(action.id))).toEqual([])
  })

  it('says the same in English', () => {
    const point = dp07(afPage([unconfirmed('unknown')], 'en').model)
    expect(point).toMatchObject({
      state: 'info',
      headline: 'apixaban 5 mg bid: use to confirm',
      why: 'Hospital prescription (2026-09-25); current use needs confirmation. Confirm actual use before starting or changing anticoagulation',
      actions: [],
      needsData: ['Confirm current medication use'],
    })
    expect(point.scoreTable?.verdict).toBe('≥2: anticoagulation recommended · hospital prescription to confirm')
    expect(point.scoreTable?.verdict).not.toContain('on it')
  })

  it('settles DP-07 as before for a confirmed MedicationStatement, leaving the pack model untouched', () => {
    const { profile, input, model } = afPage([confirmedStatement])
    expect(profile.hospitalMedicationEvidence?.[0].useState).toBe('confirmed-current')
    expect(profile.hospitalMedicationUnconfirmedAnticoagulation).toBeUndefined()
    expect(model).toEqual(buildVisitDecisionModel(input))
    const point = dp07(model)
    expect(point).toMatchObject({ state: 'done', headline: '已抗凝：apixaban 5 mg bid', actions: [] })
    expect(point.scoreTable?.verdict).toBe('≥2 建議抗凝 · 已在用')
    expect(point.scoreTable?.pending).toBeUndefined()
  })

  it('names the confirmed anticoagulant when an unconfirmed order of another sits beside it', () => {
    const { profile, model } = afPage([
      { resourceType: 'MedicationRequest', status: 'unknown', name: 'Warfarin tab 2.5 mg', dosage: [] },
      confirmedStatement,
    ])
    expect(profile.hospitalMedicationUnconfirmedAnticoagulation).toBeUndefined()
    expect(profile.afMedicationRegimens?.map((regimen) => regimen.ingredient)).toEqual(['apixaban', 'warfarin'])
    expect(dp07(model)).toMatchObject({ state: 'done', headline: '已抗凝：apixaban 5 mg bid' })
  })

  it('reaches the heart-failure page through its AF companion without 「已抗凝」', () => {
    const { profile, result: af } = afPage([unconfirmed('active')])
    const result = buildHospitalAwareCdssResult(HEART_FAILURE_GUIDELINE_PACK, profile, 'zh-TW')
    const model = buildVisitModel({ packId: result.packId, result, profile, companions: { [af.packId]: af }, locale: 'zh-TW' })!
    const folded = model.points.find((point) => point.semanticId === 'hf-af-anticoagulation')!
    expect(folded.state).not.toBe('done')
    expect(JSON.stringify(model)).not.toContain('已抗凝')
  })
})

describe('applyHospitalMedicationVisitReview', () => {
  const settled: DecisionPointView = {
    dp: 'DP-14', semanticId: 'hf-af-anticoagulation', decisionId: 'af-oac-whether', block: 'treatment', group: 'af',
    label: 'AF 抗凝', source: 'af', moduleIds: ['af-anticoagulation-concordance'],
    state: 'done', headline: '已抗凝：warfarin', actions: [],
    chain: [{ id: 'whether', state: 'done', text: '已抗凝' }, { id: 'which', state: 'done', text: 'warfarin' }],
  }
  const model = (points: DecisionPointView[], headline = 'AF 追蹤：warfarin 2.5 mg qd'): VisitDecisionModel => ({
    packId: 'heart-failure-cdss', source: 'af', stage: 'follow-up', triggers: [], headline, keyValues: [], asks: [], queue: [], points,
  } as unknown as VisitDecisionModel)
  const pending = {
    facts: {},
    hospitalMedicationUnconfirmedAnticoagulation: {
      regimens: [{ ingredient: 'warfarin', name: 'Warfarin tab 2.5 mg', doseMg: 2.5, timesPerDay: 1, date: '2026-09-25', sources: [] }],
      sources: [{ resourceType: 'MedicationRequest', resourceId: 'fictional-warfarin', date: '2026-09-25', status: 'unknown' }],
    },
  } as never

  it('holds a folded 「要不要抗凝」 (HF DP-14) and the follow-up status line at 待核對', () => {
    const reviewed = applyHospitalMedicationVisitReview(model([settled]), pending, 'zh-TW')
    expect(reviewed.headline).toBe('AF 追蹤：warfarin 2.5 mg qd（使用待核對）')
    expect(reviewed.points[0]).toMatchObject({
      dp: 'DP-14', decisionId: 'af-oac-whether', state: 'info', headline: 'warfarin 2.5 mg qd：使用待核對', actions: [],
      chain: [{ id: 'whether', state: 'current', text: '使用待核對' }, { id: 'which', state: 'later', text: 'warfarin' }],
    })
  })

  it('leaves every other point, and a profile without pending anticoagulation, as the pack built them', () => {
    const other: DecisionPointView = { ...settled, dp: 'DP-09', semanticId: 'af-oac-dose', decisionId: 'af-oac-dose', headline: 'warfarin：劑量符合' }
    const built = model([other])
    expect(applyHospitalMedicationVisitReview(built, pending, 'zh-TW').points[0]).toBe(other)
    const unchanged = model([settled])
    expect(applyHospitalMedicationVisitReview(unchanged, { facts: {} } as never, 'zh-TW')).toBe(unchanged)
  })
})

describe('決策地圖 v2 with an unconfirmed hospital apixaban order', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn()
  })
  afterEach(() => window.history.pushState({}, '', '/'))

  function Page({ medications }: { medications: readonly Medication[] }) {
    const { result, model, profile } = afPage(medications)
    return (
      <VisitBookChromeContext.Provider value={{ inline: true }}>
        <ClinicalDecisionSupportView
          result={result}
          locale="zh-TW"
          layout="map"
          patientId="fictional-hospital-oac"
          visitModel={model}
          profileFacts={profile.facts}
        />
      </VisitBookChromeContext.Provider>
    )
  }
  const bookEntry = () => document.querySelector<HTMLElement>('[data-book-dp="DP-07"]')!
  const bookMapLine = () => document.querySelector<HTMLElement>('[data-book-map-dp="DP-07"]')!

  it.each(['unknown', 'active'] as const)('shows DP-07 and its CHA₂DS₂-VA 待核對 for a %s order, never 「已定」 or 「已在用」', (status) => {
    render(<Page medications={[unconfirmed(status)]} />)
    expect(bookMapLine()).toHaveAttribute('data-book-mark', 'info')
    expect(bookEntry()).toHaveAttribute('data-book-mark', 'info')
    expect(bookMapLine()).not.toHaveTextContent('已定')
    expect(bookEntry()).not.toHaveTextContent('已定')
    const score = within(bookEntry()).getByTestId('cdss-book-score')
    expect(score).toHaveTextContent('≥2 建議抗凝 · 院內處方待核對')
    expect(score.querySelector('[data-pending]')).not.toBeNull()
    // DP-07 sits beside DP-08 (要不要｜用哪個); its line follows the pair, at full width.
    expect(document.body).toHaveTextContent('apixaban 5 mg bid：使用待核對 · 院內處方（2026-09-25），目前使用待確認')
    expect(document.body).not.toHaveTextContent('已在用')
    expect(document.body).not.toHaveTextContent('已抗凝')
    expect(within(bookEntry()).queryByRole('button', { name: /開始抗凝/ })).toBeNull()
  })

  it('still settles DP-07 for a confirmed MedicationStatement', () => {
    render(<Page medications={[confirmedStatement]} />)
    expect(bookEntry()).toHaveAttribute('data-book-mark', 'done')
    expect(bookEntry()).toHaveTextContent('已定')
    expect(within(bookEntry()).getByTestId('cdss-book-score')).toHaveTextContent('≥2 建議抗凝 · 已在用')
  })
})
