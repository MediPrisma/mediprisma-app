/**
 * The DOAC dose calculator (NVAF, EU SmPC). Cases include the spec's own
 * (2026-10-20, Hao-Min Cheng), with sex written out: the spec's 「70 歲、70 kg、
 * SCr 2.2、CrCl 26」 holds only for a woman (a man's CrCl is 30.9 and keeps 5 mg).
 */
import { CALCULATORS } from '@/features/medical-calculator/calculators'
import { RENAL } from '@/features/medical-calculator/calculators/renal'
import { CITES, calculateDoacDoses, checkRegimen, cockcroftGault, crclLabel, type DoacAgent } from '@/features/medical-calculator/doac-dose-model'
import { doacSelects } from '@/features/medical-calculator/doac-clinical-autofill'
import { buildClinicalSelects } from '@/features/medical-calculator/hfpef-clinical-autofill'
import { HF_VISIT_CALCULATORS } from '@/features/clinical-decision-support/renderers/visit/VisitCalculators'
import type { CalcValues } from '@/features/medical-calculator/types'
import type { MedicationEntity } from '@/src/core/entities/clinical-data.entity'

const DDI_KEYS = ['ddi_ketoconazole', 'ddi_itraconazole', 'ddi_vori_posaconazole', 'ddi_hiv_pi', 'ddi_ciclosporin', 'ddi_tacrolimus', 'ddi_dronedarone', 'ddi_verapamil', 'ddi_erythromycin', 'ddi_clarithromycin', 'ddi_glecaprevir', 'ddi_inducer', 'ddi_anticoagulant']
/** Every question answered 「no」: each case below changes only what it names. */
const base: CalcValues = { age: '70', sex: 'male', weight: '70', scr: '1.0', dialysis: 'no', liver: 'none', liver_enzymes: 'no', bilirubin_high: 'no', pregnancy: 'no', gi_risk: 'no', ...Object.fromEntries(DDI_KEYS.map((key) => [key, 'no'])) }
const run = (values: CalcValues) => calculateDoacDoses({ ...base, ...values })
const agent = (values: CalcValues, name: DoacAgent) => run(values).results.find((r) => r.agent === name)!
const dose = (values: CalcValues, name: DoacAgent) => agent(values, name).doses.map((d) => `${d.mg}x${d.perDay}`).join('|')
const manual = (crcl: number, extra: CalcValues = {}) => ({ crcl_manual: String(crcl), ...extra })

describe('Cockcroft–Gault', () => {
  it('is the medical calculator’s own CrCl, unrounded', () => {
    const cg = RENAL.find((c) => c.id === 'crcl-cockcroft-gault')!
    for (const [age, weight, scr, sex] of [[82, 65, 1.0, 'male'], [70, 70, 2.2, 'female'], [45, 80, 0.9, 'female']] as const) {
      expect(cockcroftGault(age, weight, scr, sex)).toBeCloseTo(cg.compute({ age: String(age), weight: String(weight), scr: String(scr), sex })!.numericValue!, 10)
    }
  })
  it('needs a confirmed sex and a positive creatinine', () => {
    expect(cockcroftGault(70, 70, 1, '')).toBeNull()
    expect(cockcroftGault(70, 70, 0, 'male')).toBeNull()
  })
  it('a manual CrCl overrides and says so', () => {
    expect(run(manual(42)).crcl).toEqual({ value: 42, source: 'manual' })
  })
})

