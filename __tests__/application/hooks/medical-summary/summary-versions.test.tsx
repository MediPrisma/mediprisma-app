import { act, render, screen } from '@testing-library/react'
import { SummaryVersionPicker } from '@/features/medical-summary/components/SummaryVersionPicker'
import { useSummaryVersionsStore, type SummaryVersion } from '@/src/application/hooks/medical-summary/summary-versions.store'
import { notifyBundleChanged } from '@/src/shared/utils/reset-on-bundle-change'
import { medicalSummaryStore } from '@/src/application/hooks/medical-summary/medical-summary-store'
import { createAiResultStore } from '@/src/application/hooks/ai-generation/create-ai-result-store'
import { stopProgressiveImport, useProgressiveImportStore } from '@/src/application/stores/progressive-import.store'

const version = (id: string, kind: SummaryVersion['kind']): SummaryVersion => ({
  id, kind, runId: 'run', viewKey: 'run::patient::medical::zh-TW', slotKey: id,
  completedAt: 1000, result: { headline: id } as SummaryVersion['result'], coverage: null, catalog: [],
})

beforeEach(() => useSummaryVersionsStore.getState().reset())

test('stopping the source keeps completed reading history but privacy revocation removes it', () => {
  const state = useSummaryVersionsStore.getState()
  state.add(version('cloud', 'cloud'), state.epoch)
  useProgressiveImportStore.setState({ current: { runId: 'run', importId: 'current', phase: 'reports-pending' }, stoppedRuns: {} })
  stopProgressiveImport('run', 'source-unavailable')
  expect(useSummaryVersionsStore.getState().versions).toHaveLength(1)
  expect(useSummaryVersionsStore.getState().automaticEpoch).toBeGreaterThan(state.automaticEpoch)
  stopProgressiveImport('run', 'privacy-stale')
  expect(useSummaryVersionsStore.getState().versions).toEqual([])
})

test('background completion preserves selection and immutable cloud content', () => {
  const store = useSummaryVersionsStore.getState()
  store.add(version('cloud', 'cloud'), store.epoch)
  store.add(version('hospital', 'hospital'), store.epoch)
  expect(useSummaryVersionsStore.getState().selected['run::patient::medical::zh-TW']).toBe('cloud')
  store.select('run::patient::medical::zh-TW', 'hospital')
  expect(useSummaryVersionsStore.getState().versions[0].result.headline).toBe('cloud')
  expect(useSummaryVersionsStore.getState().selected['run::patient::medical::zh-TW']).toBe('hospital')
})

test('a continuation keeps summary work, while other AI results and ordinary imports reset', () => {
  const other = createAiResultStore<string>()
  const state = useSummaryVersionsStore.getState()
  state.add(version('cloud', 'cloud'), state.epoch)
  medicalSummaryStore.getState().setRunning('cloud', true)
  other.getState().setResult('report', 'old interpretation')
  notifyBundleChanged(true)
  expect(medicalSummaryStore.getState().running.cloud).toBe(true)
  expect(useSummaryVersionsStore.getState().versions).toHaveLength(1)
  expect(other.getState().byKey).toEqual({})
  notifyBundleChanged()
  expect(useSummaryVersionsStore.getState().versions).toEqual([])
  expect(medicalSummaryStore.getState().running).toEqual({})
  state.add(version('late', 'hospital'), state.epoch)
  expect(useSummaryVersionsStore.getState().versions).toEqual([])
})

test('picker does not steal focus or switch when a new version arrives', () => {
  const onSelect = jest.fn()
  const cloud = version('cloud', 'cloud')
  const { rerender } = render(<SummaryVersionPicker versions={[cloud]} selectedId="cloud" onSelect={onSelect} busy locale="zh-TW" />)
  const picker = screen.getByRole('button', { name: '雲端' })
  act(() => picker.focus())
  rerender(<SummaryVersionPicker versions={[cloud, version('hospital', 'hospital')]} selectedId="cloud" onSelect={onSelect} busy={false} locale="zh-TW" />)
  expect(picker).toHaveAttribute('aria-pressed', 'true')
  expect(picker).toHaveFocus()
  expect(onSelect).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '含院內資料' })).toBeEnabled()
})
