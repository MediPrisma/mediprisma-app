import { containsSimplifiedChinese, MAINLAND_TO_TAIWAN_TERMS, SIMPLIFIED_TO_TRADITIONAL, toTraditionalChinese } from '@/src/core/utils/zh-hant-normalize.utils'

describe('toTraditionalChinese', () => {
  it('repairs Simplified-only characters in generated prose', () => {
    expect(toTraditionalChinese('血糖控制不佳，建议调整药物并复诊')).toBe('血糖控制不佳，建議調整藥物並複診')
    expect(toTraditionalChinese('肾脏功能检查')).toBe('腎臟功能檢查')
  })

  it('uses context-dependent Traditional forms for known phrases', () => {
    expect(toTraditionalChinese('重复用药')).toBe('重複用藥')
    expect(toTraditionalChinese('恢复良好，无复发')).toBe('恢復良好，無復發')
    expect(toTraditionalChinese('合并症与并发症')).toBe('合併症與併發症')
  })

  it('leaves Traditional and mixed Latin text unchanged', () => {
    const traditional = '疑似肺炎，出院後門診追蹤。HbA1c 8.2%，Metformin 500mg BID'
    expect(toTraditionalChinese(traditional)).toBe(traditional)
    expect(containsSimplifiedChinese(traditional)).toBe(false)
    expect(toTraditionalChinese(undefined)).toBeUndefined()
    expect(toTraditionalChinese('')).toBe('')
  })

  it('replaces Mainland clinical vocabulary with Taiwan usage, not just glyphs', () => {
    expect(toTraditionalChinese('血肌酐升高，谷丙转氨酶正常，建议随访')).toBe('血肌酸酐升高，ALT正常，建議追蹤')
    expect(toTraditionalChinese('糖化血红蛋白 8.2%，甘油三酯偏高')).toBe('糖化血色素 8.2%，三酸甘油酯偏高')
    expect(toTraditionalChinese('服用二甲双胍与阿司匹林')).toBe('服用Metformin與Aspirin')
    expect(toTraditionalChinese('轉氨酶上升')).toBe('轉胺酶上升') // Traditional glyphs, Mainland word
  })

  it('never double-applies a term that is already in Taiwan form', () => {
    for (const text of ['腦梗塞病史', '心肌梗塞', '肌酸酐 1.2', '糖化血色素', '三酸甘油酯', '轉胺酶', '追蹤', '患者', '數據', '冠心病'])
      expect(toTraditionalChinese(text)).toBe(text)
    expect(toTraditionalChinese('疑似腦梗')).toBe('疑似腦梗塞')
    expect(toTraditionalChinese('急性心梗')).toBe('急性心肌梗塞')
  })

  it('converts full Mainland infarction terms before their abbreviations', () => {
    expect(toTraditionalChinese('腦梗死病史')).toBe('腦梗塞病史')
    expect(toTraditionalChinese('脑梗死病史')).toBe('腦梗塞病史')
    expect(toTraditionalChinese('急性心肌梗死')).toBe('急性心肌梗塞')
    expect(toTraditionalChinese('陳舊性心梗死')).toBe('陳舊性心肌梗塞')
    expect(toTraditionalChinese('肺梗死')).toBe('肺梗塞')
    expect(toTraditionalChinese('心梗塞')).toBe('心梗塞') // never 心肌梗塞塞
    expect(toTraditionalChinese('房顫動')).toBe('房顫動') // never 心房顫動動
    for (const [, tw] of MAINLAND_TO_TAIWAN_TERMS) expect(toTraditionalChinese(tw)).toBe(tw)
  })

  it('map is single-character, non-chaining and never rewrites a Traditional character', () => {
    for (const [from, to] of SIMPLIFIED_TO_TRADITIONAL) {
      expect([...from]).toHaveLength(1)
      expect([...to]).toHaveLength(1)
      expect(SIMPLIFIED_TO_TRADITIONAL.has(to)).toBe(false)
    }
    expect(SIMPLIFIED_TO_TRADITIONAL.get('单')).toBe('單')
  })

  it('never maps a character onto another mapped Simplified character', () => {
    const sample = '这们个为来时会说对发经过还进现实与关开问题应从动学种长样体点员书业务医药疗检诊断'
    const converted = toTraditionalChinese(sample)
    expect(containsSimplifiedChinese(converted)).toBe(false)
    expect([...converted]).toHaveLength([...sample].length)
  })
})