describe('apixaban — two of three, or CrCl 15–29 alone', () => {
  it('82 y, 65 kg, Cr 1.0: one criterion, 5 mg bid (age alone does not reduce)', () => {
    expect(dose({ age: '82', weight: '65', scr: '1.0' }, 'apixaban')).toBe('5x2')
  })
  it('82 y, 58 kg, Cr 1.2: age and weight, 2.5 mg bid', () => {
    expect(dose({ age: '82', weight: '58', scr: '1.2' }, 'apixaban')).toBe('2.5x2')
  })
  it('70 y, 70 kg, Cr 2.2: a woman (CrCl 26.3) 2.5 mg bid; a man (CrCl 30.9) 5 mg bid', () => {
    expect(dose({ age: '70', weight: '70', scr: '2.2', sex: 'female' }, 'apixaban')).toBe('2.5x2')
    expect(dose({ age: '70', weight: '70', scr: '2.2', sex: 'male' }, 'apixaban')).toBe('5x2')
  })
  it('no gap at 29.5 and 15', () => {
    expect(dose(manual(29.5), 'apixaban')).toBe('2.5x2')
    expect(dose(manual(15), 'apixaban')).toBe('2.5x2')
    expect(agent(manual(14.9), 'apixaban').verdict).toBe('not-recommended')
  })
  it('dialysis: not recommended whatever the CrCl reads', () => {
    expect(agent({ dialysis: 'yes' }, 'apixaban')).toMatchObject({ verdict: 'not-recommended', doses: [] })
  })
  it('a strong dual inhibitor: not recommended (EU SmPC; Taiwan wording pending)', () => {
    expect(agent({ ddi_ketoconazole: 'yes' }, 'apixaban').verdict).toBe('not-recommended')
    expect(agent({ ddi_hiv_pi: 'yes' }, 'apixaban').verdict).toBe('not-recommended')
  })
  it('verapamil and clarithromycin: no dose adjustment, a caution line', () => {
    const result = agent({ ddi_verapamil: 'yes', ddi_clarithromycin: 'yes' }, 'apixaban')
    expect(result).toMatchObject({ verdict: 'dose', doses: [{ mg: 5, perDay: 2 }] })
    expect(result.hits.some((hit) => hit.cite === CITES.apixabanLessPotent)).toBe(true)
  })
  it('an unknown criterion that could make two stops at 「待補資料」, never 5 mg', () => {
    const result = agent({ age: '82', weight: '' , scr: '1.0', crcl_manual: '40' }, 'apixaban')
    expect(result).toMatchObject({ verdict: 'missing', doses: [] })
    expect(result.missing).toContain('weight')
  })
})

describe('rivaroxaban — CrCl only', () => {
  it('85 y, 45 kg, CrCl 55: 20 mg qd (age and weight are not criteria)', () => {
    expect(dose(manual(55, { age: '85', weight: '45' }), 'rivaroxaban')).toBe('20x1')
  })
  it('15–49 is compared below 50: 49.5 → 15 mg, 50 → 20 mg', () => {
    expect(dose(manual(49.5), 'rivaroxaban')).toBe('15x1')
    expect(dose(manual(50), 'rivaroxaban')).toBe('20x1')
  })
  it('15–29: 15 mg with caution; <15 not recommended', () => {
    const severe = agent(manual(20), 'rivaroxaban')
    expect(severe.doses).toEqual([{ mg: 15, perDay: 1 }])
    expect(severe.hits.some((hit) => hit.level === 'caution')).toBe(true)
    expect(agent(manual(14), 'rivaroxaban').verdict).toBe('not-recommended')
  })
  it('dialysis: the label gives no dose — individual review, no number, even beside an 「avoid」', () => {
    expect(agent(manual(70, { dialysis: 'yes' }), 'rivaroxaban')).toMatchObject({ verdict: 'review', doses: [] })
    expect(agent(manual(70, { dialysis: 'yes', ddi_dronedarone: 'yes' }), 'rivaroxaban')).toMatchObject({ verdict: 'review', doses: [] })
    expect(checkRegimen('rivaroxaban:20:1', run(manual(70, { dialysis: 'yes', ddi_dronedarone: 'yes' })).results)?.state).toBe('unsettled')
  })
  it('Child-Pugh B or C: contraindicated', () => {
    expect(agent({ liver: 'B' }, 'rivaroxaban').verdict).toBe('contraindicated')
    expect(agent({ liver: 'B' }, 'apixaban').verdict).toBe('dose')
  })
  it('dronedarone or a strong inducer: avoid, the dose still shown', () => {
    expect(agent({ ddi_dronedarone: 'yes' }, 'rivaroxaban')).toMatchObject({ verdict: 'avoid', doses: [{ mg: 20, perDay: 1 }] })
    expect(agent({ ddi_inducer: 'yes' }, 'rivaroxaban').verdict).toBe('avoid')
  })
})

