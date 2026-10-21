'use client'

import { Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/src/application/providers/language.provider'
import { useOriginalFhirDownload } from '@/src/application/hooks/use-original-fhir-download'

export function OriginalFhirDownload() {
  const { t } = useLanguage()
  const x = t.ipsExport
  const { available, checking, downloading, failed, download } = useOriginalFhirDownload()

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
