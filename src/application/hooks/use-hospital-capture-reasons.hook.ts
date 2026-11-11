'use client'

import { useSyncExternalStore } from 'react'
import { readLocalBundleCapture, subscribeLocalBundleCapture, type LocalBundleCapture } from '@/src/infrastructure/fhir/services/local-bundle-capture'

/** Why parts of the active Bundle's 北榮 capture are missing; null when nothing is known to be missing. */
export function useHospitalCaptureReasons(): LocalBundleCapture | null {
  return useSyncExternalStore(subscribeLocalBundleCapture, readLocalBundleCapture, () => null)
}
