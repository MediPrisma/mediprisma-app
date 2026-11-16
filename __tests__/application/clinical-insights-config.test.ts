import { stripLegacySafetyPanels } from '@/src/application/providers/clinical-insights-legacy'
import {
  coerceShowInSummary,
  MAX_AUTO_INSIGHT_MODULES,
  MAX_SUMMARY_INSIGHT_MODULES,
} from '@/src/shared/constants/clinical-insights.constants'
import { selectAutoGeneratePanelIds } from '@/features/clinical-insights/hooks/useAutoGenerate'

jest.mock('@/src/application/providers/auth.provider', () => ({ useAuth: jest.fn() }))
jest.mock('@/src/infrastructure/firebase/clinical-insights-sync', () => ({
  subscribeToClinicalInsightPanels: jest.fn(),
  batchSaveClinicalInsightPanels: jest.fn(),
  applyClinicalInsightPanelChanges: jest.fn(),
  replaceAllClinicalInsightPanels: jest.fn(),
}))

import {
  CLINICAL_INSIGHT_TEMPLATE_LIBRARY_REVISION,
  getDefaultClinicalInsightPanels,
  migrateClinicalInsightTemplateLibrary,
  type InsightPanelConfig,
} from '@/src/application/providers/clinical-insights-config.provider'

const EN_SAFETY_PROMPT =
  'Review the clinical context and flag any immediate patient safety risks, including drug interactions, abnormal results, or urgent follow-up needs. Respond with concise bullet points ordered by severity.'
const ZH_SAFETY_PROMPT =
  '檢視臨床資料並標記任何立即的病人安全風險，包括藥物交互作用、異常結果或緊急追蹤需求。以簡潔的條列式回應，依嚴重程度排序。'

const mk = (over: Partial<{ id: string; title: string; prompt: string }>) => ({
  id: 'x',
  title: 't',
  prompt: 'p',
  autoGenerate: false,
  order: 0,
  audience: 'medical' as const,
  ...over,
})

describe('stripLegacySafetyPanels (strict legacy migration)', () => {
  it('removes the PRISTINE legacy safety panel (EN and ZH)', () => {
    const en = [mk({ id: 'safety', title: 'Safety Flag', prompt: EN_SAFETY_PROMPT }), mk({ id: 'changes' })]
    expect(stripLegacySafetyPanels(en).map((p) => p.id)).toEqual(['changes'])

    const zh = [mk({ id: 'safety', title: '安全警示', prompt: ZH_SAFETY_PROMPT })]
    expect(stripLegacySafetyPanels(zh)).toHaveLength(0)
  })

  it('KEEPS an EDITED legacy safety panel (id "safety" but prompt changed)', () => {
    const panels = [mk({ id: 'safety', title: '安全警示', prompt: '我自己改寫的 prompt 內容' })]
    expect(stripLegacySafetyPanels(panels)).toHaveLength(1)
  })

  it('KEEPS a user-created panel even if titled 安全警示 / copies the prompt (its id is a UUID, not "safety")', () => {
    const panels = [mk({ id: 'a1b2c3d4-uuid', title: '安全警示', prompt: ZH_SAFETY_PROMPT })]
    expect(stripLegacySafetyPanels(panels)).toHaveLength(1)
  })

  it('leaves all other panels untouched', () => {
    const panels = [mk({ id: 'changes' }), mk({ id: 'snapshot' })]
    expect(stripLegacySafetyPanels(panels)).toHaveLength(2)
  })
})

