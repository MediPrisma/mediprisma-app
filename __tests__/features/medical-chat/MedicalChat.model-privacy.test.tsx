import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import MedicalChat, {
  medicalChatRuntimeIdentity,
} from '@/features/medical-chat/components/MedicalChat'
import { useAiConfigStore } from '@/src/application/stores/ai-config.store'
import {
  MODEL_PREF_DEFAULTS,
  useModelPrefsStore,
} from '@/src/application/stores/model-prefs.store'
import {
  CUSTOM_OPENAI_MODEL_ID,
} from '@/src/shared/constants/ai-models.constants'
import type { OpenAiCompatibleProfile } from '@/src/shared/types/openai-compatible.types'

const mockInsertTemplate = jest.fn()
const mockUseChatTemplates = jest.fn()
let mockAccountTemplates: import('@/src/application/providers/chat-templates.provider').ChatTemplate[] = []
jest.mock('@/src/application/providers/audience.provider', () => ({ useAudience: () => ({ audience: 'medical' }) }))
jest.mock('@/src/infrastructure/firebase/template-sync', () => ({
  subscribeToChatTemplates: (_uid: string, listener: (templates: typeof mockAccountTemplates) => void) => { listener(mockAccountTemplates); return jest.fn() },
  replaceAllChatTemplates: async (_uid: string, templates: typeof mockAccountTemplates) => { mockAccountTemplates = templates; return true },
  batchSaveChatTemplates: jest.fn(),
}))
const mockEvents: string[] = []
const mockResetChat = jest.fn(() => {
  mockEvents.push('reset-chat')
  mockMessages = []
})
const mockClearFollowups = jest.fn(() => mockEvents.push('clear-followups'))
const mockSetChatDataScope = jest.fn()
const mockGenerateFollowups = jest.fn()
const mockForceSave = jest.fn()
const mockAutoSaveEnabled: boolean[] = []
const mockDrawerPersistenceEnabled: boolean[] = []
const mockSmartTitleEnabled: boolean[] = []
const mockAgentDataScopes: string[] = []
let mockMessages: Array<Record<string, unknown>> = []
let mockExpanded = false

jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({
    t: {
      chat: {
        insertTemplate: 'Insert template',
        hideHeader: 'Hide header',
        showHeader: 'Show header',
        newChat: 'New chat',
        newChatSavedToast: 'Saved',
        newChatConfirmTitle: 'Start a new chat?',
        newChatConfirmDescription: 'The current chat will be cleared.',
        expandedMode: 'Expanded chat',
      },
      common: { cancel: 'Cancel', close: 'Close', maximize: 'Maximize' },
      errors: { fetchPatient: 'Patient error', fetchClinicalData: 'Clinical data error' },
      medicalChat: {
        localStandardModeTitle: 'Standard chat',
        localStandardModeDescription: 'Standard chat description',
        localStandardModeSwitchHint: 'Choose an Agent model',
        fhirDataWarning: 'FHIR warning',
        apiKeyWarningTitle: 'API key required',
        apiKeyWarningMessage: 'Sign in',
        loginLink: 'Sign in',
        quotaBannerTitle: 'Quota',
        quotaBannerMessageAnon: 'Sign in',
        quotaBannerMessageUser: 'Quota exceeded',
      },
      modelPicker: { chatTooltip: 'Choose model' },
      promptGallery: { browseGallery: 'Browse' },
      settings: {
        openAiCompatibleNotConfigured: 'Not configured',
        openAiCompatibleConfigureToUse: 'Configure endpoint',
      },
    },
  }),
}))

jest.mock('@/src/application/providers/auth.provider', () => ({
  useAuth: () => ({ user: { uid: 'doctor-1' }, isAnonymous: false, loading: false }),
}))

jest.mock('@/src/application/stores/chat.store', () => ({
  useIsTemporaryMode: () => false,
  useSetIsTemporaryMode: () => jest.fn(),
  useSetChatMessages: () => jest.fn(),
  useChatDataScope: () => 'patient',
  useSetChatDataScope: () => mockSetChatDataScope,
}))

jest.mock('@/src/application/stores/chat-history.store', () => ({
  useSetCurrentSessionId: () => jest.fn(),
}))

jest.mock('@/features/medical-chat/hooks/useAgentChat', () => ({
  useAgentChat: (...args: unknown[]) => {
    mockAgentDataScopes.push(String(args[4]))
    return {
      messages: mockMessages,
      isLoading: false,
      error: null,
      handleSend: jest.fn(),
      handleReset: mockResetChat,
      stopGeneration: jest.fn(),
    }
  },
}))

