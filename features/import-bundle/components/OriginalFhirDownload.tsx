'use client'

import { useEffect, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/src/application/providers/language.provider'
import { shouldUseLocalBundle } from '@/src/infrastructure/fhir/client/fhir-client.service'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { serializeLocalBundleMutation } from '@/src/infrastructure/fhir/services/local-bundle-mutation-queue'
import { BUNDLE_CHANGED_EVENT } from '@/src/shared/utils/reset-on-bundle-change'
import { dateStampForFilename } from '@/features/ips-export/utils/ips-helpers'

export function OriginalFhirDownload() {
  const { t } = useLanguage()
  const x = t.ipsExport
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
        const exists = await serializeLocalBundleMutation(async () => (
          shouldUseLocalBundle() && (await LocalBundleService.loadOriginalFhirJson()) !== null
        ))
        if (current === revision) setAvailable(exists)
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
        const json = shouldUseLocalBundle()
          ? await LocalBundleService.loadOriginalFhirJson()
          : null
        if (json === null) {
          setAvailable(false)
          return
        }
        const url = URL.createObjectURL(new Blob([json], { type: 'application/fhir+json;charset=utf-8' }))
        const link = document.createElement('a')
        link.href = url
        link.download = `FHIR_original_${dateStampForFilename()}.json`
        document.body.appendChild(link)
        try {
          link.click()
        } finally {
          link.remove()
          setTimeout(() => URL.revokeObjectURL(url), 0)
        }
      })
    } catch {
      setFailed(true)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <section aria-label={x.originalFhirTitle} className="mb-6 space-y-3 border-b pb-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{x.originalFhirTitle}</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{x.originalFhirDescription}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{x.originalFhirPrivacy}</p>
      </div>
      <Button
        type="button"
        variant="outline"
        className="min-h-11 gap-2"
        disabled={checking || !available || downloading}
        onClick={() => void download()}
      >
        {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {x.originalFhirDownload}
      </Button>
      {!checking && !available && !failed && (
        <p className="text-sm text-muted-foreground">{x.originalFhirUnavailable}</p>
      )}
      {failed && <p role="alert" className="text-sm text-destructive">{x.originalFhirError}</p>}
    </section>
  )
}
