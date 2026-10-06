"use client"

// 回報檢驗資料問題 — built for a busy clinic: 回報 → 送出 → 確定送出, no
// required field. Every laboratory row of the cumulative report is sent (one
// mis-filed result usually shows up in two panels at once); ticking the
// panels that look wrong, the problem type and a one-line note are optional.
// The per-row preview and the full disclosure are folded, one click away.
// Nothing leaves the browser before the second confirmation.
//
// The preview table and the JSON view render the SAME payload object that is
// posted (see buildLabDataReport), so what is shown is what is sent.
//
// On `?site=vghtpe` the form also asks where the report goes: 團隊和機構
// (default), 僅機構, or 僅連線測試, which sends no patient data at all. The
// institution is the hospital's own Gateway; until a build names one, it is
// never contacted.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { AlertCircle, Check, ChevronDown, ChevronUp, Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useLanguage } from "@/src/application/providers/language.provider"
import { useAudience } from "@/src/application/providers/audience.provider"
import { detectLaunchSource, detectSite } from "@/src/application/telemetry/launch-context"
import { useAppVersion } from "@/src/shared/hooks/use-app-version.hook"
import { getLabRowDisplayParts } from "@/src/shared/utils/lab-analyte-display.utils"
import { cn } from "@/src/shared/utils/cn.utils"
import type { AnalyteNameMode } from "@voho0000/clinical-lab-normalization/display"
import {
  buildLabDataReport,
  collectLabDataReportCandidates,
  detectLabDataSource,
  type LabDataReportLabelResolver,
} from "../utils/build-lab-data-report"
import { findDescriptionIdentifiers } from "../utils/identifier-scan"
import { rawCaptureOrigin } from "../utils/raw-capture-client"
import { assembleRawLabSource, type RawLabExtract } from "../utils/raw-lab-rows"
import { importedBundleId, readRawLabRows, type RawLabRead } from "../utils/read-raw-lab-rows"
import { sendLabDataReportInBackground } from "../utils/send-in-background"
import {
  resolveInstitutionReportUrl,
  testLabDataReportConnection,
  type LabDataReportConnectionResult,
  type LabDataReportDestination,
  type LabDataReportSubmitResult,
} from "../utils/submit-lab-data-report"
import {
  LAB_DATA_REPORT_MAX_DESCRIPTION,
  LAB_DATA_REPORT_MAX_ROWS,
  LAB_DATA_REPORT_PROBLEM_TYPES,
  type LabDataReportContext,
  type LabDataReportPayload,
  type LabDataReportProblemType,
  type LabDataReportRawError,
  type LabDataReportRawRow,
  type LabDataReportRawSource,
  type LabDataReportRow,
} from "../types"

export interface LabDataReportPanel {
  id: string
  label: string
}

export interface LabDataReportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Panels that have data, in the clinician's order. */
  panels: readonly LabDataReportPanel[]
  observations: readonly any[]
  nameMode: AnalyteNameMode
}

type Strings = Record<string, any>

/** The extension's same-run raw capture, as far as this dialog holds it:
 *  only the narrowed lab rows, never the capture itself, and only until the
 *  dialog closes or the capture's own expiry. */
type RawState =
  | { status: 'idle' }
  | { status: 'reading' }
  | { status: 'ready'; extract: RawLabExtract; expiresAt: number; producerVersion?: string }
  | { status: 'failed'; code: LabDataReportRawError }

/** 送給, asked on `?site=vghtpe` only; elsewhere a report goes to the team. */
type Delivery = 'team-and-institution' | 'institution' | 'connection-test'
const DELIVERIES: readonly Delivery[] = ['team-and-institution', 'institution', 'connection-test']
const CONNECTION_DESTINATIONS: readonly LabDataReportDestination[] = ['team', 'institution']

type ConnectionState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'done'; results: Record<LabDataReportDestination, LabDataReportConnectionResult> }

const PRIVACY_POLICY_URL = "https://github.com/MediPrisma/mediprisma-app/blob/master/PRIVACY_POLICY.md"
/** The preview table stops here; the JSON view always holds every row. */
const PREVIEW_TABLE_ROWS = 300

const fill = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template,
  )

function errorMessage(result: Exclude<LabDataReportSubmitResult, { ok: true }>, strings: Strings): string {
  const errors = strings.errors ?? {}
  switch (result.status) {
    case 'unconfigured': return errors.unconfigured
    case 'timeout': return errors.timeout
    case 401: return errors.auth
    case 413: return errors.tooLarge
    case 429: return errors.rateLimited
    case 400: return result.reason?.startsWith('description-identifier') ? errors.identifier : errors.rejected
    default: return errors.generic
  }
}

