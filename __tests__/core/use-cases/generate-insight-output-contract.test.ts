import { GenerateInsightUseCase } from '@/src/core/use-cases/clinical-insights/generate-insight.use-case'

describe('GenerateInsightUseCase output contracts', () => {
  const useCase = new GenerateInsightUseCase()
  const baseInput = {
    prompt: 'Use S:, O:, A:, P:. Keep English clinical content.',
    clinicalContext: 'Patient record',
    modelId: 'gpt-6-luna',
    locale: 'zh-TW' as const,
  }

  it('preserves physical line breaks and mixed-language prompt rules for plain text', () => {
    const messages = useCase.buildMessages({
      ...baseInput,
      outputFormat: 'plain-text',
      languagePolicy: 'follow-template',
    })

    expect(messages[0].content).toContain('Return plain text only')
    expect(messages[0].content).toContain('A single newline is meaningful')
    expect(messages[0].content).toContain('Preserve a deliberately mixed-language format')
    expect(messages[0].content).not.toContain('Use only Taiwanese Traditional Chinese')
    expect(messages[1].content).toContain('FINAL CHECK:')
    expect(messages[1].content).toContain('Preserve every requested physical line break')
  })

  it('keeps the legacy Markdown and interface-language behavior by default', () => {
    const messages = useCase.buildMessages(baseInput)

    expect(messages[0].content).toContain('Return Markdown only')
    expect(messages[0].content).toContain('Use only Taiwanese Traditional Chinese')
  })

  it('constrains HTML output to a safe semantic fragment', () => {
    const messages = useCase.buildMessages({
      ...baseInput,
      outputFormat: 'html',
      languagePolicy: 'follow-template',
    })

    expect(messages[0].content).toContain('safe semantic HTML fragment')
    expect(messages[0].content).toContain('Do not emit links, images, scripts, styles, forms')
  })
})
