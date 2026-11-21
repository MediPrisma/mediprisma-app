/**
 * The HFpEF scores, as the host computes them and hands them to the pack.
 *
 * What is checked here is the contract, not the arithmetic: the arithmetic is
 * `features/medical-calculator`'s and has its own tests. This file holds that
 * the tokens a pack parses say what the calculator actually computed, that a
 * parameter nobody reported is named rather than counted as zero, and that a
 * measurement the record already carries is not written back a second time.
 */
import {
  HFPEF_CALCULATOR_VERSION,
  applyHfpefReading,
  buildHfpefReading,
} from '@/features/clinical-decision-support/utils/hfpef-scores'
import { buildHfpefInputs } from '@/features/clinical-decision-support/stores/hfpef-inputs.store'
import { HFPEF } from '@/features/medical-calculator/calculators/hfpef'
import type { Autofill, AutofillValue } from '@/features/medical-calculator/hooks/use-lab-autofill.hook'
import type { CdssPatientProfile } from '@/features/clinical-decision-support/types'

const ECHO_DAY = '2026-07-14'

/** The echo the report printed, as the calculator's own autofill would read it. */
const ECHO: Record<string, number> = {
  averageEe: 13.2,
  ee: 13.2,
  trv: 3.1,
  pasp: 58,
  lavi: 36,
  lvmi: 118,
  rwt: 0.44,
  wall: 12,
}

function autofillWith(overrides: Partial<Record<string, number>> = {}): Autofill {
  const echo = { ...ECHO, ...overrides }
  return {
    sex: 'female',
    clinicalSelects: {
      rhythm: { value: 'sr', date: '2026-05-25', testName: '最近 EKG：竇性心律' },
      afHistory: { value: 'no', date: '2026-05-25', testName: 'EKG' },
      antihypertensives: { value: 'yes', date: '2026-09-12', testName: '目前有效用藥' },
    },
    resolve: (source): AutofillValue | undefined => {
      if (!source) return undefined
      if (source.kind === 'age') return { value: 76, unit: 'y', date: '' }
      if (source.kind === 'bmi') return { value: 26.1, unit: 'kg/m²', date: '2026-09-12' }
      if (source.kind === 'echo') {
        const value = echo[source.key]
        return value === undefined
          ? undefined
          : {
            value,
            unit: '',
            date: ECHO_DAY,
            testName: '心臟超音波',
            obsId: 'echo-1',
            resourceType: 'DiagnosticReport',
          }
      }
      return undefined
    },
  }
}

const profile: CdssPatientProfile = {
  id: 'p1',
  evaluatedAt: '2026-09-12T09:00:00+08:00',
  facts: {
    LVEF: { zh: '58%', en: '58%', numericValue: 58, unit: '%', date: ECHO_DAY },
    echoLavi: { zh: '36 mL/m²', en: '36 mL/m2', numericValue: 36, unit: 'mL/m²', date: ECHO_DAY },
  },
}

describe('the HFA-PEFF score the host computes', () => {
  it('publishes the domains, the ceiling and every unreported parameter as tokens', () => {
    const reading = buildHfpefReading({ profile, autofill: autofillWith() })
    const score = reading.hfaPeff

    expect(score?.score).toBe(4)
    expect(score?.upper).toBe(6)
    expect(score?.maximum).toBe(6)
    // The same numbers the published calculator returns, not a second reading.
    const direct = HFPEF.find((calc) => calc.id === 'hfa-peff')!.compute({
      age: '76', sex: 'female', rhythm: 'sr',
      averageEe: '13.2', e: '', septalE: '', lateralE: '', trv: '3.1', gls: '',
      lavi: '36', lvmi: '118', rwt: '0.44', wall: '12', ntprobnp: '', bnp: '',
    })
    expect(direct?.value).toBe('4–6 / 6')

    expect(score?.matchedTerms).toEqual([
      'functional:2',
      'morphological:2',
      'biomarker:0',
      'upper:6',
      'missing:septal-e-prime',
      'missing:lateral-e-prime',
      'missing:gls',
      'missing:nt-probnp',
      `calculator:hfa-peff@${HFPEF_CALCULATOR_VERSION}`,
    ])
    // A parameter the report did not print is named, never counted as zero.
    expect(score?.missingZh).toContain('GLS')
    expect(score?.date).toBe(ECHO_DAY)
  })

  it('writes the score as a fact a pack can read, dated by the study', () => {
    const next = applyHfpefReading(profile, buildHfpefReading({ profile, autofill: autofillWith() }))

    expect(next.facts.hfaPeffScore).toMatchObject({
      numericValue: 4,
      unit: 'points',
      date: ECHO_DAY,
      textEvidence: { direction: 'unknown' },
    })
    expect(next.facts.hfaPeffScore?.zh).toContain('HFA-PEFF 4／6')
    expect(next.facts.h2fpefScore?.numericValue).toBe(4)
    expect(next.facts.h2fpefScore?.textEvidence?.matchedTerms).toEqual(expect.arrayContaining([
      'item:bmi:0',
      'item:antihypertensives:1',
      'item:af:0',
      'item:pasp:1',
      'item:age:1',
      'item:e-over-e-prime:1',
      `calculator:h2fpef@${HFPEF_CALCULATOR_VERSION}`,
    ]))
  })

  it('states nothing at all for a patient whose ejection fraction is reduced', () => {
    // HFA-PEFF and H₂FPEF are read for a preserved ejection fraction; a score
    // on an HFrEF chart answers a question nobody asked.
    const reduced: CdssPatientProfile = {
      ...profile,
      facts: { ...profile.facts, LVEF: { zh: '32%', en: '32%', numericValue: 32, unit: '%' } },
    }

    expect(applyHfpefReading(reduced, buildHfpefReading({ profile: reduced, autofill: autofillWith() })))
      .toBe(reduced)
  })

  it('has no score when the calculator declines to compute one', () => {
    // No rhythm, no age, no sex: HFA-PEFF cannot read a domain, and the fact
    // is absent rather than zero.
    const bare: Autofill = { resolve: () => undefined }
    const reading = buildHfpefReading({ profile, autofill: bare })

    expect(reading.hfaPeff).toBeUndefined()
    expect(reading.h2fpef).toBeUndefined()
    expect(applyHfpefReading(profile, reading)).toBe(profile)
  })
})