describe('edoxaban — any one of three', () => {
  it('60 y, 58 kg, CrCl 90: 30 mg qd', () => {
    expect(dose(manual(90, { age: '60', weight: '58' }), 'edoxaban')).toBe('30x1')
  })
  it('CrCl exactly 50 is 30 mg; ketoconazole, dronedarone, ciclosporin, erythromycin are 30 mg', () => {
    expect(dose(manual(50), 'edoxaban')).toBe('30x1')
    for (const drug of ['ddi_ketoconazole', 'ddi_dronedarone', 'ddi_ciclosporin', 'ddi_erythromycin'])
      expect(dose(manual(90, { [drug]: 'yes' }), 'edoxaban')).toBe('30x1')
  })
  it('verapamil, clarithromycin, itraconazole do not reduce', () => {
    expect(dose(manual(90, { ddi_verapamil: 'yes', ddi_clarithromycin: 'yes', ddi_itraconazole: 'yes' }), 'edoxaban')).toBe('60x1')
  })
  it('45 y, 80 kg, CrCl 110: 60 mg qd with the high-CrCl caution (SmPC §5.1 defines high as >100)', () => {
    const result = agent(manual(110, { age: '45', weight: '80' }), 'edoxaban')
    expect(result.doses).toEqual([{ mg: 60, perDay: 1 }])
    expect(result.hits.some((hit) => hit.cite === CITES.edoxabanHighCrcl)).toBe(true)
    expect(agent(manual(96, { weight: '80' }), 'edoxaban').hits.some((hit) => hit.cite === CITES.edoxabanHighCrcl)).toBe(false)
  })
  it('dialysis or CrCl <15: not recommended', () => {
    expect(agent({ dialysis: 'yes' }, 'edoxaban').verdict).toBe('not-recommended')
    expect(agent(manual(12), 'edoxaban').verdict).toBe('not-recommended')
  })
  it('pregnancy: contraindicated', () => {
    expect(agent({ pregnancy: 'yes' }, 'edoxaban').verdict).toBe('contraindicated')
  })
})

describe('dabigatran', () => {
  it('70 y, CrCl 70, verapamil: 110 mg bid, taken with verapamil', () => {
    const result = agent(manual(70, { ddi_verapamil: 'yes' }), 'dabigatran')
    expect(result.doses).toEqual([{ mg: 110, perDay: 2 }])
    expect(result.hits.some((hit) => hit.cite === CITES.dabigatranVerapamil)).toBe(true)
  })
  it('77 y, CrCl 65: 150 or 110 mg bid, an individual choice', () => {
    expect(dose(manual(65, { age: '77' }), 'dabigatran')).toBe('150x2|110x2')
  })
  it('80 y: 110 mg bid recommended', () => {
    expect(dose(manual(65, { age: '80' }), 'dabigatran')).toBe('110x2')
  })
  it('CrCl 28: contraindicated; 30 is the 30–50 band', () => {
    expect(agent(manual(28), 'dabigatran').verdict).toBe('contraindicated')
    expect(dose(manual(30), 'dabigatran')).toBe('150x2|110x2')
  })
  it('ketoconazole, itraconazole, ciclosporin, dronedarone, glecaprevir/pibrentasvir: contraindicated; tacrolimus, ritonavir: not recommended', () => {
    for (const drug of ['ddi_ketoconazole', 'ddi_itraconazole', 'ddi_ciclosporin', 'ddi_dronedarone', 'ddi_glecaprevir'])
      expect(agent(manual(70, { [drug]: 'yes' }), 'dabigatran').verdict).toBe('contraindicated')
    expect(agent(manual(70, { ddi_tacrolimus: 'yes' }), 'dabigatran').verdict).toBe('not-recommended')
    expect(agent(manual(70, { ddi_hiv_pi: 'yes' }), 'dabigatran').verdict).toBe('not-recommended')
  })
})

