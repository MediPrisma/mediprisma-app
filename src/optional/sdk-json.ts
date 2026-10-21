// The converter is optional; JSON parsing for ordinary FHIR imports is not.
import type { ClinicalSourceMetadata } from '@/src/core/entities/clinical-data.entity'
export const SDK_JSON_PACKAGE_VERSION = 'unavailable'
export type SdkConversionReport = {
  resourceCounts: Record<string, number>
  warnings: { code: string; count?: number }[]
  labDuplicateMerge: NonNullable<ClinicalSourceMetadata['labDuplicateMerge']>
  unitInference: NonNullable<ClinicalSourceMetadata['unitInference']>
  sourceCapabilities: NonNullable<ClinicalSourceMetadata['sourceCapabilities']>
}
export function parseJsonBytes(bytes: ArrayBuffer): unknown {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
}
export function convertSdkJsonToFhir(_input: unknown, _options?: { identifierMode: string }): {
  bundle: Record<string, unknown>; report: SdkConversionReport
} {
  throw new Error('此部署未安裝 SDK 轉換器，請上傳 FHIR Bundle。 / SDK conversion is unavailable; upload a FHIR Bundle.')
}
