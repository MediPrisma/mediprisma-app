/** @jest-environment jsdom */
// 初診快覽 hero: the headline and its copy button only. 開藥前必看 (and its
// app-derived allergy row) was retired on 2026-10-02; safety alerts moved to
// 開藥注意 after 影像與病理重點.
import { render, screen } from '@testing-library/react'
import { OverviewHeroCard } from '@/features/medical-summary/components/OverviewHeroCard'
import type { MedicalSummaryResult } from '@/src/core/entities/medical-summary.entity'

const result = {
  headline: '94 歲男性，跨院慢性病照護',
  problems: [],
  medicationEducation: [],
  sourceIndex: [],
} as MedicalSummaryResult

const renderCard = () => render(
  <OverviewHeroCard
    result={result}
    title="初診快覽"
    dataRange="健保雲端 · 至 2026-08-27"
    copyLabel="複製"
    copiedLabel="已複製"
    copyFailedLabel="複製失敗"
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
  })
})
