// The on-prem latency budget for the medical summary's full-context request:
// it may only LOWER the window-derived target, only for compact-harness
// (sub-500K) windows, and the notice must name the constraint that actually
// applied. Synthetic values only.
import {
  catalogSubsetForFittedScope,
  clinicalContextTokenTarget,
  formatClinicalContextAdaptationNotice,
  resolveClinicalContextTarget,
  type ClinicalContextAdaptation,
} from '@/src/core/utils/adaptive-clinical-context.utils'
import {
  LOCAL_MODEL_FULL_CONTEXT_TOKEN_BUDGET,
  medicalSummaryContextTokenBudget,
} from '@/src/core/use-cases/medical-summary/medical-summary-harness'
import type { SummarySourceCatalogEntry } from '@/src/core/entities/medical-summary.entity'

const targetFor = (contextLimit: number) => resolveClinicalContextTarget(
  clinicalContextTokenTarget(contextLimit),
  medicalSummaryContextTokenBudget(contextLimit, { selfHosted: true }),
)

describe('medical-summary latency budget', () => {
  it('is 24K for self-hosted compact-harness windows only', () => {
    const selfHosted = { selfHosted: true }
    expect(LOCAL_MODEL_FULL_CONTEXT_TOKEN_BUDGET).toBe(24_000)
    expect(medicalSummaryContextTokenBudget(262_144, selfHosted)).toBe(24_000)
    expect(medicalSummaryContextTokenBudget(120_000, selfHosted)).toBe(24_000)
    expect(medicalSummaryContextTokenBudget(undefined, selfHosted)).toBe(24_000)
    expect(medicalSummaryContextTokenBudget(1_000_000, selfHosted)).toBeUndefined()
    expect(medicalSummaryContextTokenBudget(500_000, selfHosted)).toBeUndefined()
    // A cloud model with a small window (GPT nano 120K) reads fast: no budget.
    expect(medicalSummaryContextTokenBudget(120_000, { selfHosted: false })).toBeUndefined()
  })

  it('lowers the target only for an on-prem window larger than the budget', () => {
    // Qwen 3.6 35B-A3B stand-in: the window would hold ~226K, latency caps 24K.
    expect(clinicalContextTokenTarget(262_144)).toBeGreaterThan(24_000)
    expect(targetFor(262_144)).toEqual({ targetTokens: 24_000, reason: 'local-latency' })
    // A frontier window keeps its window-derived target untouched.
    expect(targetFor(1_048_576)).toEqual({
      targetTokens: clinicalContextTokenTarget(1_048_576),
      reason: 'context-window',
    })
    // A small on-prem window is already tighter than the budget: the window
    // is the binding constraint and the wording must say so.
    expect(clinicalContextTokenTarget(32_768)).toBe(20_768)
    expect(targetFor(32_768)).toEqual({ targetTokens: 20_768, reason: 'context-window' })
  })

  it('ignores an absent or unusable budget and never raises the target', () => {
    expect(resolveClinicalContextTarget(50_000)).toEqual({ targetTokens: 50_000, reason: 'context-window' })
    for (const budget of [Number.NaN, 0, -10, Number.POSITIVE_INFINITY]) {
      expect(resolveClinicalContextTarget(50_000, budget)).toEqual({ targetTokens: 50_000, reason: 'context-window' })
    }
    expect(resolveClinicalContextTarget(50_000, 80_000)).toEqual({ targetTokens: 50_000, reason: 'context-window' })
    expect(resolveClinicalContextTarget(50_000, 50_000)).toEqual({ targetTokens: 50_000, reason: 'context-window' })
    expect(resolveClinicalContextTarget(50_000, 24_000.7)).toEqual({ targetTokens: 24_000, reason: 'local-latency' })
  })
})

