import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { HYPERLIPIDEMIA_GUIDELINE_PACK, type CdssPatientProfile } from '@voho0000/personalized-care'
import { NhiTable1Panel } from '@/features/clinical-decision-support/renderers/NhiTable1Panel'
import { useNhiLipidAiAssist } from '@/features/clinical-decision-support/hooks/use-nhi-lipid-ai-assist.hook'
import { CarriedAnswerContext } from '@/features/clinical-decision-support/renderers/visit/carried-answer-context'

jest.mock('@/features/clinical-decision-support/hooks/use-nhi-lipid-ai-assist.hook', () => ({
  useNhiLipidAiAssist: jest.fn(),
}))

jest.mock('@/features/data-selection', () => ({
  DataSelectionDrawer: ({ open, title, description }: { open: boolean; title: string; description: string }) => open ? (
    <div role="dialog" aria-label={title}>{description}</div>
  ) : null,
}))

jest.mock('@/src/shared/components/ModelPicker', () => ({
  ModelPicker: ({
    modelId,
    disabled,
    onSelect,
  }: {
    modelId: string
    disabled?: boolean
    onSelect: (modelId: string) => void
  }) => (
    <button
      type="button"
      data-testid="nhi-model-picker"
      disabled={disabled}
      onClick={() => onSelect('model-next')}
    >
      {modelId}
    </button>
  ),
}))

const mockedUseAiAssist = jest.mocked(useNhiLipidAiAssist)

function coverageSummary() {
  const profile: CdssPatientProfile = {
    id: 'synthetic-ai-panel',
    evaluatedAt: '2026-09-18T10:00:00+08:00',
    demographics: { sex: 'male' },
    facts: {
      age: { zh: '60 歲', en: '60 years', numericValue: 60 },
    },
  }
  const result = HYPERLIPIDEMIA_GUIDELINE_PACK.build({ profile, locale: 'zh-TW' })
  const card = result.recommendations.find((item) => item.id === 'dyslipidemia-risk-and-target')
  if (!card?.coverageSummary) throw new Error('Expected the NHI lipid coverage summary')
  return card.coverageSummary
}

