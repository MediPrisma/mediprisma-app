import { GenerateInsightUseCase } from '@/src/core/use-cases/clinical-insights/generate-insight.use-case'
import type { GenerateInsightInput } from '@/src/core/use-cases/clinical-insights/generate-insight.use-case'

describe('GenerateInsightUseCase', () => {
  let useCase: GenerateInsightUseCase

  beforeEach(() => {
    useCase = new GenerateInsightUseCase()
  })

  describe('buildMessages', () => {
    it('should build messages with system instruction', () => {
      const input: GenerateInsightInput = {
        prompt: 'Analyze patient vitals',
        clinicalContext: 'BP: 140/90, HR: 85',
        modelId: 'gpt-4'
      }

      const messages = useCase.buildMessages(input)

      expect(messages).toHaveLength(2)
      expect(messages[0].role).toBe('system')
      expect(messages[0].content).toContain('clinical assistant')
      expect(messages[0].content).toContain('PATIENT-RECORD GROUNDING CONTRACT')
      expect(messages[0].content).toContain('MARKDOWN FORMAT')
      expect(messages[0].content).toContain('**Label**: value')
    })

    it('should include prompt and clinical context in user message', () => {
      const input: GenerateInsightInput = {
        prompt: 'Analyze patient vitals',
        clinicalContext: 'BP: 140/90, HR: 85',
        modelId: 'gpt-4'
      }

      const messages = useCase.buildMessages(input)

      expect(messages[1].role).toBe('user')
      expect(messages[1].content).toContain('Analyze patient vitals')
      expect(messages[1].content).toContain('BP: 140/90, HR: 85')
      expect(messages[1].content).toContain('PATIENT CLINICAL CONTEXT')
    })

    it('bookends Taiwanese Traditional Chinese and grounding rules for local models', () => {
      const messages = useCase.buildMessages({
        prompt: '請整理用藥',
        clinicalContext: 'Aromasin 25 mg',
        modelId: 'openai-compatible-custom:test-profile',
        locale: 'zh-TW',
      })

      expect(messages[0].content.match(/Taiwanese Traditional Chinese/g)?.length).toBe(1)
      expect(messages[0].content).toContain('You summarize the supplied patient record')
      expect(messages[0].content).toContain('Copy medication names, dose, status, dates, and values exactly')
      expect(messages[1].content).toContain('BEGIN UNTRUSTED PATIENT CLINICAL CONTEXT')
      expect(messages[1].content).toContain('END UNTRUSTED PATIENT CLINICAL CONTEXT')
    })

    it('places an ICD code reference at the top of the context and adds the code guard', () => {
      const base = {
        prompt: 'HMC template with ICD-9 block',
        clinicalContext: 'Visits & Treatment History:\nsynthetic visit',
        modelId: 'openai-compatible-custom:test-profile',
        locale: 'zh-TW' as const,
      }
      const plain = useCase.buildMessages(base)
      const withReference = useCase.buildMessages({ ...base, icdCodeReference: 'ICD code reference: 1 code\n\n' })

      expect(plain[0].content).not.toContain('DIAGNOSIS CODES')
      expect(withReference[0].content).toBe(
        `${plain[0].content}\n\nDIAGNOSIS CODES: In any ICD code list, use only codes that appear in the supplied record or its ICD code reference. ` +
        'Never recall or enumerate codes from memory; for a supported diagnosis without a supplied code, write the name and leave the code blank. ' +
        'From the ICD code reference, copy a SINGLE code; write every part of a COMBINATION, one code from each { } group; ' +
        'use at most one of ALTERNATIVES, and only when the record states which applies. ' +
        'When the record cannot decide, keep the ICD-10-CM code and leave the ICD-9-CM code blank, marked "ICD-9 待確認". ' +
        'Write each diagnosis at most once per block, then continue to the next section.',
      )
      expect(withReference[1].content).toContain(
        '--- BEGIN UNTRUSTED PATIENT CLINICAL CONTEXT ---\nICD code reference: 1 code\n\nVisits & Treatment History:\nsynthetic visit\n',
      )
      expect(withReference[1].content.replace('ICD code reference: 1 code\n\n', '')).toBe(plain[1].content)
    })

    it('should handle empty clinical context', () => {
      const input: GenerateInsightInput = {
        prompt: 'General inquiry',
        clinicalContext: '',
        modelId: 'gpt-4'
      }

      const messages = useCase.buildMessages(input)

      expect(messages).toHaveLength(2)
      expect(messages[1].content).toContain('General inquiry')
    })

    it('should handle long prompts', () => {
      const longPrompt = 'A'.repeat(1000)
      const input: GenerateInsightInput = {
        prompt: longPrompt,
        clinicalContext: 'Context',
        modelId: 'gpt-4'
      }

      const messages = useCase.buildMessages(input)

      expect(messages[1].content).toContain(longPrompt)
    })

    it('should handle special characters in prompt', () => {
      const input: GenerateInsightInput = {
        prompt: 'What is the patient\'s "condition"?',
        clinicalContext: 'Test & context',
        modelId: 'gpt-4'
      }

      const messages = useCase.buildMessages(input)

      expect(messages[1].content).toContain('What is the patient\'s "condition"?')
      expect(messages[1].content).toContain('Test & context')
    })

    it('scrubs patient literals from user-editable prompts and context', () => {
      const messages = useCase.buildMessages({
        prompt: '分析王小明的風險',
        clinicalContext: '王小明 eGFR 32',
        piiLiterals: ['王小明'],
        modelId: 'gpt-4',
      })
      expect(messages[1].content).not.toContain('王小明')
      expect(messages[1].content.match(/\[已遮蔽\]/g)?.length).toBe(2)
    })
  })
})
