/**
 * The DOAC dose calculator's VTE indications (EU SmPC): acute DVT/PE,
 * extended prevention of recurrence, and hip/knee replacement prophylaxis.
 * None of them reads NVAF's reductions; edoxaban and dabigatran share their
 * NVAF table because their own SmPC does.
 */
import { CITES, calculateDoacDoses, checkRegimen, type DoacAgent } from '@/features/medical-calculator/doac-dose-model'
import { CALCULATORS } from '@/features/medical-calculator/calculators'
import type { CalcValues } from '@/features/medical-calculator/types'

const DDI_KEYS = ['ddi_ketoconazole', 'ddi_itraconazole', 'ddi_vori_posaconazole', 'ddi_hiv_pi', 'ddi_ciclosporin', 'ddi_tacrolimus', 'ddi_dronedarone', 'ddi_verapamil', 'ddi_amiodarone', 'ddi_quinidine', 'ddi_erythromycin', 'ddi_clarithromycin', 'ddi_glecaprevir', 'ddi_inducer', 'ddi_anticoagulant']
/** Every question answered: each case below changes only what it names. */
const base: CalcValues = { age: '70', sex: 'male', weight: '70', scr: '1.0', dialysis: 'no', liver: 'none', liver_enzymes: 'no', bilirubin_high: 'no', pregnancy: 'no', gi_risk: 'no', parenteral_lead_in: 'done', pe_unstable: 'no', ...Object.fromEntries(DDI_KEYS.map((key) => [key, 'no'])) }
const run = (indication: string, values: CalcValues = {}) => calculateDoacDoses({ ...base, indication, ...values })
const agent = (indication: string, values: CalcValues, name: DoacAgent) => run(indication, values).results.find((r) => r.agent === name)!
const dose = (indication: string, values: CalcValues, name: DoacAgent) => agent(indication, values, name).doses.map((d) => `${d.mg}x${d.perDay}`).join('|')
const steps = (indication: string, values: CalcValues, name: DoacAgent) => agent(indication, values, name).schedule.map((s) => s.regimen ? `${s.regimen.mg}x${s.regimen.perDay}` : 'lead-in').join(' → ')
const cites = (indication: string, values: CalcValues, name: DoacAgent) => agent(indication, values, name).hits.map((h) => h.cite)

describe('the indication', () => {
  it('blank is NVAF, as the AF dose point opens it', () => {
    expect(calculateDoacDoses({ ...base, age: '82', weight: '58', scr: '1.2' }).indication).toBe('nvaf')
    expect(dose('', { age: '82', weight: '58', scr: '1.2' }, 'apixaban')).toBe('2.5x2')
  })
  it('the questions only some indications ask are not counted to fill', () => {
    const inputs = CALCULATORS.find((c) => c.id === 'doac-dose-nvaf')!.inputs
    for (const key of ['parenteral_lead_in', 'anticoagulant_switch', 'pe_unstable', 'ddi_amiodarone', 'ddi_quinidine', 'vte_day', 'postop_day']) {
      expect(inputs.find((i) => i.key === key)?.optional).toBe(true)
    }
  })
  it('the calculator offers the five, NVAF first and by default', () => {
    const input = CALCULATORS.find((c) => c.id === 'doac-dose-nvaf')!.inputs.find((i) => i.key === 'indication')!
    expect(input).toMatchObject({ type: 'select', defaultValue: 'nvaf' })
    expect(input.type === 'select' && input.options.map((o) => o.value)).toEqual(['nvaf', 'vte-acute', 'vte-extended', 'vtep-hip', 'vtep-knee'])
  })
})

