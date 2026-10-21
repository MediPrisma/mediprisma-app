import { applyClinicVitals } from '@/features/clinical-decision-support/utils/apply-clinic-vitals'
import {
  buildClinicVitals,
  EMPTY_CLINIC_VITALS,
  mergeClinicVitals,
  type ClinicVitals,
} from '@/features/clinical-decision-support/stores/clinic-vitals.store'
import type { CdssPatientProfile } from '@/features/clinical-decision-support/types'

const VISIT = new Date('2026-09-05T09:30:00+08:00')

const profile: CdssPatientProfile = {
  id: 'p1',
  evaluatedAt: '2026-09-05T09:30:00+08:00',
  facts: {
    bloodPressure: { zh: '142/84 mmHg（2026-04-18）', en: '142/84 mmHg (2026-04-18)', unit: 'mmHg', date: '2026-04-18' },
    potassium: { zh: '4.2 mmol/L', en: '4.2 mmol/L', numericValue: 4.2, date: '2026-07-06' },
  },
  freshnessContexts: {
    bloodPressure: { factKey: 'bloodPressure', date: '2026-04-18', ageDays: 140, intervalDays: 90, state: 'overdue' },
    heartRate: { factKey: 'heartRate', intervalDays: 90, state: 'missing' },
  },
}

