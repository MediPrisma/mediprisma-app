// Sends a lab-data report after the dialog has closed. A clinic cannot wait
// on a spinner: once the clinician presses 確定送出 the dialog goes away, the
// (optional) raw-row read and the upload finish here, and the outcome comes
// back as a toast — the report id to copy, or the reason with 重試.
//
// This is the only toast the feature ever shows, and only as the answer to a
// report the clinician chose to send, so the question-free MediCloud launch
// route stays free of prompts.
import { toast } from 'sonner'
import type { LabDataReportPayload } from '../types'
import { assembleRawLabSource } from './raw-lab-rows'
import type { RawLabRead } from './read-raw-lab-rows'
import {
  submitLabDataReport,
  type LabDataReportDestination,
  type LabDataReportSubmitResult,
} from './submit-lab-data-report'

export interface BackgroundRawRows {
  /** The raw capture: already read, or still being read. */
  read: RawLabRead | Promise<RawLabRead>
  /** The report's day 0 and value choice, to place the raw rows. */
  dayZero: number | null
  includeValues: boolean
}

export interface BackgroundReportStrings {
  sending: string
  readingRaw: string
  successTitle: string
  successId: string
  copyId: string
  retry: string
  failure: (result: Exclude<LabDataReportSubmitResult, { ok: true }>) => string
  /** The institution's receipt; `{id}` is the Gateway's own report id. */
  institutionReceived?: string
  /** 團隊和機構 was chosen but no Gateway is set up. */
  institutionSkipped?: string
  /** Puts the destination in front of its outcome, for a report sent to two
   *  places or to the institution. */
  inDestination?: (destination: LabDataReportDestination, text: string) => string
}

export interface BackgroundReport {
  base: LabDataReportPayload
  raw?: BackgroundRawRows
  /** Where the report goes; the team only when left out. */
  destinations?: readonly LabDataReportDestination[]
  /** 團隊和機構 was chosen but the institution has no Gateway set up, so it
   *  was not contacted: the outcome says so. */
  institutionSkipped?: boolean
}

/** Each destination's latest result. */
export type BackgroundReportOutcome = Partial<Record<LabDataReportDestination, LabDataReportSubmitResult>>

/** The report as sent: the rows, plus the raw rows or why they are missing. */
export function withRawRows(base: LabDataReportPayload, read: RawLabRead, raw: Omit<BackgroundRawRows, 'read'>): LabDataReportPayload {
  const { rawSource: _rawSource, rawSourceError: _rawSourceError, ...rest } = base
  if (read.ok) {
    return {
      ...rest,
      rawSource: assembleRawLabSource(read.extract, {
        dayZero: raw.dayZero,
        includeValues: raw.includeValues,
        producerVersion: read.producerVersion,
      }),
    }
  }
  return read.code === 'ABORTED' ? rest : { ...rest, rawSourceError: read.code }
}

export function sendLabDataReportInBackground(
  report: BackgroundReport,
  strings: BackgroundReportStrings,
): Promise<BackgroundReportOutcome> {
  const destinations: readonly LabDataReportDestination[] = report.destinations?.length ? report.destinations : ['team']
  const pendingRaw = report.raw && report.raw.read instanceof Promise
  const id = toast.loading(pendingRaw ? strings.readingRaw : strings.sending)
  const outcome: BackgroundReportOutcome = {}

  const named = (destination: LabDataReportDestination, text: string) =>
    (destinations.length > 1 || destination === 'institution') && strings.inDestination
      ? strings.inDestination(destination, text)
      : text
  const receipt = (destination: LabDataReportDestination, reportId: string) =>
    destination === 'team'
      ? `${strings.successId} ${reportId}`
      : (strings.institutionReceived ?? '{id}').replaceAll('{id}', reportId)

  // Every step updates the one toast `id`. Sonner closes a toast once its
  // action button's onClick returns unless the click was preventDefault()ed,
  // so both actions below prevent it: a retry has already turned this toast
  // into its loading (or even its outcome) toast by then, and closing it
  // would take the report id, or the next 重試, off the screen.
  const submit = async (
    payload: LabDataReportPayload,
    pending: readonly LabDataReportDestination[],
  ): Promise<BackgroundReportOutcome> => {
    // An update keeps the fields it does not name: drop the failed attempt's
    // 重試 so a pending retry cannot be pressed twice.
    toast.loading(strings.sending, { id, action: undefined })
    const results = await Promise.all(pending.map((destination) => submitLabDataReport(payload, { destination })))
    pending.forEach((destination, index) => { outcome[destination] = results[index] })

    const receipts = destinations.flatMap((destination) => {
      const result = outcome[destination]
      return result?.ok ? [receipt(destination, result.reportId)] : []
    })
    const failed = destinations.filter((destination) => outcome[destination]?.ok === false)
    if (failed.length === 0) {
      const copyable = outcome.team?.ok ? outcome.team.reportId : outcome.institution?.ok ? outcome.institution.reportId : undefined
      const notes = report.institutionSkipped && strings.institutionSkipped ? [strings.institutionSkipped] : []
      toast.success(strings.successTitle, {
        id,
        description: [...receipts, ...notes].join('\n'),
        classNames: { description: 'whitespace-pre-line' },
        duration: 12_000,
        action: copyable === undefined ? undefined : {
          label: strings.copyId,
          // Copying leaves the id on screen: the clipboard can refuse it
          // silently (no permission, an insecure context).
          onClick: (event) => {
            event.preventDefault()
            void navigator.clipboard?.writeText(copyable).catch(() => undefined)
          },
        },
      })
    } else {
      // A retry sends the same payload, and only where it failed: each
      // destination answers a resend with its first report, so a slow
      // success never becomes two reports.
      const message = failed
        .map((destination) => named(destination, strings.failure(outcome[destination] as Exclude<LabDataReportSubmitResult, { ok: true }>)))
        .join('\n')
      toast.error(message, {
        id,
        description: receipts.length > 0 ? receipts.join('\n') : undefined,
        classNames: { title: 'whitespace-pre-line', description: 'whitespace-pre-line' },
        duration: Number.POSITIVE_INFINITY,
        action: {
          label: strings.retry,
          onClick: (event) => {
            event.preventDefault()
            void submit(payload, failed)
          },
        },
      })
    }
    return { ...outcome }
  }

  return (async () => {
    let payload = report.base
    if (report.raw) payload = withRawRows(report.base, await report.raw.read, report.raw)
    return submit(payload, destinations)
  })()
}
