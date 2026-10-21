'use client'

import { useEffect } from 'react'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { BUNDLE_CHANGED_EVENT } from '@/src/shared/utils/reset-on-bundle-change'
import { PROGRESSIVE_STATUS_MESSAGE, useProgressiveImportStore, isProgressiveFailureReason, stopProgressiveImport } from '../stores/progressive-import.store'

export function useProgressiveImportStatus() {
  const current = useProgressiveImportStore(state => state.current)
  useEffect(() => {
    const clearChanged = () => {
      const active = useProgressiveImportStore.getState().current
      if (active && active.importId !== LocalBundleService.getActiveImportId()) {
        useProgressiveImportStore.setState({ current: null })
      }
    }
    const receive = (event: MessageEvent) => {
      const data = event.data
      const active = useProgressiveImportStore.getState().current
      if (event.source !== window || event.origin !== location.origin
        || data?.source !== 'medcloud2-extension' || data.type !== PROGRESSIVE_STATUS_MESSAGE
        || data.version !== 1 || !isProgressiveFailureReason(data.phase)) return
      // A terminal message may name the previous snapshot if the App committed
      // before its receipt reached the extension. The run is the stable owner.
      if (active && active.runId === data.runId
        && LocalBundleService.getActiveImportId() !== active.importId) return
      stopProgressiveImport(data.runId, data.phase)
    }
    window.addEventListener(BUNDLE_CHANGED_EVENT, clearChanged)
    window.addEventListener('message', receive)
    return () => {
      window.removeEventListener(BUNDLE_CHANGED_EVENT, clearChanged)
      window.removeEventListener('message', receive)
    }
  }, [])
  return current
}
