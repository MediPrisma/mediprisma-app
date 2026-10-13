/** @jest-environment jsdom */
// 開藥注意: one neutral list ordered most important first, no severity badge,
// the first three open and the rest behind one control. Synthetic alerts.
import { fireEvent, render, screen } from '@testing-library/react'
import { MedicationSafetySection } from '@/features/medical-summary/components/MedicationSafetySection'
import type { SafetyAlert } from '@/src/core/entities/safety-alert.entity'
import { resolveKeyMentions, type KeyMentionSource } from '@/src/core/utils/key-mentions.utils'

const alert = (id: string, severity: 'high' | 'medium' | 'low', title: string): SafetyAlert => ({
  id, severity, category: 'interaction', title, detail: `${title} detail`, sources: [],
} as unknown as SafetyAlert)

const renderSection = (alerts: SafetyAlert[]) => render(
  <MedicationSafetySection
    alerts={alerts}
    title="開藥注意"
    moreLabel="顯示其餘 {count} 項"
    lessLabel="收合"
    disclaimer="AI 掃描，僅供參考"
    emptyLabel="未發現明顯安全風險。"
  />,
)

describe('MedicationSafetySection', () => {
  it('says so when a finished scan found nothing, instead of disappearing', () => {
    const { container } = renderSection([])
    expect(screen.getByRole('heading', { name: '開藥注意' })).toBeInTheDocument()
    expect(screen.getByText('未發現明顯安全風險。')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-safety-alerts] li')).toHaveLength(0)
    expect(container.querySelector('[data-safety-updating]')).toBeNull()
  })

  it('marks a rescan running over the alerts already on screen', () => {
    render(
      <MedicationSafetySection
        alerts={[alert('m1', 'medium', 'Synthetic B')]}
        title="開藥注意"
        moreLabel="顯示其餘 {count} 項"
        lessLabel="收合"
        disclaimer="AI 掃描，僅供參考"
        emptyLabel="未發現明顯安全風險。"
        updating
        updatingLabel="AI 掃描中…"
      />,
    )
    expect(screen.getByRole('status', { name: 'AI 掃描中…' })).toBeInTheDocument()
    expect(screen.getByText('Synthetic B')).toBeInTheDocument()
    expect(screen.queryByText('未發現明顯安全風險。')).toBeNull()
  })

  it('lists alerts in the given order with no severity badge, three open', () => {
    const { container } = renderSection([
      alert('h1', 'high', 'Synthetic A'),
      alert('m1', 'medium', 'Synthetic B'),
      alert('m2', 'medium', 'Synthetic C'),
      alert('l1', 'low', 'Synthetic D'),
    ])
    expect(screen.getByRole('heading', { name: '開藥注意' })).toBeInTheDocument()
    expect([...container.querySelectorAll('[data-safety-alerts] li p:first-child')].map((n) => n.textContent))
      .toEqual(['Synthetic A', 'Synthetic B', 'Synthetic C'])
    expect(screen.queryByText(/高危|High/)).toBeNull()
    expect(container.querySelector('[class*="red-"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '顯示其餘 1 項' }))
    expect(screen.getByText('Synthetic D')).toBeInTheDocument()
  })

  it('shows no fold control for three alerts or fewer', () => {
    renderSection([alert('m1', 'medium', 'Synthetic B')])
    expect(screen.queryByRole('button')).toBeNull()
  })
  it('labels an alert resting only on year-old records, and hides nothing', () => {
    render(
      <MedicationSafetySection
        alerts={[alert('old', 'high', 'Synthetic old BP'), alert('new', 'medium', 'Synthetic recent lab')]}
        title="開藥注意"
        moreLabel="顯示其餘 {count} 項"
        lessLabel="收合"
        disclaimer="AI 掃描，僅供參考"
        emptyLabel="未發現明顯安全風險。"
        staleEvidenceDate={(item) => (item.id === 'old' ? '2022-11-07' : undefined)}
        staleEvidenceLabel="依據資料已逾 1 年（{date}）"
      />,
    )
    expect(screen.getByText('Synthetic old BP')).toHaveTextContent('依據資料已逾 1 年（2022-11-07）')
    expect(screen.getByText('Synthetic recent lab')).not.toHaveTextContent('逾 1 年')
  })

  it('labels an alert that calls a medicine anticholinergic against its mechanism, and hides nothing', () => {
    render(
      <MedicationSafetySection
        alerts={[alert('ac', 'medium', 'Synthetic anticholinergic burden')]}
        title="開藥注意"
        moreLabel="顯示其餘 {count} 項"
        lessLabel="收合"
        disclaimer="AI 掃描，僅供參考"
        emptyLabel="未發現明顯安全風險。"
        propertyReviewLabel={() => '待核對：mirabegron 未列為抗膽鹼藥'}
      />,
    )
    expect(screen.getByText('Synthetic anticholinergic burden')).toHaveTextContent('待核對：mirabegron 未列為抗膽鹼藥')
    expect(screen.getByText('Synthetic anticholinergic burden detail')).toBeInTheDocument()
  })

  it('writes keys in the prose as the records they name, and lets those open them', () => {
    const sources: Record<string, KeyMentionSource> = {
      M8: { key: 'M8', resourceType: 'MedicationRequest', display: 'SYN-NAPRO 250MG', medicationClass: 'naproxen · M01A ANTIINFLAMMATORY' },
      M11: { key: 'M11', resourceType: 'MedicationRequest', display: 'SYN-IBU 400MG', medicationClass: 'ibuprofen · M01A ANTIINFLAMMATORY' },
      E10: { key: 'E10', resourceType: 'Encounter', date: '2025-09-14' },
    }
    const opened: string[][] = []
    const { container } = render(
      <MedicationSafetySection
        alerts={[{
          id: 'gi', severity: 'high', category: 'interaction',
          title: 'NSAIDs (M8, M11) with ulcer history',
          detail: 'Recent NSAID use (M8, M11) with ulcer history (E10).',
          recommendation: 'Review NSAID need; see visit E10.',
          sources: ['M8', 'M11', 'E10'],
        } as unknown as SafetyAlert]}
        title="開藥注意"
        moreLabel="顯示其餘 {count} 項"
        lessLabel="收合"
        disclaimer="AI 掃描，僅供參考"
        emptyLabel="未發現明顯安全風險。"
        renderSources={(keys, _unsupported, children) => (
          <button type="button" data-keys={keys.join(',')} onClick={() => opened.push(keys)}>{children}</button>
        )}
        resolveMentions={(text, cited) => resolveKeyMentions(text, cited, (key) => sources[key], 'en')}
      />,
    )
    const item = container.querySelector('[data-safety-alerts] li')!
    expect(item.textContent).not.toMatch(/\b(M8|M11|E10)\b/)
    // The title is one link already: its mentions read plain.
    expect(screen.getByRole('button', { name: 'NSAIDs (Naproxen, Ibuprofen) with ulcer history' }))
      .toHaveAttribute('data-keys', 'M8,M11,E10')
    expect(screen.getByText(/^Recent NSAID use/)).toHaveTextContent(
      'Recent NSAID use (Naproxen, Ibuprofen) with ulcer history (visit 2025-09-14).',
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'visit 2025-09-14' })[0])
    expect(opened).toEqual([['E10']])
    expect(screen.getAllByRole('button', { name: 'Naproxen, Ibuprofen' })[0]).toHaveAttribute('data-keys', 'M8,M11')
  })
})
