import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { InteractionSummary } from '@/features/clinical-summary/medications/components/InteractionSummary'
import { useRunInteractionCheck } from '@/features/clinical-summary/medications/hooks/useInteractionCheck'
import { resetServiceReach } from '@/features/clinical-summary/medications/hooks/hospital-service-reach'
import type { MedicationRow } from '@/features/clinical-summary/medications/types'
import type { InteractionReview } from '@/features/clinical-summary/medications/utils/interaction-check'

jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({ locale: 'zh-TW', t: { medications: {} } }),
}))

function row(id: string, title: string, patch: Partial<MedicationRow> = {}): MedicationRow {
  return {
    id, title, status: 'active', isInactive: false, isChronic: false, refillCount: 1, searchHaystack: '',
    drugTerminology: { source: 'nhi-official-drug-master', snapshotId: 's', ingredientText: title },
    ...patch,
  }
}

const rows = [
  row('isdn', 'Isosorbide dinitrate', { dataOrigin: 'hospital', pharmacy: '臺北榮總 門診', startedOn: '2026/10/28', encounterReference: 'Encounter/1' }),
  row('sild', 'Sildenafil', { dataOrigin: 'medcloud', pharmacy: '測試診所', startedOn: '2026/11/02', encounterReference: 'Encounter/9' }),
  row('spiro', 'Spironolactone', { dataOrigin: 'hospital', encounterReference: 'Encounter/1' }),
  row('enal', 'Enalapril', { dataOrigin: 'hospital', encounterReference: 'Encounter/1' }),
  row('dapo', 'Dapoxetine', { dataOrigin: 'medcloud' }),
]

const review: InteractionReview = {
  findings: [
    { id: 'a', tier: 'avoid', severity: 'low', rowIdsA: ['sild'], rowIdsB: ['isdn'], action: '絕對不可併用。', mechanism: '可能發生嚴重低血壓。', source: '北榮藥劑部交互作用資料庫', samePrescription: false, involvesEnded: false },
    { id: 'b', tier: 'act', severity: 'moderate', rowIdsA: ['spiro'], rowIdsB: ['enal'], action: '監測血鉀', mechanism: '高血鉀', source: '', samePrescription: true, involvesEnded: false },
  ],
  checkedRowIds: ['isdn', 'sild', 'spiro', 'enal'],
  uncheckedRowIds: ['dapo'], localRowIds: [], endedRowIds: [], coveredUntil: {},
}

