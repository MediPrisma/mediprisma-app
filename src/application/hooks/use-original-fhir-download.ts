'use client'

import { useEffect, useState } from 'react'
import { shouldUseLocalBundle } from '@/src/infrastructure/fhir/client/fhir-client.service'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { serializeLocalBundleMutation } from '@/src/infrastructure/fhir/services/local-bundle-mutation-queue'
import { BUNDLE_CHANGED_EVENT } from '@/src/shared/utils/reset-on-bundle-change'

export function useOriginalFhirDownload() {
  const [isLocal, setIsLocal] = useState(false)
  const [available, setAvailable] = useState(false)
  const [checking, setChecking] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let revision = 0
    const sync = async () => {
      const current = ++revision
      setChecking(true)
      setAvailable(false)
      setFailed(false)
      try {
        const state = await serializeLocalBundleMutation(async () => {
          const local = shouldUseLocalBundle()
          return { local, exists: local && await LocalBundleService.hasOriginalFhir() }
        })
        if (current === revision) {
          setIsLocal(state.local)
          setAvailable(state.exists)
        }
      } catch {
        if (current === revision) setFailed(true)
      } finally {
        if (current === revision) setChecking(false)
      }
    }
    void sync()
    window.addEventListener(BUNDLE_CHANGED_EVENT, sync)
    return () => {
      revision++
      window.removeEventListener(BUNDLE_CHANGED_EVENT, sync)
    }
  }, [])

  const download = async () => {
    setDownloading(true)
    setFailed(false)
    try {
      await serializeLocalBundleMutation(async () => {
        // Read and download within the same import boundary, including on re-import.
        const original = shouldUseLocalBundle()
          ? await LocalBundleService.loadOriginalFhir()
          : null
        if (original === null) {
          setAvailable(false)
          return
        }
        const url = URL.createObjectURL(original)
        const link = document.createElement('a')
        link.href = url
        link.download = `FHIR_original_${new Date().toISOString().slice(0, 10)}.json`
        document.body.appendChild(link)
        try {
          link.click()
        } finally {
          link.remove()
          setTimeout(() => URL.revokeObjectURL(url), 30_000)
        }
      })
    } catch {
      setFailed(true)
    } finally {
      setDownloading(false)
    }
  }

  return { isLocal, available, checking, downloading, failed, download }
}