describe('custom summary module defaults', () => {
  it('activates Changes but keeps other legacy templates in the template library', () => {
    expect(coerceShowInSummary(undefined, 'changes')).toBe(true)
    expect(coerceShowInSummary(undefined, 'snapshot')).toBe(false)
    expect(coerceShowInSummary(true, 'custom')).toBe(true)
    expect(coerceShowInSummary(false, 'changes')).toBe(false)
    expect(MAX_SUMMARY_INSIGHT_MODULES).toBe(5)
    expect(MAX_AUTO_INSIGHT_MODULES).toBe(2)
  })

  it('includes free-text equivalents of the standard summary in both audience libraries', () => {
    const medical = getDefaultClinicalInsightPanels('zh-TW', 'medical').find(
      (panel) => panel.id === 'standard-medical-summary-free-text',
    )
    expect(medical).toMatchObject({
      title: '標準醫療摘要（文字版）',
      showInSummary: false,
      autoGenerate: false,
      outputFormat: 'markdown',
      languagePolicy: 'interface-language',
    })
    expect(medical?.prompt).toContain('不要輸出 JSON')
    expect(medical?.prompt).toContain('## 主要健康問題')
    expect(medical?.prompt).toContain('健保申報用的 ICD 碼')

    const patient = getDefaultClinicalInsightPanels('en', 'patient').find(
      (panel) => panel.id === 'standard-health-summary-free-text',
    )
    expect(patient).toMatchObject({
      title: 'My Health Summary (Free Text)',
      showInSummary: false,
      autoGenerate: false,
      outputFormat: 'markdown',
      languagePolicy: 'interface-language',
    })
    expect(patient?.prompt).toContain('Markdown text only')
    expect(patient?.prompt).toContain('Never tell the patient to start, stop, skip, or change a dose')
  })

  it('migrates existing libraries once and respects a later user deletion', () => {
    const previousDefaults = [
      ...getDefaultClinicalInsightPanels('zh-TW', 'medical'),
      ...getDefaultClinicalInsightPanels('zh-TW', 'patient'),
    ]
      .filter((panel) => !panel.id.startsWith('standard-'))
      .map(({ templateLibraryRevision: _revision, ...panel }) => panel as InsightPanelConfig)

    const migrated = migrateClinicalInsightTemplateLibrary(previousDefaults, 'zh-TW')
    expect(migrated.changed).toBe(true)
    expect(migrated.panels.map((panel) => panel.id)).toEqual(expect.arrayContaining([
      'standard-medical-summary-free-text',
      'standard-health-summary-free-text',
    ]))
    expect(migrated.panels.every(
      (panel) => panel.templateLibraryRevision === CLINICAL_INSIGHT_TEMPLATE_LIBRARY_REVISION,
    )).toBe(true)

    const afterUserDeletion = migrated.panels.filter(
      (panel) => panel.id !== 'standard-medical-summary-free-text',
    )
    const reloaded = migrateClinicalInsightTemplateLibrary(afterUserDeletion, 'zh-TW')
    expect(reloaded.changed).toBe(false)
    expect(reloaded.panels.some((panel) => panel.id === 'standard-medical-summary-free-text')).toBe(false)
  })

  it('auto-runs only visible modules, respects cache, cost gate and the two-card cap', () => {
    const panels = ['a', 'b', 'c', 'hidden'].map((id) => ({
      id,
      showInSummary: id !== 'hidden',
      autoGenerate: true,
    }))
    expect(selectAutoGeneratePanelIds({
      panels,
      modelId: 'gpt-5.4-nano',
      autoRunPanels: new Set(),
    })).toEqual(['a', 'b'])

    expect(selectAutoGeneratePanelIds({
      panels,
      modelId: 'gpt-5.4-nano',
      autoRunPanels: new Set(['a']),
      responses: { b: { text: 'cached' } },
    })).toEqual(['c'])

    expect(selectAutoGeneratePanelIds({
      panels,
      modelId: 'gpt-6-luna',
      autoRunPanels: new Set(),
    })).toEqual([])

    expect(selectAutoGeneratePanelIds({
      panels,
      modelId: 'gpt-5.4-nano',
      autoRunPanels: new Set(),
      responses: { a: { text: 'partial response before quota error' } },
      failedPanelIds: new Set(['a']),
      limit: 1,
    })).toEqual(['a'])
  })
})