describe('apixaban', () => {
  it('acute VTE, 82 y, 55 kg, Cr 1.6 (CrCl 45): 10 mg bid ×7 d then 5 mg bid — NVAF’s two-of-three does not apply', () => {
    const values = { age: '82', weight: '55', scr: '1.6', crcl_manual: '45' }
    expect(steps('vte-acute', values, 'apixaban')).toBe('10x2 → 5x2')
    expect(dose('vte-acute', values, 'apixaban')).toBe('5x2')
    expect(agent('vte-acute', values, 'apixaban')).toMatchObject({ verdict: 'dose', reduced: false })
    expect(cites('vte-acute', values, 'apixaban')).toContain(CITES.apixabanVteNoAdjust)
    // The same patient in NVAF is 2.5 mg.
    expect(dose('nvaf', values, 'apixaban')).toBe('2.5x2')
  })
  it('CrCl 20: the same dose, with caution; CrCl 14 or dialysis: not recommended', () => {
    expect(dose('vte-acute', { crcl_manual: '20' }, 'apixaban')).toBe('5x2')
    expect(cites('vte-acute', { crcl_manual: '20' }, 'apixaban')).toContain(CITES.apixabanVteSevereRenal)
    expect(agent('vte-acute', { crcl_manual: '14' }, 'apixaban').verdict).toBe('not-recommended')
    expect(agent('vte-acute', { dialysis: 'yes' }, 'apixaban').verdict).toBe('not-recommended')
  })
  it('extended: 2.5 mg bid after 6 months', () => {
    expect(dose('vte-extended', {}, 'apixaban')).toBe('2.5x2')
    expect(cites('vte-extended', {}, 'apixaban')).toContain(CITES.apixabanVteExtended)
  })
  it('hip: 2.5 mg bid from 12–24 h, 32–38 days; knee 10–14 days (Eliquis 2.5 mg SmPC)', () => {
    const hip = agent('vtep-hip', {}, 'apixaban')
    expect(dose('vtep-hip', {}, 'apixaban')).toBe('2.5x2')
    expect(hip.duration?.text.zh).toContain('32–38 天')
    expect(hip.duration?.cite.document).toBe('Eliquis 2.5 mg')
    expect(agent('vtep-knee', {}, 'apixaban').duration?.text.zh).toContain('10–14 天')
    expect(agent('vtep-hip', { dialysis: 'yes' }, 'apixaban').hits[0]!.cite).toBe(CITES.apixabanVtepEsrd)
  })
  it('a strong inducer: not to be used for acute DVT/PE; caution when preventing recurrence', () => {
    expect(agent('vte-acute', { ddi_inducer: 'yes' }, 'apixaban').verdict).toBe('not-recommended')
    expect(cites('vte-acute', { ddi_inducer: 'yes' }, 'apixaban')).toContain(CITES.apixabanVteInducer)
    expect(agent('vte-extended', { ddi_inducer: 'yes' }, 'apixaban').verdict).toBe('dose')
  })
})

describe('rivaroxaban', () => {
  it('acute VTE, CrCl 40: 15 mg bid ×21 d then 20 mg qd; 15 mg qd only as a considered option, never automatic', () => {
    expect(steps('vte-acute', { crcl_manual: '40' }, 'rivaroxaban')).toBe('15x2 → 20x1')
    expect(dose('vte-acute', { crcl_manual: '40' }, 'rivaroxaban')).toBe('20x1|15x1')
    expect(agent('vte-acute', { crcl_manual: '40' }, 'rivaroxaban').reduced).toBe(false)
    expect(cites('vte-acute', { crcl_manual: '40' }, 'rivaroxaban')).toEqual(expect.arrayContaining([CITES.rivaroxabanVteRenal, CITES.rivaroxabanVteRenalUnstudied]))
    expect(dose('vte-acute', { crcl_manual: '60' }, 'rivaroxaban')).toBe('20x1')
  })
  it('extended, CrCl 40: 10 mg qd, unadjusted; 20 mg for high recurrence risk, and 15 mg beside it', () => {
    expect(dose('vte-extended', { crcl_manual: '40' }, 'rivaroxaban')).toBe('10x1|20x1|15x1')
    expect(cites('vte-extended', { crcl_manual: '40' }, 'rivaroxaban')).toEqual(expect.arrayContaining([CITES.rivaroxabanVteRenal10, CITES.rivaroxabanVteExtendedHigh]))
  })
  it('knee: 10 mg qd from 6–10 h after surgery, 2 weeks; CrCl <15 not recommended (Xarelto 10 mg SmPC)', () => {
    expect(dose('vtep-knee', {}, 'rivaroxaban')).toBe('10x1')
    expect(agent('vtep-knee', {}, 'rivaroxaban').duration?.text.zh).toContain('2 週')
    expect(agent('vtep-hip', {}, 'rivaroxaban').duration?.text.zh).toContain('5 週')
    expect(agent('vtep-knee', { crcl_manual: '12' }, 'rivaroxaban').hits[0]!.cite).toBe(CITES.rivaroxabanVtepRenal)
  })
})

