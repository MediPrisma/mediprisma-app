/**
 * @jest-environment jsdom
 */
// Locks the follow-up-chips PLACEMENT: the chips live at the bottom of the
// conversation thread (under the last message, scrolling with it like ChatGPT),
// NOT wedged into the composer/toolbar. ChatMessageList exposes an `afterMessages`
// slot rendered after the messages and before the scroll anchor; this test pins
// that DOM order so the chips can never drift back up into the input area.
import { fireEvent, render, screen } from '@testing-library/react'
import { ChatMessageList } from '@/features/medical-chat/components/ChatMessageList'
import { LanguageProvider } from '@/src/application/providers/language.provider'
import { customOpenAiModelIdForProfile } from '@/src/shared/constants/ai-models.constants'
import { createModelExecution, reportModelExecution } from '@/src/shared/utils/ai-model-execution'

// jsdom has no ResizeObserver (radix ScrollArea needs it) and react-markdown is
// heavy/irrelevant here — we only assert child ORDER, so stub both to passthroughs.
jest.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children, className }: any) => <div className={className}>{children}</div>,
}))
jest.mock('@/src/shared/components/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}))

function renderList(afterMessages?: React.ReactNode) {
  const messages = [
    { id: 'u1', role: 'user', content: 'QUESTION_TEXT', timestamp: 0 },
    { id: 'a1', role: 'assistant', content: 'ANSWER_TEXT', timestamp: 0 },
  ] as any[]
  return render(
    <LanguageProvider>
      <ChatMessageList messages={messages} isLoading={false} afterMessages={afterMessages} />
    </LanguageProvider>,
  )
}

describe('ChatMessageList — afterMessages slot (follow-up chips placement)', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } })
    // The list auto-scrolls to its end on a 100 ms debounce. jsdom has no
    // scrollIntoView, so a test still mounted when that timer fires (a slow
    // findBy* under a loaded full-suite run) threw from the timer callback.
    Element.prototype.scrollIntoView = jest.fn()
  })

  it('shows the selected model with info until actual metadata arrives, then warns on fallback', async () => {
    const pending = createModelExecution('gemini-3.8-flash')
    const message = { id: 'a1', role: 'assistant' as const, content: 'SAME_ANSWER', timestamp: 0, modelId: 'gemini-3.8-flash', modelExecution: pending }
    const view = render(<LanguageProvider><ChatMessageList messages={[message]} isLoading={true} /></LanguageProvider>)
    expect(screen.getByText('Gemini 3.8 Flash')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('載入中')
    fireEvent.focus(screen.getByRole('button', { name: '模型資訊：API 未回報實際模型' }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('目前顯示所選模型 Gemini 3.8 Flash。API 未回報實際模型')
    view.rerender(<LanguageProvider><ChatMessageList messages={[{ ...message, modelExecution: reportModelExecution(pending, 'gemini-3.1-flash-lite') }]} isLoading={false} /></LanguageProvider>)
    expect(screen.getByText('Gemini 3.1 Flash-Lite')).toHaveAttribute('title', 'Gemini 3.1 Flash-Lite')
    expect(screen.getByRole('status')).toHaveTextContent('本次未能依選擇的 Gemini 3.8 Flash 完成')
    expect(screen.getByRole('status')).toHaveTextContent('實際使用 Gemini 3.1 Flash-Lite')
    expect(screen.getByText('SAME_ANSWER')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '模型資訊：API 未回報實際模型' })).not.toBeInTheDocument()
  })

  it('renders afterMessages AFTER the last (assistant) message in the thread', () => {
    renderList(<div data-testid="chips">CHIPS</div>)
    const answer = screen.getByText('ANSWER_TEXT')
    const chips = screen.getByTestId('chips')
    // Document-order check: the chips node must follow the answer node — i.e. it
    // sits below the last answer inside the scroll area, not above it.
    const following = answer.compareDocumentPosition(chips) & Node.DOCUMENT_POSITION_FOLLOWING
    expect(following).toBeTruthy()
  })

  it('renders nothing extra when afterMessages is omitted', () => {
    renderList()
    expect(screen.queryByTestId('chips')).toBeNull()
  })

  it('renders reply quote metadata on user messages', () => {
    const messages = [
      {
        id: 'u1',
        role: 'user',
        content: 'QUESTION_TEXT',
        timestamp: 0,
        replyTo: {
          messageId: 'a0',
          role: 'assistant',
          label: 'GPT',
          excerpt: 'SELECTED_ANSWER_EXCERPT',
          timestamp: 0,
        },
      },
    ] as any[]

    render(
      <LanguageProvider>
        <ChatMessageList messages={messages} isLoading={false} />
      </LanguageProvider>,
    )

    expect(screen.getByText('回覆 GPT')).toBeInTheDocument()
    expect(screen.getByText('SELECTED_ANSWER_EXCERPT')).toBeInTheDocument()
    expect(screen.getByText('QUESTION_TEXT')).toBeInTheDocument()
  })

  it('shows the configured upstream model name for a custom endpoint answer', () => {
    const customModelId = customOpenAiModelIdForProfile('hospital-qwen')
    const messages = [{
      id: 'a1',
      role: 'assistant',
      content: 'LOCAL_ANSWER',
      timestamp: 0,
      modelId: 'qwen2.5vl:7b',
      modelExecution: reportModelExecution(createModelExecution(customModelId), 'qwen2.5vl:7b'),
    }] as any[]

    render(
      <LanguageProvider>
        <ChatMessageList
          messages={messages}
          isLoading={false}
          customModelDisplayNames={{ [customModelId]: 'qwen2.5vl:7b' }}
        />
      </LanguageProvider>,
    )

    expect(screen.getByText('qwen2.5vl:7b')).toHaveAttribute('title', 'qwen2.5vl:7b')
    expect(screen.getByText('qwen2.5vl:7b')).not.toHaveClass('uppercase')
    expect(screen.queryByText('OpenAI-compatible')).not.toBeInTheDocument()
  })
})
