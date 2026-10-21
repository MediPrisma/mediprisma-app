import { fireEvent, render, screen } from '@testing-library/react'
import {
  RightPanelProvider,
  useRightPanel,
} from '@/src/application/providers/right-panel.provider'

function NavigationHarness() {
  const {
    activeTab,
    settingsTab,
    settingsTarget,
    setActiveTab,
    clearSettingsTarget,
  } = useRightPanel()

  return (
    <div>
      <output data-testid="active-tab">{activeTab}</output>
      <output data-testid="settings-tab">{settingsTab}</output>
      <output data-testid="settings-target">
        {settingsTarget && typeof settingsTarget === 'object'
          ? `${settingsTarget.kind}:${settingsTarget.profileId ?? ''}`
          : settingsTarget ?? 'none'}
      </output>
      <button type="button" onClick={() => setActiveTab('settings', 'display')}>
        Open display
      </button>
      <button
        type="button"
        onClick={() => setActiveTab(
          'settings',
          undefined,
          'openai-compatible-context-window',
        )}
      >
        Open context window
      </button>
      <button
        type="button"
        onClick={() => setActiveTab('settings', 'ai', {
          kind: 'openai-compatible-context-window',
          profileId: 'profile-2',
        })}
      >
        Open profile context window
      </button>
      <button
        type="button"
        onClick={() => setActiveTab(
          'settings',
          'ai',
          'openai-compatible-add-profile',
        )}
      >
        Add custom model
      </button>
      <button type="button" onClick={clearSettingsTarget}>Clear target</button>
    </div>
  )
}

describe('RightPanelProvider settings navigation target', () => {
  it('keeps legacy two-argument navigation and supports a clearable third target', () => {
    render(
      <RightPanelProvider>
        <NavigationHarness />
      </RightPanelProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open display' }))
    expect(screen.getByTestId('active-tab')).toHaveTextContent('settings')
    expect(screen.getByTestId('settings-tab')).toHaveTextContent('display')
    expect(screen.getByTestId('settings-target')).toHaveTextContent('none')

    fireEvent.click(screen.getByRole('button', { name: 'Open context window' }))
    expect(screen.getByTestId('settings-tab')).toHaveTextContent('ai')
    expect(screen.getByTestId('settings-target')).toHaveTextContent(
      'openai-compatible-context-window',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open profile context window' }))
    expect(screen.getByTestId('settings-target')).toHaveTextContent(
      'openai-compatible-context-window:profile-2',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add custom model' }))
    expect(screen.getByTestId('settings-tab')).toHaveTextContent('ai')
    expect(screen.getByTestId('settings-target')).toHaveTextContent(
      'openai-compatible-add-profile',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Clear target' }))
    expect(screen.getByTestId('settings-target')).toHaveTextContent('none')
  })
})

function RevealHarness() {
  const { activeTab, exportTab, revealSeq, revealTab, setExportTab } = useRightPanel()
  return (
    <div>
      <output data-testid="active-tab">{activeTab}</output>
      <output data-testid="export-tab">{exportTab}</output>
      <output data-testid="reveal-seq">{revealSeq}</output>
      <button type="button" onClick={() => setExportTab('ai')}>Leave on AI</button>
      <button type="button" onClick={() => revealTab('ips-export')}>Reveal export</button>
      <button type="button" onClick={() => revealTab('ips-export', { exportTab: 'emr' })}>Reveal EMR handoff</button>
      <button type="button" onClick={() => revealTab('medical-chat', { exportTab: 'institution' })}>Reveal chat</button>
    </div>
  )
}

describe('RightPanelProvider reveal with a 複製 sub-tab', () => {
  it('starts 複製 on 帶回紀錄 and opens the sub-tab a reveal asks for', () => {
    render(<RightPanelProvider><RevealHarness /></RightPanelProvider>)
    expect(screen.getByTestId('export-tab')).toHaveTextContent('emr')

    fireEvent.click(screen.getByRole('button', { name: 'Leave on AI' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reveal export' }))
    expect(screen.getByTestId('active-tab')).toHaveTextContent('ips-export')
    expect(screen.getByTestId('export-tab')).toHaveTextContent('ai')
    expect(screen.getByTestId('reveal-seq')).toHaveTextContent('1')

    fireEvent.click(screen.getByRole('button', { name: 'Reveal EMR handoff' }))
    expect(screen.getByTestId('export-tab')).toHaveTextContent('emr')
    expect(screen.getByTestId('reveal-seq')).toHaveTextContent('2')
  })

  it('ignores a 複製 sub-tab passed with another tab', () => {
    render(<RightPanelProvider><RevealHarness /></RightPanelProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Reveal chat' }))
    expect(screen.getByTestId('active-tab')).toHaveTextContent('medical-chat')
    expect(screen.getByTestId('export-tab')).toHaveTextContent('emr')
  })
})
