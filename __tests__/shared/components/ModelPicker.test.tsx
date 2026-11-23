import { useRef, useState, type MouseEventHandler, type ReactNode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ModelPicker } from '@/src/shared/components/ModelPicker'
import { LanguageProvider } from '@/src/application/providers/language.provider'
import {
  RightPanelProvider,
  useRightPanel,
} from '@/src/application/providers/right-panel.provider'
import { useAiConfigStore } from '@/src/application/stores/ai-config.store'
import { customOpenAiModelIdForProfile } from '@/src/shared/constants/ai-models.constants'

jest.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({
    children,
    open,
    onOpenChange,
  }: {
    children: ReactNode
    open?: boolean
    onOpenChange?: (open: boolean) => void
  }) => (
    <div data-testid="model-picker-menu" data-open={String(Boolean(open))}>
      <button type="button" onClick={() => onOpenChange?.(!open)}>toggle menu</button>
      {children}
    </div>
  ),
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div role="menu">{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    disabled,
    onClick,
    title,
    'data-testid': testId,
    'aria-label': ariaLabel,
  }: {
    children: ReactNode
    disabled?: boolean
    onClick?: MouseEventHandler<HTMLButtonElement>
    title?: string
    'data-testid'?: string
    'aria-label'?: string
  }) => (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      title={title}
      data-testid={testId}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  ),
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
}))

function NavigationProbe() {
  const { activeTab, settingsTab, settingsTarget } = useRightPanel()
  return (
    <output data-testid="settings-navigation">
      {`${activeTab}|${settingsTab}|${settingsTarget ?? 'none'}`}
    </output>
  )
}

function ControlledPicker() {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button
        type="button"
        onClick={() => {
          triggerRef.current?.focus()
          setOpen(true)
        }}
      >
        reveal picker
      </button>
      <ModelPicker
        modelId="gemini-3.1-flash-lite"
        fallbackModelId="gemini-3.1-flash-lite"
        onSelect={jest.fn()}
        open={open}
        onOpenChange={setOpen}
        triggerRef={triggerRef}
      />
    </>
  )
}

describe('ModelPicker custom model management entry', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    useAiConfigStore.setState({
      apiKey: null,
      geminiKey: null,
      claudeKey: null,
      credentialsHydrating: false,
      openAiCompatibleProfiles: [{
        profileId: 'hospital-7b',
        enabled: true,
        baseUrl: 'https://models.example.org/v1/chat/completions',
        modelId: 'hospital/qwen-7b',
        apiKey: 'test-key',
        transport: 'direct',
        contextWindowTokens: 32768,
        contextWindowSource: 'manual',
      }],
    })
  })

  it('keeps a separate add entry after a custom endpoint is configured', () => {
    const onSelect = jest.fn()

    render(
      <LanguageProvider>
        <RightPanelProvider>
          <ModelPicker
            modelId={customOpenAiModelIdForProfile('hospital-7b')}
            fallbackModelId="gemini-3.1-flash-lite"
            onSelect={onSelect}
          />
          <NavigationProbe />
        </RightPanelProvider>
      </LanguageProvider>,
    )

    expect(screen.getAllByText('hospital/qwen-7b').length).toBeGreaterThan(0)
    const addEntry = screen.getByTestId('model-picker-add-custom-model')
    expect(addEntry).toHaveAccessibleName('新增自訂模型')

    fireEvent.click(addEntry)

    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByTestId('settings-navigation')).toHaveTextContent(
      'settings|ai|openai-compatible-add-profile',
    )
  })

  it('can be revealed and focused by a recovery action', () => {
    render(
      <LanguageProvider>
        <RightPanelProvider>
          <ControlledPicker />
        </RightPanelProvider>
      </LanguageProvider>,
    )

    expect(screen.getByTestId('model-picker-menu')).toHaveAttribute('data-open', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'reveal picker' }))

    expect(screen.getByTestId('model-picker-menu')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('model-picker-trigger')).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'toggle menu' }))
    expect(screen.getByTestId('model-picker-menu')).toHaveAttribute('data-open', 'false')
  })

  it('can keep an unavailable raw selection visible for blocking recovery flows', () => {
    render(
      <LanguageProvider>
        <RightPanelProvider>
          <ModelPicker
            modelId="gpt-6.1-terra"
            fallbackModelId="gemini-3.1-flash-lite"
            onSelect={jest.fn()}
            preserveSelection
          />
        </RightPanelProvider>
      </LanguageProvider>,
    )

    expect(screen.getByTestId('model-picker-trigger')).toHaveTextContent('GPT-6.1 Terra')
  })

  it('can lock model selection while its feature is running', () => {
    render(
      <LanguageProvider>
        <RightPanelProvider>
          <ModelPicker
            modelId="gemini-3.1-flash-lite"
            fallbackModelId="gemini-3.1-flash-lite"
            onSelect={jest.fn()}
            disabled
          />
        </RightPanelProvider>
      </LanguageProvider>,
    )

    expect(screen.getByTestId('model-picker-trigger')).toBeDisabled()
  })

  it('updates the standard-chat badge from the selected custom profile capability', () => {
    const modelId = customOpenAiModelIdForProfile('hospital-7b')
    render(
      <LanguageProvider>
        <RightPanelProvider>
          <ModelPicker
            modelId={modelId}
            fallbackModelId="gemini-3.1-flash-lite"
            onSelect={jest.fn()}
            agentModeActive
          />
        </RightPanelProvider>
      </LanguageProvider>,
    )

    expect(screen.getAllByText('標準對話').length).toBeGreaterThan(0)

    act(() => {
      useAiConfigStore.setState((state) => ({
        openAiCompatibleProfiles: state.openAiCompatibleProfiles.map((profile) => ({
          ...profile,
          agentMode: 'auto',
          agentCapability: 'verified',
          agentCapabilityTestedAt: 1_721_234_567_890,
        })),
      }))
    })

    expect(screen.queryByText('標準對話')).not.toBeInTheDocument()
  })
})
