/**
 * Coronary disease on this host: listed in the switcher behind Beta, drawn as
 * 決策地圖 v2 from the pack's own model, asking 「心絞痛比上次」 and 「出血」,
 * and — on this Taiwan deployment — the 健保給付 line under DP-12, which a
 * deployment without the locale layer does not draw (CAD core §7.2).
 *
 * The patient is the review draft's case 13 (NSTEMI admitted 2026-01-20,
 * aspirin with ticagrelor, seen 2026-10-17); every value is invented.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import {
  CORONARY_DISEASE_GUIDELINE_PACK,
  buildVisitDecisionModel,
  resetLocaleLayer,
  setLocaleLayer,
  type CdssFact,
  type CdssPatientProfile,
} from '@voho0000/personalized-care'
import { ClinicalDecisionSupportView } from '@/features/clinical-decision-support/renderers/ClinicalDecisionSupportView'
import { HOST_CARE_PACKS } from '@/features/clinical-decision-support/guideline-packs/registry'

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

const PACK_ID = 'chronic-coronary-disease-cdss'

function fact(value: string, numericValue?: number, date = '2026-09-30'): CdssFact {
  return { zh: value, en: value, ...(numericValue === undefined ? {} : { numericValue }), date }
}

function med(names: string[], factKey: string) {
  return {
    state: 'confirmed-current' as const,
    medicationNames: names,
    factKey,
    lastPrescriptionDate: '2026-10-01',
    dataWindowStartDate: '2025-10-17',
    dataWindowEndDate: '2026-10-17',
  }
}

const PROFILE: CdssPatientProfile = {
  id: 'cad-host',
  evaluatedAt: '2026-10-17T09:00:00+08:00',
  facts: {
    age: fact('62 歲', 62),
    chronicCoronarySyndromeDiagnosis: fact('慢性冠心病診斷：I25.10', undefined, '2026-07-18'),
    acuteCoronarySyndromeAdmission: fact('365 天內有以急性冠心症為就診原因的住院紀錄（2026-01-20）', undefined, '2026-01-20'),
    // NHI coverage reads the inpatient stay itself, not an emergency visit.
    acuteCoronarySyndromeHospitalization: fact('以急性冠心症為就診原因的住院紀錄（2026-01-20）', undefined, '2026-01-20'),
    acuteCoronarySyndromeDischarge: fact('出院 2026-01-24', undefined, '2026-01-24'),
    LDL: fact('68 mg/dL', 68),
    eGFR: fact('78 mL/min/1.73m²', 78),
    LVEF: fact('52%', 52, '2026-01-22'),
  },
  medicationClassContexts: {
    aspirin: med(['Bokey 100 mg'], 'aspirinTherapy'),
    'p2y12-inhibitor': med(['ticagrelor 90 mg'], 'p2y12Therapy'),
    statin: med(['rosuvastatin 20 mg'], 'statinTherapy'),
  },
}

function draw() {
  const result = CORONARY_DISEASE_GUIDELINE_PACK.build({ profile: PROFILE, locale: 'zh-TW' })
  const visitModel = buildVisitDecisionModel({ packId: PACK_ID, result, profile: PROFILE, locale: 'zh-TW' })
  return render(<ClinicalDecisionSupportView result={result} locale="zh-TW" layout="map" patientId="cad-host" visitModel={visitModel} />)
}

const entry = (dp: string) => document.querySelector<HTMLElement>(`[data-book-dp="${dp}"]`)!

afterEach(() => resetLocaleLayer())

describe('coronary disease on this host', () => {
  it('lists coronary disease after AF, behind Beta as the package ships it', () => {
    expect(HOST_CARE_PACKS.map((pack) => pack.id).at(-1)).toBe(PACK_ID)
    expect(HOST_CARE_PACKS.find((pack) => pack.id === PACK_ID)?.enabled).toBe(false)
  })

  it('draws the CAD chapters and asks angina and bleeding', () => {
    draw()
    expect(screen.getByRole('heading', { name: /抗栓：DAPT 走到哪一步？/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /事件預防：哪些還沒到位？/ })).toBeInTheDocument()
    for (const label of ['更多', '一樣', '較少', '沒有']) {
      expect(screen.getAllByRole('button', { name: label }).length).toBeGreaterThan(0)
    }
  })

  it('draws the 健保給付 line under DP-12 on this Taiwan deployment', () => {
    draw()
    const coverage = within(entry('DP-12')).getByText(/2\.1\.1\.9/)
    expect(coverage.closest('[data-book-coverage]')).not.toBeNull()
    expect(within(entry('DP-12')).getByText('健保給付')).toBeInTheDocument()
    expect(coverage.textContent).toContain('2026-10-20')
  })

  it('draws no coverage line where the deployment runs without the locale layer', () => {
    setLocaleLayer('none')
    draw()
    expect(document.querySelector('[data-book-coverage]')).toBeNull()
    expect(entry('DP-12')).toBeInTheDocument()
  })
})

describe('CAD DP-01 phase classes', () => {
  // A stay coded I25.10 on DAPT: the record holds no ACS, so the class is the clinician's.
  const CHRONIC: CdssPatientProfile = {
    ...PROFILE,
    facts: {
      age: PROFILE.facts.age,
      chronicCoronarySyndromeDiagnosis: PROFILE.facts.chronicCoronarySyndromeDiagnosis,
      LDL: PROFILE.facts.LDL,
      eGFR: PROFILE.facts.eGFR,
      LVEF: PROFILE.facts.LVEF,
    },
  }

  function drawWith(profile: CdssPatientProfile, onCoronaryPhase: (answer: NonNullable<CdssPatientProfile['coronaryPhaseAnswer']>) => void) {
    const result = CORONARY_DISEASE_GUIDELINE_PACK.build({ profile, locale: 'zh-TW' })
    const visitModel = buildVisitDecisionModel({ packId: PACK_ID, result, profile, locale: 'zh-TW' })
    return render(<ClinicalDecisionSupportView result={result} locale="zh-TW" layout="map" patientId="cad-host" visitModel={visitModel} coronaryPhaseAnswer={profile.coronaryPhaseAnswer} onCoronaryPhase={onCoronaryPhase} />)
  }

  it('draws the four classes with the record\'s marked, and one press writes the answer', () => {
    const answers: NonNullable<CdssPatientProfile['coronaryPhaseAnswer']>[] = []
    drawWith(CHRONIC, (answer) => answers.push(answer))
    const choices = screen.getByTestId('cdss-book-class-choices')
    expect(within(choices).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'ACS 1 年內', 'PCI 半年內', '慢性・有 MI／ACS', '慢性・無 MI／ACS', '還不確定',
    ])
    expect(screen.getByTestId('cdss-book-classification').textContent).toContain('慢性・無 MI／ACS ← 本病人')
    fireEvent.click(within(choices).getByRole('button', { name: 'ACS 1 年內' }))
    expect(answers).toEqual([{ phase: 'acs-recent', answeredOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }])
  })

  it('reads the answer back: DP-12 is timed from the class, and the month can be added', () => {
    const answers: NonNullable<CdssPatientProfile['coronaryPhaseAnswer']>[] = []
    drawWith({ ...CHRONIC, coronaryPhaseAnswer: { phase: 'acs-recent', answeredOn: '2026-10-17' } }, (answer) => answers.push(answer))
    expect(entry('DP-12').textContent).toContain('ACS 1 年內（醫師判斷 10-17）')
    fireEvent.click(screen.getByTestId('cdss-book-class-month-open'))
    fireEvent.change(screen.getByTestId('cdss-book-class-month'), { target: { value: '2026-04' } })
    expect(answers.at(-1)).toMatchObject({ phase: 'acs-recent', eventMonth: '2026-04' })
  })

  it('emptying the month keeps the class and drops the month', () => {
    const answers: NonNullable<CdssPatientProfile['coronaryPhaseAnswer']>[] = []
    drawWith({ ...CHRONIC, coronaryPhaseAnswer: { phase: 'acs-recent', answeredOn: '2026-10-17' } }, (answer) => answers.push(answer))
    fireEvent.click(screen.getByTestId('cdss-book-class-month-open'))
    fireEvent.change(screen.getByTestId('cdss-book-class-month'), { target: { value: '2026-04' } })
    fireEvent.change(screen.getByTestId('cdss-book-class-month'), { target: { value: '' } })
    expect(answers.at(-1)).toEqual({ phase: 'acs-recent', answeredOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
  })

  it('shows a kept month back in the field, and emptying it drops the month', () => {
    const answers: NonNullable<CdssPatientProfile['coronaryPhaseAnswer']>[] = []
    drawWith({ ...CHRONIC, coronaryPhaseAnswer: { phase: 'pci-recent', answeredOn: '2026-10-17', eventMonth: '2026-08' } }, (answer) => answers.push(answer))
    const field = screen.getByTestId('cdss-book-class-month') as HTMLInputElement
    expect(field.value).toBe('2026-08')
    fireEvent.change(field, { target: { value: '' } })
    expect(answers).toEqual([{ phase: 'pci-recent', answeredOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }])
  })
})
