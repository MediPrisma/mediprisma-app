import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { InteractionSummary } from '@/features/clinical-summary/medications/components/InteractionSummary'
import { useInteractionReview } from '@/features/clinical-summary/medications/hooks/useInteractionReview'
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
    { id: 'a', tier: 'avoid', rowIdsA: ['sild'], rowIdsB: ['isdn'], action: '絕對不可併用。', mechanism: '可能發生嚴重低血壓。', source: '北榮藥劑部交互作用資料庫', samePrescription: false },
    { id: 'b', tier: 'act', rowIdsA: ['spiro'], rowIdsB: ['enal'], action: '監測血鉀', mechanism: '高血鉀', source: '', samePrescription: true },
  ],
  checkedRowIds: ['isdn', 'sild', 'spiro', 'enal'],
  uncheckedRowIds: ['dapo'],
}

describe('InteractionSummary', () => {
  it('lists the cross-visit pair with its action and keeps the rest collapsed', () => {
    render(<InteractionSummary review={review} rows={rows} />)
    const section = screen.getByRole('region', { name: '交互作用' })
    expect(within(section).getByText('避免併用 1')).toBeInTheDocument()
    expect(within(section).getByText('Sildenafil × Isosorbide dinitrate')).toBeInTheDocument()
    expect(within(section).getByText('絕對不可併用。')).toBeInTheDocument()
    expect(within(section).getByText('已檢核 4／5 項')).toBeInTheDocument()
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

  it('reveals same-visit pairs and unchecked drugs behind one disclosure', () => {
    render(<InteractionSummary review={review} rows={rows} />)
    fireEvent.click(screen.getByRole('button', { name: '其他 1 項、1 項未檢核' }))
    expect(screen.getByText('Spironolactone × Enalapril')).toBeInTheDocument()
    expect(screen.getByText('同次開立')).toBeInTheDocument()
    expect(screen.getByText(/未檢核：成分未對到/)).toBeInTheDocument()
  })

  it('says so when nothing was found', () => {
    render(<InteractionSummary review={{ findings: [], checkedRowIds: ['isdn', 'sild'], uncheckedRowIds: [] }} rows={rows} />)
    expect(screen.getByText('跨次開立未發現')).toBeInTheDocument()
    expect(screen.getByText('已檢核 2／2 項')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('useInteractionReview', () => {
  const pair = rows.slice(0, 2)
  const answer = {
    resolvedMedications: [
      { inputIndex: 0, udCode: '01669', genericName: 'isosorbide dinitrate' },
      { inputIndex: 1, udCode: '02602', genericName: 'Sildenafil citrate (sildenafil)' },
    ],
    alerts: [{ alertId: 'x', type: 'DRUG_INTERACTION', severity: 'low', drugA: { udCode: '02602' }, drugB: { udCode: '01669' }, nursingAction: '絕對不可併用。' }],
  }
  const fetchMock = jest.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
  })
  afterEach(() => { delete process.env.NEXT_PUBLIC_DDI_SERVICE_ORIGIN })

  it('stays off without a configured service', () => {
    const { result } = renderHook(() => useInteractionReview(pair, true))
    expect(result.current).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends ingredient names only and returns the graded review', async () => {
    process.env.NEXT_PUBLIC_DDI_SERVICE_ORIGIN = 'https://ddi.example.test'
    fetchMock.mockResolvedValue({ ok: true, json: async () => answer })
    const { result } = renderHook(() => useInteractionReview(pair, true))
    await waitFor(() => expect(result.current?.findings).toHaveLength(1))
    expect(result.current?.findings[0]?.tier).toBe('avoid')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://ddi.example.test/api/ddi-check')
    expect(JSON.parse(init.body)).toEqual({ medications: [{ drugName: 'Isosorbide dinitrate' }, { drugName: 'Sildenafil' }] })
  })

  it('asks again when the same drugs arrive in another order', async () => {
    process.env.NEXT_PUBLIC_DDI_SERVICE_ORIGIN = 'https://ddi.example.test'
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
    const { result, rerender } = renderHook(({ list }) => useInteractionReview(list, true), { initialProps: { list: pair } })
    await waitFor(() => expect(result.current?.findings).toHaveLength(1))
    rerender({ list: [...pair].reverse() })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current?.findings).toHaveLength(1))
    expect(result.current?.uncheckedRowIds).toEqual([])
  })

  it('shows nothing when the service cannot be reached, for another audience, or for one drug', async () => {
    process.env.NEXT_PUBLIC_DDI_SERVICE_ORIGIN = 'https://ddi.example.test'
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const failed = renderHook(() => useInteractionReview(pair, true))
    await act(async () => { await Promise.resolve() })
    expect(failed.result.current).toBeNull()
    fetchMock.mockClear()
    expect(renderHook(() => useInteractionReview(pair, false)).result.current).toBeNull()
    expect(renderHook(() => useInteractionReview(pair.slice(0, 1), true)).result.current).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