describe('NhiTable1Panel AI review', () => {
  const run = jest.fn(async () => undefined)
  const decide = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    mockedUseAiAssist.mockReturnValue({
      suggestions: {},
      decisions: {},
      isRunning: false,
      isDataReady: true,
      error: null,
      modelId: 'gpt-test',
      modelName: 'GPT Test',
      run,
      decide,
    })
  })

  it('a judgement brought in from a saved record says which record', () => {
    const summary = coverageSummary()
    const editable = [...summary.factors, ...(summary.metabolicChecks ?? []), ...(summary.diseaseChecks ?? [])].find((check) => check.editable)
    if (!editable) throw new Error('Expected an editable criterion')
    render(
      <CarriedAnswerContext.Provider value={(key) => key === `lipid:${editable.id}` ? '2025-09-01' : null}>
        <NhiTable1Panel summary={summary} locale="zh-TW" patientId="patient-1" onAnswer={jest.fn()} />
      </CarriedAnswerContext.Provider>,
    )
    expect(screen.getByTestId(`nhi-criterion-carried-${editable.id}`)).toHaveTextContent('帶入 · 2025/09/01')
    expect(screen.getAllByText(/^帶入 · /)).toHaveLength(1)
  })

  it('opens the independent Table 1 data scope without starting AI', () => {
    mockedUseAiAssist.mockReturnValue({ suggestions: {}, decisions: {}, isRunning: false, isDataReady: true, error: null, modelId: 'test', modelName: 'Test', run, decide })
    render(<NhiTable1Panel summary={coverageSummary()} locale="zh-TW" patientId="patient-1" onAnswer={jest.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'AI 判讀設定' }))
    expect(screen.getByRole('button', { name: '查看 AI 執行紀錄' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '資料範圍' }))
    expect(screen.getByRole('dialog', { name: 'AI 判讀資料範圍' })).toBeVisible()
    expect(screen.getByText('選擇表一 AI 判讀要納入的病歷資料；此範圍獨立於 AI 摘要。')).toBeVisible()
    expect(run).not.toHaveBeenCalled()
  })

  it('starts the AI review directly from the visible action', () => {
    render(
      <NhiTable1Panel
        summary={coverageSummary()}
        locale="zh-TW"
        patientId="patient-1"
        onAnswer={jest.fn()}
      />,
    )

    expect(run).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('nhi-lipid-ai-run'))
    expect(run).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('送出去識別化病歷摘要？')).not.toBeInTheDocument()
  })

  it('bulk reviews only known editable answers, preserving AI evidence and manual answers', () => {
    const base = coverageSummary()
    const onAnswer = jest.fn()
    const summary = { ...base, factors: base.factors.map(check => check.id === 'smoking'
      ? { ...check, state: 'yes' as const, origin: 'ai' as const }
      : check) }
    render(<NhiTable1Panel summary={summary} locale="zh-TW" patientId="patient-1"
      onAnswer={onAnswer} answerProvenance={{
        age: { source: 'manual', manualAction: 'selected' },
        smoking: { source: 'ai', modelName: 'Evidence model', recordState: 'unknown' },
      }} />)
    fireEvent.click(screen.getByRole('button', { name: /一鍵覆核目前結果/ }))
    expect(onAnswer).toHaveBeenCalledWith('smoking', 'yes', expect.objectContaining({
      source: 'manual', manualAction: 'reviewed', modelName: 'Evidence model',
      recordState: 'unknown', overrides: 'ai', reviewedAt: expect.any(String),
    }))
    expect(onAnswer.mock.calls.some(([id]) => id === 'age' || id === 'family-history' || id === 'metabolic')).toBe(false)
  })

  it('locks the selected model while running and shows the run model and duration', () => {
    const selectModel = jest.fn()
    const runMetadata = {
      runId: 'run-1',
      inputSignature: 'input-1',
      sourceScopeSignature: 'scope-1',
      promptVersion: 'prompt-1',
      startedAt: '2026-09-20T10:00:00.000Z',
      modelId: 'model-routed',
      modelName: 'Routed Model',
      inputSummary: { criteriaCount: 20, sourceCount: 46, sourceCounts: { Encounter: 40, Observation: 6 }, earliestDate: '2018-02-12', latestDate: '2026-08-25' },
    }
    const runningAssist = {
      suggestions: {},
      decisions: {},
      isRunning: true,
      isDataReady: true,
      error: null,
      latestAttempt: runMetadata,
      modelId: 'model-routed',
      modelName: 'Routed Model',
      selectedModelId: 'model-selected',
      fallbackModelId: 'model-fallback',
      selectModel,
      run,
      decide,
    }
    const view = render(
      <NhiTable1Panel
        summary={coverageSummary()}
        locale="zh-TW"
        patientId="patient-1"
        onAnswer={jest.fn()}
        aiAssist={runningAssist}
      />,
    )

    expect(screen.getByTestId('nhi-model-picker')).toBeDisabled()
    expect(screen.getByTestId('nhi-lipid-ai-run-meta')).toHaveTextContent('Routed Model')
    expect(screen.getByTestId('nhi-lipid-ai-run-meta')).toHaveTextContent('已等待')
    expect(screen.getByText('已整理 20 項表一條件、46 筆來源。')).toBeVisible()
    expect(screen.getByText('就醫 40 · 檢驗／量測 6')).toBeVisible()
    expect(screen.getByText('來源日期：2018-02-12 ～ 2026-08-25')).toBeVisible()
    expect(screen.getByText(/目前模型不回報逐項進度/)).toBeVisible()

    view.rerender(
      <NhiTable1Panel
        summary={coverageSummary()}
        locale="zh-TW"
        patientId="patient-1"
        onAnswer={jest.fn()}
        aiAssist={{
          ...runningAssist,
          isRunning: false,
          latestAttempt: { ...runMetadata, completedAt: '2026-09-20T10:01:05.000Z' },
          lastCompleted: {
            ...runMetadata,
            completedAt: '2026-09-20T10:01:05.000Z',
            modelId: 'model-actual',
            modelName: 'Actual Model',
          },
        }}
      />,
    )

    expect(screen.getByTestId('nhi-model-picker')).not.toBeDisabled()
    expect(screen.getByTestId('nhi-lipid-ai-run-meta')).toHaveTextContent('Actual Model')
    expect(screen.getByTestId('nhi-lipid-ai-run-meta')).toHaveTextContent('耗時 01:05')
  })

  it('opens criterion details only after an explicit click', () => {
    render(
      <NhiTable1Panel
        summary={coverageSummary()}
        locale="zh-TW"
        patientId="patient-1"
        onAnswer={jest.fn()}
      />,
    )

    fireEvent.pointerEnter(screen.getAllByRole('button', { name: '低 HDL-C' })[0], { pointerType: 'mouse' })

    expect(screen.queryByTestId('nhi-criterion-popover-low-hdl')).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: '低 HDL-C' })[0])

    expect(screen.getByTestId('nhi-criterion-popover-low-hdl')).toBeVisible()
    expect(screen.getByText('男 <40 mg/dL；女 <50 mg/dL')).toBeVisible()
  })

  it('routes a laboratory autofill source to the cumulative report', () => {
    const onNavigate = jest.fn()
    render(
      <NhiTable1Panel
        summary={coverageSummary()}
        locale="zh-TW"
        patientId="patient-1"
        onNavigate={onNavigate}
        recordSources={{
          'low-hdl': [{
            resourceType: 'Observation',
            resourceId: 'observation-hdl',
            date: '2026-08-04',
            value: 55,
            unit: 'mg/dL',
            coding: [{ code: '2085-9', display: 'HDL cholesterol' }],
          }],
        }}
      />,
    )

    fireEvent.click(screen.getAllByRole('button', { name: '低 HDL-C' })[0])
    const popover = screen.getByTestId('nhi-criterion-popover-low-hdl')
    fireEvent.click(within(popover).getByRole('button', { name: /開啟原始病歷 · HDL cholesterol/ }))

    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({
      resourceType: 'Observation',
      resourceId: 'observation-hdl',
      date: '2026-08-04',
      reportView: 'cumulative',
    }))
  })

  it('keeps the clicked extreme-risk tier in view when source navigation narrows the table', () => {
    const originalResizeObserver = globalThis.ResizeObserver
    let resizeCallback: ResizeObserverCallback | undefined
    let animationCallback: FrameRequestCallback | undefined
    const performanceNow = jest.spyOn(performance, 'now').mockReturnValue(1_000)
    const requestAnimationFrame = jest.spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        animationCallback = callback
        return 1
      })
    globalThis.ResizeObserver = class {
      private readonly callback: ResizeObserverCallback
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
      }
      observe(target: Element) {
        if (target.getAttribute('data-testid') === 'nhi-table1-scroll') {
          resizeCallback = this.callback
        }
      }
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver

    try {
      const onNavigate = jest.fn()
      render(
        <NhiTable1Panel
          summary={coverageSummary()}
          locale="zh-TW"
          patientId="patient-1"
          onNavigate={onNavigate}
          recordSources={{
            cad: [{
              resourceType: 'Condition',
              resourceId: 'condition-cad',
              date: '2026-08-04',
              coding: [{ code: 'I25.2', display: 'Old myocardial infarction' }],
            }],
          }}
        />,
      )

      const viewport = screen.getByTestId('nhi-table1-scroll')
      const extremeTier = viewport.querySelector<HTMLElement>('[data-nhi-tier="extreme"]')
      expect(extremeTier).not.toBeNull()
      Object.defineProperty(viewport, 'scrollLeft', { configurable: true, writable: true, value: 400 })
      jest.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({
        left: 0, right: 500, width: 500, top: 0, bottom: 800, height: 800, x: 0, y: 0, toJSON: () => ({}),
      })
      jest.spyOn(extremeTier!, 'getBoundingClientRect').mockReturnValue({
        left: 700, right: 900, width: 200, top: 0, bottom: 80, height: 80, x: 700, y: 0, toJSON: () => ({}),
      })

      fireEvent.click(screen.getAllByRole('button', { name: '冠狀動脈疾病' })[0])
      fireEvent.click(within(screen.getByTestId('nhi-criterion-popover-cad')).getByRole('button', { name: /開啟原始病歷 · Old myocardial infarction/ }))
      expect(resizeCallback).toBeDefined()
      resizeCallback?.([], {} as ResizeObserver)
      animationCallback?.(0)

      expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({
        resourceType: 'Condition',
        resourceId: 'condition-cad',
      }))
      expect(viewport.scrollLeft).toBe(950)
    } finally {
      globalThis.ResizeObserver = originalResizeObserver
      requestAnimationFrame.mockRestore()
      performanceNow.mockRestore()
    }
  })

  it('automatically includes a traceable AI assessment in the tier with provenance', async () => {
    const onAnswer = jest.fn()
    mockedUseAiAssist.mockReturnValue({
      suggestions: {
        smoking: {
          criterionId: 'smoking',
          state: 'yes',
          confidence: 'high',
          rationale: '病歷明確記載目前抽菸。',
          missing: [],
          evidence: [{
            sourceKey: 'D1',
            sourceResourceType: 'DocumentReference',
            sourceResourceId: 'doc-smoking',
            sourceLabel: '出院病歷摘要',
            date: '2026-09-16',
            excerpt: '目前每日抽菸一包。',
          }],
          modelId: 'gpt-test',
          modelName: 'GPT Test',
          generatedAt: '2026-09-18T10:00:00+08:00',
        },
      },
      decisions: {},
      isRunning: false,
      isDataReady: true,
      error: null,
      modelId: 'gpt-test',
      modelName: 'GPT Test',
      run,
      decide,
    })

    render(
      <NhiTable1Panel
        summary={coverageSummary()}
        locale="zh-TW"
        patientId="patient-1"
        onAnswer={onAnswer}
      />,
    )

    expect(screen.getByText('AI 判讀符合 · 已納入分級 · 1 筆來源 · 點擊查看')).toBeInTheDocument()
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith('smoking', 'yes', expect.objectContaining({
      source: 'ai',
      modelId: 'gpt-test',
      confidence: 'high',
    })))
    expect(decide).toHaveBeenCalledWith('smoking', 'applied')
    expect(screen.queryByText('採用並重算')).not.toBeInTheDocument()
  })

  it('does not write an answer when AI remains uncertain', () => {
    const onAnswer = jest.fn()
    mockedUseAiAssist.mockReturnValue({
      suggestions: {
        smoking: {
          criterionId: 'smoking',
          state: 'unknown',
          confidence: 'low',
          rationale: '病歷沒有足夠資料。',
          missing: ['目前吸菸狀態'],
          evidence: [],
          modelId: 'gpt-test',
          modelName: 'GPT Test',
          generatedAt: '2026-09-18T10:00:00+08:00',
        },
      },
      decisions: {},
      isRunning: false,
      isDataReady: true,
      error: null,
      modelId: 'gpt-test',
      modelName: 'GPT Test',
      run,
      decide,
    })

    render(
      <NhiTable1Panel
        summary={coverageSummary()}
        locale="zh-TW"
        patientId="patient-1"
        onAnswer={onAnswer}
      />,
    )

    expect(onAnswer).not.toHaveBeenCalled()
    expect(decide).not.toHaveBeenCalled()
    expect(screen.getByText('查看 1 項仍待補資料原因')).toBeInTheDocument()
  })

  it('shows the AI rationale and source link on the applied criterion row', async () => {
    const base = coverageSummary()
    const summary = {
      ...base,
      factors: base.factors.map((check) => check.id === 'smoking'
        ? { ...check, state: 'yes' as const, origin: 'physician' as const, value: '未找到可判讀資料' }
        : check),
    }
    const onAnswer = jest.fn()
    const onNavigate = jest.fn()
    mockedUseAiAssist.mockReturnValue({
      suggestions: {
        smoking: {
          criterionId: 'smoking',
          state: 'yes',
          confidence: 'high',
          rationale: '病歷明確記載目前抽菸。',
          missing: [],
          evidence: [{
            sourceKey: 'D1',
            sourceResourceType: 'DocumentReference',
            sourceResourceId: 'doc-smoking',
            sourceLabel: '出院病歷摘要',
            date: '2026-09-16',
            excerpt: '目前每日抽菸一包。',
          }],
          modelId: 'gpt-test',
          modelName: 'GPT Test',
          generatedAt: '2026-09-18T10:00:00+08:00',
        },
      },
      decisions: { smoking: 'applied' },
      isRunning: false,
      isDataReady: true,
      error: null,
      modelId: 'gpt-test',
      modelName: 'GPT Test',
      run,
      decide,
    })

    render(
      <NhiTable1Panel
        summary={summary}
        locale="zh-TW"
        patientId="patient-1"
        onAnswer={onAnswer}
        onNavigate={onNavigate}
        answerProvenance={{ smoking: { source: 'ai', recordState: 'unknown' } }}
      />,
    )

    const row = screen.getByRole('button', { name: '抽菸' })
    expect(row).toHaveTextContent('符合 · 病歷明確記載目前抽菸。')
    expect(row).toHaveTextContent('AI 判讀符合 · 已納入分級 · 1 筆來源 · 點擊查看')
    expect(row).not.toHaveTextContent('符合 · 未找到可判讀資料')

    fireEvent.click(row)
    const popover = screen.getByTestId('nhi-criterion-popover-smoking')
    expect(popover).toHaveTextContent('目前每日抽菸一包。')
    fireEvent.click(within(popover).getByRole('button', { name: /開啟原始病歷 · 出院病歷摘要/ }))
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({
      resourceType: 'DocumentReference',
      resourceId: 'doc-smoking',
      evidenceQuote: '目前每日抽菸一包。',
    }))
  })

  it('keeps the AI rationale and source guidance after the clinician reviews it', () => {
    const base = coverageSummary()
    const criterion = base.diseaseChecks.find((check) => check.label === '接受血管再通術')!
    const summary = {
      ...base,
      diseaseChecks: base.diseaseChecks.map((check) => check.id === criterion.id
        ? { ...check, state: 'yes' as const, origin: 'physician' as const, value: '未找到可判讀資料' }
        : check),
    }
    const onNavigate = jest.fn()
    mockedUseAiAssist.mockReturnValue({
      suggestions: {
        [criterion.id]: {
          criterionId: criterion.id,
          state: 'yes',
          confidence: 'high',
          rationale: '心導管報告明確記載已接受 PCI 血管再通術。',
          missing: [],
          evidence: [{
            sourceKey: 'R1',
            sourceResourceType: 'DiagnosticReport',
            sourceResourceId: 'cardiac-catheterization',
            sourceLabel: '心導管報告',
            date: '2025-03-26',
            excerpt: 'PCI was performed through RRA access.',
          }],
          modelId: 'gpt-test',
          modelName: 'GPT Test',
          generatedAt: '2026-09-18T10:00:00+08:00',
        },
      },
      decisions: { [criterion.id]: 'applied' },
      isRunning: false,
      isDataReady: true,
      error: null,
      modelId: 'gpt-test',
      modelName: 'GPT Test',
      run,
      decide,
    })

    render(
      <NhiTable1Panel
        summary={summary}
        locale="zh-TW"
        patientId="patient-1"
        onAnswer={jest.fn()}
        onNavigate={onNavigate}
        answerProvenance={{
          [criterion.id]: {
            source: 'manual',
            manualAction: 'reviewed',
            overrides: 'ai',
            recordState: 'unknown',
          },
        }}
      />,
    )

    const row = screen.getByRole('button', { name: '接受血管再通術' })
    expect(row).toHaveTextContent('符合 · 心導管報告明確記載已接受 PCI 血管再通術。')
    expect(row).toHaveTextContent('醫師已覆核此判讀 · 1 筆來源 · 點擊查看')
    expect(row).not.toHaveTextContent('符合 · 未找到可判讀資料')

    fireEvent.click(row)
    const popover = screen.getByTestId(`nhi-criterion-popover-${criterion.id}`)
    expect(popover).toHaveTextContent('PCI was performed through RRA access.')
    fireEvent.click(within(popover).getByRole('button', { name: /開啟原始病歷 · 心導管報告/ }))
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({
      resourceType: 'DiagnosticReport',
      resourceId: 'cardiac-catheterization',
      evidenceQuote: 'PCI was performed through RRA access.',
    }))
  })

  it.each([
    {
      label: '接受血管再通術',
      resourceId: 'catheterization-revascularization',
      excerpt: 'PCI with balloon angioplasty and stent deployment was performed.',
    },
    {
      label: '≥50% 直徑狹窄率',
      resourceId: 'angiography-stenosis',
      excerpt: 'Angiography showed a 60% diameter stenosis.',
    },
    {
      label: '多支冠狀動脈阻塞',
      resourceId: 'angiography-multivessel',
      excerpt: 'Significant lesions were documented in multiple coronary vessels.',
    },
  ])('opens the exact reviewed evidence for $label', ({ label, resourceId, excerpt }) => {
    const base = coverageSummary()
    const criterion = base.diseaseChecks.find((check) => check.label === label)!
    expect(criterion).toBeDefined()
    const summary = {
      ...base,
      diseaseChecks: base.diseaseChecks.map((check) => check.id === criterion.id
        ? { ...check, state: 'yes' as const, origin: 'physician' as const, value: '未找到可判讀資料' }
        : check),
    }
    const onNavigate = jest.fn()
    mockedUseAiAssist.mockReturnValue({
      suggestions: {
        [criterion.id]: {
          criterionId: criterion.id,
          state: 'yes',
          confidence: 'high',
          rationale: `${label}具有明確報告依據。`,
          missing: [],
          evidence: [{
            sourceKey: `source-${criterion.id}`,
            sourceResourceType: 'DiagnosticReport',
            sourceResourceId: resourceId,
            sourceLabel: '心導管報告',
            date: '2026-09-20',
            excerpt,
          }],
          modelId: 'gpt-test',
          modelName: 'GPT Test',
          generatedAt: '2026-09-20T10:00:00+08:00',
        },
      },
      decisions: { [criterion.id]: 'applied' },
      isRunning: false,
      isDataReady: true,
      error: null,
      modelId: 'gpt-test',
      modelName: 'GPT Test',
      run,
      decide,
    })

    render(
      <NhiTable1Panel
        summary={summary}
        locale="zh-TW"
        patientId="patient-1"
        onAnswer={jest.fn()}
        onNavigate={onNavigate}
        answerProvenance={{
          [criterion.id]: {
            source: 'manual',
            manualAction: 'reviewed',
            overrides: 'ai',
            recordState: 'unknown',
          },
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: label }))
    const popover = screen.getByTestId(`nhi-criterion-popover-${criterion.id}`)
    expect(popover).toHaveTextContent(excerpt)
    fireEvent.click(within(popover).getByRole('button', { name: /開啟原始病歷 · 心導管報告/ }))
    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({
      resourceType: 'DiagnosticReport',
      resourceId,
      evidenceQuote: excerpt,
    }))
  })

  it('does not apply a decisive AI answer without a traceable source', async () => {
    const onAnswer = jest.fn()
    mockedUseAiAssist.mockReturnValue({
      suggestions: {
        smoking: {
          criterionId: 'smoking',
          state: 'yes',
          confidence: 'high',
          rationale: '模型宣稱符合但沒有來源。',
          missing: [],
          evidence: [],
          modelId: 'gpt-test',
          modelName: 'GPT Test',
          generatedAt: '2026-09-18T10:00:00+08:00',
        },
      },
      decisions: {},
      isRunning: false,
      isDataReady: true,
      error: null,
      modelId: 'gpt-test',
      modelName: 'GPT Test',
      run,
      decide,
    })

    render(
      <NhiTable1Panel
        summary={coverageSummary()}
        locale="zh-TW"
        patientId="patient-1"
        onAnswer={onAnswer}
      />,
    )

    await waitFor(() => expect(onAnswer).not.toHaveBeenCalled())
    expect(decide).not.toHaveBeenCalled()
  })

  it('distinguishes record, AI, clinician modification and clinician selection by text and color', () => {
    const summary = coverageSummary()
    const answered = {
      ...summary,
      factors: summary.factors.map((check) => check.id === 'smoking'
        ? { ...check, state: 'yes' as const, origin: 'physician' as const, value: '符合' }
        : check),
    }
    const { rerender } = render(
      <NhiTable1Panel
        summary={answered}
        locale="zh-TW"
        patientId="patient-1"
        answerProvenance={{ smoking: { source: 'ai', recordState: 'unknown', modelName: 'GPT Test' } }}
        onAnswer={jest.fn()}
      />,
    )
    expect(screen.getByTestId('nhi-criterion-provenance-age')).toHaveTextContent('自動帶入')
    expect(screen.getByTestId('nhi-criterion-provenance-age')).toHaveClass('text-sky-800')
    expect(screen.getByTestId('nhi-criterion-provenance-smoking')).toHaveTextContent('AI 判讀')
    expect(screen.getByTestId('nhi-criterion-provenance-smoking')).toHaveClass('text-violet-800')

    rerender(
      <NhiTable1Panel
        summary={answered}
        locale="zh-TW"
        patientId="patient-1"
        answerProvenance={{ smoking: { source: 'manual', manualAction: 'modified', recordState: 'unknown', overrides: 'ai' } }}
        onAnswer={jest.fn()}
      />,
    )
    expect(screen.getByTestId('nhi-criterion-provenance-smoking')).toHaveTextContent('醫師修改')
    expect(screen.getByTestId('nhi-criterion-provenance-smoking')).toHaveClass('text-amber-900')

    rerender(
      <NhiTable1Panel
        summary={answered}
        locale="zh-TW"
        patientId="patient-1"
        answerProvenance={{ smoking: { source: 'manual', manualAction: 'selected', recordState: 'unknown', overrides: 'record' } }}
        onAnswer={jest.fn()}
      />,
    )
    expect(screen.getByTestId('nhi-criterion-provenance-smoking')).toHaveTextContent('醫師選擇')
    expect(screen.getByTestId('nhi-criterion-provenance-smoking')).toHaveClass('text-emerald-900')
  })

  it('restores the record state when a clinician-selected answer returns to the original unknown', () => {
    const onAnswer = jest.fn()
    const summary = coverageSummary()
    const answered = {
      ...summary,
      factors: summary.factors.map((check) => check.id === 'smoking'
        ? { ...check, state: 'yes' as const, origin: 'physician' as const, value: '符合' }
        : check),
    }
    render(
      <NhiTable1Panel
        summary={answered}
        locale="zh-TW"
        patientId="patient-1"
        answerProvenance={{ smoking: { source: 'manual', manualAction: 'selected', recordState: 'unknown', overrides: 'record' } }}
        onAnswer={onAnswer}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '抽菸' }))
    fireEvent.click(screen.getByRole('button', { name: '未確認' }))
    expect(onAnswer).toHaveBeenCalledWith('smoking', undefined)
  })

  it('records filling an unknown criterion as a clinician selection', () => {
    const onAnswer = jest.fn()
    render(
      <NhiTable1Panel
        summary={coverageSummary()}
        locale="zh-TW"
        patientId="patient-1"
        onAnswer={onAnswer}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '抽菸' }))
    fireEvent.click(screen.getByRole('button', { name: '符合' }))
    expect(onAnswer).toHaveBeenCalledWith('smoking', 'yes', {
      source: 'manual',
      manualAction: 'selected',
      recordState: 'unknown',
      overrides: 'record',
    })
  })

  it('records confirming a preselected claim-code row as a clinician selection', () => {
    const onAnswer = jest.fn()
    const base = coverageSummary()
    const summary = {
      ...base,
      diseaseChecks: base.diseaseChecks.map((check) => check.id === 'cad'
        ? { ...check, state: 'yes' as const, origin: 'record' as const, evidenceKind: 'code' as const, value: 'I25.9' }
        : check),
    }
    render(
      <NhiTable1Panel
        summary={summary}
        locale="zh-TW"
        patientId="patient-1"
        onAnswer={onAnswer}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '冠狀動脈疾病' }))
    fireEvent.click(screen.getByRole('button', { name: '符合' }))
    expect(onAnswer).toHaveBeenCalledWith('cad', 'yes', {
      source: 'manual',
      manualAction: 'selected',
      recordState: 'yes',
      overrides: 'record',
    })
  })

  it('does not mislabel a derived compound result as record autofill', () => {
    const base = coverageSummary()
    const summary = {
      ...base,
      diseaseChecks: base.diseaseChecks.map((check) => check.id === 'acs-diabetes'
        ? { ...check, state: 'yes' as const, origin: 'derived' as const }
        : check),
    }
    render(
      <NhiTable1Panel
        summary={summary}
        locale="zh-TW"
        patientId="patient-1"
        onAnswer={jest.fn()}
      />,
    )

    expect(screen.queryByTestId('nhi-criterion-provenance-acs-diabetes')).not.toBeInTheDocument()
  })

  it('keeps an explicit clinician correction visible when it overrides AI with unknown', () => {
    const onAnswer = jest.fn()
    const summary = coverageSummary()
    const answered = {
      ...summary,
      factors: summary.factors.map((check) => check.id === 'smoking'
        ? { ...check, state: 'yes' as const, origin: 'physician' as const, value: '符合' }
        : check),
    }
    render(
      <NhiTable1Panel
        summary={answered}
        locale="zh-TW"
        patientId="patient-1"
        answerProvenance={{ smoking: { source: 'ai', recordState: 'unknown' } }}
        onAnswer={onAnswer}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '抽菸' }))
    fireEvent.click(screen.getByRole('button', { name: '未確認' }))
    expect(onAnswer).toHaveBeenCalledWith('smoking', 'unknown', {
      source: 'manual',
      manualAction: 'modified',
      recordState: 'unknown',
      overrides: 'ai',
    })
  })

  it('keeps all six tiers while compacting the zero-factor tier beside low risk', () => {
    const summary = coverageSummary()
    render(<NhiTable1Panel summary={summary} locale="zh-TW" />)

    expect(screen.getByText('代謝性症候群五項細節').closest('details')).toHaveAttribute('open')
    expect(screen.getByTestId('nhi-zero-tier-compact')).toHaveAttribute('data-testid', 'nhi-zero-tier-compact')
    expect(screen.getByLabelText('0 項心血管風險因子')).toBeInTheDocument()
    expect(screen.getByTestId('nhi-zero-tier-compact')).toHaveTextContent('0 項')
    expect(screen.getByTestId('nhi-zero-tier-compact')).toHaveTextContent('低風險')
    expect(screen.getByTestId('nhi-lower-tier-prescribing')).toHaveTextContent('0 項、低風險與中風險共用')
    expect(screen.getAllByText('生活型態改變，並處置心血管風險因子 3–6 個月')).toHaveLength(1)
    expect(screen.getAllByText('<160').length).toBeGreaterThan(0)
    expect(screen.getByText('non-HDL-C <160')).toBeInTheDocument()
    expect(screen.getAllByTestId('nhi-table1-scroll')).toHaveLength(1)
    expect(screen.getByTestId('nhi-table1-clinical-summary')).toHaveTextContent(summary.rows[3].label)
    expect(screen.getByTestId('nhi-table1-clinical-summary')).toHaveTextContent(summary.rows[3].value)
    expect(screen.getByTestId('nhi-table1-clinical-summary')).toHaveTextContent(summary.rows[2].value)
    expect(screen.getByTestId('nhi-table1-clinical-summary')).toHaveTextContent(summary.rows[5].value)
    expect(screen.getByText('不符合')).toBeInTheDocument()
    expect(screen.queryByText('有數值且不符合')).not.toBeInTheDocument()
  })

  it('marks a current medication in green on the selected tier without claiming the full rung is met', () => {
    const base = coverageSummary()
    const summary = {
      ...base,
      tiers: base.tiers.map((tier) => ({
        ...tier,
        selected: tier.id === 'extreme',
        prescribing: tier.id === 'extreme'
          ? [{
              text: '中至高強度 statin',
              state: 'unknown' as const,
              evidence: '處方中：ATORVASTATIN 40 MG。紀錄未載每日劑量，強度仍待核對。',
            }]
          : tier.prescribing,
      })),
    }

    render(<NhiTable1Panel summary={summary} locale="zh-TW" />)

    const currentMedication = screen.getByRole('button', { name: /中至高強度 statin 使用中/ })
    expect(currentMedication).toHaveAttribute('data-current-medication', 'true')
    expect(currentMedication).toHaveTextContent('○')
    expect(screen.getByText('綠＝目前用藥')).toBeInTheDocument()

    fireEvent.click(currentMedication)
    expect(screen.getByText('目前有相關藥物處方；是否符合這一階的強度、療程與血脂條件，仍依下方判讀。')).toBeVisible()
    expect(screen.getByText('紀錄無法判讀')).toBeVisible()
  })

  it('shows the pack-owned clinician action points without rewording them', () => {
    const summary = {
      ...coverageSummary(),
      clinicianActionPoints: [
        { id: 'confirm-tier', kind: 'confirm' as const, label: '本次確認', text: '確認未確認的高風險條件與採檢時用藥。' },
        { id: 'treatment', kind: 'treatment' as const, label: '處置', text: '依目前分層與表一門檻核對現行降脂治療。' },
        { id: 'follow-up', kind: 'follow-up' as const, label: '複驗', text: '治療更動後 1–3 個月複驗血脂。' },
      ],
    }

    render(<NhiTable1Panel summary={summary} locale="zh-TW" />)

    const actions = screen.getByTestId('nhi-table1-action-points')
    expect(actions).toHaveAccessibleName('建議處置')
    expect(actions).toHaveTextContent('本次確認確認未確認的高風險條件與採檢時用藥。')
    expect(actions).toHaveTextContent('處置依目前分層與表一門檻核對現行降脂治療。')
    expect(actions).toHaveTextContent('複驗治療更動後 1–3 個月複驗血脂。')
    expect(actions.querySelectorAll('[data-action-id]')).toHaveLength(3)
    expect(actions.querySelector('[data-action-kind="treatment"]')).toHaveTextContent('依目前分層與表一門檻核對現行降脂治療。')
  })

  it('states the effective no answer directly on the criterion row', () => {
    const base = coverageSummary()
    const criterion = base.diseaseChecks.find((check) => check.label === '慢性腎臟病')!
    const summary = {
      ...base,
      diseaseChecks: base.diseaseChecks.map((check) => check.id === criterion.id
        ? { ...check, state: 'no' as const, origin: 'physician' as const, value: '未找到可判讀資料' }
        : check),
    }
    render(
      <NhiTable1Panel
        summary={summary}
        locale="zh-TW"
        answerProvenance={{ [criterion.id]: { source: 'manual' } }}
      />,
    )

    expect(screen.getByRole('button', { name: criterion.label })).toHaveTextContent('不符合 · 未找到可判讀資料')
  })

  it('reports clinician corrections in the AI card and opens its exact source', () => {
    const base = coverageSummary()
    const summary = {
      ...base,
      factors: base.factors.map((check) => check.id === 'smoking'
        ? { ...check, state: 'no' as const, origin: 'physician' as const, value: '不符合' }
        : check),
    }
    const onNavigate = jest.fn()
    const aiAssist = {
      suggestions: {
        smoking: {
          criterionId: 'smoking',
          state: 'yes' as const,
          confidence: 'high' as const,
          rationale: '病歷記載目前抽菸。',
          missing: [],
          evidence: [{
            sourceKey: 'D1',
            sourceResourceType: 'DocumentReference',
            sourceResourceId: 'doc-smoking',
            sourceLabel: '出院病歷摘要',
            date: '2026-09-16',
            excerpt: '目前每日抽菸一包。',
          }],
          modelId: 'gpt-test',
          modelName: 'GPT Test',
          generatedAt: '2026-09-18T10:00:00+08:00',
        },
      },
      decisions: { smoking: 'applied' as const },
      isRunning: false,
      isDataReady: true,
      error: null,
      modelId: 'gpt-test',
      modelName: 'GPT Test',
      run,
      decide,
    }
    render(
      <NhiTable1Panel
        summary={summary}
        locale="zh-TW"
        patientId="patient-1"
        answerProvenance={{ smoking: { source: 'manual', overrides: 'ai' } }}
        onAnswer={jest.fn()}
        onNavigate={onNavigate}
        aiAssist={aiAssist}
      />,
    )

    expect(screen.getByText('0 項符合 · 1 項不符合 · 0 項未確認 · 1 項醫師修改。')).toBeInTheDocument()
    expect(screen.getByText('醫師已改為不符合。')).toBeInTheDocument()
    expect(screen.getByText('醫師已改為不符合。')).not.toBeVisible()
    fireEvent.click(screen.getByText('查看判讀結果與依據'))
    fireEvent.click(screen.getByText('判讀依據'))
    fireEvent.click(screen.getByRole('button', { name: /開啟原始病歷/ }))
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({
      resourceType: 'DocumentReference',
      resourceId: 'doc-smoking',
      evidenceQuote: '目前每日抽菸一包。',
    }))
  })
})
