// Whether 院內 Gemini can be picked right now, shared by every ModelPicker.
// Checked when a picker mounts and whenever a model menu opens, at most once
// every few seconds; never polled in the background.
import { useEffect, useSyncExternalStore } from 'react'
import {
  getHospitalGeminiStatus,
  type HospitalGeminiStatus,
} from '@/src/infrastructure/ai/hospital-gemini/hospital-gemini-bridge'

const MIN_INTERVAL_MS = 2_000

let current: HospitalGeminiStatus = 'unavailable'
let lastCheck = -Infinity
let pending: Promise<void> | null = null
const listeners = new Set<() => void>()

export function refreshHospitalGeminiStatus(
  { force = false, check = getHospitalGeminiStatus }: { force?: boolean; check?: () => Promise<HospitalGeminiStatus> } = {},
): Promise<void> {
  if (pending) return pending
  if (!force && Date.now() - lastCheck < MIN_INTERVAL_MS) return Promise.resolve()
  lastCheck = Date.now()
  pending = check()
    .catch((): HospitalGeminiStatus => 'unavailable')
    .then((status) => {
      if (status !== current) {
        current = status
        listeners.forEach((listener) => listener())
      }
    })
    .finally(() => { pending = null })
  return pending
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useHospitalGeminiStatus(): HospitalGeminiStatus {
  useEffect(() => { void refreshHospitalGeminiStatus() }, [])
  return useSyncExternalStore(subscribe, () => current, () => 'unavailable')
}

/** Test seam. */
export function resetHospitalGeminiStatus(): void {
  current = 'unavailable'
  lastCheck = -Infinity
  pending = null
}
