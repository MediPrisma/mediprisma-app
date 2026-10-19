import { buildEncounterIcdCandidates } from '@/features/ips-export/utils/encounter-icd-candidates'
import { inferredToCondition } from '@/features/ips-export/utils/inference-engine'
import { SYSTEM } from '@/features/ips-export/utils/ips-constants'
import type { ConditionEntity, EncounterEntity } from '@/src/core/entities/clinical-data.entity'

const NOW = new Date('2026-07-13T00:00:00Z')

/** A NEW-format outpatient encounter carrying one ICD-10 reasonCode. */
function enc(
  id: string,
  start: string,
  code: string,
  opts: { text?: string; display?: string; system?: string } = {},
): EncounterEntity {
  const { text, display, system = 'http://hl7.org/fhir/sid/icd-10-cm' } = opts
  return {
    id,
    period: { start },
    reasonCode: [{ text, coding: [{ system, code, display }] }],
  }
}

describe('buildEncounterIcdCandidates — aggregation', () => {
  it('de-duplicates one ICD across multiple visits into a single candidate with a visit count', () => {
    const encounters = [
      enc('e1', '2026-06-01', 'E11.9', { text: 'E11.9 第二型糖尿病', display: 'Type 2 diabetes' }),
      enc('e2', '2026-05-01', 'E11.9', { text: 'E11.9 第二型糖尿病', display: 'Type 2 diabetes' }),
      enc('e3', '2026-04-01', 'E11.9', { text: 'E11.9 第二型糖尿病', display: 'Type 2 diabetes' }),
    ]
    const out = buildEncounterIcdCandidates(encounters, [], { now: NOW })

    expect(out).toHaveLength(1)
    const c = out[0]
    expect(c.origin).toBe('encounter-icd')
    expect(c.id).toBe('encounter-icd:E11.9')
    const ev = c.evidence.find((e) => e.kind === 'encounter-icd')
    expect(ev?.count).toBe(3)
    // Latest visit date is surfaced on the evidence row.
    expect(ev?.date).toBe('2026-06-01')
    // Localized labels resolved from the reasonCode text (zh) + coding.display (en).
    expect(c.labelZh).toBe('第二型糖尿病')
    expect(c.labelEn).toBe('Type 2 diabetes')
    // Deterministic import gets 'low' confidence (UI does not badge it).
    expect(c.inferenceConfidence).toBe('low')
  })

  it('sorts candidates by visit count (desc)', () => {
    const encounters = [
      enc('a1', '2026-06-01', 'I10', { text: 'I10 高血壓' }),
      enc('b1', '2026-06-02', 'E11.9', { text: 'E11.9 第二型糖尿病' }),
      enc('b2', '2026-06-03', 'E11.9', { text: 'E11.9 第二型糖尿病' }),
      enc('b3', '2026-06-04', 'E11.9', { text: 'E11.9 第二型糖尿病' }),
    ]
    const out = buildEncounterIcdCandidates(encounters, [], { now: NOW })
    expect(out.map((c) => c.sourceCoding?.code)).toEqual(['E11.9', 'I10'])
    expect(out[0].evidence[0].count).toBe(3)
    expect(out[1].evidence[0].count).toBe(1)
  })

  it('falls back to the raw code when no description is present', () => {
    // R10.9 is absent from the built-in ICD dictionary, so nothing resolves it.
    const out = buildEncounterIcdCandidates([enc('e1', '2026-06-01', 'R10.9')], [], { now: NOW })
    expect(out[0].labelZh).toBe('R10.9')
    expect(out[0].labelEn).toBe('R10.9')
  })
})