describe('edoxaban', () => {
  it('acute VTE: the lead-in unanswered is unknown, and the prescription is not called 「一致」', () => {
    const r = run('vte-acute', { parenteral_lead_in: '' })
    expect(r.results.find((x) => x.agent === 'edoxaban')!.missing).toContain('parenteral_lead_in')
    expect(checkRegimen('edoxaban:60:1', r.results)?.state).toBe('unsettled')
  })
  it('acute VTE, lead-in under way: the dose waits on it', () => {
    const r = run('vte-acute', { parenteral_lead_in: 'ongoing' })
    const edo = r.results.find((x) => x.agent === 'edoxaban')!
    expect(edo).toMatchObject({ verdict: 'prerequisite' })
    expect(dose('vte-acute', { parenteral_lead_in: 'ongoing' }, 'edoxaban')).toBe('60x1')
    expect(checkRegimen('edoxaban:60:1', r.results)).toMatchObject({ state: 'unsettled', text: { zh: expect.stringContaining('≥5 天注射抗凝') } })
  })
  it('acute VTE, lead-in done: 60 mg qd matches; the schedule names the lead-in first', () => {
    const r = run('vte-acute')
    expect(checkRegimen('edoxaban:60:1', r.results)?.state).toBe('matches')
    expect(steps('vte-acute', {}, 'edoxaban')).toBe('lead-in → 60x1')
  })
  it('acute VTE, CrCl 120, 70 kg: 60 mg qd without NVAF’s high-CrCl caution', () => {
    expect(dose('vte-acute', { crcl_manual: '120' }, 'edoxaban')).toBe('60x1')
    expect(cites('vte-acute', { crcl_manual: '120' }, 'edoxaban')).not.toContain(CITES.edoxabanHighCrcl)
    expect(cites('nvaf', { crcl_manual: '120' }, 'edoxaban')).toContain(CITES.edoxabanHighCrcl)
  })
  it('the 30 mg factors are the SmPC’s own NVAF-and-VTE table', () => {
    expect(dose('vte-acute', { weight: '58' }, 'edoxaban')).toBe('30x1')
    expect(cites('vte-acute', { weight: '58' }, 'edoxaban')).toContain(CITES.edoxabanReduce)
  })
  it('hip or knee prophylaxis: not an indication in the EU SmPC', () => {
    const r = run('vtep-knee')
    expect(r.results.find((x) => x.agent === 'edoxaban')).toMatchObject({ verdict: 'not-indicated', doses: [] })
    expect(checkRegimen('edoxaban:30:1', r.results)?.state).toBe('label-against')
  })
})

