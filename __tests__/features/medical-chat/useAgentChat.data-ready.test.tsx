// Standard chat sent while the chart snapshot is still being fitted (e.g. right
// after a model switch) must wait for it, not report "too large". Synthetic only.
import { act, renderHook, waitFor } from '@testing-library/react'
import { useAgentChat } from '@/features/medical-chat/hooks/useAgentChat'
import { useAiConfigStore } from '@/src/application/stores/ai-config.store'
import { CUSTOM_OPENAI_MODEL_ID } from '@/src/shared/constants/ai-models.constants'
import type { OpenAiCompatibleProfile } from '@/src/shared/types/openai-compatible.types'

const mockStandardChatStream = jest.fn()
type Message = { id: string; role: string; content: string; error?: string }
let mockMessages: Message[] = []
const mockSetChatMessages = jest.fn((update: Message[] | ((prev: Message[]) => Message[])) => {
  mockMessages = typeof update === 'function' ? update(mockMessages) : update
})
const mockBuildStandardChatSystemPrompt = jest.fn((..._args: unknown[]) => 'local system prompt')
const mockTruncate = jest.fn((messages: unknown[]) => messages)
let mockFittedInput: { clinicalContext: string; dataReady: boolean; contextAdaptation: null } = {
  clinicalContext: '', dataReady: false, contextAdaptation: null,
}

jest.mock('@/src/infrastructure/ai/streaming/ai-sdk-stream.adapter', () => ({
  AiSdkStreamAdapter: jest.fn().mockImplementation(() => ({
    stream: (...args: unknown[]) => mockStandardChatStream(...args),
  })),
}))
jest.mock('@/src/application/stores/chat.store', () => ({
  useChatMessages: () => [],  // each turn starts from an empty conversation
  useSetChatMessages: () => mockSetChatMessages,
}))
jest.mock('@/src/application/hooks/patient/use-patient-query.hook', () => ({
  usePatient: () => ({ patient: { id: 'synthetic-patient' } }),
}))
jest.mock('@/src/application/hooks/ai-generation/use-clinical-ai-input.hook', () => ({
  useClinicalAiInput: () => mockFittedInput,
}))
jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({
    t: {
      agent: { thinking: 'thinking', apiKeyRequired: 'API key required' },
      settings: { openAiCompatibleNotConfigured: 'Custom endpoint not configured' },
      medicalChat: { localStandardContextTooLarge: 'Context too large', clinicalContextNotReady: 'Record still being prepared' },
    },
  }),
}))
jest.mock('@/src/application/hooks/ai/use-fhir-tools.hook', () => ({ useFhirTools: () => undefined }))
jest.mock('@/src/application/hooks/ai/use-literature-tools.hook', () => ({ useLiteratureTools: () => undefined }))
jest.mock('@/src/infrastructure/fhir/client/fhir-client.service', () => ({ shouldUseLocalBundle: () => false }))
jest.mock('@/src/application/providers/auth.provider', () => ({ useAuth: () => ({ user: null, isAnonymous: false }) }))
jest.mock('@/src/core/use-cases/chat/build-standard-chat-system-prompt.use-case', () => ({
  buildStandardChatSystemPrompt: (...args: unknown[]) => mockBuildStandardChatSystemPrompt(...args),
}))
jest.mock('@/src/shared/utils/context-window-manager', () => ({
  truncateToContextWindow: (messages: unknown[]) => mockTruncate(messages),
}))

const profile: OpenAiCompatibleProfile = {
  // The bare custom model id resolves to the profile named 'legacy'.
  profileId: 'legacy', enabled: true, baseUrl: 'https://synthetic.example/v1', modelId: 'synthetic-7b',
  apiKey: 'synthetic-key', transport: 'direct', contextWindowTokens: 32768, contextWindowSource: 'manual',
}

/** Errors the chat stored on its messages. */
function assistantErrors(): string[] {
  return mockMessages.map((message) => message.error).filter((error): error is string => !!error)
}

describe('useAgentChat standard chat waits for the fitted chart', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockMessages = []
    mockStandardChatStream.mockResolvedValue(undefined)
    mockTruncate.mockImplementation((messages: unknown[]) => messages)
    mockFittedInput = { clinicalContext: '', dataReady: false, contextAdaptation: null }
    useAiConfigStore.setState({ apiKey: null, geminiKey: null, claudeKey: null, perplexityKey: null, openAiCompatibleProfiles: [profile] })
  })

  it('does not report "too large" while fitting, and sends the settled chart once it is ready', async () => {
    const { result, rerender } = renderHook(() => useAgentChat('system', CUSTOM_OPENAI_MODEL_ID))
    let sending!: Promise<void>
    act(() => { sending = result.current.handleSend('synthetic question') })
    await act(async () => { await Promise.resolve() })
    expect(mockStandardChatStream).not.toHaveBeenCalled()
    expect(assistantErrors()).toEqual([])
    expect(result.current.isLoading).toBe(true)

    mockFittedInput = { clinicalContext: 'synthetic settled chart', dataReady: true, contextAdaptation: null }
    rerender()
    await act(async () => { await sending })

    expect(mockStandardChatStream).toHaveBeenCalledTimes(1)
    expect(mockBuildStandardChatSystemPrompt).toHaveBeenCalledWith('system', 'synthetic settled chart', 'patient')
    expect(assistantErrors()).toEqual([])
  })

  it('still reports "too large" when the settled chart really does not fit', async () => {
    mockFittedInput = { clinicalContext: 'synthetic settled chart', dataReady: true, contextAdaptation: null }
    mockTruncate.mockReturnValue([])
    const { result } = renderHook(() => useAgentChat('system', CUSTOM_OPENAI_MODEL_ID))
    await act(async () => { await result.current.handleSend('synthetic question') })
    expect(mockStandardChatStream).not.toHaveBeenCalled()
    expect(assistantErrors()).toEqual(['Context too large'])
  })

  it('can be stopped while it waits, without an error and without sending', async () => {
    const { result } = renderHook(() => useAgentChat('system', CUSTOM_OPENAI_MODEL_ID))
    let sending!: Promise<void>
    act(() => { sending = result.current.handleSend('synthetic question') })
    await waitFor(() => expect(result.current.isLoading).toBe(true))
    await act(async () => {
      result.current.stopGeneration?.()
      await sending
    })
    expect(mockStandardChatStream).not.toHaveBeenCalled()
    expect(assistantErrors()).toEqual([])
  })

  it('gives up after a bounded wait with its own message, never "too large"', async () => {
    jest.useFakeTimers()
    try {
      const { result } = renderHook(() => useAgentChat('system', CUSTOM_OPENAI_MODEL_ID))
      let sending!: Promise<void>
      act(() => { sending = result.current.handleSend('synthetic question') })
      await act(async () => {
        await jest.advanceTimersByTimeAsync(60_001)
        await sending
      })
      expect(mockStandardChatStream).not.toHaveBeenCalled()
      expect(assistantErrors()).toEqual(['Record still being prepared'])
    } finally { jest.useRealTimers() }
  })
})