describe('InteractionSummary', () => {
  it('names skin and ear preparations left out of the check, once each', () => {
    render(<InteractionSummary review={{ ...review, localRowIds: ['isdn', 'isdn'] }} rows={rows} />)
    expect(screen.getByText(/^外用藥不列入檢核：/)).toBeInTheDocument()
  })

  it('lists the cross-visit pair with its action, names the unchecked drug, and folds same-visit pairs', () => {
    render(<InteractionSummary review={review} rows={rows} />)
    const section = screen.getByRole('region', { name: '交互作用' })
    expect(within(section).getByText('需注意 1 項（避免併用 1） · 已檢核 4／5 項')).toBeInTheDocument()
    expect(within(section).getByText('避免併用')).toBeInTheDocument()
    // The service's own grade shows beside 避免併用, even when it reads 輕度.
    expect(within(section).getByText('輕度')).toBeInTheDocument()
    expect(within(section).getByText('Sildenafil × Isosorbide dinitrate')).toBeInTheDocument()
    expect(within(section).getByText('絕對不可併用。')).toBeInTheDocument()
    expect(within(section).getByText('未檢核 1 項（成分未對到）：')).toBeInTheDocument()
    expect(within(section).getByText('Dapoxetine · 雲端')).toBeInTheDocument()
    expect(within(section).queryByText('Spironolactone × Enalapril')).not.toBeInTheDocument()
    expect(within(section).queryByText('可能發生嚴重低血壓。')).not.toBeInTheDocument()
  })

  it('shows mechanism and where each drug was prescribed when a pair is opened', () => {
    render(<InteractionSummary review={review} rows={rows} />)
    fireEvent.click(screen.getByRole('button', { name: /Sildenafil × Isosorbide dinitrate/ }))
    expect(screen.getByText('可能發生嚴重低血壓。')).toBeInTheDocument()
    expect(screen.getByText('Sildenafil · 雲端 · 測試診所 · 2026/11/02')).toBeInTheDocument()
    expect(screen.getByText('Isosorbide dinitrate · 院內 · 臺北榮總 門診 · 2026/10/28')).toBeInTheDocument()
  })

  it('reveals same-visit pairs behind one disclosure', () => {
    render(<InteractionSummary review={review} rows={rows} />)
    fireEvent.click(screen.getByRole('button', { name: '同次開立 1 項' }))
    expect(screen.getByText('Spironolactone × Enalapril')).toBeInTheDocument()
    expect(screen.getByText('同次開立')).toBeInTheDocument()
  })

  it('keeps a same-visit avoid pair and a low cross-visit pair in the list', () => {
    render(<InteractionSummary review={{
      findings: [
        { id: 'a', tier: 'avoid', severity: 'high', rowIdsA: ['spiro'], rowIdsB: ['enal'], action: '避免併用', mechanism: '', source: '', samePrescription: true, involvesEnded: false },
        { id: 'n', tier: 'note', severity: 'unknown', rowIdsA: ['isdn'], rowIdsB: ['sild'], action: '注意', mechanism: '', source: '', samePrescription: false, involvesEnded: false },
      ],
      checkedRowIds: ['isdn', 'sild', 'spiro', 'enal'],
      uncheckedRowIds: [], localRowIds: [], endedRowIds: [], coveredUntil: {},
    }} rows={rows} />)
    expect(screen.getByText('需注意 2 項（避免併用 1） · 已檢核 4／4 項')).toBeInTheDocument()
    expect(screen.getByText('Spironolactone × Enalapril')).toBeInTheDocument()
    expect(screen.getByText('Isosorbide dinitrate × Sildenafil')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /同次開立 \d+ 項/ })).not.toBeInTheDocument()
  })

  it('says which drugs ran out, and how far a chronic slip could still reach', () => {
    const list = [
      ...rows,
      row('val', 'Valsartan', { dataOrigin: 'hospital', isInactive: true, isChronic: true, chronicFills: 3, durationDays: 30, endDateIso: '2026-09-04' }),
    ]
    render(<InteractionSummary review={{
      findings: [{ id: 'e', tier: 'act', severity: 'moderate', rowIdsA: ['val'], rowIdsB: ['spiro'], action: '監測血鉀', mechanism: '', source: '', samePrescription: false, involvesEnded: true }],
      checkedRowIds: ['val', 'spiro'], uncheckedRowIds: [], localRowIds: [], endedRowIds: ['val'], coveredUntil: { val: '2026-11-03' },
    }} rows={list} />)
    expect(screen.getByText('含 1 項最近用完的長期用藥（慢箋期間內或用完 14 天內），續開前請確認是否仍在服用')).toBeInTheDocument()
    expect(screen.getByText('已用完')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Valsartan × Spironolactone/ }))
    expect(screen.getByText('Valsartan · 院內 · 院內藥用到 9/4，慢箋可續領至 11/3')).toBeInTheDocument()
  })

  it('tells "none found" apart from "not checked"', () => {
    const { rerender } = render(<InteractionSummary review={{ findings: [], checkedRowIds: ['isdn', 'sild'], uncheckedRowIds: [], localRowIds: [], endedRowIds: [], coveredUntil: {} }} rows={rows} />)
    expect(screen.getByText('已檢核 2／2 項，未發現需注意的交互作用')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    rerender(<InteractionSummary review={{ findings: [], checkedRowIds: ['isdn', 'sild'], uncheckedRowIds: ['dapo'], localRowIds: [], endedRowIds: [], coveredUntil: {} }} rows={rows} />)
    expect(screen.getByText('已檢核的 2 項之間未發現，1 項未檢核')).toBeInTheDocument()
  })
})