function connectionError(result: Exclude<LabDataReportConnectionResult, { ok: true }>, strings: Strings): string {
  const errors = strings.connectionErrors ?? {}
  switch (result.status) {
    case 'unconfigured': return errors.unconfigured
    case 'timeout': return errors.timeout
    case 'network': return errors.network
    case 401:
    case 403: return errors.auth
    default: return fill(errors.status ?? '{status}', { status: result.status })
  }
}

export function LabDataReportDialog({
  open,
  onOpenChange,
  panels,
  observations,
  nameMode,
}: LabDataReportDialogProps) {
  const { t, locale } = useLanguage()
  const strings = ((t as any).labDataReport ?? {}) as Strings
  const { audience } = useAudience()
  const appVersion = useAppVersion()
  const ids = useId()

  const resolveLabel = useCallback<LabDataReportLabelResolver>(
    (identity) => getLabRowDisplayParts(identity, audience, locale, nameMode).name,
    [audience, locale, nameMode],
  )
  const collected = useMemo(
    () => collectLabDataReportCandidates(observations, nameMode, resolveLabel),
    [nameMode, observations, resolveLabel],
  )
  // Chips only for panels that actually have laboratory rows to send.
  const reportablePanels = useMemo(
    () => panels.filter((panel) => (collected.rowsByCategory[panel.id] ?? 0) > 0),
    [collected.rowsByCategory, panels],
  )
  const panelLabels = useMemo(
    () => Object.fromEntries(panels.map((panel) => [panel.id, panel.label])),
    [panels],
  )

  const [flagged, setFlagged] = useState<string[]>([])
  const [problemType, setProblemType] = useState<LabDataReportProblemType | null>(null)
  const [description, setDescription] = useState('')
  const [includeValues, setIncludeValues] = useState(true)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [rawOpen, setRawOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [launchSource, setLaunchSource] = useState<string | undefined>(undefined)
  const [includeRaw, setIncludeRaw] = useState(true)
  const [bundleId, setBundleId] = useState<string | null>(null)
  const [raw, setRaw] = useState<RawState>({ status: 'idle' })
  /** The latest raw read and its abort. Closing the dialog before 確定送出
   *  aborts it; 確定送出 hands it to the background send. It stays after it
   *  settles (aborting a settled read does nothing), so a read that finished
   *  just before 確定送出, ahead of its result reaching `raw`, is handed over
   *  instead of being read a second time. */
  const rawReadRef = useRef<{ controller: AbortController; read: Promise<RawLabRead> } | null>(null)
  /** Set once 確定送出 handed the report to the background: closing the
   *  dialog must then no longer abort its raw read. */
  const handedOffRef = useRef(false)
  const sendRef = useRef<HTMLButtonElement>(null)
  const [delivery, setDelivery] = useState<Delivery>('team-and-institution')
  const [connection, setConnection] = useState<ConnectionState>({ status: 'idle' })
  const connectionRef = useRef<AbortController | null>(null)

  useEffect(() => {
    let cancelled = false
    void detectLaunchSource().then((source) => {
      if (!cancelled) setLaunchSource(source)
    })
    return () => {
      cancelled = true
      if (!handedOffRef.current) rawReadRef.current?.controller.abort()
      connectionRef.current?.abort()
    }
  }, [])

  const context = useMemo<LabDataReportContext>(() => ({
    appVersion: appVersion ?? 'unknown',
    dataSource: detectLabDataSource(collected.candidates.map((candidate) => candidate.observation), launchSource),
    site: detectSite() === 'vghtpe' ? 'vghtpe' : 'unknown',
    language: locale,
    nameMode: nameMode === 'original' ? 'original' : 'standardized',
  }), [appVersion, collected, launchSource, locale, nameMode])

  // 送給 is asked only on the 北榮 route, the one institution with a Gateway
  // of its own; everywhere else a report goes to the team, as before.
  const deliveryOffered = context.site === 'vghtpe'
  const institutionReady = useMemo(() => resolveInstitutionReportUrl() !== null, [])
  const mode: Delivery | 'team' = deliveryOffered ? delivery : 'team'
  const testingConnection = mode === 'connection-test'
  const destinations = useMemo<LabDataReportDestination[]>(() => {
    if (mode === 'institution') return ['institution']
    if (mode === 'team-and-institution' && institutionReady) return ['team', 'institution']
    return ['team']
  }, [institutionReady, mode])
  const institutionSkipped = mode === 'team-and-institution' && !institutionReady
  const institutionBlocked = mode === 'institution' && !institutionReady

  // Raw rows are offered only for a 雲端病歷 patient on a page the extension
  // serves, with the imported Bundle.id to pair the capture with. Nothing is
  // read until 送出 (or the raw preview) is pressed.
  const rawCapable = useMemo(
    () => context.dataSource === 'medcloud' && rawCaptureOrigin() !== null,
    [context.dataSource],
  )
  useEffect(() => {
    if (!open || !rawCapable) return
    let cancelled = false
    void importedBundleId().then((id) => {
      if (!cancelled) setBundleId(id)
    })
    return () => {
      cancelled = true
    }
  }, [open, rawCapable])
  const rawOffered = rawCapable && bundleId !== null
  const wantsRaw = rawOffered && includeRaw

  // Closing the dialog drops whatever was read (reset during render, the
  // pattern for resetting state on a prop change); so does the capture's
  // expiry, below.
  const [openSeen, setOpenSeen] = useState(open)
  if (openSeen !== open) {
    setOpenSeen(open)
    if (!open) {
      setRaw({ status: 'idle' })
      setConnection({ status: 'idle' })
    }
  }
  useEffect(() => {
    if (open) return
    if (!handedOffRef.current) rawReadRef.current?.controller.abort()
    connectionRef.current?.abort()
  }, [open])
  useEffect(() => {
    if (raw.status !== 'ready') return
    const timer = window.setTimeout(
      () => setRaw({ status: 'failed', code: 'EXPIRED' }),
      Math.max(0, raw.expiresAt - Date.now()),
    )
    return () => window.clearTimeout(timer)
  }, [raw])

  /** Reads and narrows the raw capture; null when the read was abandoned. */
  const readRaw = async (): Promise<RawState | null> => {
    if (!bundleId) return null
    rawReadRef.current?.controller.abort()
    const controller = new AbortController()
    setRaw({ status: 'reading' })
    const read = readRawLabRows(bundleId, { signal: controller.signal })
    rawReadRef.current = { controller, read }
    const result = await read
    if (!result.ok && result.code === 'ABORTED') return null
    const next: RawState = result.ok
      ? { status: 'ready', extract: result.extract, expiresAt: result.expiresAt, producerVersion: result.producerVersion }
      : { status: 'failed', code: result.code as LabDataReportRawError }
    setRaw(next)
    return next
  }

  const categoryOrder = useMemo(() => panels.map((panel) => panel.id), [panels])
  // Rows do not depend on the note or problem type, so typing does not
  // rebuild every row; those two fields are merged in below.
  const built = useMemo(() => buildLabDataReport(collected, {
    problemType: 'unspecified',
    description: '',
    includeValues,
    context,
    categoryOrder,
    flaggedCategories: flagged,
  }), [categoryOrder, collected, context, flagged, includeValues])

  const rawSource = useMemo<LabDataReportRawSource | undefined>(() => (
    wantsRaw && raw.status === 'ready'
      ? assembleRawLabSource(raw.extract, { dayZero: built.dayZero, includeValues, producerVersion: raw.producerVersion })
      : undefined
  ), [built.dayZero, includeValues, raw, wantsRaw])

  const payload = useMemo<LabDataReportPayload>(() => ({
    ...built.payload,
    problemType: problemType ?? 'unspecified',
    description: description.trim(),
    ...(rawSource && { rawSource }),
    ...(wantsRaw && raw.status === 'failed' && { rawSourceError: raw.code }),
  }), [built.payload, description, problemType, raw, rawSource, wantsRaw])

  const rowCount = payload.rows.length
  const descriptionIssues = useMemo(() => findDescriptionIdentifiers(description), [description])
  const canSend = rowCount > 0 && descriptionIssues.length === 0 && !institutionBlocked
  const summary = includeValues
    ? mode === 'institution' ? strings.summaryWithValuesInstitution
      : destinations.includes('institution') ? strings.summaryWithValuesBoth
        : strings.summaryWithValues
    : mode === 'institution' ? strings.summaryWithoutValuesInstitution
      : destinations.includes('institution') ? strings.summaryWithoutValuesBoth
        : strings.summaryWithoutValues
  const confirmDestination = mode === 'institution' ? strings.confirmToInstitution
    : destinations.length > 1 ? strings.confirmToBoth
      : institutionSkipped ? strings.confirmInstitutionSkipped
        : undefined

  const handleOpenChange = (next: boolean) => onOpenChange(next)

  // 僅連線測試 sends `{"connectionTest": true}` to each destination and
  // nothing else; one that is not set up is not contacted at all.
  const runConnectionTest = async () => {
    connectionRef.current?.abort()
    const controller = new AbortController()
    connectionRef.current = controller
    setConnection({ status: 'testing' })
    const [team, institution] = await Promise.all(
      CONNECTION_DESTINATIONS.map((destination) => testLabDataReportConnection(destination, { signal: controller.signal })),
    )
    if (controller.signal.aborted) return
    setConnection({ status: 'done', results: { team, institution } })
  }

  const requestSend = () => {
    if (!canSend) return
    // The raw capture starts reading now, after the clinician chose to send;
    // the confirmation opens at once and shows how the read is going.
    if (wantsRaw && raw.status === 'idle') void readRaw()
    setConfirmOpen(true)
  }

  // 確定送出: the dialog closes at once and the report finishes in the
  // background (a clinic cannot wait on a spinner); a toast gives the report
  // id, or the reason with 重試.
  const send = () => {
    setConfirmOpen(false)
    let rawRead: RawLabRead | Promise<RawLabRead> | undefined
    if (wantsRaw && bundleId) {
      if (raw.status === 'ready') {
        rawRead = { ok: true, extract: raw.extract, expiresAt: raw.expiresAt, producerVersion: raw.producerVersion }
      } else if (raw.status === 'failed') {
        rawRead = { ok: false, code: raw.code }
      } else {
        // Still reading, or done but not yet in `raw` (hand that read
        // over), or never started (start it).
        rawRead = rawReadRef.current?.read ?? readRawLabRows(bundleId)
      }
    }
    handedOffRef.current = true
    void sendLabDataReportInBackground({
      base: payload,
      ...(rawRead && { raw: { read: rawRead, dayZero: built.dayZero, includeValues } }),
      destinations,
      institutionSkipped,
    }, {
      sending: strings.backgroundSending,
      readingRaw: strings.backgroundReadingRaw,
      successTitle: strings.successTitle,
      successId: strings.successId,
      copyId: strings.copyId,
      retry: strings.retry,
      failure: (result) => errorMessage(result, strings),
      institutionReceived: strings.institutionReceived,
      institutionSkipped: strings.institutionSkipped,
      inDestination: (destination, text) => fill(strings.inDestination ?? '{destination}: {text}', {
        destination: strings.destinations?.[destination] ?? destination,
        text,
      }),
    })
    onOpenChange(false)
  }

  const toggleFlagged = (id: string) => {
    setFlagged((previous) => previous.includes(id)
      ? previous.filter((item) => item !== id)
      : [...previous, id])
  }

  const identifierKinds = strings.identifierKinds ?? {}
  const descriptionErrorId = `${ids}-description-error`
  const detailsId = `${ids}-details`
  const previewId = `${ids}-preview`
  const linkButton = "inline-flex min-h-6 items-center gap-0.5 rounded text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary max-md:min-h-11"
  const chip = (pressed: boolean) => cn(
    "inline-flex min-h-8 items-center gap-1 rounded-md border px-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary max-md:min-h-11",
    pressed
      ? "border-primary bg-primary/10 font-medium text-primary"
      : "border-border text-foreground hover:bg-muted/50",
  )

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className={cn(
            "flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 max-md:max-h-[calc(100dvh-1rem)] max-md:max-w-[calc(100%-1rem)]",
            previewOpen ? "sm:max-w-3xl" : "sm:max-w-lg",
          )}
          // Land on 送出 so the fastest path is two presses.
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            sendRef.current?.focus()
          }}
        >
          <DialogHeader className="shrink-0 border-b border-border px-4 py-3 pr-12 text-left">
            <DialogTitle className="text-base">{strings.title}</DialogTitle>
            <DialogDescription className="text-xs">{strings.subtitle}</DialogDescription>
          </DialogHeader>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
              {deliveryOffered && (
                <fieldset>
                  <legend className="mb-1 text-xs font-medium text-muted-foreground">{strings.deliveryLegend}</legend>
                  <div className="flex flex-wrap gap-x-4">
                    {DELIVERIES.map((option) => (
                      <label
                        key={option}
                        className="flex min-h-8 cursor-pointer items-center gap-2 text-sm max-md:min-h-11"
                      >
                        <input
                          type="radio"
                          name={`${ids}-delivery`}
                          value={option}
                          checked={delivery === option}
                          onChange={() => setDelivery(option)}
                          className="h-4 w-4 shrink-0 accent-primary"
                        />
                        {strings.deliveryOptions?.[option] ?? option}
                      </label>
                    ))}
                  </div>
                  {!institutionReady && !testingConnection && (
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{strings.institutionUnavailable}</p>
                  )}
                </fieldset>
              )}

              {testingConnection ? (
                <ConnectionTest connection={connection} strings={strings} />
              ) : (
              <>
              {reportablePanels.length > 0 && (
                <fieldset>
                  <legend className="mb-1.5 text-xs font-medium text-muted-foreground">{strings.panelLegend}</legend>
                  <div className="flex flex-wrap gap-1.5">
                    {reportablePanels.map((panel) => {
                      const pressed = flagged.includes(panel.id)
                      return (
                        <button
                          key={panel.id}
                          type="button"
                          aria-pressed={pressed}
                          onClick={() => toggleFlagged(panel.id)}
                          className={chip(pressed)}
                        >
                          {pressed && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                          {panel.label}
                        </button>
                      )
                    })}
                  </div>
                </fieldset>
              )}

              <fieldset>
                <legend className="mb-1.5 text-xs font-medium text-muted-foreground">{strings.problemLegend}</legend>
                <div className="flex flex-wrap gap-1.5">
                  {LAB_DATA_REPORT_PROBLEM_TYPES.map((type) => {
                    const pressed = problemType === type
                    return (
                      <button
                        key={type}
                        type="button"
                        aria-pressed={pressed}
                        onClick={() => setProblemType(pressed ? null : type)}
                        className={chip(pressed)}
                      >
                        {pressed && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                        {strings.problemTypes?.[type] ?? type}
                      </button>
                    )
                  })}
                </div>
              </fieldset>

              <div className="space-y-1">
                <Label htmlFor={`${ids}-description`} className="text-xs font-medium text-muted-foreground">
                  {strings.descriptionLabel}
                </Label>
                <Input
                  id={`${ids}-description`}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                      event.preventDefault()
                      requestSend()
                    }
                  }}
                  placeholder={strings.descriptionPlaceholder}
                  maxLength={LAB_DATA_REPORT_MAX_DESCRIPTION}
                  aria-invalid={descriptionIssues.length > 0 || undefined}
                  aria-describedby={descriptionIssues.length > 0 ? descriptionErrorId : undefined}
                  className="h-9"
                />
                {descriptionIssues.length > 0 && (
                  <p id={descriptionErrorId} className="flex items-start gap-1 text-xs text-destructive" role="alert">
                    <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {fill(strings.descriptionBlocked ?? '{kinds}', {
                      kinds: descriptionIssues.map((kind) => identifierKinds[kind] ?? kind).join(locale === 'en' ? ', ' : '、'),
                    })}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id={`${ids}-values`}
                  checked={includeValues}
                  onCheckedChange={(checked) => setIncludeValues(checked === true)}
                />
                <Label htmlFor={`${ids}-values`} className="text-sm max-md:min-h-11">{strings.includeValues}</Label>
              </div>

              {rawOffered && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`${ids}-raw`}
                    checked={includeRaw}
                    onCheckedChange={(checked) => setIncludeRaw(checked === true)}
                  />
                  <Label htmlFor={`${ids}-raw`} className="text-sm max-md:min-h-11">{strings.includeRaw}</Label>
                </div>
              )}

              <div className="space-y-1 rounded-md bg-muted/40 px-3 py-2">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {fill(summary ?? '{count}', { count: rowCount })}
                  {wantsRaw && ` ${strings.summaryRaw}`}
                </p>
                <div className="flex flex-wrap gap-x-4">
                  <button type="button" onClick={() => setDetailsOpen((value) => !value)} aria-expanded={detailsOpen} aria-controls={detailsId} className={linkButton}>
                    {detailsOpen ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
                    {strings.detailsToggle}
                  </button>
                  <button type="button" onClick={() => setPreviewOpen((value) => !value)} aria-expanded={previewOpen} aria-controls={previewId} className={linkButton}>
                    {previewOpen ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
                    {fill(strings.previewToggle ?? '{count}', { count: rowCount })}
                  </button>
                </div>
                {detailsOpen && (
                  <div id={detailsId} className="space-y-1 pt-1 text-xs leading-relaxed text-muted-foreground">
                    {/* 僅機構 never reaches the team: its own text, not the team's. */}
                    <p>{mode === 'institution' ? strings.disclosureInstitutionOnly : strings.disclosure}</p>
                    {mode !== 'institution' && destinations.includes('institution') && <p>{strings.disclosureInstitution}</p>}
                    <p>{strings.includeValuesHint}</p>
                    {rawOffered && <p>{strings.includeRawHint}</p>}
                    <a href={PRIVACY_POLICY_URL} target="_blank" rel="noopener noreferrer" className={linkButton}>
                      {strings.policyLink}
                    </a>
                  </div>
                )}
              </div>

              {previewOpen && (
                <section id={previewId} aria-label={fill(strings.previewToggle ?? '{count}', { count: rowCount })} className="space-y-1.5">
                  <PreviewNotes payload={payload} totalRows={built.totalRows} strings={strings} />
                  {rowCount > 0 && (
                    <PreviewTable
                      rows={payload.rows.slice(0, PREVIEW_TABLE_ROWS)}
                      includesValues={payload.includesValues}
                      panelLabels={panelLabels}
                      strings={strings}
                    />
                  )}
                  {rowCount > PREVIEW_TABLE_ROWS && (
                    <p className="text-xs text-muted-foreground">
                      {fill(strings.previewTableLimited ?? '{shown}/{count}', { shown: PREVIEW_TABLE_ROWS, count: rowCount })}
                    </p>
                  )}
                  {wantsRaw && (
                    <RawPreview
                      raw={raw}
                      rawSource={payload.rawSource}
                      includesValues={payload.includesValues}
                      onLoad={() => { void readRaw() }}
                      strings={strings}
                      linkButton={linkButton}
                    />
                  )}
                  <button type="button" onClick={() => setRawOpen((value) => !value)} aria-expanded={rawOpen} className={linkButton}>
                    {rawOpen ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
                    {strings.rawToggle}
                  </button>
                  {rawOpen && (
                    <pre className="max-h-72 overflow-auto rounded-md border border-border bg-muted/30 p-2 font-mono text-[0.6875rem] leading-snug text-foreground">
                      {JSON.stringify({ ...payload, problemType }, null, 2)}
                    </pre>
                  )}
                </section>
              )}
              </>
              )}
            </div>

          <DialogFooter className="shrink-0 gap-2 border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] max-md:flex-col-reverse sm:justify-end">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} className="max-md:h-11 max-md:w-full">
              {strings.cancel}
            </Button>
            {testingConnection ? (
              <Button
                ref={sendRef}
                type="button"
                onClick={() => { void runConnectionTest() }}
                disabled={connection.status === 'testing'}
                className="max-md:h-11 max-md:w-full"
              >
                {strings.testConnection}
              </Button>
            ) : (
              <Button
                ref={sendRef}
                type="button"
                onClick={requestSend}
                disabled={rowCount === 0 || institutionBlocked}
                aria-disabled={!canSend || undefined}
                className="max-md:h-11 max-md:w-full"
              >
                {fill(strings.send ?? '{count}', { count: rowCount })}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{strings.confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {fill(includeValues ? strings.confirmWithValues : strings.confirmWithoutValues, { count: rowCount })}
              {confirmDestination && <span className="mt-1 block">{confirmDestination}</span>}
              {wantsRaw && raw.status === 'reading' && (
                <span className="mt-1 flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  {strings.confirmRawReading}
                </span>
              )}
              {payload.rawSource && (
                <span className="mt-1 block">
                  {fill(strings.confirmRaw ?? '{count}', { count: payload.rawSource.rows.length })}
                </span>
              )}
              {payload.rawSourceError && (
                <span className="mt-1 block">
                  {fill(strings.confirmRawMissing ?? '{reason}', {
                    reason: strings.rawErrors?.[payload.rawSourceError] ?? payload.rawSourceError,
                  })}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="max-md:flex-col-reverse max-md:gap-2">
            <AlertDialogCancel className="max-md:h-11">{strings.confirmBack}</AlertDialogCancel>
            <AlertDialogAction className="max-md:h-11" onClick={send}>
              {strings.confirmSend}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function ConnectionTest({ connection, strings }: { connection: ConnectionState; strings: Strings }) {
  const names = strings.destinations ?? {}
  return (
    <section aria-label={strings.deliveryOptions?.['connection-test']} className="space-y-2">
      <p className="text-xs leading-relaxed text-muted-foreground">{strings.connectionHint}</p>
      {connection.status !== 'idle' && (
        <ul role="status" className="space-y-1 text-sm">
          {CONNECTION_DESTINATIONS.map((destination) => (
            <li key={destination} className="flex flex-wrap items-center gap-x-2">
              <span className="font-medium">{names[destination] ?? destination}</span>
              <ConnectionOutcome
                destination={destination}
                result={connection.status === 'done' ? connection.results[destination] : undefined}
                strings={strings}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ConnectionOutcome({
  destination,
  result,
  strings,
}: {
  destination: LabDataReportDestination
  result?: LabDataReportConnectionResult
  strings: Strings
}) {
  if (!result) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        {strings.connectionTesting}
      </span>
    )
  }
  if (result.ok) {
    return (
      <span className="inline-flex items-center gap-1">
        <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        {strings.connectionOk}
      </span>
    )
  }
  // An institution with no Gateway set up was not contacted: not a failure.
  if (destination === 'institution' && result.status === 'unconfigured') {
    return <span className="text-muted-foreground">{strings.connectionSkipped}</span>
  }
  return (
    <span className="inline-flex items-center gap-1 text-destructive">
      <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {fill(strings.connectionFailed ?? '{reason}', { reason: connectionError(result, strings) })}
    </span>
  )
}

function PreviewNotes({ payload, totalRows, strings }: { payload: LabDataReportPayload; totalRows: number; strings: Strings }) {
  const notes = [
    payload.truncatedRows > 0 && fill(strings.previewTruncated, { total: totalRows, max: LAB_DATA_REPORT_MAX_ROWS }),
    payload.droppedStrings > 0 && fill(strings.previewDropped, { count: payload.droppedStrings }),
    payload.excludedNonLabRows > 0 && fill(strings.previewExcluded, { count: payload.excludedNonLabRows }),
  ].filter((note): note is string => !!note)
  if (notes.length === 0) return null
  return (
    <ul className="space-y-0.5 text-xs text-muted-foreground">
      {notes.map((note) => <li key={note}>{note}</li>)}
    </ul>
  )
}

function formatValue(row: LabDataReportRow, includesValues: boolean, strings: Strings): string {
  const notAttached = strings.valueNotAttached ?? '—'
  const value = row.value
  switch (value.kind) {
    case 'quantity':
      return value.value === undefined ? notAttached : `${value.comparator ?? ''}${value.value}`
    case 'range':
      return value.low === undefined && value.high === undefined
        ? notAttached
        : `${value.low ?? '?'}–${value.high ?? '?'}`
    case 'coded':
      return value.text ?? value.code ?? notAttached
    case 'string':
      return value.value ?? (includesValues ? `(${value.length})` : notAttached)
    case 'other':
      return value.type
    default:
      return '—'
  }
}

function PreviewTable({
  rows,
  includesValues,
  panelLabels,
  strings,
}: {
  rows: LabDataReportRow[]
  includesValues: boolean
  panelLabels: Record<string, string>
  strings: Strings
}) {
  const columns = strings.previewColumns ?? {}
  const decidedBy = strings.decidedBy ?? {}
  return (
    <div
      role="region"
      aria-label={strings.previewTableLabel}
      tabIndex={0}
      // Phones get one vertical scroller (the dialog body); the table keeps
      // only its horizontal scroll there. Wider screens cap its height.
      className="overflow-auto rounded-md border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:max-h-72"
    >
      <table className="w-max min-w-full border-collapse text-xs tabular-nums">
        <thead className="sticky top-0 z-10 bg-muted text-left text-muted-foreground">
          <tr>
            <th scope="col" className="sticky left-0 z-20 bg-muted px-2 py-1.5 font-medium">{columns.ref}</th>
            <th scope="col" className="px-2 py-1.5 font-medium">{columns.placed}</th>
            <th scope="col" className="px-2 py-1.5 font-medium">{columns.day}</th>
            <th scope="col" className="px-2 py-1.5 font-medium">{columns.hospital}</th>
            <th scope="col" className="px-2 py-1.5 font-medium">{columns.code}</th>
            <th scope="col" className="px-2 py-1.5 font-medium">{columns.name}</th>
            <th scope="col" className="px-2 py-1.5 font-medium">{columns.specimen}</th>
            <th scope="col" className="px-2 py-1.5 font-medium">{columns.value}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const codes = row.code.codings.map((coding) => coding.code).filter(Boolean).join(' · ')
            const displays = row.code.codings
              .map((coding) => coding.display)
              .filter((display): display is string => !!display && display !== row.code.text)
            const time = row.timeOfDay ?? row.sourceTime?.time
            const panel = row.app.categoryId ? panelLabels[row.app.categoryId] ?? row.app.categoryId : '—'
            return (
              <tr key={row.ref} className="border-t border-border/70 align-top">
                <th scope="row" className="sticky left-0 bg-background px-2 py-1 text-left font-normal text-muted-foreground">{row.ref}</th>
                <td className="whitespace-nowrap px-2 py-1">
                  {panel} › {row.app.column}
                  <span className="block text-muted-foreground">{decidedBy[row.app.decidedBy] ?? row.app.decidedBy}</span>
                </td>
                <td className="whitespace-nowrap px-2 py-1">
                  {row.day === null ? '—' : fill(strings.dayValue ?? '{day}', { day: row.day })}
                  {time && <span className="ml-1 text-muted-foreground">{time}</span>}
                </td>
                <td className="max-w-40 px-2 py-1">{row.performer.join('、') || '—'}</td>
                <td className="whitespace-nowrap px-2 py-1 font-mono">{codes || '—'}</td>
                <td className="max-w-56 px-2 py-1">
                  <span className="text-foreground">{row.code.text ?? '—'}</span>
                  {displays.length > 0 && (
                    <span className="block text-muted-foreground">{displays.join(' / ')}</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-2 py-1">{row.specimen ?? '—'}</td>
                <td className="whitespace-nowrap px-2 py-1">
                  <span className={cn(!includesValues && 'text-muted-foreground')}>{formatValue(row, includesValues, strings)}</span>
                  {row.unit && <span className="ml-1 text-muted-foreground">{row.unit}</span>}
                  {row.sameValueGroup !== undefined && (
                    <span className="ml-1.5 text-muted-foreground">{fill(strings.sameValue ?? '#{group}', { group: row.sameValueGroup })}</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function rawDay(row: LabDataReportRawRow): { day: number; time?: string } | undefined {
  return row.dates.case_time ?? row.dates.real_inspect_date ?? row.dates.recipe_date ?? row.dates.assaY_DATE
}

function rawValue(row: LabDataReportRawRow, includesValues: boolean, strings: Strings): string {
  const sent = row.results.assay_value ?? row.results.assaY_VALUE
  if (sent !== undefined) return String(sent)
  const withheld = row.withheld.assay_value ?? row.withheld.assaY_VALUE
  if (withheld === undefined) return '—'
  return includesValues ? `(${withheld})` : strings.valueNotAttached ?? '—'
}

function RawPreview({
  raw,
  rawSource,
  includesValues,
  onLoad,
  strings,
  linkButton,
}: {
  raw: RawState
  rawSource?: LabDataReportRawSource
  includesValues: boolean
  onLoad: () => void
  strings: Strings
  linkButton: string
}) {
  if (raw.status === 'reading') {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        {strings.readingRaw}
      </p>
    )
  }
  if (raw.status === 'failed') {
    return (
      <p className="text-xs text-muted-foreground">
        {fill(strings.confirmRawMissing ?? '{reason}', { reason: strings.rawErrors?.[raw.code] ?? raw.code })}
      </p>
    )
  }
  if (raw.status === 'idle' || !rawSource) {
    return (
      <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
        {strings.rawPreviewNotRead}
        <button type="button" onClick={onLoad} className={linkButton}>{strings.rawPreviewLoad}</button>
      </p>
    )
  }

  const notes = strings.rawNotes ?? {}
  const columns = strings.rawPreviewColumns ?? {}
  const sources = strings.rawSources ?? {}
  const lines = [
    rawSource.droppedStrings > 0 && fill(notes.dropped ?? '{count}', { count: rawSource.droppedStrings }),
    rawSource.unparsedDates > 0 && fill(notes.unparsed ?? '{count}', { count: rawSource.unparsedDates }),
    rawSource.truncatedRows > 0 && fill(notes.truncated ?? '{count}', { count: rawSource.truncatedRows }),
    rawSource.unknownFields.length > 0 && fill(notes.unknown ?? '{fields}', { fields: rawSource.unknownFields.join(', ') }),
  ].filter((line): line is string => !!line)
  const title = fill(strings.rawPreviewTitle ?? '{count}', { count: rawSource.rows.length })
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-foreground">{title}</p>
      {lines.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {lines.map((line) => <li key={line}>{line}</li>)}
        </ul>
      )}
      {rawSource.rows.length > 0 && (
        <div
          role="region"
          aria-label={strings.rawPreviewLabel}
          tabIndex={0}
          className="overflow-auto rounded-md border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:max-h-72"
        >
          <table className="w-max min-w-full border-collapse text-xs tabular-nums">
            <thead className="sticky top-0 z-10 bg-muted text-left text-muted-foreground">
              <tr>
                <th scope="col" className="sticky left-0 z-20 bg-muted px-2 py-1.5 font-medium">{columns.ref}</th>
                <th scope="col" className="px-2 py-1.5 font-medium">{columns.source}</th>
                <th scope="col" className="px-2 py-1.5 font-medium">{columns.day}</th>
                <th scope="col" className="px-2 py-1.5 font-medium">{columns.hospital}</th>
                <th scope="col" className="px-2 py-1.5 font-medium">{columns.order}</th>
                <th scope="col" className="px-2 py-1.5 font-medium">{columns.item}</th>
                <th scope="col" className="px-2 py-1.5 font-medium">{columns.value}</th>
              </tr>
            </thead>
            <tbody>
              {rawSource.rows.slice(0, PREVIEW_TABLE_ROWS).map((row) => {
                const date = rawDay(row)
                return (
                  <tr key={row.ref} className="border-t border-border/70 align-top">
                    <th scope="row" className="sticky left-0 bg-background px-2 py-1 text-left font-normal text-muted-foreground">{row.ref}</th>
                    <td className="whitespace-nowrap px-2 py-1">
                      {sources[row.source] ?? row.source}
                      {row.ordinal !== undefined && <span className="ml-1 text-muted-foreground">#{row.ordinal}</span>}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1">
                      {date ? fill(strings.dayValue ?? '{day}', { day: date.day }) : '—'}
                      {date?.time && <span className="ml-1 text-muted-foreground">{date.time}</span>}
                    </td>
                    <td className="max-w-40 px-2 py-1">{row.fields.hosp ?? '—'}</td>
                    <td className="max-w-48 px-2 py-1">
                      <span className="font-mono">{row.fields.order_code ?? '—'}</span>
                      {row.fields.order_name && <span className="block text-muted-foreground">{row.fields.order_name}</span>}
                    </td>
                    <td className="max-w-48 px-2 py-1">{row.fields.assay_item_name ?? row.fields.assaY_NAME ?? '—'}</td>
                    <td className="whitespace-nowrap px-2 py-1">
                      <span className={cn(!includesValues && 'text-muted-foreground')}>{rawValue(row, includesValues, strings)}</span>
                      {row.fields.unit_data && <span className="ml-1 text-muted-foreground">{row.fields.unit_data}</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {rawSource.rows.length > PREVIEW_TABLE_ROWS && (
        <p className="text-xs text-muted-foreground">
          {fill(strings.previewTableLimited ?? '{shown}/{count}', { shown: PREVIEW_TABLE_ROWS, count: rawSource.rows.length })}
        </p>
      )}
    </div>
  )
}
