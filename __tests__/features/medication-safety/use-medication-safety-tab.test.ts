import { act, renderHook } from '@testing-library/react'
import { useInteractionCheckStore, type InteractionCheckState } from '@/features/clinical-summary/medications/hooks/useInteractionCheck'
import { useMedicationSafetyTab } from '@/features/medication-safety/useMedicationSafetyTab'
import type { MedicationRow } from '@/features/clinical-summary/medications/types'

const row = (id: string, dataOrigin?: MedicationRow['dataOrigin']): MedicationRow => ({
  id, title: id, status: 'active', isInactive: false, isChronic: false, refillCount: 1, searchHaystack: '', dataOrigin,
})
const cloudOnly = [row('a', 'medcloud'), row('b', 'medcloud')]
const withHospital = [row('a', 'hospital'), row('b', 'medcloud')]

function publish(state: InteractionCheckState, rows: MedicationRow[]) {
  act(() => useInteractionCheckStore.getState().publish({ state, rows, retry: () => {} }))
}

describe('useMedicationSafetyTab', () => {
  afterEach(() => { window.history.replaceState({}, '', '/') })

  it('has no tab without the service', () => {
    const { result } = renderHook(() => useMedicationSafetyTab())
    publish({ status: 'off' }, withHospital)
    expect(result.current.visible).toBe(false)
  })

  it('has no tab away from the hospital when the service cannot be reached', () => {
    const { result } = renderHook(() => useMedicationSafetyTab())
    publish({ status: 'unreachable', reason: 'network' }, cloudOnly)
    expect(result.current.visible).toBe(false)
  })

  it('keeps a greyed tab at the hospital when the service cannot be reached', () => {
    const { result } = renderHook(() => useMedicationSafetyTab())
    publish({ status: 'blocked' }, withHospital)
    expect(result.current).toMatchObject({ visible: true, unreachable: true, count: null })
    window.history.replaceState({}, '', '/?site=vghtpe')
    publish({ status: 'unreachable', reason: 'timeout' }, cloudOnly)
    expect(result.current).toMatchObject({ visible: true, unreachable: true })
  })

  it('counts every cross-visit pair, avoid pairs, and unchecked drugs', () => {
    const { result } = renderHook(() => useMedicationSafetyTab())
    publish({
      status: 'ok',
      review: {
        findings: [
          { id: '1', tier: 'avoid', rowIdsA: ['a'], rowIdsB: ['b'], action: '', mechanism: '', source: '', samePrescription: false },
          { id: '2', tier: 'act', rowIdsA: ['a'], rowIdsB: ['b'], action: '', mechanism: '', source: '', samePrescription: false },
          { id: '3', tier: 'note', rowIdsA: ['a'], rowIdsB: ['b'], action: '', mechanism: '', source: '', samePrescription: false },
          { id: '4', tier: 'act', rowIdsA: ['a'], rowIdsB: ['b'], action: '', mechanism: '', source: '', samePrescription: true },
        ],
        checkedRowIds: ['a', 'b'],
        uncheckedRowIds: ['c'],
      },
    }, cloudOnly)
    expect(result.current).toEqual({ visible: true, unreachable: false, count: 3, avoid: 1, unchecked: 1, notRun: false })
  })

  it('marks a list with fewer than two checkable ingredients as not run', () => {
    const { result } = renderHook(() => useMedicationSafetyTab())
    publish({ status: 'too-few' }, withHospital)
    expect(result.current).toMatchObject({ visible: true, count: 0, notRun: true })
  })
})