describe('applyClinicVitals', () => {
  it('returns the profile untouched when nothing was measured or answered', () => {
    expect(applyClinicVitals(profile, undefined)).toBe(profile)
    expect(applyClinicVitals(profile, EMPTY_CLINIC_VITALS)).toBe(profile)
  })

  it('replaces the record facts with today\'s measurements, dated and marked as entered', () => {
    const next = applyClinicVitals(profile, buildClinicVitals({
      entries: {
        systolic: { value: 128 },
        diastolic: { value: 76 },
        heartRate: { value: 72 },
        bodyWeight: { value: 73.5 },
      },
    }, VISIT))

    expect(next.facts.bloodPressure).toEqual({
      zh: '128/76 mmHg（2026-09-05 門診輸入）',
      en: '128/76 mmHg (2026-09-05, entered in clinic)',
      unit: 'mmHg',
      date: '2026-09-05',
    })
    expect(next.facts.heartRate).toMatchObject({ numericValue: 72, unit: 'bpm', date: '2026-09-05' })
    expect(next.facts.bodyWeight).toMatchObject({ numericValue: 73.5, unit: 'kg', date: '2026-09-05' })
    // Untouched facts stay.
    expect(next.facts.potassium).toBe(profile.facts.potassium)
    // Freshness follows: the record's window is kept, the state is current.
    expect(next.freshnessContexts?.bloodPressure).toEqual({
      factKey: 'bloodPressure', date: '2026-09-05', ageDays: 0, intervalDays: 90, state: 'current',
    })
    expect(next.freshnessContexts?.bodyWeight).toMatchObject({ intervalDays: 30, state: 'current' })
  })

  it('dates each field by its own measurement day, not by the visit', () => {
    // A weight carried in from last month is a month-old weight, and the
    // 30-day window is what says so. Sharing one visit-level date made every
    // carried value read as taken today.
    const next = applyClinicVitals(profile, buildClinicVitals({
      entries: { bodyWeight: { value: 75.8, measuredOn: '2026-07-01' } },
    }, VISIT))

    expect(next.facts.bodyWeight).toMatchObject({ date: '2026-07-01' })
    expect(next.freshnessContexts?.bodyWeight).toMatchObject({
      date: '2026-07-01',
      ageDays: 66,
      intervalDays: 30,
      state: 'overdue',
    })
  })

  it('needs both halves of a blood pressure and ignores non-positive numbers', () => {
    const next = applyClinicVitals(profile, buildClinicVitals({
      entries: { systolic: { value: 128 }, heartRate: { value: 0 }, bodyWeight: { value: 70 } },
    }, VISIT))

    expect(next.facts.bloodPressure).toBe(profile.facts.bloodPressure)
    expect(next.facts.heartRate).toBeUndefined()
    expect(next.facts.bodyWeight?.numericValue).toBe(70)
  })

  it('derives the BMI a rule reads from the height and weight entered in the room', () => {
    // The adapter derived `bodyMassIndex` from the record's own pair before
    // this ran, so a height typed in the room has to redo it — otherwise the
    // H2FPEF score reads a BMI from numbers the clinician just replaced.
    const next = applyClinicVitals(profile, buildClinicVitals({
      entries: { bodyHeight: { value: 160 }, bodyWeight: { value: 76.8 } },
    }, VISIT))

    expect(next.facts.bodyHeight).toMatchObject({ numericValue: 160, unit: 'cm' })
    expect(next.facts.bodyMassIndex).toMatchObject({ numericValue: 30, unit: 'kg/m²' })
  })

  it('writes the signs seen today as a clinic examination the congestion table reads', () => {
    const next = applyClinicVitals(profile, buildClinicVitals({
      signAnswers: { 'pitting-edema': 'present', jvp: 'present', rales: 'present' },
    }, VISIT))

    expect(next.facts.clinicCongestionExam).toEqual({
      zh: '門診理學檢查（2026-09-05 門診輸入）',
      en: 'Clinic examination (2026-09-05, entered in clinic)',
      date: '2026-09-05',
      textEvidence: { direction: 'supports', matchedTerms: ['pitting-edema', 'jvp', 'rales'] },
    })
    // Only the measured vitals get a freshness context; the examination is a fact alone.
    expect(next.freshnessContexts?.bloodPressure).toBe(profile.freshnessContexts?.bloodPressure)
    // No answer, no fact: the default is silence, not a negative finding.
    expect(applyClinicVitals(profile, buildClinicVitals({ signAnswers: {} }, VISIT))
      .facts.clinicCongestionExam).toBeUndefined()
  })

  it('carries a symptom the patient only described into the same examination fact', () => {
    // ESC criterion (i) can be met by 勞力性呼吸困難 alone. While the host wrote
    // only the three congestion groups, a breathless patient with no signs
    // produced no term at all and the criterion could never be read.
    const next = applyClinicVitals(profile, buildClinicVitals({
      signAnswers: {
        'exertional-dyspnea': 'present',
        'fatigue-exercise-intolerance': 'absent',
      },
    }, VISIT))

    expect(next.facts.clinicCongestionExam?.textEvidence).toEqual({
      direction: 'supports',
      matchedTerms: ['exertional-dyspnea'],
      negatedTerms: ['fatigue-exercise-intolerance'],
    })
  })

  it('hands the saturation to the pack under the key its own row reads', () => {
    const next = applyClinicVitals(profile, buildClinicVitals({
      entries: { oxygenSaturation: { value: 95 } },
    }, VISIT))

    expect(next.facts.oxygenSaturation).toEqual({
      zh: '95%（2026-09-05 門診輸入）',
      en: '95% (2026-09-05, entered in clinic)',
      numericValue: 95,
      unit: '%',
      date: '2026-09-05',
    })
  })

  it('treats an explicit 「未評估」 as unknown, exactly like never having asked', () => {
    // 「未評估」 is an answer to the screen and a silence to the pack: it says
    // the question was put, and it must never become a negative finding.
    const notAssessed = applyClinicVitals(profile, buildClinicVitals({
      signAnswers: { orthopnea: 'not-assessed' },
      nyhaClass: 'not-assessed',
      compensationStatus: 'not-assessed',
    }, VISIT))

    expect(notAssessed.facts.clinicCongestionExam).toBeUndefined()
    expect(notAssessed.facts.physicianNyhaClass).toBeUndefined()
    expect(notAssessed.facts.physicianCompensationStatus).toBeUndefined()
    expect(notAssessed).toBe(profile)
  })

  it('writes the compensation judgement under its own key, not the admission fact', () => {
    const next = applyClinicVitals(profile, buildClinicVitals({
      compensationStatus: 'decompensated',
    }, VISIT))

    expect(next.facts.physicianCompensationStatus).toEqual({
      zh: '失代償（2026-09-05 門診輸入）',
      en: 'Decompensated (2026-09-05, entered in clinic)',
      date: '2026-09-05',
      textEvidence: { direction: 'supports', matchedTerms: ['decompensated'] },
    })
    // `decompensatedHeartFailure` is the adapter's, read from an admission
    // inside a 90-day window. A clinic judgement never touches it: saying
    // 「今天穩定」 must not erase a real admission, and saying 「今天失代償」
    // must not reclassify exercise risk from the host.
    expect(next.facts.decompensatedHeartFailure).toBeUndefined()
  })

  it('records a compensated judgement as a finding of its own', () => {
    const next = applyClinicVitals(profile, buildClinicVitals({
      compensationStatus: 'compensated',
    }, VISIT))

    expect(next.facts.physicianCompensationStatus).toMatchObject({
      zh: '代償（2026-09-05 門診輸入）',
      textEvidence: { matchedTerms: ['compensated'] },
    })
    // No judgement, no fact: unanswered stays unanswered.
    expect(
      applyClinicVitals(profile, EMPTY_CLINIC_VITALS).facts.physicianCompensationStatus,
    ).toBeUndefined()
  })
})

/**
 * PR #224 review (2026-10-01): HF DP-06 reads today's examination only, and it
 * knows the day by the fact's `date`. Dated by the latest sign, one sign
 * answered today made every earlier negative — perfusion among them — read as
 * today's; and 全部皆無 pressed again the next day changed no value, so the
 * examination kept the earlier date and read as never done.
 */
