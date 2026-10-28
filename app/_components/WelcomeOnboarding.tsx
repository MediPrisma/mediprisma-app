// Welcome / first-visit onboarding screen.
//
// Renders when neither a SMART-on-FHIR launch nor a locally-imported bundle
// is available. Replaces the empty/erroring panels with a friendly intro
// and a compact source chooser over a full-area drag-and-drop zone.
"use client"

import { useCallback, useRef, useState } from 'react'
import {
  ChevronRight,
  CloudDownload,
  FileUp,
  FlaskConical,
  Hospital,
  Shield,
  type LucideIcon,
} from 'lucide-react'
import { useLanguage } from '@/src/application/providers/language.provider'
import { useImportBundle, type DemoDataVariant } from '@/features/import-bundle/hooks/useImportBundle'
import { BundleFileInput, type BundleFileInputHandle } from '@/features/import-bundle/components/BundleFileInput'
import { Button } from '@/components/ui/button'
import { getLocaleDisplayName, type Locale } from '@/src/shared/i18n/i18n.config'
import { cn } from '@/src/shared/utils/cn.utils'

interface WelcomeSourceOptionProps {
  icon: LucideIcon
  title: string
  description: string
  tone?: 'default' | 'featured' | 'informational'
  onClick?: () => void
  disabled?: boolean
  testId?: string
  /** Keeps the phone layout (icon beside the text) at every width, so two
   *  options can share one column. */
  compact?: boolean
}

function WelcomeSourceOption({
  icon: Icon,
  title,
  description,
  tone = 'default',
  onClick,
  disabled,
  testId,
  compact = false,
}: WelcomeSourceOptionProps) {
  const interactive = Boolean(onClick)
  const content = (
    <>
      <div
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
          !compact && 'sm:mb-5',
          tone === 'informational'
            ? 'bg-muted text-muted-foreground'
            : tone === 'featured'
              ? 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-emerald-950'
            : 'bg-primary/10 text-primary',
        )}
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-foreground sm:text-lg">
          {title}
        </h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground sm:mt-2">
          {description}
        </p>
      </div>
      {interactive && (
        <ChevronRight
          className={cn(
            'h-4 w-4 shrink-0 self-center text-muted-foreground',
            !compact && 'sm:mt-auto sm:self-end sm:pt-4',
            tone === 'featured'
              ? 'group-hover:text-emerald-600 dark:group-hover:text-emerald-400'
              : 'group-hover:text-primary',
          )}
          aria-hidden="true"
        />
      )}
    </>
  )
  const className = cn(
    'group grid grid-cols-[auto_1fr_auto] items-start gap-3 rounded-lg border p-4 text-left',
    compact ? 'sm:p-5' : 'sm:flex sm:min-h-52 sm:flex-col sm:p-6',
    tone === 'featured' &&
      'border-emerald-300/80 bg-emerald-50/65 hover:border-emerald-500/70 hover:bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/[0.07] dark:hover:border-emerald-400/45 dark:hover:bg-emerald-500/[0.10]',
    tone === 'default' &&
      'border-border bg-card hover:border-primary/40 hover:bg-primary/[0.03]',
    tone === 'informational' &&
      'border-dashed border-border bg-muted/30',
  )

  if (!interactive) {
    return <div className={className}>{content}</div>
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={cn(
        className,
        'cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        tone === 'featured' ? 'focus-visible:ring-emerald-500' : 'focus-visible:ring-primary',
      )}
    >
      {content}
    </button>
  )
}