describe('dabigatran', () => {
  it('acute VTE, 81 y: 110 mg bid, quoting that 110 mg for DVT/PE was not studied', () => {
    expect(dose('vte-acute', { age: '81', crcl_manual: '60' }, 'dabigatran')).toBe('110x2')
    expect(cites('vte-acute', { age: '81', crcl_manual: '60' }, 'dabigatran')).toContain(CITES.dabigatranVte220)
    expect(steps('vte-acute', { age: '81', crcl_manual: '60' }, 'dabigatran')).toBe('lead-in → 110x2')
  })
  it('hip, 76 y, CrCl 70: 75 mg then 150 mg qd for 28–35 days', () => {
    const r = agent('vtep-hip', { age: '76', crcl_manual: '70' }, 'dabigatran')
    expect(steps('vtep-hip', { age: '76', crcl_manual: '70' }, 'dabigatran')).toBe('75x1 → 150x1')
    expect(r).toMatchObject({ verdict: 'dose', reduced: true })
    expect(r.duration?.text.zh).toContain('28–35 天')
  })
  it('hip, CrCl 40 with verapamil: 150 mg qd, and 75 mg qd to consider', () => {
    expect(dose('vtep-hip', { crcl_manual: '40', ddi_verapamil: 'yes' }, 'dabigatran')).toBe('150x1|75x1')
    expect(cites('vtep-hip', { crcl_manual: '40', ddi_verapamil: 'yes' }, 'dabigatran')).toContain(CITES.dabigatranVtepVerapamilRenal)
  })
  it('knee, 70 y, CrCl 70, none of the three: 110 mg then 220 mg qd for 10 days; amiodarone reduces; amiodarone unanswered withholds', () => {
    expect(steps('vtep-knee', { crcl_manual: '70' }, 'dabigatran')).toBe('110x1 → 220x1')
    expect(agent('vtep-knee', { crcl_manual: '70' }, 'dabigatran').duration?.text.zh).toContain('10 天')
    expect(dose('vtep-knee', { crcl_manual: '70', ddi_amiodarone: 'yes' }, 'dabigatran')).toBe('150x1')
    expect(agent('vtep-knee', { crcl_manual: '70', ddi_amiodarone: '' }, 'dabigatran')).toMatchObject({ verdict: 'missing', missing: expect.arrayContaining(['ddi_amiodarone']) })
  })
  it('hip prophylaxis is read by the day after surgery: 75 mg on the day of surgery, 150 mg qd from day 1 (#review Astra 3)', () => {
    const { results } = run('vtep-hip', { age: '76', crcl_manual: '62' })
    expect(checkRegimen('dabigatran:75:1', results, 0)?.state).toBe('matches')
    expect(checkRegimen('dabigatran:150:1', results, 0)).toMatchObject({ state: 'differs', text: { zh: expect.stringContaining('術後第 0 天仿單劑量為 75 mg qd') } })
    expect(checkRegimen('dabigatran:150:1', results, 2)?.state).toBe('matches')
    expect(checkRegimen('dabigatran:75:1', results)).toMatchObject({ state: 'unsettled', text: { zh: expect.stringContaining('術後第幾天') } })
    expect(checkRegimen('dabigatran:150:1', results)?.state).toBe('unsettled')
    const calc = CALCULATORS.find((c) => c.id === 'doac-dose-nvaf')!
    expect(calc.compute({ ...base, indication: 'vtep-hip', age: '76', crcl_manual: '62', regimen: 'dabigatran:75:1', postop_day: '0' })!.interpretation?.zh).toContain('與仿單劑量一致')
  })
  it('knee, no reduction: 110 mg once on the day of surgery is a regimen the form offers and reads as matching (#review Astra re-review 3)', () => {
    const regimen = CALCULATORS.find((c) => c.id === 'doac-dose-nvaf')!.inputs.find((i) => i.key === 'regimen')!
    expect(regimen.type === 'select' && regimen.options.map((o) => o.value)).toContain('dabigatran:110:1')
    expect(checkRegimen('dabigatran:110:1', run('vtep-knee', { crcl_manual: '62' }).results, 0)?.state).toBe('matches')
  })
  it('CrCl 28: contraindicated in every indication', () => {
    for (const indication of ['vte-acute', 'vte-extended', 'vtep-hip']) expect(agent(indication, { crcl_manual: '28' }, 'dabigatran').verdict).toBe('contraindicated')
  })
})

