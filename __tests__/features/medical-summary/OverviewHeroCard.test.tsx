/** @jest-environment jsdom */
// 初診快覽 hero: the headline and its copy button only. 開藥前必看 (and its
// app-derived allergy row) was retired on 2026-10-02; safety alerts moved to
// 開藥注意 after 影像與病理重點.
import { fireEvent, render, screen } from '@testing-library/react'
import { OverviewHeroCard } from '@/features/medical-summary/components/OverviewHeroCard'
import type { MedicalSummaryResult } from '@/src/core/entities/medical-summary.entity'

const mockCopy = jest.fn(async () => true)
jest.mock('@/src/shared/hooks/use-copy-to-clipboard', () => ({
  useCopyToClipboard: () => ({ copied: false, copy: mockCopy }),
}))

const result = {
  headline: '94 歲男性，跨院慢性病照護',
  problems: [],
  medicationEducation: [],
  sourceIndex: [],
} as MedicalSummaryResult

const renderCard = (reviewLabel?: string, reviewUnavailable = false) => render(
  <OverviewHeroCard
    result={result}
    title="初診快覽"
    dataRange="健保雲端 · 至 2026-08-27"
    copyLabel="複製"
    copiedLabel="已複製"
    copyFailedLabel="複製失敗"
    reviewButtonLabel="摘要核對"
    reviewDescription="未對應不代表內容有誤，請回查原始紀錄確認。"
    reviewLabel={reviewLabel}
    reviewUnavailable={reviewUnavailable}
  />,
)

describe('OverviewHeroCard', () => {
  it('shows the headline and the copy button, and nothing of the retired checklist', () => {
    renderCard()
    expect(screen.getByRole('heading', { name: '初診快覽' })).toBeInTheDocument()
    expect(screen.getByText('94 歲男性，跨院慢性病照護')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '複製' })).toBeInTheDocument()
    expect(screen.queryByText('開藥前必看')).not.toBeInTheDocument()
    expect(screen.queryByText('過敏')).not.toBeInTheDocument()
    expect(screen.queryByText('主動安全警示 · 高危')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '摘要核對' })).not.toBeInTheDocument()
  })

  it('reveals wording differences only when the summary check is opened', async () => {
    const detail = '與問題清單未完全對應（currently on aromatase inhibitor therapy）'
    renderCard(detail)
    expect(screen.queryByText(detail)).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '摘要核對' }))
    expect(await screen.findByRole('dialog', { name: '摘要核對' })).toBeVisible()
    expect(screen.getByText(detail)).toBeVisible()
    expect(screen.getByText('未對應不代表內容有誤，請回查原始紀錄確認。')).toBeVisible()
  })

  it('keeps a failed comparison visible without opening the check', () => {
    const failure = '摘要核對未完成：問題清單未產生，請回查原始紀錄'
    renderCard(failure, true)
    expect(screen.getByRole('status')).toHaveTextContent(failure)
    expect(screen.queryByRole('button', { name: '摘要核對' })).not.toBeInTheDocument()
  })

  it('copies only the headline, excluding comparison details', () => {
    mockCopy.mockClear()
    renderCard('與問題清單未完全對應（periodontal disease）')
    fireEvent.click(screen.getByRole('button', { name: '複製' }))
    expect(mockCopy).toHaveBeenCalledWith(result.headline)
  })
})
