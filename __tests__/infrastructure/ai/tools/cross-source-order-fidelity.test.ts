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

it.each([true, false])('reports cancelled hospital versus active cloud as uncertain, whether a module tag exists (%s)', async tagged => {
  jest.useFakeTimers().setSystemTime(new Date('2026-10-20T08:00:00+08:00'))
  try {
    const input: any = JSON.parse(JSON.stringify(fixture))
    input.entry.find((entry: any) => entry.resource.id === 'synthetic-order-a').resource.status = 'cancelled'
    const cloud = input.entry.find((entry: any) => entry.resource.id === 'synthetic-cloud-order-a').resource
    cloud.meta.tag = tagged ? [{ system: 'https://cloud-wildcatch.invalid/fhir/CodeSystem/source-module', code: 'imue0008' }] : undefined
    const parsed = LocalBundleService.parse(input)!
    const tools = createFhirTools(() => parsed)
    const result = await (tools.getActiveMedicationList as any).execute({})
    expect(result.data.some((record: any) => record.sourceComparison?.warnings?.includes('source-status-conflict'))).toBe(false)
    expect(result.uncertainData).toEqual(expect.arrayContaining([expect.objectContaining({
      sourceComparison: expect.objectContaining({ sourceStatuses: expect.arrayContaining([
        expect.objectContaining({ origin: 'hospital', status: 'cancelled', basis: 'source-status' }),
        expect.objectContaining({ origin: 'medcloud', status: 'active', basis: tagged ? 'coverage-estimate' : 'source-status' }),
      ]) }),
    })]))
    expect(result.canConcludeAbsence).toBe(false)
  } finally { jest.useRealTimers() }
})