export function WelcomeOnboarding() {
  const { t, locale, setLocale } = useLanguage()
  const w = (t as any).welcome ?? {}
  const i18n = t.importBundle
  const languageLabel = locale === 'en' ? 'Language' : 'Language / 語言'

  const { importFile, loadDemo, loading, error } = useImportBundle()
  const [isDragging, setIsDragging] = useState(false)
  const dragCounter = useRef(0)

  // The "從本地匯入" card and the header CTA (ImportBundleButton) share ONE
  // input implementation (BundleFileInput) so accepted file types + import
  // handling live in a single place; this ref just opens its picker.
  const localCardFileRef = useRef<BundleFileInputHandle>(null)

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Only count file drags (ignore in-page text/element drags).
    if (!e.dataTransfer?.types?.includes('Files')) return
    dragCounter.current += 1
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current -= 1
    if (dragCounter.current <= 0) {
      dragCounter.current = 0
      setIsDragging(false)
    }
  }, [])

  // `dragover` fires continuously while a file is over the zone; must
  // preventDefault() so the browser allows the drop event to fire.
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleLoadDemo = useCallback(async (variant: DemoDataVariant) => {
    try {
      await loadDemo(variant)
    } catch {
      // error surfaces via the hook's `error` state
    }
  }, [loadDemo])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current = 0
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    try {
      await importFile(file)
    } catch {
      // error is surfaced via the hook's `error` state below.
    }
  }, [importFile])

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={cn(
        'relative flex min-h-full w-full items-start justify-center bg-muted/35 px-4 py-8 transition-colors dark:bg-background sm:px-6 lg:py-12',
        isDragging && 'bg-primary/[0.09] dark:bg-primary/[0.08]',
      )}
    >
      {/* Drag-over overlay — covers the screen with a dashed border so the
          drop target is unambiguous. */}
      {isDragging && (
        <div className="pointer-events-none absolute inset-4 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-background/95">
          <div className="flex flex-col items-center gap-2 text-primary">
            <FileUp className="h-10 w-10" />
            <p className="text-base font-semibold">
              {w.dropHere ?? 'Drop FHIR Bundle to import'}
            </p>
          </div>
        </div>
      )}

      <div className="my-auto w-full max-w-5xl text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center overflow-hidden">
          <img
            src={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/icon.svg?v=3`}
            alt="App Icon"
            className="h-full w-full object-contain"
          />
        </div>

        <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {w.title ?? 'Welcome'}
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          {w.description ?? 'Import a FHIR Bundle or launch from your EHR to get started.'}
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">
            {languageLabel}
          </span>
          <div
            role="group"
            aria-label={languageLabel}
            className="inline-flex items-center rounded-lg border border-border bg-background p-1"
          >
            {(['zh-TW', 'en'] as Locale[]).map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={locale === value ? 'secondary' : 'ghost'}
                aria-pressed={locale === value}
                onClick={() => setLocale(value)}
                className="h-11 px-3 shadow-none sm:h-8"
              >
                {getLocaleDisplayName(value, locale)}
              </Button>
            ))}
          </div>
        </div>

        {loading && (
          <p className="mt-4 text-sm text-primary" role="status" aria-live="polite">
            {i18n.importing}…
          </p>
        )}
        {error && (
          <p className="mt-4 text-sm text-destructive" role="alert">{error}</p>
        )}

        {/* The welcome screen is an entry point, not a dense clinical view.
            The source options make the available paths understandable at a
            glance while a shared component keeps their structure aligned. The
            two 試用資料 are the same patient seen through 健康存摺 and through
            雲端病歷, so they share the middle column as one choice. */}
        <section className="mt-8 grid gap-3 sm:grid-cols-3 lg:gap-4">
          <WelcomeSourceOption
            icon={FileUp}
            title={w.localTitle ?? 'Local FHIR Bundle'}
            description={w.localDesc ?? 'Import a JSON bundle — data stays in your browser.'}
            onClick={() => localCardFileRef.current?.open()}
            disabled={loading}
          />

          <div className="flex flex-col gap-3 lg:gap-4">
            <WelcomeSourceOption
              icon={CloudDownload}
              title={w.medcloudDemoTitle ?? 'Demo data (NHI MediCloud)'}
              description={w.medcloudDemoDesc ?? 'The same sample patient as seen in NHI MediCloud — explore without importing anything.'}
              tone="featured"
              onClick={() => handleLoadDemo('medcloud')}
              disabled={loading}
              testId="welcome-medcloud-demo-card"
              compact
            />

            <WelcomeSourceOption
              icon={FlaskConical}
              title={w.demoTitle ?? 'Demo data (My Health Bank)'}
              description={w.demoDesc ?? 'Load an anonymised sample patient — explore without importing anything.'}
              tone="featured"
              onClick={() => handleLoadDemo('health-bank')}
              disabled={loading}
              testId="welcome-demo-card"
              compact
            />
          </div>

          <WelcomeSourceOption
            icon={Hospital}
            title={w.smartTitle ?? 'SMART-on-FHIR'}
            description={w.smartDesc ?? 'Launch from a hospital EHR — patient data loads automatically.'}
            tone="informational"
          />
        </section>

        <div className="mt-6 flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground sm:flex-row sm:gap-5">
          <p>{w.dragHint ?? 'Tip: you can also drag a .json file anywhere on this screen to import.'}</p>
          <div className="flex items-center gap-2">
            <Shield className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{w.privacyNote ?? 'Imported bundles stay in your browser only.'}</span>
          </div>
        </div>

        <BundleFileInput ref={localCardFileRef} importFile={importFile} />
      </div>
    </div>
  )
}