describe('applyClinicVitals — one examination, one day', () => {
  const SEPT_27 = new Date('2026-09-27T10:00:00+08:00')
  const SEPT_28 = new Date('2026-09-28T10:00:00+08:00')
  const DP06_TERMS = ['orthopnea', 'paroxysmal-nocturnal-dyspnea', 'jvp', 'rales', 'pitting-edema', 'hypoperfusion'] as const
  const allAbsent = Object.fromEntries(DP06_TERMS.map((term) => [term, 'absent' as const]))
  const on = (day: string): CdssPatientProfile => ({ ...profile, evaluatedAt: `${day}T10:30:00+08:00` })

  it('a sign found today does not carry the day before\'s negatives into today\'s examination', () => {
    const yesterday = buildClinicVitals({ signAnswers: allAbsent }, SEPT_27)
    const today = mergeClinicVitals(yesterday, { signAnswers: { rales: 'present' } }, SEPT_28)

    expect(applyClinicVitals(on('2026-09-28'), today).facts.clinicCongestionExam).toEqual({
      zh: '門診理學檢查（2026-09-28 門診輸入）',
      en: 'Clinic examination (2026-09-28, entered in clinic)',
      date: '2026-09-28',
      // Perfusion is not today's 無 — nobody looked today — and neither is any other sign.
      textEvidence: { direction: 'supports', matchedTerms: ['rales'] },
    })
    // The screens read the same record: yesterday's answers are 沒問 today, not 無.
    expect(Object.keys(today.signAnswers)).toEqual(['rales'])
  })

  it('全部皆無 pressed again the next day dates the examination today and leaves 最後修改 alone', () => {
    const yesterday = buildClinicVitals({ signAnswers: allAbsent }, SEPT_27)
    const today = mergeClinicVitals(yesterday, { signAnswers: allAbsent }, SEPT_28)

    expect(today).not.toBe(yesterday)
    for (const term of DP06_TERMS) {
      expect(today.signAnswers[term]).toEqual({ value: 'absent', modifiedAt: SEPT_27.toISOString(), examinedOn: '2026-09-28' })
    }
    expect(applyClinicVitals(on('2026-09-28'), today).facts.clinicCongestionExam).toMatchObject({
      date: '2026-09-28',
      textEvidence: { direction: 'against', matchedTerms: [], negatedTerms: [...DP06_TERMS] },
    })
    // Pressed again the same day, it is the same examination and changes nothing.
    expect(mergeClinicVitals(today, { signAnswers: allAbsent }, new Date('2026-09-28T11:00:00+08:00'))).toBe(today)
  })

  it('leaves an earlier day\'s examination whole and dated that day until today\'s begins', () => {
    const yesterday = buildClinicVitals({ signAnswers: { rales: 'present', hypoperfusion: 'absent' } }, SEPT_27)

    expect(applyClinicVitals(on('2026-09-28'), yesterday).facts.clinicCongestionExam).toMatchObject({
      date: '2026-09-27',
      textEvidence: { matchedTerms: ['rales'], negatedTerms: ['hypoperfusion'] },
    })
    // Withdrawing an answer is not an examination: nothing is re-dated or cleared.
    expect(mergeClinicVitals(yesterday, { signAnswers: { rales: null } }, SEPT_28).signAnswers)
      .toEqual({ hypoperfusion: yesterday.signAnswers.hypoperfusion })
  })

  it('dates by this browser\'s calendar, not the UTC day of the timestamp', () => {
    // 07:30 in Taipei is 23:30 the day before in UTC.
    const early = new Date('2026-09-28T07:30:00+08:00')
    const next = applyClinicVitals(on('2026-09-28'), buildClinicVitals({
      signAnswers: { jvp: 'present' },
      nyhaClass: 'III',
      compensationStatus: 'decompensated',
    }, early))

    expect(next.facts.clinicCongestionExam?.date).toBe('2026-09-28')
    expect(next.facts.physicianNyhaClass?.date).toBe('2026-09-28')
    expect(next.facts.physicianCompensationStatus?.date).toBe('2026-09-28')
  })

  it('reads only the latest day when a record holds more than one', () => {
    // As a record kept before the store started a new examination each day can.
    const kept: ClinicVitals = {
      entries: {},
      signAnswers: {
        hypoperfusion: { value: 'absent', modifiedAt: SEPT_27.toISOString(), examinedOn: '2026-09-27' },
        rales: { value: 'present', modifiedAt: SEPT_28.toISOString(), examinedOn: '2026-09-28' },
      },
    }

    expect(applyClinicVitals(on('2026-09-28'), kept).facts.clinicCongestionExam).toMatchObject({
      date: '2026-09-28',
      textEvidence: { matchedTerms: ['rales'] },
    })
    expect(applyClinicVitals(on('2026-09-28'), kept).facts.clinicCongestionExam?.textEvidence?.negatedTerms).toBeUndefined()
  })
})
