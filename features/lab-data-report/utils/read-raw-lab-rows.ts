// Glue between the lab-data report dialog and the 雲端病歷 extension: find the
// imported Bundle.id, read the same-run capture, and narrow it to lab rows
// straight away. The raw JSON never leaves this function.
import { getImportedBundleId } from '@/src/application/composition'
import type { LabDataReportRawError } from '../types'
import { isRawCaptureBundleId, requestRawCapture } from './raw-capture-client'
import { extractRawLabRows, type RawLabExtract } from './raw-lab-rows'

export type RawLabRead =
  | { ok: true; extract: RawLabExtract; expiresAt: number; producerVersion?: string }
  | { ok: false; code: LabDataReportRawError | 'ABORTED' }

/** The original Bundle.id of the imported bundle (the extension pairs its
 *  capture with it), or null when there is none to ask for. */
export async function importedBundleId(): Promise<string | null> {
  const id = await getImportedBundleId()
  return isRawCaptureBundleId(id) ? id : null
}

export async function readRawLabRows(bundleId: string, { signal }: { signal?: AbortSignal } = {}): Promise<RawLabRead> {
  const result = await requestRawCapture(bundleId, { signal })
  if (!result.ok) return { ok: false, code: result.code }
  const extract = extractRawLabRows(result.json)
  if (!extract) return { ok: false, code: 'NO_LAB_SOURCE' }
  return {
    ok: true,
    extract,
    expiresAt: result.metadata.expiresAt,
    ...(result.metadata.producerVersion && { producerVersion: result.metadata.producerVersion }),
  }
}