describe('shared acute-VTE rules', () => {
  it('the lead-in’s parenteral agent, and only it, stopped as the oral one starts, is the label’s switch', () => {
    const switching = agent('vte-acute', { ddi_anticoagulant: 'yes', anticoagulant_switch: 'yes' }, 'apixaban')
    expect(switching.verdict).toBe('dose')
    expect(switching.hits.map((h) => h.cite)).toContain(CITES.apixabanSwitch)
    expect(agent('vte-acute', { ddi_anticoagulant: 'yes' }, 'apixaban')).toMatchObject({ verdict: 'review', missing: expect.arrayContaining(['anticoagulant_switch']) })
    expect(agent('nvaf', { ddi_anticoagulant: 'yes', anticoagulant_switch: 'yes' }, 'apixaban').verdict).toBe('contraindicated')
  })
  it('the switch names a subcutaneous agent and a UFH infusion apart: edoxaban starts 4 h after the infusion stops (#review Astra re-review 1)', () => {
    const edo = cites('vte-acute', { ddi_anticoagulant: 'yes', anticoagulant_switch: 'yes' }, 'edoxaban')
    expect(edo).toEqual(expect.arrayContaining([CITES.edoxabanSwitchSc, CITES.edoxabanSwitchUfh]))
    expect(cites('vte-acute', { ddi_anticoagulant: 'yes', anticoagulant_switch: 'yes' }, 'rivaroxaban')).toContain(CITES.rivaroxabanSwitchUfh)
    expect(cites('vte-acute', { ddi_anticoagulant: 'yes', anticoagulant_switch: 'yes' }, 'dabigatran')).toContain(CITES.dabigatranSwitchUfh)
  })
  it('a completed lead-in does not excuse warfarin or a second DOAC (#review Astra 1)', () => {
    const { results } = run('vte-acute', { ddi_anticoagulant: 'yes', parenteral_lead_in: 'done', anticoagulant_switch: 'no' })
    expect(results.find((r) => r.agent === 'apixaban')!.verdict).toBe('contraindicated')
    expect(checkRegimen('apixaban:5:2', results, 10)?.state).toBe('label-against')
  })
  it('unstable PE: not recommended for apixaban, rivaroxaban and edoxaban; dabigatran’s label is silent — individual review', () => {
    for (const name of ['apixaban', 'rivaroxaban', 'edoxaban'] as const) expect(agent('vte-acute', { pe_unstable: 'yes' }, name).verdict).toBe('not-recommended')
    expect(agent('vte-acute', { pe_unstable: 'yes' }, 'dabigatran').verdict).toBe('review')
    expect(agent('vte-acute', { pe_unstable: '' }, 'apixaban').missing).toContain('pe_unstable')
    expect(agent('vte-extended', { pe_unstable: '' }, 'apixaban').missing).not.toContain('pe_unstable')
  })
})

describe('the prescription against a schedule that changes with time', () => {
  const { results } = run('vte-acute')
  it('without the day, the loading dose is never 「一致」', () => {
    expect(checkRegimen('apixaban:10:2', results)).toMatchObject({ state: 'unsettled', text: { zh: expect.stringContaining('第幾天') } })
    expect(checkRegimen('apixaban:5:2', results)?.state).toBe('unsettled')
  })
  it('on day 3, 10 mg bid matches and 5 mg bid differs; on day 10 the reverse', () => {
    expect(checkRegimen('apixaban:10:2', results, 3)?.state).toBe('matches')
    expect(checkRegimen('apixaban:5:2', results, 3)).toMatchObject({ state: 'differs', text: { zh: expect.stringContaining('第 3 天仿單劑量為 10 mg bid') } })
    expect(checkRegimen('apixaban:5:2', results, 10)?.state).toBe('matches')
    expect(checkRegimen('apixaban:10:2', results, 10)?.state).toBe('differs')
  })
  it('rivaroxaban 15 mg qd on day 10 is not the loading dose, even where 15 mg qd is a later option', () => {
    const low = run('vte-acute', { crcl_manual: '40' }).results
    expect(checkRegimen('rivaroxaban:15:1', low, 10)?.state).toBe('differs')
    expect(checkRegimen('rivaroxaban:15:2', low, 10)?.state).toBe('matches')
    expect(checkRegimen('rivaroxaban:15:1', low, 30)?.state).toBe('matches')
  })
  it('a dose matching no phase names every phase', () => {
    expect(checkRegimen('apixaban:2.5:2', results)).toMatchObject({ state: 'differs', text: { zh: expect.stringContaining('10 mg bid 或 5 mg bid') } })
  })
  it('the headline reads the day from the form', () => {
    const calc = CALCULATORS.find((c) => c.id === 'doac-dose-nvaf')!
    expect(calc.compute({ ...base, indication: 'vte-acute', regimen: 'apixaban:10:2', vte_day: '2' })!.interpretation?.zh).toContain('與仿單劑量一致')
  })
})

describe('quotations', () => {
  it('a quotation from another strength’s SmPC in the same PDF names it', () => {
    for (const cite of Object.values(CITES)) {
      if (cite.agent === 'apixaban' && cite.page < 36) expect(cite.document).toBe('Eliquis 2.5 mg')
      if (cite.agent === 'rivaroxaban' && cite.page >= 29 && cite.page < 54) expect(cite.document).toBe('Xarelto 10 mg')
    }
  })
})