describe('shared rules', () => {
  it('another anticoagulant: contraindicated for all four', () => {
    expect(run({ ddi_anticoagulant: 'yes' }).results.every((r) => r.verdict === 'contraindicated')).toBe(true)
  })
  it('dialysis unanswered: doses still shown, dialysis listed to fill, the prescription not 「一致」', () => {
    const result = agent({ dialysis: '' }, 'rivaroxaban')
    expect(result.verdict).toBe('dose')
    expect(result.missing).toContain('dialysis')
    expect(checkRegimen('rivaroxaban:20:1', run({ dialysis: '' }).results)).toMatchObject({ state: 'unsettled', text: { zh: expect.stringContaining('透析') } })
  })
  it('an unanswered interaction is unknown, never 「no」 (#review P1)', () => {
    // Any of edoxaban's four would make it 30 mg: no 60 mg until each is answered.
    const edoxaban = agent(manual(70, { ddi_ciclosporin: '' }), 'edoxaban')
    expect(edoxaban).toMatchObject({ verdict: 'missing', doses: [] })
    expect(edoxaban.missing).toContain('ddi_ciclosporin')
    // Already 30 mg by weight: the unknown no longer decides the dose.
    expect(dose(manual(70, { weight: '55', ddi_ciclosporin: '' }), 'edoxaban')).toBe('30x1')
    // Verapamil would make dabigatran 110 mg recommended.
    expect(agent(manual(70, { ddi_verapamil: '' }), 'dabigatran')).toMatchObject({ verdict: 'missing', doses: [] })
    // A contraindicating drug unanswered: the dose stands, the prescription is not 「一致」.
    expect(checkRegimen('dabigatran:150:2', run(manual(70, { ddi_dronedarone: '' })).results)?.state).toBe('unsettled')
    // Liver unanswered: rivaroxaban is not called 「一致」.
    expect(checkRegimen('rivaroxaban:20:1', run(manual(70, { liver: '' })).results)?.state).toBe('unsettled')
  })
  it('ALT/AST >2 ULN: dabigatran not recommended; apixaban and edoxaban with caution', () => {
    expect(agent(manual(70, { liver_enzymes: 'yes' }), 'dabigatran').verdict).toBe('not-recommended')
    expect(agent(manual(70, { liver_enzymes: 'yes' }), 'apixaban')).toMatchObject({ verdict: 'dose' })
    expect(agent(manual(70, { liver_enzymes: 'yes' }), 'apixaban').hits.some((hit) => hit.cite === CITES.apixabanEnzymes)).toBe(true)
    expect(agent(manual(70, { liver_enzymes: '' }), 'dabigatran').missing).toContain('liver_enzymes')
  })
  it('bilirubin ≥1.5 ULN alone is not dabigatran’s enzyme rule (#review P2)', () => {
    expect(agent(manual(70, { bilirubin_high: 'yes' }), 'dabigatran').verdict).toBe('dose')
    expect(agent(manual(70, { bilirubin_high: 'yes' }), 'edoxaban').hits.some((hit) => hit.cite === CITES.edoxabanEnzymes)).toBe(true)
  })
  it('dabigatran with the GI risk unanswered: no dose, so 110 mg is never called a mismatch (#review P1)', () => {
    expect(agent(manual(70, { gi_risk: '' }), 'dabigatran')).toMatchObject({ verdict: 'missing', doses: [] })
    expect(checkRegimen('dabigatran:110:2', run(manual(70, { gi_risk: '' })).results)?.state).toBe('unsettled')
    expect(checkRegimen('dabigatran:110:2', run(manual(70, { gi_risk: 'yes' })).results)?.state).toBe('matches')
  })
  it('no CrCl: every agent waits on it', () => {
    expect(run({ scr: '' }).results.every((r) => r.verdict === 'missing' && r.missing.includes('CrCl'))).toBe(true)
  })
  it('a CrCl printed on the same side of 15, 30 and 50 as its raw value', () => {
    expect(crclLabel(49.96)).toBe('49.96')
    expect(crclLabel(29.99)).toBe('29.99')
    expect(crclLabel(62.34)).toBe('62.3')
  })
  it('every quotation names its section and a page, and is a sentence from the label, not a paraphrase', () => {
    for (const cite of Object.values(CITES)) {
      expect(cite.page).toBeGreaterThan(0)
      expect(cite.section).toMatch(/^4\.\d/)
      expect(cite.quote).not.toMatch(/…|\.\.\.|[一-鿿]/)
    }
  })
})

describe('the prescription beside its label dose', () => {
  it('matches, differs, against the label', () => {
    const { results } = run({ age: '82', weight: '58', scr: '1.2' })
    expect(checkRegimen('apixaban:2.5:2', results)?.state).toBe('matches')
    expect(checkRegimen('apixaban:5:2', results)).toMatchObject({ state: 'differs' })
    expect(checkRegimen('dabigatran:150:2', run(manual(25)).results)?.state).toBe('label-against')
  })
  it('dabigatran 110 inside the 「consideration」 band matches', () => {
    expect(checkRegimen('dabigatran:110:2', run(manual(45)).results)?.state).toBe('matches')
  })
  it('edoxaban 15 mg qd differs, quoting the SmPC’s own 15 mg line', () => {
    const check = checkRegimen('edoxaban:15:1', run(manual(25, { age: '84', weight: '44' })).results)
    expect(check).toMatchObject({ state: 'differs', cite: CITES.edoxaban15 })
  })
  it('an 「avoid」 combination is never a green 「一致」 (#review P1)', () => {
    const check = checkRegimen('rivaroxaban:20:1', run({ ddi_dronedarone: 'yes' }).results)
    expect(check).toMatchObject({ state: 'label-against', text: { zh: expect.stringContaining('應避免') } })
  })
  it('no regimen chosen: no check', () => {
    expect(checkRegimen('', run({}).results)).toBeUndefined()
    expect(checkRegimen('none', run({}).results)).toBeUndefined()
  })
})

