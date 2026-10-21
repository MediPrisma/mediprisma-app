/**
 * Stopping and restarting a DOAC around a procedure (EHRA 2021, ASRA 2025
 * fifth edition, EU SmPC). Run under TZ=Asia/Taipei: clock times are the app's local time.
 * The specification's own example (2026-10-20) is the first case; the rest
 * are the corrections its review asked for.
 */
import { CITES, crclLabel } from '@/features/medical-calculator/doac-dose-model'
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
const allCites = (result: PeriopResult) => [...result.cautions, ...result.basis, ...result.resume.lines, ...result.notes].flatMap((line) => line.cites)
const allText = (result: PeriopResult) => [...result.cautions, ...result.basis, ...result.resume.lines, ...result.notes].map((line) => `${line.text.zh} ${line.text.en}`).join('\n')

describe('the specification’s example: apixaban 5 mg bid, CrCl 62, total knee replacement, spinal anaesthesia at 2026-11-03 08:00, ending 10:00', () => {
  const result = plan({ neuraxial: 'single' })
  it('72 h — ASRA’s neuraxial interval outranks EHRA’s 48 h', () => {
    expect(result).toMatchObject({ state: 'timed', tier: 'high', holdHours: 72 })
    expect(allCites(result)).toEqual(expect.arrayContaining([GUIDELINE_CITES.ehraFig14, GUIDELINE_CITES.asraApixabanHigh]))
  })
  it('last dose 10-31 08:00; six doses skipped, from 10-31 20:00 to the 11-03 08:00 dose at the procedure time', () => {
    expect(formatLocal(result.lastDoseBy!)).toBe('10-31 08:00')
    expect(formatLocal(result.lastDose!)).toBe('10-31 08:00')
    expect(times(result.skippedBefore)).toEqual(['10-31 20:00', '11-01 08:00', '11-01 20:00', '11-02 08:00', '11-02 20:00', '11-03 08:00'])
  })
  it('restart from 11-05 10:00 (high risk, 48 h after the end), with haemostasis confirmed first; the 11-05 08:00 dose is taken at 10:00 by the apixaban label (#review coordinator 3rd)', () => {
    expect(formatLocal(result.resume.earliest!)).toBe('11-05 10:00')
    // EHRA Figure 15 draws both apixaban doses on Day +2; it is the label that lets the morning dose wait until 10:00.
    expect(formatLocal(result.resume.delayed!)).toBe('11-05 08:00')
    expect(formatLocal(result.resume.firstDose!)).toBe('11-05 10:00')
    expect(times(result.resume.skippedAfter)).toEqual(['11-03 20:00', '11-04 08:00', '11-04 20:00'])
    expect(allCites(result)).toContain(CITES.apixabanMissed)
    expect(allText(result)).not.toContain('不服用、不補服（EHRA')
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

describe('neuraxial and deep blocks (ASRA 2025, fifth edition)', () => {
  it('dabigatran high dose: 72 h at CrCl ≥50, 120 h at 30–49 — by CrCl alone', () => {
    const dabigatran = { regimen: 'dabigatran:150:2', neuraxial: 'single' }
    expect(plan({ ...dabigatran, crcl_manual: '85' }).holdHours).toBe(72)
    expect(plan({ ...dabigatran, crcl_manual: '50' }).holdHours).toBe(72)
    expect(plan({ ...dabigatran, crcl_manual: '49.9' }).holdHours).toBe(120)
    expect(allCites(plan({ ...dabigatran, crcl_manual: '40' }))).toContain(GUIDELINE_CITES.asraDabigatranHigh30)
  })
  it('low doses: apixaban 36 h, rivaroxaban 24 h (30 h at CrCl <30), dabigatran 48 h — the longer of it and EHRA’s', () => {
    // A low-risk procedure under a deep plexus block: EHRA 24 h, ASRA low dose decides.
    const plexus = { procedure_kind: 'low', neuraxial: 'plexus' }
    expect(plan({ ...plexus, regimen: 'apixaban:2.5:2', dose_intent: 'low' }).holdHours).toBe(36)
    expect(plan({ ...plexus, regimen: 'rivaroxaban:10:1', dose_time_2: '' }).holdHours).toBe(24)
    expect(plan({ ...plexus, regimen: 'rivaroxaban:10:1', dose_time_2: '', crcl_manual: '25' }).holdHours).toBe(36)
    expect(allCites(plan({ ...plexus, regimen: 'rivaroxaban:10:1', dose_time_2: '', crcl_manual: '25' }))).toContain(GUIDELINE_CITES.asraRivaroxabanLow)
    expect(plan({ ...plexus, regimen: 'dabigatran:220:1', dose_time_2: '', crcl_manual: '85' }).holdHours).toBe(48)
  })
  it('apixaban 2.5 mg bid: its use unanswered reads as the high dose (72 h) and is asked', () => {
    const result = plan({ regimen: 'apixaban:2.5:2', neuraxial: 'plexus', procedure_kind: 'low' })
    expect(result).toMatchObject({ doseClass: 'high', holdHours: 72 })
    expect(result.pending).toContain('dose_intent')
  })
  it('a deep plexus/peripheral block takes ASRA’s interval but not EHRA’s neuraxial tier', () => {
    const result = plan({ procedure_kind: 'low', neuraxial: 'plexus' })
    expect(result).toMatchObject({ tier: 'low', holdHours: 72 })
    expect(allCites(result)).toContain(GUIDELINE_CITES.asraApixabanHigh)
  })
  it('minor risk with a deep block: ASRA’s 72 h replaces the trough, and nothing says 「不提前停藥」 (#review Astra 4)', () => {
    for (const neuraxial of ['plexus', 'plexus-catheter']) {
      const result = plan({ procedure_kind: 'minimal', neuraxial })
      expect(result).toMatchObject({ holdHours: 72 })
      expect(result.troughOnly).toBeUndefined()
      expect(result.skippedBefore).toHaveLength(6)
      expect(allText(result)).not.toContain('不提前停藥，')
      expect(allText(result)).toContain('不適用「在谷底做、不提前停藥」')
    }
  })
  it('AF ablation with any block: ASRA’s 72 h replaces “uninterrupted”, never both (#review Astra 5)', () => {
    for (const neuraxial of ['single', 'catheter', 'plexus', 'plexus-catheter']) {
      const result = plan({ procedure_kind: 'af-ablation', neuraxial })
      expect(result).toMatchObject({ state: 'ablation', holdHours: 72 })
      expect(result.troughOnly).toBeUndefined()
      expect(result.skippedBefore).toHaveLength(6)
      expect(allText(result)).not.toMatch(/不中斷或最小中斷；|不需中斷/)
      expect(allCites(result)).not.toContain(CITES.apixabanAblation)
    }
  })
  it('a minor-risk procedure does not skip the neuraxial rules: high tier, 72 h', () => {
    const result = plan({ procedure_kind: 'minimal', neuraxial: 'single' })
    expect(result).toMatchObject({ tier: 'high', holdHours: 72 })
    expect(allCites(result)).toContain(GUIDELINE_CITES.ehraTable12Neuraxial)
  })
  it('a catheter in place: the rule for a dose given unexpectedly is listed', () => {
    expect(allCites(plan({ neuraxial: 'catheter' }))).toContain(GUIDELINE_CITES.asraApixabanHighInSitu)
    expect(allText(plan({ neuraxial: 'catheter' }))).toContain('拔管前需停藥 ≥72 小時')
  })
})

describe('a timed interval does not silently cost an extra dose (#review coordinator 3b)', () => {
  it('rivaroxaban daily 09:00, low risk at 08:00: last dose 11-01 09:00 (47 h) is flagged — move the procedure, never take a dose early (#review Opus full 2)', () => {
    const result = plan({ regimen: 'rivaroxaban:20:1', dose_time_1: '09:00', dose_time_2: '', procedure_kind: 'low' })
    expect(formatLocal(result.lastDose!)).toBe('11-01 09:00')
    expect(result.hoursFromLastDose).toBe(47)
    const text = result.cautions.map((c) => c.text.zh).join()
    expect(text).toContain('若處置延後 1 小時，11-02 09:00 那一劑就可照常服用')
    expect(text).not.toMatch(/提前 [\d.]+ 小時服用/)
    // Evening qd, morning procedure: the caution offers a 12 h later procedure, never a dose 12 h early.
    const evening = plan({ regimen: 'rivaroxaban:20:1', dose_time_1: '20:00', dose_time_2: '', procedure_kind: 'low' })
    expect(evening.cautions.map((c) => c.text.zh).join()).toContain('若處置延後 12 小時，11-02 20:00 那一劑就可照常服用')
  })
  it('an interval met to the hour raises nothing', () => {
    expect(plan({}).cautions).toEqual([])
  })
  it('a CrCl just under 30 is printed on its own side of 30', () => {
    const result = plan({ regimen: 'dabigatran:150:2', crcl_manual: '29.96' })
    expect(allText(result)).toContain('CrCl 29.96 <30')
  })
  it('low doses quote ASRA’s own low-dose residual-level paragraph', () => {
    expect(allCites(plan({ neuraxial: 'plexus', procedure_kind: 'low', regimen: 'apixaban:2.5:2', dose_intent: 'low' }))).toContain(GUIDELINE_CITES.asraApixabanLowLevel)
    expect(allCites(plan({ neuraxial: 'plexus', procedure_kind: 'low', regimen: 'rivaroxaban:10:1', dose_time_2: '' }))).toContain(GUIDELINE_CITES.asraRivaroxabanLowLevel)
  })
})

describe('AF ablation and minor risk keep the last scheduled dose (#review 2)', () => {
  it('rivaroxaban daily at 08:00, ablation at 19:00: the 08:00 dose is kept (11 h), not one more skipped (35 h)', () => {
    const result = plan({ regimen: 'rivaroxaban:20:1', dose_time_1: '08:00', dose_time_2: '', procedure_kind: 'af-ablation', surgery_at: '2026-11-03T19:00' })
    expect(result).toMatchObject({ state: 'ablation', troughOnly: true })
    expect(formatLocal(result.lastDose!)).toBe('11-03 08:00')
    expect(result.hoursFromLastDose).toBe(11)
    expect(result.skippedBefore).toEqual([])
    expect(result.lastDoseBy).toBeUndefined()
    expect(result.cautions.map((c) => c.text.zh).join()).toContain('短於 EHRA 預設的 12 小時')
  })
  it('daily at 09:00, minor-risk procedure at 08:00: the day before’s 09:00 dose is last (23 h), not 47 h', () => {
    const result = plan({ regimen: 'rivaroxaban:20:1', dose_time_1: '09:00', dose_time_2: '', procedure_kind: 'minimal' })
    expect(formatLocal(result.lastDose!)).toBe('11-02 09:00')
    expect(result.hoursFromLastDose).toBe(23)
    expect(result.skippedBefore).toEqual([])
    expect(result.cautions.map((c) => c.text.zh).join()).toContain('延後 1 小時')
  })
  it('bid 08:00/20:00, procedure at 07:30: the 20:00 dose is last (11.5 h)', () => {
    const result = plan({ procedure_kind: 'minimal', surgery_at: '2026-11-03T07:30' })
    expect(formatLocal(result.lastDose!)).toBe('11-02 20:00')
    expect(result.hoursFromLastDose).toBe(11.5)
    expect(result.skippedBefore).toEqual([])
  })
  it('bid, minor risk: the procedure day’s morning dose is not taken, as EHRA Figure 15’s minor-risk row draws it (#review re7 Opus 1)', () => {
    // bid 08:00/20:00, minor risk 08:00–10:00: 20:00 the day before is last; 08:00 is not taken; 20:00 resumes.
    const result = plan({ procedure_kind: 'minimal', haemostasis: 'yes' })
    expect(result.skippedBefore).toEqual([])
    expect(formatLocal(result.resume.earliest!)).toBe('11-03 16:00')
    expect(times(result.resume.skippedAfter)).toEqual(['11-03 08:00'])
    expect(result.resume.delayed).toBeUndefined()
    expect(formatLocal(result.resume.firstDose!)).toBe('11-03 20:00')
    expect(allText(result)).toContain('EHRA Fig 15 的極低風險列')
    expect(allCites(result)).toContain(GUIDELINE_CITES.ehraFig15)
  })
  it('qd: a restart past midnight, or more than one dose in between, is not made up — never two doses in one day (#review final Opus 2)', () => {
    const late = plan({ procedure_kind: 'minimal', haemostasis: 'yes', regimen: 'rivaroxaban:20:1', dose_time_1: '09:00', dose_time_2: '', surgery_end_at: '2026-11-03T18:00' })
    expect(formatLocal(late.resume.earliest!)).toBe('11-04 00:00')
    expect(late.resume.delayed).toBeUndefined()
    expect(times(late.resume.skippedAfter)).toEqual(['11-03 09:00'])
    expect(formatLocal(late.resume.firstDose!)).toBe('11-04 09:00')
    expect(allCites(late)).toContain(CITES.rivaroxabanMissed)
    // An evening dose after a morning procedure is simply taken at its time.
    const evening = plan({ procedure_kind: 'minimal', haemostasis: 'yes', regimen: 'edoxaban:60:1', dose_time_1: '20:00', dose_time_2: '', surgery_end_at: '2026-11-03T09:00' })
    expect(evening.resume.delayed).toBeUndefined()
    expect(evening.resume.skippedAfter).toEqual([])
    expect(formatLocal(evening.resume.firstDose!)).toBe('11-03 20:00')
  })
  it('dabigatran once daily: the dose is not made up, the next day’s follows — its own label (#review final Opus 3)', () => {
    const result = plan({ procedure_kind: 'minimal', haemostasis: 'yes', regimen: 'dabigatran:220:1', dose_time_1: '09:00', dose_time_2: '', surgery_end_at: '2026-11-03T09:00' })
    expect(result.resume.delayed).toBeUndefined()
    expect(times(result.resume.skippedAfter)).toEqual(['11-03 09:00'])
    expect(formatLocal(result.resume.firstDose!)).toBe('11-04 09:00')
    expect(allCites(result)).toContain(CITES.dabigatranMissed)
    expect(allText(result)).not.toContain('延到恢復時服用')
    // Rivaroxaban 10 mg quotes the 10 mg SmPC's own missed-dose line.
    expect(allCites(plan({ procedure_kind: 'minimal', regimen: 'rivaroxaban:10:1', dose_time_2: '' }))).toContain(CITES.rivaroxabanMissed10)
  })
  it('qd, two doses before the restart: the earlier is not made up, the restart day’s own is taken at the restart (#review Astra sweep 1)', () => {
    const result = plan({ procedure_kind: 'minimal', haemostasis: 'yes', regimen: 'rivaroxaban:20:1', dose_time_1: '08:00', dose_time_2: '', surgery_end_at: '2026-11-04T04:00' })
    expect(formatLocal(result.resume.earliest!)).toBe('11-04 10:00')
    expect(times(result.resume.skippedAfter)).toEqual(['11-03 08:00'])
    expect(formatLocal(result.resume.delayed!)).toBe('11-04 08:00')
    expect(formatLocal(result.resume.firstDose!)).toBe('11-04 10:00')
  })
  it('apixaban bid: only the last dose before a same-day restart is taken at it, by the label (#review Astra sweep 2, Opus)', () => {
    const result = plan({ procedure_kind: 'minimal', haemostasis: 'yes', surgery_end_at: '2026-11-03T15:00' })
    expect(formatLocal(result.resume.earliest!)).toBe('11-03 21:00')
    expect(times(result.resume.skippedAfter)).toEqual(['11-03 08:00'])
    expect(formatLocal(result.resume.delayed!)).toBe('11-03 20:00')
    expect(formatLocal(result.resume.firstDose!)).toBe('11-03 21:00')
    expect(allCites(result)).toContain(CITES.apixabanMissed)
    expect(allText(result)).toContain('apixaban 仿單另允許早上漏服的那一劑與晚上那一劑一起服；計算機只把恢復前最後一劑列為在恢復時服用，不加倍補服更早的劑量；由團隊決定')
    // Past midnight the evening dose is not made up.
    const late = plan({ procedure_kind: 'minimal', haemostasis: 'yes', surgery_end_at: '2026-11-03T19:00' })
    expect(late.resume.delayed).toBeUndefined()
    expect(formatLocal(late.resume.firstDose!)).toBe('11-04 08:00')
  })
  it('dabigatran bid: the evening dose is taken at the restart only while the next dose is ≥6 h away', () => {
    const dabi = { procedure_kind: 'minimal', haemostasis: 'yes', regimen: 'dabigatran:150:2' }
    // Restart exactly at 20:00: the dose is simply taken on time.
    const onTime = plan({ ...dabi, surgery_end_at: '2026-11-03T14:00' })
    expect(onTime.resume.delayed).toBeUndefined()
    expect(formatLocal(onTime.resume.firstDose!)).toBe('11-03 20:00')
    const late = plan({ ...dabi, surgery_end_at: '2026-11-03T18:00' })
    // Restart 11-04 00:00, next 08:00 is 8 h away: the 20:00 dose is taken at 00:00.
    expect(formatLocal(late.resume.delayed!)).toBe('11-03 20:00')
    const tooLate = plan({ ...dabi, surgery_end_at: '2026-11-03T22:00' })
    // Restart 11-04 04:00, next 08:00 only 4 h away: omitted.
    expect(tooLate.resume.delayed).toBeUndefined()
    expect(formatLocal(tooLate.resume.firstDose!)).toBe('11-04 08:00')
    expect(allCites(tooLate)).toContain(CITES.dabigatranMissedBid)
  })
  it('qd: the day’s dose is taken at the restart instead, the same day (EHRA Figure 15; #review final Opus)', () => {
    // qd 09:00, minor risk 08:00–09:00: the 09:00 dose moves to 15:00, then 09:00 the next day — not a 48 h gap.
    const result = plan({ procedure_kind: 'minimal', haemostasis: 'yes', regimen: 'rivaroxaban:20:1', dose_time_1: '09:00', dose_time_2: '', surgery_end_at: '2026-11-03T09:00' })
    expect(formatLocal(result.resume.earliest!)).toBe('11-03 15:00')
    expect(formatLocal(result.resume.delayed!)).toBe('11-03 09:00')
    expect(formatLocal(result.resume.firstDose!)).toBe('11-03 15:00')
    expect(result.resume.skippedAfter).toEqual([])
    expect(allText(result)).toContain('恢復仍在同一天就延到恢復時服用')
  })
  it('minor risk soon after a dose: that dose is not taken before the procedure, and the headline does not say “taken as usual” (#review Opus full 1)', () => {
    // bid 08:00/20:00, minor risk 10:00–11:00: 08:00 is only 2 h before; 20:00 the day before (14 h) is the last taken.
    const bid = plan({ procedure_kind: 'minimal', haemostasis: 'yes', surgery_at: '2026-11-03T10:00', surgery_end_at: '2026-11-03T11:00' })
    expect(formatLocal(bid.heldBefore!)).toBe('11-03 08:00')
    expect(formatLocal(bid.lastDose!)).toBe('11-02 20:00')
    expect(bid.hoursFromLastDose).toBe(14)
    expect(times(bid.skippedBefore)).toEqual(['11-03 08:00'])
    // The procedure day’s morning dose is not taken (EHRA Figure 15, minor risk), listed once; 20:00 resumes.
    expect(bid.resume.delayed).toBeUndefined()
    expect(bid.resume.skippedAfter).toEqual([])
    expect(formatLocal(bid.resume.firstDose!)).toBe('11-03 20:00')
    expect(bid.cautions.map((c) => c.text.zh).join()).toContain('11-03 08:00 那一劑距開始只有 2 小時，未到谷底：處置前不服')
    const headline = CALCULATORS.find((c) => c.id === 'doac-periop')!.compute({ ...base, procedure_kind: 'minimal', haemostasis: 'yes', surgery_at: '2026-11-03T10:00', surgery_end_at: '2026-11-03T11:00' })!
    expect(headline.interpretation!.zh).toContain('11-03 08:00 那一劑距開始太近，處置前不服；處置前最後服用 11-02 20:00，距開始 14 小時')
    expect(headline.interpretation!.zh).not.toContain('照常服用')
    // qd 08:00, minor risk 14:00–15:00: 08:00 (6 h) is held and taken at the 21:00 restart, the same day.
    const qd = plan({ procedure_kind: 'minimal', haemostasis: 'yes', regimen: 'rivaroxaban:20:1', dose_time_1: '08:00', dose_time_2: '', surgery_at: '2026-11-03T14:00', surgery_end_at: '2026-11-03T15:00' })
    expect(formatLocal(qd.heldBefore!)).toBe('11-03 08:00')
    expect(formatLocal(qd.lastDose!)).toBe('11-02 08:00')
    expect(formatLocal(qd.resume.delayed!)).toBe('11-03 08:00')
    expect(formatLocal(qd.resume.firstDose!)).toBe('11-03 21:00')
    expect(qd.skippedBefore).toEqual([])
    expect(qd.resume.skippedAfter).toEqual([])
  })
  it('minor risk with no end time yet: the dose at the start still waits, with the missed-dose rule (#review Opus full 3)', () => {
    const result = plan({ procedure_kind: 'minimal', surgery_end_at: '' })
    expect(result.resume.earliest).toBeUndefined()
    expect(allText(result)).toContain('恢復時間未定：11-03 08:00 起的劑量先不服')
    expect(allCites(result)).toContain(CITES.apixabanMissed)
  })
  it('AF ablation: the restart waits on the sheath, and the dose at the start is still named (#review Opus re5 1)', () => {
    const result = plan({ procedure_kind: 'af-ablation', surgery_end_at: '' })
    expect(result.resume.earliest).toBeUndefined()
    expect(allText(result)).toContain('恢復時間未定：11-03 08:00 起的劑量先不服')
  })
  it('bid: only the procedure day’s morning dose is omitted; a later morning dose follows the label (#review Astra full 1)', () => {
    // dabigatran 150 bid, minor risk 11-03 08:00 to 11-04 04:00: restart 11-04 10:00, next dose 20:00 is 10 h away.
    const result = plan({ procedure_kind: 'minimal', haemostasis: 'yes', regimen: 'dabigatran:150:2', surgery_end_at: '2026-11-04T04:00' })
    expect(formatLocal(result.resume.earliest!)).toBe('11-04 10:00')
    expect(times(result.resume.skippedAfter)).toEqual(['11-03 08:00', '11-03 20:00'])
    expect(formatLocal(result.resume.delayed!)).toBe('11-04 08:00')
    expect(formatLocal(result.resume.firstDose!)).toBe('11-04 10:00')
    // Apixaban the same way: 11-04 08:00 is taken at the 10:00 restart, the same day.
    const apixaban = plan({ procedure_kind: 'minimal', haemostasis: 'yes', surgery_end_at: '2026-11-04T04:00' })
    expect(formatLocal(apixaban.resume.delayed!)).toBe('11-04 08:00')
  })
  it('a trough already reached needs no prompt: bid 08:00/20:00, procedure at 08:00 is 12 h after the 20:00 dose', () => {
    const result = plan({ procedure_kind: 'minimal' })
    expect(formatLocal(result.lastDose!)).toBe('11-02 20:00')
    expect(result.hoursFromLastDose).toBe(12)
    expect(result.cautions).toEqual([])
  })
})

describe('third review by the coordinator', () => {
  it('AF ablation: the restart is 3 h after the sheath is out, and the dose at the start waits for it (EHRA Figure 16)', () => {
    const ablation = { procedure_kind: 'af-ablation', surgery_at: '2026-11-03T07:00', surgery_end_at: '2026-11-03T10:00', haemostasis: 'yes' }
    const waiting = plan(ablation)
    expect(waiting.resume.earliest).toBeUndefined()
    expect(waiting.pending).toContain('sheath_removed_at')
    expect(allText(waiting)).toContain('恢復時間未定：11-03 08:00 起的劑量先不服')
    const out = plan({ ...ablation, sheath_removed_at: '2026-11-03T10:00' })
    expect(out.pending).toEqual([])
    expect(formatLocal(out.resume.earliest!)).toBe('11-03 13:00')
    expect(formatLocal(out.resume.delayed!)).toBe('11-03 08:00')
    expect(formatLocal(out.resume.firstDose!)).toBe('11-03 13:00')
    expect(allCites(out)).toContain(GUIDELINE_CITES.ehraFig16)
    expect(plan({ ...ablation, sheath_removed_at: '2026-11-03T06:00' }).pending).toContain('sheath_removed_at')
  })
  it('a block with a prophylactic dose: the longer interval is named when EHRA’s is the longer', () => {
    const result = plan({ regimen: 'rivaroxaban:10:1', dose_time_2: '', neuraxial: 'single' })
    expect(result.holdHours).toBe(48)
    expect(allText(result)).toContain('取較長者：48 小時（EHRA 高風險）')
    expect(allText(result)).toContain('術前取 EHRA 與 ASRA 低劑量規則的較長者')
  })
  it('two equal bid dose times are stopped, with no doses counted', () => {
    const result = plan({ dose_time_2: '08:00' })
    expect(result.cautions.map((c) => c.text.zh).join()).toContain('兩個服藥時刻相同')
    expect(result.pending).toContain('dose_time_2')
    expect(result.lastDose).toBeUndefined()
    expect(result.skippedBefore).toEqual([])
    expect(result.resume.firstDose).toBeUndefined()
  })
  it('the procedure-day morning line appears only where that dose is actually omitted (#review re8 Astra 1)', () => {
    const afternoon = plan({ procedure_kind: 'minimal', haemostasis: 'yes', surgery_at: '2026-11-03T16:00', surgery_end_at: '2026-11-03T17:00' })
    expect(formatLocal(afternoon.lastDose!)).toBe('11-03 08:00')
    expect(allText(afternoon)).not.toContain('早上那一劑（')
    const night = plan({ procedure_kind: 'minimal', haemostasis: 'yes', surgery_at: '2026-11-03T00:00', surgery_end_at: '2026-11-03T01:00' })
    expect(formatLocal(night.resume.firstDose!)).toBe('11-03 08:00')
    expect(allText(night)).not.toContain('早上那一劑（')
    expect(allText(plan({ procedure_kind: 'minimal', haemostasis: 'yes' }))).toContain('極低風險處置當天早上那一劑（11-03 08:00）不服用')
    // Restart past midnight: the evening dose is not called optional (#review re9 Opus 1).
    const lateEnd = plan({ procedure_kind: 'minimal', haemostasis: 'yes', surgery_at: '2026-11-03T13:00', surgery_end_at: '2026-11-03T18:30' })
    expect(times(lateEnd.resume.skippedAfter)).toEqual(['11-03 20:00'])
    expect(allText(lateEnd)).toContain('本例恢復時間未到，11-03 20:00 那一劑也不服')
    expect(allText(lateEnd)).not.toContain('當晚那一劑可選（')
    // Restart not yet known, procedure at midnight: the morning dose is named ahead (#review re9 Opus 3).
    expect(allText(plan({ procedure_kind: 'minimal', surgery_at: '2026-11-03T00:00', surgery_end_at: '' }))).toContain('極低風險處置當天早上那一劑（11-03 08:00）不服用')
    // Low risk names Figure 15’s optional evening dose it leaves out.
    expect(allText(plan({ procedure_kind: 'low' }))).toContain('低風險列另把處置當晚一劑畫為可選')
  })
  it('CrCl 79.96 is not printed as 80.0', () => {
    expect(crclLabel(79.96)).toBe('79.96')
    expect(crclLabel(79.999)).toBe('79.999')
    expect(crclLabel(29.9999)).toBe('29.9999')
    expect(crclLabel(62)).toBe('62.0')
  })
})

describe('restart: the latest condition', () => {
  const catheter = { neuraxial: 'catheter' }
  it('a catheter not yet removed: no earliest time, the removal time asked for', () => {
    const result = plan(catheter)
    expect(result.resume.earliest).toBeUndefined()
    expect(result.pending).toContain('catheter_removed_at')
  })
  it('a high dose waits 24 h after catheter removal (ASRA 2025): removed 11-04 10:00 → 11-05 10:00; removed 11-06 06:00 → 11-07 06:00 (#review 1)', () => {
    expect(formatLocal(plan({ ...catheter, catheter_removed_at: '2026-11-04T10:00' }).resume.earliest!)).toBe('11-05 10:00')
    const late = plan({ ...catheter, catheter_removed_at: '2026-11-06T06:00' })
    expect(formatLocal(late.resume.earliest!)).toBe('11-07 06:00')
    expect(formatLocal(late.resume.firstDose!)).toBe('11-07 08:00')
    expect(allCites(late)).toEqual(expect.arrayContaining([GUIDELINE_CITES.asraApixabanHighRestart, CITES.apixabanCatheter]))
  })
  it('a low dose waits 6 h after removal', () => {
    const low = plan({ ...catheter, regimen: 'rivaroxaban:10:1', dose_time_1: '20:00', dose_time_2: '', catheter_removed_at: '2026-11-06T06:00' })
    expect(formatLocal(low.resume.earliest!)).toBe('11-06 12:00')
    expect(allCites(low)).toContain(GUIDELINE_CITES.asraRivaroxabanLowRestart)
  })
  it('a single shot: the first high dose waits 24 h after the puncture, beside the tier’s own interval', () => {
    const quick = plan({ neuraxial: 'plexus', procedure_kind: 'minimal', surgery_end_at: '2026-11-03T08:30' })
    // Minor risk restarts 6 h after the end (11-03 14:30); the block's 24 h from the puncture (11-04 08:00) is later.
    expect(formatLocal(quick.resume.earliest!)).toBe('11-04 08:00')
    expect(allCites(quick)).toContain(GUIDELINE_CITES.asraApixabanHighRestart)
  })
  it('a traumatic puncture: unanswered withholds the earliest time; apixaban waits 48 h, rivaroxaban 24 h, the others are agreed with anaesthesia', () => {
    expect(plan({ neuraxial: 'single', traumatic_puncture: '' }).resume.earliest).toBeUndefined()
    const bloody = plan({ neuraxial: 'single', traumatic_puncture: 'yes', surgery_end_at: '2026-11-03T08:30', procedure_kind: 'low' })
    expect(allCites(bloody)).toContain(GUIDELINE_CITES.asraTraumatic)
    expect(formatLocal(bloody.resume.earliest!)).toBe('11-05 08:30')
    const edo = plan({ neuraxial: 'single', traumatic_puncture: 'yes', regimen: 'edoxaban:60:1', dose_time_2: '' })
    expect(edo.resume.earliest).toBeUndefined()
    expect(allCites(edo)).toContain(GUIDELINE_CITES.asraTraumaticNone)
    // Answered, it is no longer 「待填」 but a word from anaesthesia (#review coordinator).
    expect(edo.pending).not.toContain('traumatic_puncture')
    expect(edo.pending).toContain('anaesthesia')
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
  it('an end before the start, or a catheter removed before it, is a typing error, never an early restart (#review Astra re-review 2)', () => {
    const typo = plan({ neuraxial: 'single', surgery_at: '2026-11-03T07:30', surgery_end_at: '2026-11-01T10:00' })
    expect(typo.resume.earliest).toBeUndefined()
    expect(typo.resume.firstDose).toBeUndefined()
    expect(typo.pending).toContain('surgery_end_at')
    expect(allText(typo)).toContain('結束時刻早於開始時刻')
    const catheterTypo = plan({ neuraxial: 'catheter', catheter_removed_at: '2026-11-02T10:00' })
    expect(catheterTypo.resume.earliest).toBeUndefined()
    expect(catheterTypo.pending).toContain('catheter_removed_at')
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
  it('with a catheter, the emergency plan keeps the block’s restart rule beside idarucizumab’s 24 h (#review Astra 6)', () => {
    for (const neuraxial of ['catheter', 'plexus-catheter']) {
      const result = plan({ procedure_kind: 'emergency', regimen: 'dabigatran:150:2', neuraxial })
      expect(allText(result)).toContain('導管未拔前不恢復')
      expect(allText(result)).toContain('這只是條件之一')
      expect(allCites(result)).toContain(GUIDELINE_CITES.asraDabigatranHighRestart)
    }
    expect(allText(plan({ procedure_kind: 'emergency', neuraxial: 'none' }))).not.toContain('ASRA 2025')
  })
  it('a traumatic puncture delays the emergency restart too: apixaban 48 h, rivaroxaban 24 h, the others with anaesthesia (#review Astra 7)', () => {
    const emergency = { procedure_kind: 'emergency', neuraxial: 'single', traumatic_puncture: 'yes' }
    expect(allText(plan({ ...emergency, regimen: 'apixaban:2.5:2', dose_intent: 'low' }))).toContain('延後 48 小時')
    expect(allText(plan({ ...emergency, regimen: 'rivaroxaban:10:1', dose_time_2: '' }))).toContain('延後 24 小時')
    expect(allCites(plan({ ...emergency, regimen: 'dabigatran:150:2' }))).toContain(GUIDELINE_CITES.asraTraumaticNone)
    expect(allText(plan({ ...emergency, traumatic_puncture: '' }))).toContain('若脊髓／硬膜外穿刺出血')
    expect(allText(plan({ ...emergency, neuraxial: 'plexus' }))).not.toContain('穿刺出血')
  })
  it('dabigatran: idarucizumab, haemodialysis removes it, and it may restart 24 h after idarucizumab', () => {
    expect(allCites(plan({ procedure_kind: 'emergency', regimen: 'dabigatran:150:2' }))).toEqual(expect.arrayContaining([CITES.dabigatranIdarucizumab, CITES.dabigatranDialysable, CITES.dabigatranIdarucizumabRestart]))
  })
})

describe('what the prescription is (#review 4)', () => {
  it('a VTE loading dose: deferral advised, hours for reference, the restart dose left to the VTE course', () => {
    const result = plan({ regimen: 'apixaban:10:2' })
    expect(result.cautions.map((c) => c.text.zh).join()).toContain('急性 VTE 的起始劑量')
    expect(allCites(result)).toContain(GUIDELINE_CITES.ehraRecentEvent)
    expect(allText(result)).toContain('不自動接回起始劑量')
  })
  it('a prophylactic dose: flagged, restarted as prophylaxis', () => {
    const result = plan({ regimen: 'rivaroxaban:10:1', dose_time_2: '' })
    expect(result.doseClass).toBe('low')
    expect(result.cautions.map((c) => c.text.zh).join()).toContain('預防劑量')
    expect(allText(result)).toContain('恢復時：給回預防劑量')
  })
  it('a therapeutic dose: restarted at the same dose, no caution', () => {
    const result = plan({})
    expect(result.cautions).toEqual([])
    expect(allText(result)).toContain('恢復時：給回術前的治療劑量')
  })
})

describe('residual levels never clear a patient', () => {
  it('no plan says 「可開刀」 or 「safe to operate」; each says it clears no one', () => {
    for (const values of [{}, { neuraxial: 'single' }, { procedure_kind: 'emergency' }, { regimen: 'dabigatran:150:2' }, { crcl_manual: '12' }, { procedure_kind: 'af-ablation' }] as CalcValues[]) {
      const text = allText(plan(values))
      expect(text).not.toMatch(/可開刀|safe to operate|may proceed/i)
      expect(text).toMatch(/不據以判定可否處置/)
    }
  })
  it('with a block, ASRA’s acceptable level is quoted as the guideline says it, beside its own “never clinically validated” (#review 1)', () => {
    const result = plan({ neuraxial: 'single' })
    expect(allText(result)).toContain('<30 ng/mL，或 anti-Xa 活性 ≤0.1 IU/mL，為「可接受」（原文）')
    expect(allCites(result)).toEqual(expect.arrayContaining([GUIDELINE_CITES.asraApixabanHighLevel, GUIDELINE_CITES.asraThresholdUnvalidated]))
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
        // ASRA 2025, online first: pages 1–29, as printed and as the PDF's.
        expect(cite.page).toBe(cite.pdfPage)
        expect(cite.page).toBeGreaterThanOrEqual(1)
        expect(cite.page).toBeLessThanOrEqual(29)
      }
      expect(cite.quote).not.toMatch(/…|\.\.\.|[一-鿿]/)
    }
  })
  it('the calculator: listed once, its headline the last dose and the earliest restart', () => {
    const calc = CALCULATORS.filter((c) => c.id === 'doac-periop')
    expect(calc).toHaveLength(1)
    expect(calc[0]!.compute({ ...base, neuraxial: 'single' })!.interpretation?.zh).toBe('apixaban：最後一劑距手術 ≥72 小時（10-31 08:00 以前）；最早 11-05 10:00 恢復，需確認止血')
    expect(calc[0]!.compute({ ...base, regimen: '' })).toBeNull()
    // AF ablation and minor risk: the headline never asks for a gap to be made up by skipping a dose (#review final Opus 1).
    const ablation = calc[0]!.compute({ ...base, regimen: 'rivaroxaban:20:1', dose_time_1: '08:00', dose_time_2: '', procedure_kind: 'af-ablation', surgery_at: '2026-11-03T19:00' })!
    expect(ablation.interpretation?.zh).toContain('不提前停藥（谷底約 12 小時）；照常服用最後一劑 11-03 08:00，距開始 11 小時')
    expect(ablation.interpretation?.zh).not.toContain('≥')
    const minor = calc[0]!.compute({ ...base, regimen: 'rivaroxaban:20:1', dose_time_1: '09:00', dose_time_2: '', procedure_kind: 'minimal' })!
    expect(minor.interpretation?.zh).toContain('最後一劑 11-02 09:00，距開始 23 小時')
    expect(minor.interpretation?.zh).not.toContain('≥')
    expect(minor).toMatchObject({ value: '—' })
    expect(minor.unit).toBeUndefined()
  })
})
