import {
  SDK_JSON_PACKAGE_VERSION,
  convertSdkJsonToFhir,
  parseJsonBytes,
  type SdkConversionReport,
} from '@/vendor/nhi-fhir-bridge-sdk-json/browser.js'
import type { ClinicalSourceMetadata } from '@/src/core/entities/clinical-data.entity'

const MAX_SDK_IMPORT_BYTES = 32 * 1024 * 1024

export interface PreparedLocalImport {
  bundle: Record<string, unknown>
  /** Snapshot before application enrichment, parsing, and image extraction. */
  originalFhir: Blob
  sourceMetadata?: ClinicalSourceMetadata
}

function isFhirBundle(value: unknown): value is Record<string, unknown> {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && (value as { resourceType?: unknown }).resourceType === 'Bundle'
}

function sdkMetadata(
  report: SdkConversionReport,
  bundle: Record<string, unknown>,
): ClinicalSourceMetadata {
  return {
    source: 'health-bank-sdk-json',
    convertedAt: typeof bundle.timestamp === 'string'
      ? bundle.timestamp
      : new Date().toISOString(),
    converterVersion: SDK_JSON_PACKAGE_VERSION,
    resourceCounts: report.resourceCounts,
    warnings: report.warnings.map(({ code, count }) => ({
      code,
      ...(typeof count === 'number' ? { count } : {}),
    })),
    labDuplicateMerge: report.labDuplicateMerge,
    unitInference: {
      policyVersion: report.unitInference.policyVersion,
      inferredCount: report.unitInference.inferredCount,
      unitlessCount: report.unitInference.unitlessCount,
      unresolvedCount: report.unitInference.unresolvedCount,
    },
    sourceCapabilities: report.sourceCapabilities.map(({ key, availability }) => ({
      key,
      availability,
    })),
  }
}

export function convertLocalImportBytes(bytes: ArrayBuffer): PreparedLocalImport {
  const parsed = parseJsonBytes(bytes)
  if (isFhirBundle(parsed)) {
    return { bundle: parsed, originalFhir: new Blob([bytes], { type: 'application/fhir+json' }) }
  }

  if (bytes.byteLength > MAX_SDK_IMPORT_BYTES) {
    throw new Error('SDK JSON exceeds the 32 MB conversion limit')
  }
  const converted = convertSdkJsonToFhir(parsed, { identifierMode: 'masked' })
  return {
    bundle: converted.bundle,
    originalFhir: new Blob([JSON.stringify(converted.bundle)], { type: 'application/fhir+json' }),
    sourceMetadata: sdkMetadata(converted.report, converted.bundle),
  }
}