describe('useRunInteractionCheck', () => {
  const pair = rows.slice(0, 2)
  const answer = {
    resolvedMedications: [
      { inputIndex: 0, udCode: '01669', genericName: 'isosorbide dinitrate' },
      { inputIndex: 1, udCode: '02602', genericName: 'Sildenafil citrate (sildenafil)' },
    ],
    alerts: [{ alertId: 'x', type: 'DRUG_INTERACTION', severity: 'low', drugA: { udCode: '02602' }, drugB: { udCode: '01669' }, nursingAction: '絕對不可併用。' }],
  }
  const on = { enabled: true, ready: true }
  const run = (list: MedicationRow[], options = on) => renderHook(() => useRunInteractionCheck(list, options))
  const fetchMock = jest.fn()
  const originalPermissions = Object.getOwnPropertyDescriptor(navigator, 'permissions')
  function permission(state: PermissionState) {
    const listeners: Array<() => void> = []
    const status = { state, addEventListener: (_: string, fn: () => void) => listeners.push(fn), removeEventListener: jest.fn() }
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: jest.fn(async () => status) } })
    return { status, change: (next: PermissionState) => { status.state = next; listeners.forEach(fn => fn()) } }
  }
  beforeEach(() => {
    resetServiceReach()
    fetchMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
    process.env.NEXT_PUBLIC_DDI_SERVICE_ORIGIN = 'https://ddi.example.test'
  })
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_DDI_SERVICE_ORIGIN
    if (originalPermissions) Object.defineProperty(navigator, 'permissions', originalPermissions)
    else delete (navigator as { permissions?: unknown }).permissions
  })

  it('is off without a configured service or outside the medical view', () => {
    delete process.env.NEXT_PUBLIC_DDI_SERVICE_ORIGIN
    expect(run(pair).result.current.state).toEqual({ status: 'off' })
    process.env.NEXT_PUBLIC_DDI_SERVICE_ORIGIN = 'https://ddi.example.test'
    expect(run(pair, { enabled: false, ready: true }).result.current.state).toEqual({ status: 'off' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('waits for the list, then says when there are too few ingredients to check', async () => {
    expect(run(pair, { enabled: true, ready: false }).result.current.state).toEqual({ status: 'loading' })
    expect(fetchMock).not.toHaveBeenCalled()
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })
    const { result } = run(pair.slice(0, 1))
    expect(result.current.state).toEqual({ status: 'too-few', localRowIds: [], reachable: undefined })
    await waitFor(() => expect(result.current.state).toEqual({ status: 'too-few', localRowIds: [], reachable: true }))
  })

  it('asks the service with a fixed synthetic drug when there are too few to check', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const { result } = run([])
    await waitFor(() => expect(result.current.state).toEqual({ status: 'too-few', localRowIds: [], reachable: false }))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://ddi.example.test/api/ddi-check')
    expect(JSON.parse(init.body)).toEqual({ medications: [{ drugName: 'acetaminophen' }] })

    fetchMock.mockResolvedValueOnce({ ok: false, status: 422 })
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.state).toMatchObject({ status: 'too-few', reachable: true }))
  })

  it('does not ask a service the browser was refused', async () => {
    permission('denied')
    const { result } = run([])
    await waitFor(() => expect(result.current.state).toMatchObject({ status: 'too-few', reachable: false }))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends ingredient names only and returns the graded review', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => answer })
    const { result } = run(pair)
    expect(result.current.state).toEqual({ status: 'loading' })
    await waitFor(() => expect(result.current.state.status).toBe('ok'))
    const state = result.current.state as Extract<typeof result.current.state, { status: 'ok' }>
    expect(state.review.findings[0]?.tier).toBe('avoid')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://ddi.example.test/api/ddi-check')
    expect(JSON.parse(init.body)).toEqual({ medications: [{ drugName: 'Isosorbide dinitrate' }, { drugName: 'Sildenafil' }] })
  })

  it('asks again when the same drugs arrive in another order', async () => {
    const codes: Record<string, [string, string]> = {
      'Isosorbide dinitrate': ['01669', 'isosorbide dinitrate'],
      Sildenafil: ['02602', 'Sildenafil citrate (sildenafil)'],
    }
    fetchMock.mockImplementation(async (_url: string, init: { body: string }) => ({
      ok: true,
      json: async () => ({
        alerts: answer.alerts,
        resolvedMedications: JSON.parse(init.body).medications.map((m: { drugName: string }, inputIndex: number) =>
          ({ inputIndex, udCode: codes[m.drugName]![0], genericName: codes[m.drugName]![1] })),
      }),
    }))
    const { result, rerender } = renderHook(({ list }) => useRunInteractionCheck(list, on), { initialProps: { list: pair } })
    await waitFor(() => expect(result.current.state.status).toBe('ok'))
    rerender({ list: [...pair].reverse() })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.state.status).toBe('ok'))
    const state = result.current.state as Extract<typeof result.current.state, { status: 'ok' }>
    expect(state.review.findings).toHaveLength(1)
    expect(state.review.uncheckedRowIds).toEqual([])
  })

  it('reports an unreachable service and checks again on retry', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const { result } = run(pair)
    await waitFor(() => expect(result.current.state).toEqual({ status: 'unreachable', reason: 'network' }))
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 })
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.state).toEqual({ status: 'unreachable', reason: 'http' }))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not ask while Chrome blocks the hospital network, and asks once access is granted', async () => {
    const { change } = permission('denied')
    fetchMock.mockResolvedValue({ ok: true, json: async () => answer })
    const { result } = run(pair)
    await waitFor(() => expect(result.current.state).toEqual({ status: 'blocked' }))
    expect(fetchMock).not.toHaveBeenCalled()
    act(() => change('granted'))
    await waitFor(() => expect(result.current.state.status).toBe('ok'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
