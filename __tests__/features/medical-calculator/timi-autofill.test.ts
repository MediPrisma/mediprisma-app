/**
 * TIMI UA/NSTEMI's marker and ST items, read from this presentation's record
 * (owner rule 2026-11-19: prefill whatever the record can answer).
 */
import { timiSelects } from '@/features/medical-calculator/timi-autofill'
import type { LabObservation } from '@/features/medical-calculator/doac-patient-autofill'
import type { DiagnosticReportEntity } from '@/src/core/entities/clinical-data.entity'

const now = new Date('2026-11-19T10:00:00+08:00')
const trop = (value: number, effectiveDateTime: string, range: LabObservation['referenceRange'] = [{ text: '<0.04' }], loinc = '10839-9'): LabObservation =>
  ({ id: `t-${value}-${effectiveDateTime}`, status: 'final', effectiveDateTime, code: { text: 'Troponin I', coding: [{ code: loinc }] }, valueQuantity: { value, unit: 'ng/mL' }, referenceRange: range })
const ecg = (text: string, effectiveDateTime: string): DiagnosticReportEntity =>
  ({ id: `e-${effectiveDateTime}`, status: 'final', effectiveDateTime, code: { text: 'ECG 12 lead', coding: [{ code: '11524-6' }] }, conclusion: text }) as DiagnosticReportEntity

describe('TIMI marker from troponin', () => {
  it('reads a troponin above its own upper limit within 72 hours as 是', () => {
    expect(timiSelects({ observations: [trop(0.02, '2026-11-18T08:00:00+08:00'), trop(0.31, '2026-11-18T20:00:00+08:00')], reports: [], now }).timiMarker)
      .toMatchObject({ value: 'yes', date: '2026-11-18', resourceType: 'Observation', testName: expect.stringContaining('高於上限') })
  })

  it('reads 否 only when every troponin of the window has a limit and none is above it', () => {
    expect(timiSelects({ observations: [trop(0.01, '2026-11-19T07:00:00+08:00')], reports: [], now }).timiMarker?.value).toBe('no')
    // One result without a limit: not enough to say 否.
    expect(timiSelects({ observations: [trop(0.01, '2026-11-19T07:00:00+08:00'), trop(0.02, '2026-11-18T07:00:00+08:00', [])], reports: [], now }).timiMarker).toBeUndefined()
  })

  it('ignores a troponin older than 72 hours and reads hs-troponin by its LOINC', () => {
    expect(timiSelects({ observations: [trop(0.5, '2026-11-10T08:00:00+08:00')], reports: [], now }).timiMarker).toBeUndefined()
    const hs = { ...trop(52, '2026-11-19T06:00:00+08:00', [{ high: { value: 26.2, unit: 'ng/L' } }], '89579-7'), code: { text: 'hs-Troponin I', coding: [{ code: '89579-7' }] }, valueQuantity: { value: 52, unit: 'ng/L' } }
    expect(timiSelects({ observations: [hs], reports: [], now }).timiMarker?.value).toBe('yes')
  })
})

describe('TIMI ST deviation from the ECG', () => {
  it('reads ST depression or elevation in an ECG within 72 hours as 是', () => {
    expect(timiSelects({ observations: [], reports: [ecg('Sinus rhythm. ST depression in V4-V6.', '2026-11-19T08:00:00+08:00')], now }).timiSt)
      .toMatchObject({ value: 'yes', resourceType: 'DiagnosticReport' })
    expect(timiSelects({ observations: [], reports: [ecg('竇性心律，ST 段壓低', '2026-11-18T09:00:00+08:00')], now }).timiSt?.value).toBe('yes')
  })

  it('reads 否 from a recent ECG that names none or denies it, and nothing from an older one', () => {
    expect(timiSelects({ observations: [], reports: [ecg('Normal sinus rhythm. No ST elevation or depression.', '2026-11-19T08:00:00+08:00')], now }).timiSt?.value).toBe('no')
    expect(timiSelects({ observations: [], reports: [ecg('ST elevation in II, III, aVF', '2026-11-01T08:00:00+08:00')], now }).timiSt).toBeUndefined()
  })
})
