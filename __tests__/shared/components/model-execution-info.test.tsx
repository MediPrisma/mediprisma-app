/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/src/application/providers/language.provider'
import { ModelExecutionInfo } from '@/src/shared/components/ModelExecutionNotice'
import { ChatMessageList } from '@/features/medical-chat/components/ChatMessageList'
import { createModelExecution, reportModelExecution, markModelExecutionUnreported } from '@/src/shared/utils/ai-model-execution'
import { customOpenAiModelIdForProfile } from '@/src/shared/constants/ai-models.constants'

jest.mock('@/components/ui/scroll-area', () => ({ ScrollArea: ({ children }: any) => <div>{children}</div> }))
jest.mock('@/src/shared/components/MarkdownRenderer', () => ({ MarkdownRenderer: ({ content }: any) => <div>{content}</div> }))

beforeAll(() => {
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } })
})

test('info can be opened by click and remains open after the event', async () => {
  render(<LanguageProvider><ModelExecutionInfo execution={createModelExecution('gemini-4-hydrogen')} /></LanguageProvider>)
  fireEvent.click(screen.getByRole('button', { name: '模型資訊：API 未回報實際模型' }))
  const tooltip = await screen.findByRole('tooltip')
  expect(tooltip).not.toHaveAttribute('data-state', 'closed')
})

test('an unreported custom endpoint keeps its selected upstream display name', () => {
  const modelId = customOpenAiModelIdForProfile('audit-qwen')
  render(<LanguageProvider><ChatMessageList
    messages={[{ id: 'audit', role: 'assistant', content: 'synthetic answer', timestamp: 0, modelId,
      modelExecution: createModelExecution(modelId) }]}
    isLoading={false} customModelDisplayNames={{ [modelId]: 'qwen2.5vl:7b' }}
  /></LanguageProvider>)
  expect(screen.getByText('qwen2.5vl:7b')).toBeInTheDocument()
})

test('saved custom provenance keeps its original name after the profile is renamed', async () => {
  const modelId = customOpenAiModelIdForProfile('audit-qwen')
  const execution = JSON.parse(JSON.stringify(createModelExecution(modelId, modelId, 'qwen2.5vl:7b')))
  render(<LanguageProvider><ChatMessageList
    messages={[{ id: 'saved', role: 'assistant', content: 'saved answer', timestamp: 0, modelId, modelExecution: execution }]}
    isLoading={false} customModelDisplayNames={{ [modelId]: 'replacement-model' }}
  /></LanguageProvider>)
  expect(screen.getByText('qwen2.5vl:7b')).toBeInTheDocument()
  expect(screen.queryByText('replacement-model')).not.toBeInTheDocument()
  fireEvent.focus(screen.getByRole('button', { name: '模型資訊：API 未回報實際模型' }))
  expect(await screen.findByRole('tooltip')).toHaveTextContent('目前顯示所選模型 qwen2.5vl:7b')
})

test('the info hint stays visible when the last step reports its model but an earlier step did not', async () => {
  const execution = reportModelExecution(markModelExecutionUnreported(createModelExecution('gemini-4-hydrogen')), 'gemini-4-hydrogen')
  render(<LanguageProvider><ModelExecutionInfo execution={execution} /></LanguageProvider>)
  fireEvent.focus(screen.getByRole('button', { name: '模型資訊：API 未回報實際模型' }))
  expect(await screen.findByRole('tooltip')).toHaveTextContent('部分步驟')
})
