/** @jest-environment node */
import fixture from '@/e2e/fixtures/cross-source-prescriptions.json'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { createFhirTools } from '@/src/infrastructure/ai/tools/fhir-tools'

it('retains real identical orders and explicitly identifies possible source copies in AI tool data', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-10-20T08:00:00+08:00'))
  try {
    const parsed = LocalBundleService.parse(fixture)!
    const tools = createFhirTools(() => parsed)
    const result = await (tools.getActiveMedicationList as any).execute({})
    expect(result.count).toBe(5) // source records, including two unconfirmed copies
    expect(result.sourceComparisonCounts).toEqual({ sourceRecordCount: 5, comparisonGroupCount: 4, unconfirmedGroupCount: 1 })
    expect(result.data.filter((record: any) => /Metformin/i.test(record.medication))).toHaveLength(2)
    expect(result.data.filter((record: any) => record.sourceComparison?.status === 'candidate')).toHaveLength(2)
    expect(result.data.filter((record: any) => record.selfPurchased)).toHaveLength(1)
    expect(result.data.some((record: any) => record.status === 'cancelled')).toBe(false)
    expect(result.data.filter((record: any) => record.sourceComparison?.status === 'candidate')
      .every((record: any) => record.sourceComparisonInstruction.includes('Preserve distinct orders within each source'))).toBe(true)
  } finally { jest.useRealTimers() }
})
