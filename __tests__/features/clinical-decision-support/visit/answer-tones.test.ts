import { answerToneClass, visitAnswerTone } from '@/features/clinical-decision-support/renderers/visit/answer-tones'

/**
 * A chosen every-visit answer wears the page's selection blue, unless the
 * answer is itself a clinical state: red for a warning, green for an
 * improvement (clinician feedback 2026-09-28: 「進步不是要綠色嗎」).
 */
describe('answer tones', () => {
  const chosen = (id: Parameters<typeof visitAnswerTone>[0], value: string) => answerToneClass(visitAnswerTone(id, value), true)

  it('greens 喘進步, reds 喘變差 and 體重增加, ambers 體重減少, and keeps the rest in the selection blue', () => {
    expect(chosen('dyspnoea-trend', 'better')).toContain('bg-emerald-50')
    expect(chosen('dyspnoea-trend', 'worse')).toContain('bg-destructive/10')
    expect(chosen('weight-trend', 'up')).toContain('bg-destructive/10')
    for (const [id, value] of [['dyspnoea-trend', 'stable'], ['weight-trend', 'same']] as const) {
      expect(chosen(id, value)).toContain('bg-primary/10')
    }
    // 體重減少 is neither good nor bad (dry weight, or dehydration): amber, 「look at which」.
    expect(chosen('weight-trend', 'down')).toContain('bg-amber-50')
    expect(answerToneClass(visitAnswerTone('weight-trend', 'down'), false)).toContain('border-amber-500/55')
  })

  // Clinician feedback 2026-09-28: 「沒選的時候可以只有外框有顏色，其他底色維持大家都一樣」.
  it('colours only an open answer’s frame, on the same ground as the others, and fills it in when chosen', () => {
    const open = (value: string) => answerToneClass(visitAnswerTone('dyspnoea-trend', value), false)
    expect(open('worse')).toContain('border-destructive/45')
    expect(open('stable')).toContain('border-primary/40')
    expect(open('better')).toContain('border-emerald-600/45')
    for (const value of ['worse', 'stable', 'better']) {
      expect(open(value)).toMatch(/(^| )bg-card( |$)/)
      expect(open(value)).not.toContain('font-semibold')
      expect(answerToneClass(visitAnswerTone('dyspnoea-trend', value), true)).toContain('font-semibold')
    }
  })
})
