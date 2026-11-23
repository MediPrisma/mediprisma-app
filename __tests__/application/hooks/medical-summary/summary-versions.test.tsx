import { act, fireEvent, render, screen } from '@testing-library/react'
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
  const picker = screen.getByRole('combobox', { name: '摘要版本' })
  expect(screen.getByRole('status', { name: '新版產生中' })).toBeInTheDocument()
  act(() => picker.focus())
  rerender(<SummaryVersionPicker versions={[cloud, version('hospital', 'hospital')]} selectedId="cloud" onSelect={onSelect} busy={false} locale="zh-TW" />)
  expect(picker).toHaveTextContent('雲端')
  expect(picker).toHaveFocus()
  expect(onSelect).not.toHaveBeenCalled()
  expect(screen.queryByRole('status')).toBeNull()
})

test('one dropdown lists the latest versions first and earlier ones below', () => {
  const onSelect = jest.fn()
  const at = (id: string, kind: SummaryVersion['kind'], hour: number) =>
    ({ ...version(id, kind), completedAt: new Date(2026, 10, 24, hour, 29, 51).getTime() })
  const versions = [at('c1', 'cloud', 1), at('h1', 'hospital', 1), at('c2', 'cloud', 2), at('h2', 'hospital', 3)]
  const { rerender } = render(<SummaryVersionPicker versions={versions} selectedId="h2" onSelect={onSelect} busy={false} locale="zh-TW" />)
  expect(screen.queryAllByRole('button')).toHaveLength(0)
  const picker = screen.getByRole('combobox', { name: '摘要版本' })
  expect(picker).toHaveTextContent(/^含院內資料$/)
  fireEvent.click(picker)
  const options = screen.getAllByRole('option').map(option => option.textContent)
  expect(options).toEqual(['雲端02:29:51', '含院內資料03:29:51', '含院內資料01:29:51', '雲端01:29:51'])
  expect(screen.getByRole('group', { name: '較早版本' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('option', { name: /含院內資料\s*01:29:51/ }))
  expect(onSelect).toHaveBeenCalledWith('h1')
  rerender(<SummaryVersionPicker versions={versions} selectedId="h1" onSelect={onSelect} busy={false} locale="zh-TW" />)
  expect(screen.getByRole('combobox', { name: '摘要版本' })).toHaveTextContent(/^含院內資料 · 01:29$/)
})

test('a missing hospital version shows as not generated yet and cannot be picked', () => {
  render(<SummaryVersionPicker versions={[version('cloud', 'cloud')]} selectedId="cloud" onSelect={jest.fn()} busy={false} locale="zh-TW" />)
  fireEvent.click(screen.getByRole('combobox', { name: '摘要版本' }))
  expect(screen.getByRole('option', { name: /含院內資料.*尚未產生/ })).toHaveAttribute('aria-disabled', 'true')
  expect(screen.queryByRole('group', { name: '較早版本' })).toBeNull()
})

test('cited evidence is immutable after source update/removal and survives serialization', async () => {
  const { captureSummaryEvidence } = await import('@/src/application/hooks/medical-summary/summary-versions.store')
  let original = '檢查原文：未見異常'
  const catalog = [{ key: 'R1', resourceType: 'DiagnosticReport', resourceId: 'same-id', display: '檢查', getContentText: () => original }]
  const saved = captureSummaryEvidence(catalog, { sourceIndex: [{ key: 'R1' }] } as any)
  original = '更新後的不同報告'
  catalog.splice(0)
  expect(JSON.parse(JSON.stringify(saved))['DiagnosticReport/same-id']).toBe('檢查原文：未見異常')
})
