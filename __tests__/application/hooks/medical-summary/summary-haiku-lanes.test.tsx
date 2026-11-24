/** @jest-environment jsdom */
// Claude Haiku 5.5 is asked for each card in its own request: the headline
// does not wait for the problem list, the problem list writes a worksheet the
// app discards, and only the safety request is allowed to think.
import { act, renderHook } from '@testing-library/react'
import { useMedicalSummary } from '@/src/application/hooks/medical-summary/use-medical-summary.hook'
import { medicalSummaryStore } from '@/src/application/hooks/medical-summary/medical-summary-store'
import { useSummaryVersionsStore } from '@/src/application/hooks/medical-summary/summary-versions.store'
import { useProgressiveImportStore } from '@/src/application/stores/progressive-import.store'
import type { SummarySourceCatalogEntry } from '@/src/core/entities/medical-summary.entity'

const SLOT = 'haiku-slot'
const CATALOG: SummarySourceCatalogEntry[] = [
  { key: 'E1', resourceType: 'Encounter', resourceId: 'enc-1', display: '門診', date: '2026-04-20', encounterClass: 'outpatient' },
  { key: 'M1', resourceType: 'MedicationRequest', resourceId: 'med-1', display: 'Metformin 500mg', date: '2026-04-20' },
]
const block = (id: string, value: unknown) =>
  `<<<MEDIPRISMA_MODULE:${id}>>>${JSON.stringify(value)}<<<END_MEDIPRISMA_MODULE:${id}>>>`
const REPLIES: Record<string, string> = {
  overview: block('overview', { headline: '78M with T2DM', medicationEducation: [] }),
  problems: '<<<WORKSHEET>>>\nM1 | metformin | type 2 diabetes\nT2DM | E1 | none in record\n<<<END_WORKSHEET>>>\n\n' +
    block('problems', { problems: [{ label: 'Type 2 diabetes mellitus', basis: 'medication', kind: 'medication', basisSources: ['M1'], medicationSources: ['M1'] }] }),
  safety: block('safety', { scannedCount: 0, alerts: [] }),
}
/** The card a request's output contract asks for. */
const requestedCards = (messages: Array<{ role: string; content: string }>) =>
  Object.keys(REPLIES).filter(id => messages[0].content.includes(`<<<MEDIPRISMA_MODULE:${id}>>>`))

let mockSlotOptions: any
const mockStream = jest.fn()
jest.mock('@/src/application/hooks/ai-generation/use-ai-slot-generation.hook', () => ({
  useAiSlotGeneration: (options: any) => {
    mockSlotOptions = options
    return {
      slotKey: SLOT, catalog: CATALOG, dataReady: true,
      generate: () => mockSlotOptions.run({
        operationKey: SLOT, modelId: 'claude-haiku-5-5', requestedModelId: 'claude-haiku-5-5',
        modelName: 'Claude Haiku 5.5', locale: 'zh-TW', audience: 'medical',
        clinicalContext: 'Patient Information:\n- Gender: Male', catalog: CATALOG,
        piiLiterals: [], contextLimit: 900_000, ai: { stream: mockStream },
      }),
    }
  },
}))
jest.mock('@/src/application/providers/audience.provider', () => ({ useAudience: () => ({ audience: 'medical' }) }))
jest.mock('@/src/application/providers/ai-demographics-gate.provider', () => ({ useAiDemographicsGate: () => ({ demographicsReadyForAi: true }) }))

beforeEach(() => {
  useSummaryVersionsStore.getState().reset()
  useProgressiveImportStore.setState({ current: null, stoppedRuns: {}, pendingRunId: null })
  mockStream.mockReset()
  medicalSummaryStore.setState({ byKey: {}, running: { [SLOT]: true } } as any)
})

test('asks for each card on its own and keeps the problem list written after a worksheet', async () => {
  mockStream.mockImplementation(async (messages: any[], options: any) => {
    const reply = REPLIES[requestedCards(messages)[0]]
    options.onChunk(reply)
    return reply
  })
  const { result } = renderHook(() => useMedicalSummary())
  await act(async () => { await result.current.generate() })

  const calls = mockStream.mock.calls.map(([messages, options]) => ({
    cards: requestedCards(messages), system: messages[0].content as string,
    user: messages[1].content as string, options,
  }))
  expect(calls.map(call => call.cards).sort()).toEqual([['overview'], ['problems'], ['safety']])
  const byCard = Object.fromEntries(calls.map(call => [call.cards[0], call]))
  expect(byCard.problems.system).toContain('This request covers ONLY the problems card.')
  expect(byCard.problems.user).toContain('<<<WORKSHEET>>>')
  expect(byCard.problems.options.claudeThinking).toBeUndefined()
  expect(byCard.overview.user).not.toMatch(/FINAL (STEP|CHECK) FOR THE/)
  expect(byCard.safety.user).toContain('FINAL CHECK FOR THE SAFETY CARD')
  expect(byCard.safety.options).toMatchObject({ claudeThinking: 'adaptive', maxTokens: 16_000 })
  expect(calls.map(call => call.options.summaryDiagnostics.lane).sort()).toEqual(['batch', 'fast', 'full'])

  const stored = medicalSummaryStore.getState().byKey[SLOT] as any
  expect(stored.headline).toBe('78M with T2DM')
  expect(stored.problems.map((problem: any) => problem.label)).toEqual(['Type 2 diabetes mellitus'])
  expect(stored.cardErrors).toBeUndefined()
})
