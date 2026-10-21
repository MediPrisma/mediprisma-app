/**
 * Stopping and restarting a DOAC around a procedure (EHRA 2021, ASRA 2018,
 * EU SmPC). Run under TZ=Asia/Taipei: clock times are the app's local time.
 * The specification's own example (2026-10-20) is the first case; the rest
 * are the corrections its review asked for.
 */
import { CITES } from '@/features/medical-calculator/doac-dose-model'
import { GUIDELINE_CITES, calculatePeriop, ehraHours, formatLocal, isLabelCite, parseClock, parseLocalDateTime, type PeriopResult } from '@/features/medical-calculator/doac-periop-model'
import { CALCULATORS } from '@/features/medical-calculator/calculators'
import type { CalcValues } from '@/features/medical-calculator/types'

/** Apixaban 5 mg bid at 08:00 and 20:00, CrCl 62, no neuraxial, high risk, 2026-11-03 08:00 to 10:00. */
const base: CalcValues = {
  regimen: 'apixaban:5:2', dose_time_1: '08:00', dose_time_2: '20:00',
  age: '70', sex: 'male', weight: '70', scr: '1.0', crcl_manual: '62', dialysis: 'no',
  procedure_kind: 'high', neuraxial: 'none', surgery_at: '2026-11-03T08:00', surgery_end_at: '2026-11-03T10:00',
  traumatic_puncture: 'no', haemostasis: '',
}
const plan = (values: CalcValues = {}) => calculatePeriop({ ...base, ...values })
const times = (dates: Date[]) => dates.map(formatLocal)
const allCites = (result: PeriopResult) => [...result.basis, ...result.resume.lines, ...result.notes].flatMap((line) => line.cites)
const allText = (result: PeriopResult) => [...result.basis, ...result.resume.lines, ...result.notes].map((line) => `${line.text.zh} ${line.text.en}`).join('\n')

describe('the specification’s example: apixaban 5 mg bid, CrCl 62, total knee replacement, spinal anaesthesia at 2026-11-03 08:00, ending 10:00', () => {
  const result = plan({ neuraxial: 'single' })
  it('72 h — ASRA’s neuraxial interval outranks EHRA’s 48 h', () => {
    expect(result).toMatchObject({ state: 'timed', tier: 'high', holdHours: 72 })
    expect(allCites(result)).toEqual(expect.arrayContaining([GUIDELINE_CITES.ehraFig14, GUIDELINE_CITES.asraApixaban]))
  })
  it('last dose 10-31 08:00; six doses skipped, from 10-31 20:00 to the 11-03 08:00 dose at the procedure time', () => {
    expect(formatLocal(result.lastDoseBy!)).toBe('10-31 08:00')
    expect(formatLocal(result.lastDose!)).toBe('10-31 08:00')
    expect(times(result.skippedBefore)).toEqual(['10-31 20:00', '11-01 08:00', '11-01 20:00', '11-02 08:00', '11-02 20:00', '11-03 08:00'])
  })
  it('restart from 11-05 10:00 (high risk, 48 h after the end), with haemostasis confirmed first; the 11-05 20:00 dose is the first back', () => {
    expect(formatLocal(result.resume.earliest!)).toBe('11-05 10:00')
    expect(formatLocal(result.resume.firstDose!)).toBe('11-05 20:00')
    expect(times(result.resume.skippedAfter)).toEqual(['11-03 20:00', '11-04 08:00', '11-04 20:00', '11-05 08:00'])
    expect(allText(result)).toContain('恢復前需確認止血')
  })
  it('the label’s own 48 h stands beside EHRA, and no bridging', () => {
    expect(allCites(result)).toEqual(expect.arrayContaining([CITES.apixabanSurgeryHigh, GUIDELINE_CITES.ehraBridging]))
  })
})