jest.mock('@/features/medical-chat/hooks/useFollowupSuggestions', () => ({
  useFollowupSuggestions: () => ({
    suggestions: [],
    generate: mockGenerateFollowups,
    clear: mockClearFollowups,
  }),
}))

jest.mock('@/src/application/hooks/chat/use-auto-save-chat.hook', () => ({
  useAutoSaveChat: ({ enabled }: { enabled: boolean }) => {
    mockAutoSaveEnabled.push(enabled)
    mockEvents.push(`autosave:${enabled}`)
    return { forceSave: mockForceSave, isSaving: false }
  },
}))

jest.mock('@/src/application/hooks/chat/use-smart-title-generation.hook', () => ({
  useSmartTitleGeneration: ({ enabled }: { enabled: boolean }) => {
    mockSmartTitleEnabled.push(enabled)
    mockEvents.push(`smart-title:${enabled}`)
  },
}))

jest.mock('@/src/shared/components/ModelPicker', () => ({
  ModelPicker: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <button
      type="button"
      data-testid="header-model-picker"
      onClick={() => onSelect('gemini-4-hydrogen')}
    >
      switch header model
    </button>
  ),
}))

jest.mock('@/src/shared/components/AiExecutionDiagnosticsDialog', () => ({
  AiExecutionDiagnosticsDialog: () => null,
}))

jest.mock('@/features/medical-chat/components/ChatToolbar', () => ({
  ChatToolbar: ({
    onModelSelect,
    showModelPicker,
    patientDataDisabled,
    canTogglePatientData,
    onTogglePatientData,
    onOpenGallery,
  }: {
    onModelSelect: (id: string) => void
    showModelPicker: boolean
    patientDataDisabled: boolean
    canTogglePatientData: boolean
    onTogglePatientData: () => void
    onOpenGallery: () => void
  }) => (
    <>
      <button onClick={onOpenGallery}>Browse</button>
      {canTogglePatientData && (
        <button
          type="button"
          data-testid="toolbar-patient-data-toggle"
          aria-pressed={patientDataDisabled}
          onClick={onTogglePatientData}
        >
          no chart
        </button>
      )}
      {showModelPicker && (
        <button
          type="button"
          data-testid="toolbar-model-picker"
          onClick={() => onModelSelect('gemini-4-hydrogen')}
        >
          switch toolbar model
        </button>
      )}
    </>
  ),
}))

jest.mock('@/src/shared/hooks/ui/use-expandable.hook', () => ({
  useExpandable: () => ({
    isExpanded: mockExpanded,
    toggle: jest.fn(),
    collapse: jest.fn(),
  }),
}))

jest.mock('@/features/medical-chat/hooks/useSystemPrompt', () => ({
  useSystemPrompt: () => ({
    systemPrompt: 'system',
    updateSystemPrompt: jest.fn(),
    resetSystemPrompt: jest.fn(),
    isCustomPrompt: false,
  }),
}))
jest.mock('@/features/medical-chat/hooks/useChatInput', () => ({
  useChatInput: () => ({
    input: '',
    clear: jest.fn(),
    setInput: jest.fn(),
    insertTextWithTrim: mockInsertTemplate,
  }),
}))
jest.mock('@/features/medical-chat/hooks/useImageUpload', () => ({
  useImageUpload: () => ({ images: [], clearImages: jest.fn() }),
}))
jest.mock('@/features/medical-chat/hooks/useVoiceRecording', () => ({
  useVoiceRecording: () => ({
    isRecording: false,
    isAsrLoading: false,
    asrError: null,
  }),
}))
jest.mock('@/features/medical-chat/hooks/useRecordingStatus', () => ({
  useRecordingStatus: () => ({ recordingStatusLabel: '' }),
}))
jest.mock('@/features/medical-chat/hooks/useTemplateSelector', () => ({
  useTemplateSelector: () => ({
    templates: [],
    selectedTemplate: null,
    selectedTemplateId: undefined,
    setSelectedTemplateId: jest.fn(),
  }),
}))
jest.mock('@/features/medical-chat/hooks/useApiKeyValidation', () => ({
  useApiKeyValidation: () => ({ hasApiKey: () => true }),
}))
jest.mock('@/features/medical-chat/hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: jest.fn(),
}))
jest.mock('@/features/medical-chat/hooks/useTextareaAutoResize', () => ({
  useTextareaAutoResize: jest.fn(),
}))

