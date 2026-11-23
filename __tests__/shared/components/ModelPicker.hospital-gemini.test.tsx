// 院內 Gemini in the shared model picker, with a fake 北榮懷爾抓抓 status reply.
// Synthetic only: no extension, no Gemini page.
import type { MouseEventHandler, ReactNode } from 'react'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { useModelSelection } from '@/src/application/hooks/useModelSelection'
import { HOSPITAL_GEMINI_SIGN_IN_URL } from '@/src/infrastructure/ai/hospital-gemini/hospital-gemini-bridge'
import { ModelPicker } from '@/src/shared/components/ModelPicker'
import { LanguageProvider } from '@/src/application/providers/language.provider'
import { RightPanelProvider } from '@/src/application/providers/right-panel.provider'
import { useAiConfigStore } from '@/src/application/stores/ai-config.store'
import { resetHospitalGeminiStatus } from '@/src/application/hooks/use-hospital-gemini-status.hook'
import { HOSPITAL_GEMINI_MODEL_ID } from '@/src/shared/constants/ai-models.constants'
import { AiService } from '@/src/infrastructure/ai/services/ai.service'
import { apiKeyForModel, hasDirectModelAccess } from '@/src/shared/utils/model-access.utils'
import { showHospitalGeminiFailure } from '@/src/application/composition.ai'
import { toast } from 'sonner'

const mockToast = toast as unknown as { error: jest.Mock; success: jest.Mock }

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))

jest.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children, onOpenChange }: { children: ReactNode; onOpenChange?: (open: boolean) => void }) => (
    <div>
      <button type="button" onClick={() => onOpenChange?.(true)}>open menu</button>
      {children}
    </div>
  ),
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div role="menu">{children}</div>,
  DropdownMenuItem: ({ children, disabled, onClick }: {
    children: ReactNode; disabled?: boolean; onClick?: MouseEventHandler<HTMLButtonElement>
  }) => <button type="button" role="menuitem" disabled={disabled} onClick={onClick}>{children}</button>,
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
}))

const statusReply = jest.fn()

function installExtension(status: string | null) {
  statusReply.mockImplementation(() => status === null ? { ok: false, error: 'UNTRUSTED_ORIGIN' } : { ok: true, status, busy: false })
  ;(globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      sendMessage: (_id: string, _message: unknown, reply: (response: unknown) => void) => reply(statusReply()),
      connect: jest.fn(),
    },
  }
}

function renderPicker(onSelect = jest.fn()) {
  render(
    <LanguageProvider>
      <RightPanelProvider>
        <ModelPicker modelId="gemini-3.1-flash-lite" fallbackModelId="gemini-3.1-flash-lite" onSelect={onSelect} />
      </RightPanelProvider>
    </LanguageProvider>,
  )
  return onSelect
}

const hospitalItem = () => screen.queryByRole('menuitem', { name: /Gemini Enterprise（院內）/ })

