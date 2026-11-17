import {
  REPORT_INTERPRETATION_CUSTOM_PROMPT_MAX_LENGTH,
  REPORT_INTERPRETATION_DEFAULT_MODEL_ID,
  defaultReportInterpretationPrompt,
  resolveReportInterpretationModel,
  resolveReportInterpretationPrompt,
  useReportInterpretationPrefsStore,
} from '@/src/application/stores/report-interpretation-prefs.store'

describe('report interpretation preferences', () => {
  beforeEach(() => {
    localStorage.clear()
    useReportInterpretationPrefsStore.setState({
      modelId: REPORT_INTERPRETATION_DEFAULT_MODEL_ID,
      customPrompt: '',
    })
  })

  it('defaults to the original Gemini model', () => {
    expect(useReportInterpretationPrefsStore.getState().modelId)
      .toBe('gemini-3.1-flash-lite')
  })

  it('shows a real default prompt instead of an empty custom-instruction field', () => {
    expect(resolveReportInterpretationPrompt(
      useReportInterpretationPrefsStore.getState().customPrompt,
      'zh-TW',
    )).toBe(defaultReportInterpretationPrompt('zh-TW'))
    expect(defaultReportInterpretationPrompt('zh-TW'))
      .toContain('請忠實翻譯這份臨床文件')
    expect(defaultReportInterpretationPrompt('en'))
      .toContain('Faithfully translate this clinical document')
  })

  it('saves an explicitly selected custom endpoint as the report model', () => {
    useReportInterpretationPrefsStore.getState().setModelId(
      'openai-compatible-custom:hospital-model',
    )

    expect(useReportInterpretationPrefsStore.getState().modelId)
      .toBe('openai-compatible-custom:hospital-model')
    expect(resolveReportInterpretationModel(
      'openai-compatible-custom:hospital-model',
      {},
    )).toBe('openai-compatible-custom:hospital-model')
  })

  it('saves a selectable cloud model preference', () => {
    useReportInterpretationPrefsStore.getState().setModelId('gpt-6-luna')

    expect(useReportInterpretationPrefsStore.getState().modelId)
      .toBe('gpt-6-luna')
  })

  it('falls back to Gemini when a selected cloud model has no required key', () => {
    expect(resolveReportInterpretationModel('gpt-6.1-terra', {}))
      .toBe(REPORT_INTERPRETATION_DEFAULT_MODEL_ID)
    expect(resolveReportInterpretationModel('gpt-6.1-terra', {
      openAiKey: 'test-key',
    })).toBe('gpt-6.1-terra')
  })

  it('bounds the saved custom prompt', () => {
    useReportInterpretationPrefsStore.getState().setCustomPrompt(
      'a'.repeat(REPORT_INTERPRETATION_CUSTOM_PROMPT_MAX_LENGTH + 25),
    )

    expect(useReportInterpretationPrefsStore.getState().customPrompt)
      .toHaveLength(REPORT_INTERPRETATION_CUSTOM_PROMPT_MAX_LENGTH)
  })

  it('treats a blank saved prompt as the visible default prompt', () => {
    useReportInterpretationPrefsStore.getState().setCustomPrompt('   ')

    expect(useReportInterpretationPrefsStore.getState().customPrompt)
      .toBe('')
    expect(resolveReportInterpretationPrompt('', 'zh-TW'))
      .toBe(defaultReportInterpretationPrompt('zh-TW'))
  })

  it('migrates a previously persisted blank prompt to the visible default', async () => {
    localStorage.setItem('report-interpretation-prefs', JSON.stringify({
      state: {
        modelId: REPORT_INTERPRETATION_DEFAULT_MODEL_ID,
        customPrompt: '',
      },
      version: 0,
    }))

    await useReportInterpretationPrefsStore.persist.rehydrate()

    expect(useReportInterpretationPrefsStore.getState().customPrompt)
      .toBe('')
  })

  it('migrates the earlier saved default text back to the locale-aware default', async () => {
    localStorage.setItem('report-interpretation-prefs', JSON.stringify({
      state: {
        modelId: REPORT_INTERPRETATION_DEFAULT_MODEL_ID,
        customPrompt: defaultReportInterpretationPrompt('zh-TW'),
      },
      version: 0,
    }))

    await useReportInterpretationPrefsStore.persist.rehydrate()

    expect(useReportInterpretationPrefsStore.getState().customPrompt).toBe('')
    expect(resolveReportInterpretationPrompt('', 'en'))
      .toBe(defaultReportInterpretationPrompt('en'))
  })
})