describe('autofill from current prescriptions', () => {
  const now = new Date('2026-10-21T09:00:00+08:00')
  const med = (name: string, mg?: number, perDay?: number, extra: Partial<MedicationEntity> = {}): MedicationEntity => ({
    id: name,
    status: 'active',
    authoredOn: '2026-10-01',
    medicationCodeableConcept: { text: name },
    ...(mg ? { dosageInstruction: [{ doseAndRate: [{ doseQuantity: { value: mg, unit: 'mg' } }], timing: { repeat: { frequency: perDay, period: 1, periodUnit: 'd' } } }] } : {}),
    ...extra,
  } as MedicationEntity)
  it('one DOAC at a plain dose fills the regimen; interacting drugs are 是, the rest 否', () => {
    const selects = doacSelects([med('Eliquis apixaban', 2.5, 2), med('verapamil', 120, 2)], now)
    expect(selects.doacRegimen?.value).toBe('apixaban:2.5:2')
    expect(selects.ddi_verapamil?.value).toBe('yes')
    expect(selects.ddi_ketoconazole?.value).toBe('no')
  })
  it('a dose in tablets, or two DOACs, leaves the regimen to the clinician; two DOACs are another anticoagulant', () => {
    expect(doacSelects([med('apixaban')], now).doacRegimen).toBeUndefined()
    const two = doacSelects([med('apixaban', 5, 2), med('rivaroxaban', 20, 1)], now)
    expect(two.doacRegimen).toBeUndefined()
    expect(two.ddi_anticoagulant?.value).toBe('yes')
  })
  it('a topical azole or a heparin flush is not systemic, also when the record names the ingredient first (#review P2)', () => {
    const selects = doacSelects([
      med('ketoconazole cream', undefined, undefined, { drugTerminology: { ingredientText: 'ketoconazole' } } as Partial<MedicationEntity>),
      med('heparin lock flush', undefined, undefined, { drugTerminology: { ingredientText: 'heparin' } } as Partial<MedicationEntity>),
      med('amlodipine', 5, 1),
    ], now)
    expect(selects.ddi_ketoconazole?.value).toBe('no')
    expect(selects.ddi_anticoagulant?.value).toBe('no')
  })
  it('a hard gelatin capsule is oral (#review P2)', () => {
    const selects = doacSelects([med('Pradaxa dabigatran', 110, 2, { drugTerminology: { doseForm: 'hard gelatin capsule' } } as Partial<MedicationEntity>)], now)
    expect(selects.doacRegimen?.value).toBe('dabigatran:110:2')
  })
  it('no current prescription says nothing; none of them a DOAC says 「無」', () => {
    expect(doacSelects([], now)).toEqual({})
    expect(doacSelects([med('amlodipine', 5, 1)], now).doacRegimen?.value).toBe('none')
  })
  it('reaches the calculator through the shared clinical selects', () => {
    expect(buildClinicalSelects([], [med('rivaroxaban', 15, 1)], now).doacRegimen?.value).toBe('rivaroxaban:15:1')
  })
})

describe('registration', () => {
  it('one calculator, listed once, opened from the AF dose point (DP-09)', () => {
    expect(CALCULATORS.filter((c) => c.id === 'doac-dose-nvaf')).toHaveLength(1)
    const entry = HF_VISIT_CALCULATORS.find((e) => e.calculatorId === 'doac-dose-nvaf')!
    expect(entry).toMatchObject({ dp: 'DP-09', source: 'af', needsPoint: true })
    // The AF card's line 「劑量請用 DOAC 劑量計算機核對」 links to it.
    expect('劑量請用 DOAC 劑量計算機核對。').toMatch(entry.names)
  })
  it('its headline is the prescription against the label', () => {
    const calc = CALCULATORS.find((c) => c.id === 'doac-dose-nvaf')!
    const result = calc.compute({ ...base, age: '82', weight: '58', scr: '1.2', regimen: 'apixaban:5:2' })!
    expect(result.interpretation?.zh).toContain('仿單劑量為 2.5 mg bid')
    expect(calc.compute({ ...base, scr: '' })).toBeNull()
  })
})