describe('catalogSubsetForFittedScope', () => {
  const entry = (key: string, resourceType: string, resourceId: string): SummarySourceCatalogEntry => ({
    key, resourceType, resourceId, display: `${resourceType} ${resourceId}`,
  })

  it('keeps the saved keys of the records the fitted view kept, never renumbering them', () => {
    const saved = [
      entry('E1', 'Encounter', 'enc-new'),
      entry('E2', 'Encounter', 'enc-old'),
      entry('L1', 'DiagnosticReport', 'rep-new'),
      entry('L2', 'DiagnosticReport', 'rep-old'),
      entry('M1', 'MedicationRequest', 'med-1'),
    ]
    // The fitted scope numbered its own records from 1 — L1 there is rep-old.
    const fitted = [
      entry('E1', 'Encounter', 'enc-new'),
      entry('L1', 'DiagnosticReport', 'rep-old'),
      entry('M1', 'MedicationRequest', 'med-1'),
      entry('X1', 'Encounter', 'not-in-saved-scope'),
    ]
    expect(catalogSubsetForFittedScope(saved, fitted).map((item) => item.key)).toEqual(['E1', 'L2', 'M1'])
  })

  it('matches on resource type as well as id', () => {
    const saved = [entry('E1', 'Encounter', 'same-id'), entry('P1', 'Procedure', 'same-id')]
    const fitted = [entry('P1', 'Procedure', 'same-id')]
    expect(catalogSubsetForFittedScope(saved, fitted).map((item) => item.key)).toEqual(['P1'])
  })
})

describe('formatClinicalContextAdaptationNotice reason', () => {
  const adaptation = (
    tier: ClinicalContextAdaptation['tier'],
    reason: ClinicalContextAdaptation['reason'],
  ): ClinicalContextAdaptation => ({
    tier,
    reason,
    contextLimit: 262_144,
    targetTokens: 24_000,
    originalTokens: 140_000,
    adaptedTokens: 23_500,
  })

  const ZH_SCOPE: Record<ClinicalContextAdaptation['tier'], string> = {
    trimmed: '最多最近 1 年的主要病歷、每項最多 8 筆檢驗，以及最近一次出院病摘',
    compact: '最多最近 6 個月的主要病歷、每項最多 3 筆檢驗，以及最近一次出院病摘',
    tight: '最多最近 3 個月的主要病歷、每項最新檢驗，以及精簡後的最近一次出院病摘',
    prioritized: '逐筆保留活動中問題、過敏、目前用藥、異常與最新檢驗及近期重要紀錄',
  }
  const EN_SCOPE: Record<ClinicalContextAdaptation['tier'], string> = {
    trimmed: 'up to 1 year of key records, up to 8 results per lab, and the latest discharge summary',
    compact: 'up to 6 months of key records, up to 3 results per lab, and the latest discharge summary',
    tight: 'up to 3 months of key records, the latest result per lab, and a condensed latest discharge summary',
    prioritized: 'retained active problems, allergies, current medications, abnormal/latest tests, and recent important records first',
  }
  const tiers = ['trimmed', 'compact', 'tight', 'prioritized'] as const

  it.each(tiers)('zh-TW %s: explains the latency budget instead of the window', (tier) => {
    const notice = formatClinicalContextAdaptationNotice(adaptation(tier, 'local-latency'), 'zh-TW')
    expect(notice.startsWith('為了讓模型在合理時間內回覆，本次')).toBe(true)
    expect(notice).toContain(ZH_SCOPE[tier])
    expect(notice).toMatch(/（約 24k tokens）。你儲存的資料範圍沒有變更。$/)
    expect(notice).not.toContain('內容視窗')
    // The saved scope's source list is kept under a latency budget.
    expect(notice).not.toContain('來源索引')
  })

  it.each(tiers)('en %s: explains the latency budget instead of the window', (tier) => {
    const notice = formatClinicalContextAdaptationNotice(adaptation(tier, 'local-latency'), 'en')
    expect(notice.startsWith("To keep this model's reply time reasonable, this run ")).toBe(true)
    expect(notice).toContain(EN_SCOPE[tier])
    expect(notice).toMatch(/\(about 24k tokens\)\. Your saved data scope was not changed\.$/)
    expect(notice).not.toContain('context window')
    expect(notice).not.toContain('source index')
  })

  it.each(tiers)('keeps the window wording for a context-window fit (%s)', (tier) => {
    const zh = formatClinicalContextAdaptationNotice(adaptation(tier, 'context-window'), 'zh-TW')
    const en = formatClinicalContextAdaptationNotice(adaptation(tier, 'context-window'), 'en')
    expect(zh).toContain('已依模型 262k 內容視窗')
    expect(zh).not.toContain('合理時間')
    expect(en).toContain("For this model's 262k-token context window")
    expect(en).not.toContain('reply time')
  })
})
