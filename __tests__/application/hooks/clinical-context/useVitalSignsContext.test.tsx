import { renderHook } from '@testing-library/react'
import { useVitalSignsContext } from '@/src/application/hooks/clinical-context/useVitalSignsContext'

describe('useVitalSignsContext record fidelity', () => {
  it('retains every missing-id measurement instead of deduplicating them all under undefined', () => {
    const clinicalData = {
      vitalSigns: [
        { code: { text: 'Heart rate' }, effectiveDateTime: '2026-07-01', valueQuantity: { value: 70, unit: '/min' }, status: 'final' },
        { code: { text: 'Heart rate' }, effectiveDateTime: '2026-07-02', valueQuantity: { value: 80, unit: '/min' }, status: 'final' },
      ],
    }
    const { result } = renderHook(() => useVitalSignsContext(true, clinicalData as any, {
      vitalSignsTimeRange: 'all',
      vitalSignsVersion: 'all',
    } as any))

    expect(result.current).toHaveLength(1)
    expect(result.current[0].items).toHaveLength(2)
    expect(result.current[0].items.join('\n')).toContain('70 /min')
    expect(result.current[0].items.join('\n')).toContain('80 /min')
  })

  it('says a reading came from the adult preventive health check, and where', () => {
    const clinicalData = {
      vitalSigns: [{
        id: 'bp-checkup',
        code: { text: 'Blood Pressure' },
        effectiveDateTime: '2022-10-15T08:00:00+08:00',
        component: [
          { code: { text: 'Systolic blood pressure' }, valueQuantity: { value: 150, unit: 'mmHg' } },
          { code: { text: 'Diastolic blood pressure' }, valueQuantity: { value: 100, unit: 'mmHg' } },
        ],
        performer: [{ display: '示範乙診所;健檢' }],
        meta: { tag: [{ system: 'https://cloud-wildcatch.invalid/fhir/source-program', code: 'adult-preventive' }] },
        status: 'final',
      }],
    }
    const { result } = renderHook(() => useVitalSignsContext(true, clinicalData as any, {
      vitalSignsTimeRange: 'all',
      vitalSignsVersion: 'all',
    } as any, true))

    expect(result.current[0].items[0]).toContain('[adult preventive health check 成人預防保健 · 示範乙診所]')

    // Every other consumer keeps the unlabelled line.
    const plain = renderHook(() => useVitalSignsContext(true, clinicalData as any, {
      vitalSignsTimeRange: 'all',
      vitalSignsVersion: 'all',
    } as any))
    expect(plain.result.current[0].items[0]).not.toContain('成人預防保健')
  })

  it('recognises a check-up reading the bridge tagged only with its module', () => {
    const clinicalData = {
      vitalSigns: [{
        id: 'bp-module-only',
        code: { text: 'Blood Pressure' },
        effectiveDateTime: '2022-10-15T08:00:00+08:00',
        valueQuantity: { value: 150, unit: 'mmHg' },
        performer: [{ display: '示範乙診所' }],
        meta: { tag: [{ system: 'https://cloud-wildcatch.invalid/fhir/CodeSystem/source-module', code: 'imue0140' }] },
        status: 'final',
      }],
    }
    const { result } = renderHook(() => useVitalSignsContext(true, clinicalData as any, {
      vitalSignsTimeRange: 'all',
      vitalSignsVersion: 'all',
    } as any, true))
    expect(result.current[0].items[0]).toContain('成人預防保健 · 示範乙診所')
  })

  it('does not emit entered-in-error vital signs', () => {
    const clinicalData = {
      vitalSigns: [{
        id: 'invalid',
        code: { text: 'Heart rate' },
        effectiveDateTime: '2026-07-01',
        valueQuantity: { value: 999, unit: '/min' },
        status: 'entered-in-error',
      }],
    }
    const { result } = renderHook(() => useVitalSignsContext(true, clinicalData as any, {
      vitalSignsTimeRange: 'all',
      vitalSignsVersion: 'all',
    } as any))

    expect(result.current[0]?.items).toEqual(['No vital signs found within the selected time range.'])
  })
})
