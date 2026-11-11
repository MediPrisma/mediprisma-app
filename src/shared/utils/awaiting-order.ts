// An outpatient order the hospital bridge delivered with its "awaiting-report"
// tag: written at the visit, with no request number or report in HIS yet. The
// tag does not say the sample or examination has not been done.

const ORDER_REPORT_STATE = 'https://github.com/voho0000/EHR-FHIR-BRIDGE/CodeSystem/order-report-state'
const AWAITING_REPORT = 'awaiting-report'

export type AwaitingOrder = {
  id: string
  label: string
  /** Booked for a later day (the source's APPOINT frequency). */
  appointment: boolean
}

export function toAwaitingOrder(order: any): AwaitingOrder | null {
  const tagged = Array.isArray(order?.meta?.tag) && order.meta.tag.some((tag: any) =>
    tag?.system === ORDER_REPORT_STATE && tag?.code === AWAITING_REPORT)
  if (!tagged || typeof order.id !== 'string' || !order.id) return null
  const display = order.code?.text || order.code?.coding?.find((coding: any) => coding?.display)?.display
  // The source ends a panel member's name with its list separator ("CBC,").
  const label = typeof display === 'string' ? display.trim().replace(/[,，]\s*$/, '') : ''
  if (!label) return null
  const appointment = Array.isArray(order.orderDetail) && order.orderDetail.some((detail: any) =>
    typeof detail?.text === 'string' && /^頻次[:：]\s*APPOINT\s*$/i.test(detail.text.trim()))
  return { id: order.id, label, appointment }
}
