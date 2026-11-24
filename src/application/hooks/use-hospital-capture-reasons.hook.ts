'use client'

import { useSyncExternalStore } from 'react'
import { readLocalBundleCapture, subscribeLocalBundleCapture, type LocalBundleCapture } from '@/src/infrastructure/fhir/services/local-bundle-capture'

/** What the active Bundle's 北榮 capture says of itself: what is missing and why, and whether 門診助理's stored record was used; null when it says neither. */
export function useHospitalCaptureReasons(): LocalBundleCapture | null {
  return useSyncExternalStore(subscribeLocalBundleCapture, readLocalBundleCapture, () => null)
}