describe('EHRA Figure 14 hours', () => {
  it('dabigatran by CrCl, FXa inhibitors at ≥30 and 15–29; nothing below', () => {
    expect(ehraHours('dabigatran', 85)).toEqual([24, 48])
    expect(ehraHours('dabigatran', 79.9)).toEqual([36, 72])
    expect(ehraHours('dabigatran', 30)).toEqual([48, 96])
    expect(ehraHours('dabigatran', 29.9)).toBeUndefined()
    expect(ehraHours('rivaroxaban', 30)).toEqual([24, 48])
    expect(ehraHours('rivaroxaban', 20)).toEqual([36, 48])
    expect(ehraHours('apixaban', 14.9)).toBeUndefined()
  })
  it('rivaroxaban CrCl 20: low risk 36 h, high risk 48 h', () => {
    expect(plan({ regimen: 'rivaroxaban:15:1', dose_time_2: '', crcl_manual: '20', procedure_kind: 'low' }).holdHours).toBe(36)
    expect(plan({ regimen: 'rivaroxaban:15:1', dose_time_2: '', crcl_manual: '20' }).holdHours).toBe(48)
  })
  it('dabigatran CrCl 45, high risk: 96 h, beside the label’s Table 7', () => {
    const result = plan({ regimen: 'dabigatran:110:2', crcl_manual: '45' })
    expect(result.holdHours).toBe(96)
    expect(allCites(result)).toContain(CITES.dabigatranSurgeryTable)
  })
})

describe('no interval where the sources give none', () => {
  it('CrCl 12 or dialysis: none, and the 15–29 row is not borrowed', () => {
    for (const values of [{ crcl_manual: '12' }, { dialysis: 'yes' }] as CalcValues[]) {
      const result = plan(values)
      expect(result).toMatchObject({ state: 'no-hours' })
      expect(result.holdHours).toBeUndefined()
      expect(result.lastDoseBy).toBeUndefined()
      expect(allText(result)).toContain('No official indication')
    }
  })
  it('dabigatran CrCl 25: none; with neuraxial, ASRA advises against the block', () => {
    const result = plan({ regimen: 'dabigatran:110:2', crcl_manual: '25', neuraxial: 'single' })
    expect(result).toMatchObject({ state: 'no-hours' })
    expect(result.holdHours).toBeUndefined()
    expect(allCites(result)).toEqual(expect.arrayContaining([CITES.dabigatranRenal, GUIDELINE_CITES.asraDabigatranBelow30]))
  })
  it('a blank CrCl, dialysis, procedure or neuraxial answer withholds the hours', () => {
    for (const [key, field] of [['crcl_manual', 'CrCl'], ['dialysis', 'dialysis'], ['procedure_kind', 'procedure_kind'], ['neuraxial', 'neuraxial']] as const) {
      const result = plan({ [key]: '', ...(key === 'crcl_manual' ? { scr: '' } : {}) })
      expect(result.state).toBe('missing')
      expect(result.holdHours).toBeUndefined()
      expect(result.missing).toContain(field)
    }
  })
})

describe('neuraxial (ASRA 2018)', () => {
  const dabigatran = { regimen: 'dabigatran:150:2', crcl_manual: '85', neuraxial: 'single' }
  it('dabigatran defaults to 120 h while any risk factor is unanswered', () => {
    const result = plan(dabigatran)
    expect(result.holdHours).toBe(120)
    expect(allText(result)).toContain('ASRA 預設')
  })
  it('graded only with reliable renal function and no risk factor: 64 y → 72 h; 66 y → 120 h', () => {
    const graded = { ...dabigatran, renal_reliable: 'yes', hypertension: 'no', antiplatelet: 'no' }
    expect(plan({ ...graded, age: '64' }).holdHours).toBe(72)
    expect(plan({ ...graded, age: '66' }).holdHours).toBe(120)
    expect(plan({ ...graded, age: '64', hypertension: 'yes' }).holdHours).toBe(120)
    expect(plan({ ...graded, age: '64', crcl_manual: '60' }).holdHours).toBe(96)
  })
  it('a minor-risk procedure does not skip the neuraxial rules: high tier, 72 h', () => {
    const result = plan({ procedure_kind: 'minimal', neuraxial: 'single' })
    expect(result).toMatchObject({ tier: 'high', holdHours: 72 })
    expect(allCites(result)).toContain(GUIDELINE_CITES.ehraTable12Neuraxial)
  })
  it('minor risk without neuraxial: one dosing interval — 12 h bid, 24 h qd; restart ≥6 h', () => {
    expect(plan({ procedure_kind: 'minimal' }).holdHours).toBe(12)
    const qd = plan({ procedure_kind: 'minimal', regimen: 'edoxaban:60:1', dose_time_2: '' })
    expect(qd.holdHours).toBe(24)
    expect(formatLocal(qd.resume.earliest!)).toBe('11-03 16:00')
  })
})