jest.mock('@/src/application/hooks/chat/use-fhir-context.hook', () => ({
  useFhirContext: () => ({ patientId: 'patient-1', fhirServerUrl: 'https://fhir.example' }),
}))
jest.mock('@/src/application/hooks/patient/use-patient-query.hook', () => ({
  usePatient: () => ({ patient: null, error: null }),
}))
jest.mock('@/src/application/hooks/clinical-data/use-clinical-data-query.hook', () => ({
  useClinicalData: () => ({ error: null }),
}))
jest.mock('@/src/application/providers/chat-templates.provider', () => ({
  useChatTemplates: () => mockUseChatTemplates(),
}))

jest.mock('@/features/medical-chat/components/ChatMessageList', () => ({ ChatMessageList: () => null }))
jest.mock('@/features/medical-chat/components/ChatHeader', () => ({ ChatHeader: () => null }))
jest.mock('@/features/medical-chat/components/ChatInputArea', () => ({ ChatInputArea: () => null }))
jest.mock('@/features/medical-chat/components/SuggestionChips', () => ({ SuggestionChips: () => null }))
jest.mock('@/features/medical-chat/components/ChatTemplatesManagerDrawer', () => ({
  ChatTemplatesManagerDrawer: () => null,
}))
jest.mock('@/src/shared/components/ExpandedOverlay', () => ({
  ExpandedOverlay: ({ content }: { content: React.ReactNode }) => <>{content}</>,
}))
jest.mock('@/features/chat-history', () => ({
  ChatHistoryDrawer: ({ persistenceEnabled }: { persistenceEnabled: boolean }) => {
    mockDrawerPersistenceEnabled.push(persistenceEnabled)
    mockEvents.push(`drawer:${persistenceEnabled}`)
    return null
  },
}))
jest.mock('@/features/prompt-gallery', () => ({
  PromptGalleryDialog: ({ open, onSelectPrompt }: { open: boolean; onSelectPrompt: (prompt: import('@/features/prompt-gallery').SharedPrompt, useAs: 'chat') => void }) => open ? (
    <button onClick={() => {
      const prompt = { id: 'same-source', title: 'Source prompt', prompt: 'Original source content' } as import('@/features/prompt-gallery').SharedPrompt
      onSelectPrompt(prompt, 'chat')
      onSelectPrompt(prompt, 'chat')
    }}>Use chat gallery twice</button>
  ) : null,
}))
jest.mock('@/features/auth', () => ({ AuthDialog: () => null }))

jest.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
jest.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  AlertDialogAction: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const profile: OpenAiCompatibleProfile = {
  profileId: 'legacy',
  enabled: true,
  baseUrl: 'https://hospital.example/v1',
  modelId: 'hospital-7b',
  apiKey: 'hospital-key',
  transport: 'direct',
  contextWindowTokens: 32768,
  contextWindowSource: 'manual',
  agentMode: 'auto',
  agentCapability: 'unknown',
  agentCapabilityTestedAt: null,
}

