import { consolidateCardErrors } from "@/features/medical-summary/utils/consolidate-card-errors"
import { MEDICAL_SUMMARY_CARD_IDS } from "@/src/core/entities/medical-summary.entity"

const allFailed = MEDICAL_SUMMARY_CARD_IDS.map((label) => ({ label, message: "連線失敗" }))
const cardCount = MEDICAL_SUMMARY_CARD_IDS.length

describe("consolidateCardErrors", () => {
  it("shows one summary error when every card reports the same message", () => {
    expect(consolidateCardErrors(allFailed, "醫療摘要")).toEqual([
      { label: "醫療摘要", message: "連線失敗" },
    ])
  })

  it.each([1, 3, cardCount - 1])("preserves individual labels when only %i cards fail", (count) => {
    const partial = allFailed.slice(0, count)
    expect(consolidateCardErrors(partial, "醫療摘要")).toEqual(partial)
  })

  it("preserves all messages if one card has a different displayed error", () => {
    const mixed = allFailed.map((item, index) => index === cardCount - 1
      ? { ...item, message: "安全警示解析失敗" } : item)
    expect(consolidateCardErrors(mixed, "醫療摘要")).toEqual(mixed)
  })

  it("does not trim or normalize differences in displayed errors", () => {
    const mixed = allFailed.map((item, index) => index === 0
      ? { ...item, message: item.message + " " } : item)
    expect(consolidateCardErrors(mixed, "醫療摘要")).toEqual(mixed)
  })

  it("adds no error when all cards succeed", () => {
    expect(consolidateCardErrors([], "醫療摘要")).toEqual([])
  })
})