describe('restart: the latest condition', () => {
  const catheter = { neuraxial: 'catheter' }
  it('a catheter not yet removed: no earliest time, the removal time asked for', () => {
    const result = plan(catheter)
    expect(result.resume.earliest).toBeUndefined()
    expect(result.pending).toContain('catheter_removed_at')
  })
  it('removed 11-04 10:00: high-risk 48 h is later (11-05 10:00); removed 11-05 06:00: removal + 6 h is (11-05 12:00)', () => {
    expect(formatLocal(plan({ ...catheter, catheter_removed_at: '2026-11-04T10:00' }).resume.earliest!)).toBe('11-05 10:00')
    const late = plan({ ...catheter, catheter_removed_at: '2026-11-05T06:00' })
    expect(formatLocal(late.resume.earliest!)).toBe('11-05 12:00')
    expect(formatLocal(late.resume.firstDose!)).toBe('11-05 20:00')
    expect(allCites(late)).toEqual(expect.arrayContaining([GUIDELINE_CITES.asraXaCatheter, CITES.apixabanCatheter]))
  })
  it('a traumatic puncture unanswered withholds the earliest time; answered yes, its 24 h is listed', () => {
    expect(plan({ neuraxial: 'single', traumatic_puncture: '' }).resume.earliest).toBeUndefined()
    const bloody = plan({ neuraxial: 'single', traumatic_puncture: 'yes' })
    expect(allCites(bloody)).toContain(CITES.rivaroxabanTraumatic)
    expect(formatLocal(bloody.resume.earliest!)).toBe('11-05 10:00')
  })
  it('the interval before runs to the start, the restart from the end (#review Astra 2)', () => {
    // A puncture at 07:30 is the start: 72 h before it, not before 08:00.
    const early = plan({ neuraxial: 'single', surgery_at: '2026-11-03T07:30' })
    expect(formatLocal(early.lastDoseBy!)).toBe('10-31 07:30')
    expect(formatLocal(early.lastDose!)).toBe('10-30 20:00')
    // Ending at 12:00, the 48 h run from 12:00.
    expect(formatLocal(plan({ surgery_end_at: '2026-11-03T12:00' }).resume.earliest!)).toBe('11-05 12:00')
    const open = plan({ surgery_end_at: '' })
    expect(open.resume.earliest).toBeUndefined()
    expect(open.pending).toContain('surgery_end_at')
  })
  it('haemostasis not yet established: no earliest time', () => {
    expect(plan({ haemostasis: 'no' }).resume.earliest).toBeUndefined()
    expect(plan({ haemostasis: 'yes' }).resume.earliest).toBeDefined()
  })
})

describe('clock times', () => {
  it('without the patient’s dose times: the latest time, but no dose counted', () => {
    const result = plan({ dose_time_1: '', dose_time_2: '' })
    expect(formatLocal(result.lastDoseBy!)).toBe('11-01 08:00')
    expect(result.lastDose).toBeUndefined()
    expect(result.skippedBefore).toEqual([])
    expect(result.pending).toEqual(expect.arrayContaining(['dose_time_1', 'dose_time_2']))
  })
  it('without the procedure time: hours only', () => {
    const result = plan({ surgery_at: '' })
    expect(result.holdHours).toBe(48)
    expect(result.lastDoseBy).toBeUndefined()
    expect(result.pending).toContain('surgery_at')
  })
  it('the actual times decide which dose is last: 09:00/21:00 makes 10-31 21:00 the last', () => {
    const result = plan({ dose_time_1: '09:00', dose_time_2: '21:00' })
    expect(formatLocal(result.lastDose!)).toBe('10-31 21:00')
    expect(times(result.skippedBefore)).toEqual(['11-01 09:00', '11-01 21:00', '11-02 09:00', '11-02 21:00'])
  })
  it('parses only well-formed local times', () => {
    expect(parseLocalDateTime('2026-02-30T08:00')).toBeUndefined()
    expect(parseLocalDateTime('2026-11-03 08:00')).toBeUndefined()
    expect(parseClock('24:00')).toBeUndefined()
    expect(parseClock('07:30')).toBe(450)
  })
})