describe('MedicalChat model privacy boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUseChatTemplates.mockImplementation(() => ({ addTemplate: jest.fn(), updateTemplate: jest.fn(), saveTemplates: jest.fn(), maxTemplates: 10, templates: [] }))
    mockEvents.length = 0
    mockAutoSaveEnabled.length = 0
    mockDrawerPersistenceEnabled.length = 0
    mockSmartTitleEnabled.length = 0
    mockAgentDataScopes.length = 0
    mockExpanded = false
    mockMessages = [{ id: 'local-message', role: 'user', content: 'private local question' }]
    localStorage.clear()
    useAiConfigStore.setState({
      apiKey: null,
      geminiKey: null,
      claudeKey: null,
      openAiCompatibleProfiles: [profile],
    })
    useModelPrefsStore.setState({
      prefs: { chat: CUSTOM_OPENAI_MODEL_ID, insights: MODEL_PREF_DEFAULTS.insights },
    })
  })

  it('clears the local conversation before the header picker switches to cloud', async () => {
    const unsubscribe = useModelPrefsStore.subscribe((state) => {
      if (state.prefs.chat === MODEL_PREF_DEFAULTS.chat) mockEvents.push('select-model')
    })
    render(<MedicalChat />)

    expect(mockResetChat).not.toHaveBeenCalled()
    expect(mockAgentDataScopes[0]).toBe('patient')
    expect(mockAutoSaveEnabled[0]).toBe(false)
    expect(mockDrawerPersistenceEnabled[0]).toBe(false)
    expect(mockSmartTitleEnabled[0]).toBe(false)
    fireEvent.click(screen.getByTestId('header-model-picker'))

    await waitFor(() => expect(useModelPrefsStore.getState().prefs.chat).toBe(
      MODEL_PREF_DEFAULTS.chat,
    ))
    expect(mockEvents.indexOf('reset-chat')).toBeLessThan(
      mockEvents.indexOf('clear-followups'),
    )
    expect(mockEvents.indexOf('clear-followups')).toBeLessThan(
      mockEvents.indexOf('select-model'),
    )
    expect(mockResetChat).toHaveBeenCalledTimes(1)
    expect(mockMessages).toEqual([])
    expect(mockAutoSaveEnabled).toContain(true)
    expect(mockDrawerPersistenceEnabled).toContain(true)
    expect(mockSmartTitleEnabled).toContain(true)
    expect(mockAgentDataScopes).toContain('auto')
    unsubscribe()
  })

  it('routes the fullscreen toolbar picker through the same reset-before-switch callback', async () => {
    mockExpanded = true
    render(<MedicalChat />)

    fireEvent.click(screen.getByTestId('toolbar-model-picker'))

    await waitFor(() => expect(useModelPrefsStore.getState().prefs.chat).toBe(
      MODEL_PREF_DEFAULTS.chat,
    ))
    expect(mockResetChat).toHaveBeenCalledTimes(1)
    expect(mockClearFollowups).toHaveBeenCalled()
  })

  it('changes to a patient-free boundary only when the user enables the badge', () => {
    render(<MedicalChat />)

    const toggle = screen.getByTestId('toolbar-patient-data-toggle')
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(mockAgentDataScopes[0]).toBe('patient')

    fireEvent.click(toggle)

    expect(mockSetChatDataScope).toHaveBeenLastCalledWith('general')
    expect(mockClearFollowups).toHaveBeenCalled()
  })

  it('does not clear on mount but clears when the selected custom destination changes externally', async () => {
    render(<MedicalChat />)
    expect(mockResetChat).not.toHaveBeenCalled()

    act(() => {
      useAiConfigStore.setState({
        openAiCompatibleProfiles: [{
          ...profile,
          baseUrl: 'https://replacement.example/v1',
        }],
      })
    })

    await waitFor(() => expect(mockResetChat).toHaveBeenCalledTimes(1))
    expect(mockClearFollowups).toHaveBeenCalled()
  })

  it('clears when only the custom credential is replaced without exposing it in identity', async () => {
    render(<MedicalChat />)
    expect(mockResetChat).not.toHaveBeenCalled()

    act(() => {
      useAiConfigStore.setState({
        openAiCompatibleProfiles: [{
          ...profile,
          apiKey: 'replacement-secret',
        }],
      })
    })

    await waitFor(() => expect(mockResetChat).toHaveBeenCalledTimes(1))
    expect(medicalChatRuntimeIdentity(CUSTOM_OPENAI_MODEL_ID, {
      ...profile,
      apiKey: 'replacement-secret',
    })).toBe(medicalChatRuntimeIdentity(CUSTOM_OPENAI_MODEL_ID, profile))
  })

  it('keeps cloud history disabled until an external custom-to-cloud cleanup finishes', async () => {
    render(<MedicalChat />)
    expect(mockResetChat).not.toHaveBeenCalled()
    mockEvents.length = 0

    act(() => {
      useModelPrefsStore.setState({
        prefs: {
          ...useModelPrefsStore.getState().prefs,
          chat: MODEL_PREF_DEFAULTS.chat,
        },
      })
    })

    await waitFor(() => expect(mockAutoSaveEnabled).toContain(true))
    const resetIndex = mockEvents.indexOf('reset-chat')
    const enableHistoryIndex = mockEvents.indexOf('autosave:true')
    const enableDrawerIndex = mockEvents.indexOf('drawer:true')
    const enableSmartTitleIndex = mockEvents.indexOf('smart-title:true')
    expect(resetIndex).toBeGreaterThanOrEqual(0)
    expect(enableHistoryIndex).toBeGreaterThan(resetIndex)
    expect(enableDrawerIndex).toBeGreaterThan(resetIndex)
    expect(enableSmartTitleIndex).toBeGreaterThan(resetIndex)
    expect(mockEvents.slice(0, resetIndex)).not.toContain('autosave:true')
    expect(mockEvents.slice(0, resetIndex)).not.toContain('drawer:true')
    expect(mockEvents.slice(0, resetIndex)).not.toContain('smart-title:true')
    expect(mockResetChat).toHaveBeenCalledTimes(1)
  })

  it('includes every custom destination and execution-mode field in runtime identity', () => {
    const base = medicalChatRuntimeIdentity(CUSTOM_OPENAI_MODEL_ID, profile)
    expect(medicalChatRuntimeIdentity(CUSTOM_OPENAI_MODEL_ID, {
      ...profile,
      profileId: 'other-profile',
    })).not.toBe(base)
    expect(medicalChatRuntimeIdentity(CUSTOM_OPENAI_MODEL_ID, {
      ...profile,
      baseUrl: 'https://other.example/v1',
    })).not.toBe(base)
    expect(medicalChatRuntimeIdentity(CUSTOM_OPENAI_MODEL_ID, {
      ...profile,
      modelId: 'hospital-14b',
    })).not.toBe(base)
    expect(medicalChatRuntimeIdentity(CUSTOM_OPENAI_MODEL_ID, {
      ...profile,
      transport: 'mediprisma-gateway',
    })).not.toBe(base)
    expect(medicalChatRuntimeIdentity(CUSTOM_OPENAI_MODEL_ID, {
      ...profile,
      agentCapability: 'verified',
      agentCapabilityTestedAt: 1_721_234_567_890,
    })).not.toBe(base)
    expect(medicalChatRuntimeIdentity(CUSTOM_OPENAI_MODEL_ID, {
      ...profile,
      apiKey: 'different-secret',
    })).toBe(base)
    // Cloud models deliberately share ONE identity: switching among them is
    // the same trust domain, so it must not clear the conversation.
    expect(medicalChatRuntimeIdentity('gemini-3.1-flash-lite', null)).toBe(
      JSON.stringify(['cloud']),
    )
    expect(medicalChatRuntimeIdentity('gpt-5-nano', null)).toBe(
      medicalChatRuntimeIdentity('gemini-3.1-flash-lite', null),
    )
  })

  it('keeps the conversation when switching between cloud models', async () => {
    useModelPrefsStore.setState({
      prefs: { chat: MODEL_PREF_DEFAULTS.chat, insights: MODEL_PREF_DEFAULTS.insights },
    })
    render(<MedicalChat />)
    expect(mockResetChat).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('header-model-picker'))

    await waitFor(() => expect(useModelPrefsStore.getState().prefs.chat).toBe(
      'gemini-4-hydrogen',
    ))
    // No privacy boundary was crossed: the transcript (and any in-flight
    // stream) survives an ordinary cloud→cloud picker change.
    expect(mockResetChat).not.toHaveBeenCalled()
    expect(mockMessages).toEqual([
      { id: 'local-message', role: 'user', content: 'private local question' },
    ])
  })
  it.each([false, true])('gallery duplicate selections insert only once in expanded=%s', async expanded => {
    mockExpanded = expanded
    const real = jest.requireActual<typeof import('@/src/application/providers/chat-templates.provider')>('@/src/application/providers/chat-templates.provider')
    mockAccountTemplates = [{ id: 'existing', label: 'Existing', content: 'Existing', audience: 'medical', order: 0 }]
    mockUseChatTemplates.mockImplementation(real.useChatTemplates)
    render(<real.ChatTemplatesProvider><MedicalChat /></real.ChatTemplatesProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use chat gallery twice' }))
    if (screen.queryByRole('button', { name: '知道了' })) fireEvent.click(screen.getByRole('button', { name: '知道了' }))
    await waitFor(() => expect(mockAccountTemplates.filter(t => t.sourcePromptKey)).toHaveLength(1))
    expect(mockInsertTemplate).toHaveBeenCalledTimes(1)
    expect(mockInsertTemplate).toHaveBeenLastCalledWith('Original source content')
    const saved = mockAccountTemplates.find(t => t.sourcePromptKey)!
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use chat gallery twice' }))
    if (screen.queryByRole('button', { name: '知道了' })) fireEvent.click(screen.getByRole('button', { name: '知道了' }))
    await waitFor(() => expect(mockInsertTemplate).toHaveBeenCalledTimes(1))
    expect(mockAccountTemplates.filter(t => t.sourcePromptKey)).toEqual([saved])
  })

})