describe('buildEncounterIcdCandidates — 6-month window', () => {
  it('keeps encounters within the window and drops older ones', () => {
    const encounters = [
      enc('recent', '2026-05-01', 'I10', { text: 'I10 高血壓' }), // within 6 months
      enc('old', '2025-01-01', 'E11.9', { text: 'E11.9 第二型糖尿病' }), // > 6 months
    ]
    const out = buildEncounterIcdCandidates(encounters, [], { now: NOW })
    expect(out).toHaveLength(1)
    expect(out[0].sourceCoding?.code).toBe('I10')
  })

  it('honours a custom sinceMonths window', () => {
    const encounters = [enc('e1', '2026-05-01', 'I10', { text: 'I10 高血壓' })]
    // A 1-month window (cutoff 2026-06-13) excludes the 2026-05-01 visit.
    expect(buildEncounterIcdCandidates(encounters, [], { now: NOW, sinceMonths: 1 })).toHaveLength(0)
    expect(buildEncounterIcdCandidates(encounters, [], { now: NOW, sinceMonths: 6 })).toHaveLength(1)
  })

  it('ignores encounters with no period.start', () => {
    const encounters: EncounterEntity[] = [
      { id: 'e1', reasonCode: [{ coding: [{ code: 'I10' }] }] },
    ]
    expect(buildEncounterIcdCandidates(encounters, [], { now: NOW })).toHaveLength(0)
  })
})

describe('buildEncounterIcdCandidates — real source coding (no invented codes)', () => {
  it('carries the genuine source system + code (not SNOMED)', () => {
    const encounters = [
      enc('e1', '2026-06-01', 'E11.9', {
        text: 'E11.9 第二型糖尿病',
        display: 'Type 2 diabetes',
        system: 'http://hl7.org/fhir/sid/icd-10-cm',
      }),
    ]
    const out = buildEncounterIcdCandidates(encounters, [], { now: NOW })
    expect(out[0].sourceCoding).toEqual({
      system: 'http://hl7.org/fhir/sid/icd-10-cm',
      code: 'E11.9',
      display: 'Type 2 diabetes',
    })
    // No SNOMED anywhere on the candidate.
    expect(out[0].sourceCoding?.system).not.toBe(SYSTEM.snomed)
  })

  it('defaults to the ICD-10 system for OLD text-only encounters that carry no coding.system', () => {
    const encounters: EncounterEntity[] = [
      { id: 'e1', period: { start: '2026-06-01' }, reasonCode: [{ text: 'I10,E11.9' }] },
    ]
    const out = buildEncounterIcdCandidates(encounters, [], { now: NOW })
    expect(out).toHaveLength(2)
    for (const c of out) {
      expect(c.sourceCoding?.system).toBe(SYSTEM.icd10)
    }
  })

  it('resolves descriptions from bundle Conditions when the encounter carries none', () => {
    const conditions: ConditionEntity[] = [
      {
        id: 'c1',
        code: {
          text: '本態性高血壓',
          coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'I10', display: 'Essential hypertension' }],
        },
      },
    ]
    const encounters = [enc('e1', '2026-06-01', 'I10')]
    const out = buildEncounterIcdCandidates(encounters, conditions, { now: NOW })
    expect(out[0].labelZh).toBe('本態性高血壓')
    expect(out[0].labelEn).toBe('Essential hypertension')
  })
})

describe('buildEncounterIcdCandidates → inferredToCondition (real ICD-10 coding survives the gate)', () => {
  it('exports a confirmed visit-ICD problem with its genuine source ICD-10 coding', () => {
    const encounters = [
      enc('e1', '2026-06-01', 'E11.9', {
        text: 'E11.9 第二型糖尿病',
        display: 'Type 2 diabetes',
        system: 'http://hl7.org/fhir/sid/icd-10-cm',
      }),
    ]
    const [candidate] = buildEncounterIcdCandidates(encounters, [], { now: NOW })
    const condition = inferredToCondition(candidate)

    expect(condition.id).toBe('urn:ips-inferred:encounter-icd:E11.9')
    expect(condition.code?.text).toBe('第二型糖尿病')
    // The REAL ICD-10 coding is attached — system faithful to the source.
    expect(condition.code?.coding).toEqual([
      {
        system: 'http://hl7.org/fhir/sid/icd-10-cm',
        code: 'E11.9',
        display: 'Type 2 diabetes',
      },
    ])
    // Never a SNOMED code.
    expect((condition.code?.coding ?? []).some((c) => c.system === SYSTEM.snomed)).toBe(false)
    // Still an audited, provisional synthetic problem behind the review gate.
    expect(condition.verificationStatus).toBe('provisional')
    expect(condition._inferred?.evidence[0]).toMatchObject({ kind: 'encounter-icd', icd10: 'E11.9' })
  })
})
