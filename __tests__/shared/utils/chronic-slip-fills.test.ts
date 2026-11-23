import { chronicSlipFills } from '@/src/shared/utils/medication-source-markers'

describe('chronicSlipFills', () => {
  it('reads the structured fill count first', () => {
    expect(chronicSlipFills({ dispenseRequest: { numberOfRepeatsAllowed: 2 } }, 7)).toBe(3)
    expect(chronicSlipFills({ dispenseRequest: { numberOfRepeatsAllowed: 1 } }, undefined)).toBe(2)
  })

  it('reads the months of a 慢簽 remark when each fill is about a month', () => {
    expect(chronicSlipFills({ note: [{ text: '慢簽(三個月)' }] }, 30)).toBe(3)
    expect(chronicSlipFills({ note: [{ text: '慢箋（2個月）' }] }, 28)).toBe(2)
    expect(chronicSlipFills({ note: [{ text: '慢簽(三個月)' }] }, 14)).toBeUndefined()
    expect(chronicSlipFills({ note: [{ text: '慢簽' }] }, 30)).toBeUndefined()
    expect(chronicSlipFills({ note: [{ text: '慢簽(五個月)' }] }, 30)).toBeUndefined()
    expect(chronicSlipFills({ dispenseRequest: { numberOfRepeatsAllowed: 5 } }, 30)).toBeUndefined()
  })
})