describe('院內 Gemini in ModelPicker', () => {
  beforeEach(() => {
    resetHospitalGeminiStatus()
    statusReply.mockReset()
    useAiConfigStore.setState({ apiKey: null, geminiKey: null, claudeKey: null, credentialsHydrating: false, openAiCompatibleProfiles: [] })
  })
  afterEach(() => { delete (globalThis as { chrome?: unknown }).chrome })

  it('does not exist without the extension', async () => {
    renderPicker()
    await act(async () => {})
    expect(hospitalItem()).toBeNull()
  })

  it.each([['disabled'], [null]])('stays hidden when the extension answers %s', async (status) => {
    installExtension(status)
    renderPicker()
    await waitFor(() => expect(statusReply).toHaveBeenCalled())
    expect(hospitalItem()).toBeNull()
  })

  it.each(['no_tab', 'needs_login'])('is grey with the sign-in hint when %s', async (status) => {
    installExtension(status)
    const onSelect = renderPicker()
    await waitFor(() => expect(hospitalItem()).not.toBeNull())
    expect(hospitalItem()).toBeDisabled()
    expect(hospitalItem()).toHaveTextContent('請先開啟並登入院內 Gemini')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('can be picked when ready, and re-checks when the menu opens', async () => {
    installExtension('needs_login')
    const onSelect = renderPicker()
    await waitFor(() => expect(hospitalItem()).toBeDisabled())

    // The clinician signs in, then opens the menu again (after the short rate limit).
    installExtension('ready')
    const now = Date.now()
    jest.spyOn(Date, 'now').mockReturnValue(now + 3_000)
    fireEvent.click(screen.getByRole('button', { name: 'open menu' }))
    await waitFor(() => expect(hospitalItem()).toBeEnabled())
    expect(hospitalItem()).not.toHaveTextContent('請先開啟並登入')
    fireEvent.click(hospitalItem()!)
    expect(onSelect).toHaveBeenCalledWith(HOSPITAL_GEMINI_MODEL_ID)
    jest.restoreAllMocks()
  })
})

describe('院內 Gemini sign-in shortcut', () => {
  beforeEach(() => {
    resetHospitalGeminiStatus()
    statusReply.mockReset()
    mockToast.error.mockClear()
    useAiConfigStore.setState({ apiKey: null, geminiKey: null, claudeKey: null, credentialsHydrating: false, openAiCompatibleProfiles: [] })
  })
  afterEach(() => {
    delete (globalThis as { chrome?: unknown }).chrome
    jest.restoreAllMocks()
  })

  const signInLink = () => screen.queryByRole('link', { name: '開啟院內 Gemini' })

  it('sits under the locked entry, opens the sign-in page in a new tab and never selects the model', async () => {
    installExtension('needs_login')
    const onSelect = renderPicker()
    await waitFor(() => expect(signInLink()).not.toBeNull())
    expect(signInLink()).toHaveAttribute('href', HOSPITAL_GEMINI_SIGN_IN_URL)
    expect(signInLink()).toHaveAttribute('target', '_blank')
    expect(signInLink()).toHaveAttribute('rel', 'noopener noreferrer')
    fireEvent.click(signInLink()!)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('is gone once 院內 Gemini is ready', async () => {
    installExtension('ready')
    renderPicker()
    await waitFor(() => expect(hospitalItem()).toBeEnabled())
    expect(signInLink()).toBeNull()
  })

  it('looks again when the clinician comes back to this tab, lifting the lock without reopening the menu', async () => {
    installExtension('no_tab')
    renderPicker()
    await waitFor(() => expect(hospitalItem()).toBeDisabled())
    installExtension('ready')
    const now = Date.now()
    jest.spyOn(Date, 'now').mockReturnValue(now + 3_000)
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await waitFor(() => expect(hospitalItem()).toBeEnabled())

    // A window focus also looks again (after the same 2-second rate limit).
    installExtension('needs_login')
    jest.spyOn(Date, 'now').mockReturnValue(now + 6_000)
    act(() => { window.dispatchEvent(new Event('focus')) })
    await waitFor(() => expect(hospitalItem()).toBeDisabled())
  })

  it('puts the same link on the toast shown when the locked entry is chosen', async () => {
    installExtension('needs_login')
    const open = jest.spyOn(window, 'open').mockImplementation(() => null)
    const setModel = jest.fn()
    const { result } = renderHook(() => useModelSelection(null, null, null, 'gemini-3.1-flash-lite', setModel), {
      wrapper: ({ children }: { children: ReactNode }) => <LanguageProvider>{children}</LanguageProvider>,
    })
    await waitFor(() => expect(result.current.geminiModels.find((entry) => entry.id === HOSPITAL_GEMINI_MODEL_ID)?.isLocked).toBe(true))
    act(() => result.current.handleSelectModel(HOSPITAL_GEMINI_MODEL_ID))
    expect(setModel).not.toHaveBeenCalled()
    const [message, options] = mockToast.error.mock.calls.at(-1)!
    expect(message).toBe('請先開啟並登入院內 Gemini')
    expect(options.action.label).toBe('開啟院內 Gemini')
    options.action.onClick()
    expect(open).toHaveBeenCalledWith(HOSPITAL_GEMINI_SIGN_IN_URL, '_blank', 'noopener,noreferrer')
  })
})

describe('院內 Gemini failure toast', () => {
  it('offers 複製提示 with the whole prompt', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    showHospitalGeminiFailure({ message: '院內 Gemini 分頁在回答途中被切換到其他頁面，回答未完成。', prompt: 'Synthetic chart\n\nQ' })
    const [message, options] = mockToast.error.mock.calls[0]
    expect(message).toMatch(/切換到其他頁面/)
    expect(options.action.label).toBe('複製提示')
    options.action.onClick()
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Synthetic chart\n\nQ'))
    await waitFor(() => expect(mockToast.success).toHaveBeenCalled())
  })
})

describe('院內 Gemini access and non-streaming route', () => {
  it('needs no provider key and never sends the Gemini API key', () => {
    expect(hasDirectModelAccess(HOSPITAL_GEMINI_MODEL_ID, {})).toBe(true)
    expect(apiKeyForModel(HOSPITAL_GEMINI_MODEL_ID, { geminiKey: 'synthetic-key' })).toBeNull()
  })

  it('answers custom summaries through the extension, not the Gemini cloud service', async () => {
    const posted: unknown[] = []
    let emit: (message: unknown) => void = () => {}
    ;(globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        sendMessage: jest.fn(),
        connect: () => ({
          postMessage: (message: unknown) => {
            posted.push(message)
            if ((message as { action?: string }).action === 'ask') queueMicrotask(() => emit({ type: 'done', markdown: 'Synthetic summary', sessionId: 's-3' }))
          },
          disconnect: () => {},
          onMessage: { addListener: (listener: (message: unknown) => void) => { emit = listener } },
          onDisconnect: { addListener: () => {} },
        }),
      },
    }
    const cloud = { isAvailable: () => true, query: jest.fn() }
    const service = new AiService({ cloudServices: { openai: cloud, gemini: cloud, claude: cloud }, createCustomService: () => cloud })
    const result = await service.query({ modelId: HOSPITAL_GEMINI_MODEL_ID, messages: [
      { role: 'system', content: 'Synthetic chart' }, { role: 'user', content: 'Custom summary task' },
    ] })
    expect(result.text).toBe('Synthetic summary')
    expect(result.metadata.modelExecution?.actualModelId).toBe(HOSPITAL_GEMINI_MODEL_ID)
    expect(posted).toEqual([{ action: 'ask', prompt: 'Synthetic chart\n\nCustom summary task' }])
    expect(cloud.query).not.toHaveBeenCalled()
    delete (globalThis as { chrome?: unknown }).chrome
  })
})