describe('the measurements behind the score', () => {
  it('writes a typed value as its own fact, and leaves the record\'s own alone', () => {
    const typed = buildHfpefInputs(
      { gls: { value: '14', measuredOn: '2026-09-12' } },
      new Date('2026-09-12T14:09:00+08:00'),
    )
    const reading = buildHfpefReading({ profile, autofill: autofillWith(), inputs: typed })
    const next = applyHfpefReading(profile, reading)

    expect(next.facts.echoGls).toMatchObject({
      numericValue: 14,
      unit: '%',
      date: '2026-09-12',
    })
    expect(next.facts.echoGls?.zh).toContain('你輸入')
    // LAVI came off the same report the adapter already read: one measurement,
    // one fact, and the record's own keeps its provenance — even where the two
    // scanners would have printed slightly different numbers.
    expect(next.facts.echoLavi).toBe(profile.facts.echoLavi)
    // A parameter the report did print, that the adapter had no key for, is
    // published so criterion (iii) can read it.
    expect(next.facts.echoLvmi).toMatchObject({ numericValue: 118, unit: 'g/m²' })
    expect(next.facts.echoRwt?.numericValue).toBe(0.44)
    expect(next.facts.echoLvWallThickness?.numericValue).toBe(12)
  })

  it('counts a typed parameter into the score and drops it from 「報告未提供」', () => {
    const before = buildHfpefReading({ profile, autofill: autofillWith() })
    const after = buildHfpefReading({
      profile,
      autofill: autofillWith(),
      inputs: buildHfpefInputs({ ntprobnp: { value: '900', measuredOn: '2026-09-12' } }),
    })

    expect(before.hfaPeff?.missing).toContain('nt-probnp')
    expect(after.hfaPeff?.missing).not.toContain('nt-probnp')
    expect(after.hfaPeff?.score).toBe(6)
  })

  it('does not score with a LAVI or LVMI derived from BSA the dialog cannot show', () => {
    // Synthetic echo: LA volume and LV mass (from wall dimensions) printed, no
    // stated LAVI or LVMI. The calculator would derive both from height and
    // weight; the CDSS reading must not until its dialog can show that.
    const raw = { lavi: undefined, lvmi: undefined, laVolume: 80, lvMass: 200 }
    const withBody = (body: boolean): Autofill => {
      const base = autofillWith(raw)
      return {
        ...base,
        resolve: (source) => {
          if (body && source?.kind === 'vital') {
            return source.vital === 'height'
              ? { value: 160, unit: 'cm', date: '2026-09-12' }
              : { value: 60, unit: 'kg', date: '2026-09-12' }
          }
          return base.resolve(source)
        },
      }
    }
    const without = buildHfpefReading({ profile: { ...profile, facts: { LVEF: profile.facts.LVEF } }, autofill: withBody(false) })
    const withHw = buildHfpefReading({ profile: { ...profile, facts: { LVEF: profile.facts.LVEF } }, autofill: withBody(true) })

    // The calculator itself does score differently with height and weight, so
    // the equality below is not vacuous.
    const calc = HFPEF.find((def) => def.id === 'hfa-peff')!
    const common = {
      age: '76', sex: 'female', rhythm: 'sr', averageEe: '13.2', trv: '3.1',
      rwt: '0.44', wall: '12', laVolume: '80', lvMass: '200',
    }
    expect(calc.compute({ ...common, height: '160', weight: '60' })?.value)
      .not.toBe(calc.compute(common)?.value)

    expect(withHw.hfaPeff?.score).toBe(without.hfaPeff?.score)
    expect(withHw.hfaPeff?.upper).toBe(without.hfaPeff?.upper)
    expect(withHw.hfaPeff?.matchedTerms).toEqual(without.hfaPeff?.matchedTerms)
    expect(withHw.hfaPeff?.missing).toEqual(expect.arrayContaining(['lavi', 'lvmi']))
    expect(withHw.hfaPeff?.date).toBe(without.hfaPeff?.date)
    for (const key of ['height', 'weight', 'laVolume', 'lvMass']) {
      expect(withHw.inputs.some((item) => item.key === key)).toBe(false)
    }
  })

  it('writes the rhythm the ECG reported as a term, not as a number', () => {
    const next = applyHfpefReading(profile, buildHfpefReading({ profile, autofill: autofillWith() }))

    expect(next.facts.physicianRhythm?.textEvidence?.matchedTerms).toEqual(['sinus'])
    expect(next.facts.physicianRhythm?.numericValue).toBeUndefined()
  })
})