describe('AF ablation is its own plan', () => {
  it('apixaban: last dose 12 h before, the label’s 「need not be interrupted」, restart after sheath removal — never 48 h', () => {
    const result = plan({ procedure_kind: 'af-ablation' })
    expect(result).toMatchObject({ state: 'ablation', holdHours: 12 })
    expect(allCites(result)).toEqual(expect.arrayContaining([GUIDELINE_CITES.ehraFig16, CITES.apixabanAblation]))
    expect(allText(result)).toContain('3–5 小時')
    expect(result.resume.earliest).toBeUndefined()
  })
  it('dabigatran 110 mg: the label has no ablation data', () => {
    expect(allCites(plan({ procedure_kind: 'af-ablation', regimen: 'dabigatran:110:2' }))).toContain(CITES.dabigatranAblation110)
  })
})

describe('emergency', () => {
  it('apixaban: Figure 12, no interval, and andexanet is not a pre-operative reversal', () => {
    const result = plan({ procedure_kind: 'emergency' })
    expect(result.state).toBe('emergency')
    expect(result.holdHours).toBeUndefined()
    expect(allCites(result)).toEqual(expect.arrayContaining([GUIDELINE_CITES.ehraFig12, GUIDELINE_CITES.ehraAndexanet, GUIDELINE_CITES.ehraAnnexa]))
    expect(allText(result)).toContain('andexanet 不作為術前通用逆轉')
  })
  it('dabigatran: idarucizumab, and haemodialysis removes it', () => {
    expect(allCites(plan({ procedure_kind: 'emergency', regimen: 'dabigatran:150:2' }))).toEqual(expect.arrayContaining([CITES.dabigatranIdarucizumab, CITES.dabigatranDialysable]))
  })
})

describe('residual levels never clear a patient', () => {
  it('no plan says 「可開刀」 or 「safe to operate」', () => {
    for (const values of [{}, { neuraxial: 'single' }, { procedure_kind: 'emergency' }, { regimen: 'dabigatran:150:2' }, { crcl_manual: '12' }, { procedure_kind: 'af-ablation' }] as CalcValues[]) {
      const text = allText(plan(values))
      expect(text).not.toMatch(/可開刀|safe to operate|may proceed/i)
      expect(text).toMatch(/可接受的殘餘濃度未定/)
    }
  })
})

describe('sources', () => {
  it('every guideline quotation has its section, journal page and PDF page, verbatim English', () => {
    for (const cite of Object.values(GUIDELINE_CITES)) {
      expect(isLabelCite(cite)).toBe(false)
      if (cite.source === 'ehra') {
        expect(cite.page).toBe(1611 + cite.pdfPage)
        expect(cite.page).toBeGreaterThanOrEqual(1612)
        expect(cite.page).toBeLessThanOrEqual(1676)
      } else {
        expect(cite.page).toBeGreaterThanOrEqual(263)
        expect(cite.page).toBeLessThanOrEqual(309)
      }
      expect(cite.quote).not.toMatch(/…|\.\.\.|[一-鿿]/)
    }
  })
  it('the calculator: listed once, its headline the last dose and the earliest restart', () => {
    const calc = CALCULATORS.filter((c) => c.id === 'doac-periop')
    expect(calc).toHaveLength(1)
    expect(calc[0]!.compute({ ...base, neuraxial: 'single' })!.interpretation?.zh).toBe('apixaban：最後一劑距手術 ≥72 小時（10-31 08:00 以前）；最早 11-05 10:00 恢復，需確認止血')
    expect(calc[0]!.compute({ ...base, regimen: '' })).toBeNull()
  })
})
