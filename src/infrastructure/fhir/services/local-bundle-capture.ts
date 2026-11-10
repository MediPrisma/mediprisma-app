import type { HospitalCaptureEvent } from '@/src/shared/contracts/collector-event'
import { failureFromTag, type Tag } from '@/src/infrastructure/telemetry/hospital-capture'

// Why parts of the 北榮 capture in the active Bundle are missing, read from the
// bounded tags 北榮懷爾抓抓 writes (雲端懷爾抓抓 keeps them). Scoped to this tab's
// active Bundle like the extension version; no clinical content is retained.
const COMPLETENESS_SYSTEM = 'https://github.com/voho0000/EHR-FHIR-BRIDGE/CodeSystem/capture-completeness'

export interface LocalBundleCapture {
  failures: HospitalCaptureEvent['failures']
  /** 北榮懷爾抓抓 marked the capture partial but gave no structured reason (older versions). */
  incompleteWithoutReason: boolean
}

let active: LocalBundleCapture | null = null
const listeners = new Set<() => void>()

export function rememberLocalBundleCapture(bundle: unknown): void {
  const raw = (bundle as { meta?: { tag?: unknown } } | null)?.meta?.tag
  const tags: Tag[] = Array.isArray(raw) ? raw.filter((t: unknown): t is Tag => !!t && typeof t === 'object') : []
  const failures = tags.map(failureFromTag).filter(f => f !== null).slice(0, 40)
  const partial = tags.some(t => t.system === COMPLETENESS_SYSTEM && t.code === 'partial')
  const next = failures.length || partial ? { failures, incompleteWithoutReason: !failures.length } : null
  if (JSON.stringify(next) === JSON.stringify(active)) return
  active = next
  for (const listener of listeners) listener()
}

export function readLocalBundleCapture(): LocalBundleCapture | null { return active }

export function subscribeLocalBundleCapture(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
