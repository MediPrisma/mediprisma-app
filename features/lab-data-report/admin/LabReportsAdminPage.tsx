"use client"

// /lab-reports — the developer's inbox for 回報檢驗資料問題. Not linked from
// the clinical workspace; the notice mail links here (?id=LDR-…).
//
// Each report is shown the way the clinician saw it: one grid per panel,
// relative days × the columns the app showed, with the placement rule under
// every column name — so "why is RBC under 尿液" is answered on sight. A cell
// opens the rows behind it with every field that was sent. When the problem
// is handled, 「已處理，刪除」 removes the report (the privacy promise is
// "deleted once handled, 90 days at most").
import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, Download, LogIn, LogOut, Loader2, RefreshCw, Trash2, X } from "lucide-react"
import { toast } from "sonner"
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
import { AuthDialog } from "@/features/auth"
import { useAuth } from "@/src/application/providers/auth.provider"
import { useLanguage } from "@/src/application/providers/language.provider"
import { cn } from "@/src/shared/utils/cn.utils"
import { isAllergenName, SPECIFIC_ALLERGEN_NHI_ORDER_CODES } from "@/src/shared/utils/immunology-analytes"
import type { LabDataReportRawRow, LabDataReportRow } from "../types"
import { buildReportGrids, cellKey, formatReportValue, type ReportPanelGrid } from "./report-grid"
import { pairRawRows, type RawPairing } from "./raw-pairing"
import { isLabDataReportAdmin } from "./admin"
import {
  deleteLabDataReport,
  getLabDataReport,
  getLabDataReportRows,
  type StoredLabDataReportRows,
  listLabDataReports,
  type StoredLabDataReport,
} from "./service"

type Strings = Record<string, any>

const fill = (template: string | undefined, values: Record<string, string | number>) =>
  Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template ?? '',
  )

const formatTime = (date: Date | null) => date
  ? date.toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }).slice(0, 16)
  : '—'

const daysLeft = (date: Date | null) => date
  ? Math.max(0, Math.ceil((date.getTime() - Date.now()) / 86_400_000))
  : null

function readRequestedId(): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get('id')
}

function writeRequestedId(id: string | null) {
  const url = new URL(window.location.href)
  if (id) url.searchParams.set('id', id)
  else url.searchParams.delete('id')
  window.history.replaceState(null, '', url)
}

export function LabReportsAdminPage() {
  const { t } = useLanguage()
  const strings = ((t as any).labDataReportAdmin ?? {}) as Strings
  const { user, loading, signOut } = useAuth()
  const isAdmin = isLabDataReportAdmin(user)
  const [signInOpen, setSignInOpen] = useState(false)

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 py-2">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">{strings.title}</h1>
          <p className="hidden text-xs text-muted-foreground sm:block">{strings.subtitle}</p>
        </div>
        {user && (
          <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            <span className="hidden truncate sm:inline">{user.email}</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => { void signOut() }} className="h-7 text-xs max-md:h-11">
              <LogOut aria-hidden="true" />
              {strings.signOut}
            </Button>
          </div>
        )}
      </header>
      {loading ? (
        <CenteredNote><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{strings.loading}</CenteredNote>
      ) : !user || !isAdmin ? (
        <CenteredNote>
          <span className="flex flex-col items-center gap-3 text-center">
            <span>{user ? fill(strings.notAdmin, { email: user.email ?? '—' }) : strings.signInPrompt}</span>
            <Button type="button" onClick={() => setSignInOpen(true)} className="max-md:h-11">
              <LogIn aria-hidden="true" />
              {strings.signIn}
            </Button>
          </span>
        </CenteredNote>
      ) : (
        <ReportsWorkspace strings={strings} />
      )}
      <AuthDialog open={signInOpen} onOpenChange={setSignInOpen} />
    </div>
  )
}

function CenteredNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center gap-2 p-6 text-sm text-muted-foreground" role="status">
      {children}
    </div>
  )
}

function ReportsWorkspace({ strings }: { strings: Strings }) {
  const { t } = useLanguage()
  const panelLabels = ((t.reports as any).cumulativeCategories ?? {}) as Record<string, string>
  const [reports, setReports] = useState<StoredLabDataReport[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(() => readRequestedId())
  const [reloadCount, setReloadCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const list = await listLabDataReports()
      // A mailed link may point past the newest 100.
      const requested = readRequestedId()
      if (requested && !list.some((report) => report.id === requested)) {
        const extra = await getLabDataReport(requested)
        if (extra) list.push(extra)
      }
      return list
    }
    load()
      .then((list) => { if (!cancelled) setReports(list) })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError))
      })
    return () => { cancelled = true }
  }, [reloadCount])

  const reload = () => {
    setReports(null)
    setError(null)
    setReloadCount((count) => count + 1)
  }

  const select = (id: string | null) => {
    setSelectedId(id)
    writeRequestedId(id)
  }

  const selected = reports?.find((report) => report.id === selectedId) ?? null

  if (error) return <CenteredNote>{fill(strings.loadFailed, { message: error })}</CenteredNote>
  if (!reports) {
    return <CenteredNote><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{strings.loading}</CenteredNote>
  }

  return (
    <div className="flex min-h-0 flex-1">
      <nav
        aria-label={strings.listLabel}
        className={cn(
          "flex w-full shrink-0 flex-col border-r border-border md:w-80",
          selectedId && "max-md:hidden",
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
          <span className="text-xs text-muted-foreground tabular-nums">{fill(strings.listCount, { count: reports.length })}</span>
          <Button type="button" variant="ghost" size="sm" onClick={reload} className="h-7 text-xs max-md:h-11">
            <RefreshCw aria-hidden="true" />
            {strings.reload}
          </Button>
        </div>
        {reports.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{strings.empty}</p>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {reports.map((report) => (
              <li key={report.id}>
                <ReportListItem
                  report={report}
                  active={report.id === selectedId}
                  panelLabels={panelLabels}
                  strings={strings}
                  onSelect={() => select(report.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </nav>
      <main className={cn("min-w-0 flex-1 overflow-y-auto", !selectedId && "max-md:hidden")}>
        {!selectedId ? (
          <CenteredNote>{strings.selectPrompt}</CenteredNote>
        ) : !selected ? (
          <div className="p-4">
            <BackButton strings={strings} onBack={() => select(null)} />
            <p className="mt-3 text-sm text-muted-foreground">{fill(strings.notFound, { id: selectedId })}</p>
          </div>
        ) : (
          <ReportDetail
            key={selected.id}
            report={selected}
            panelLabels={panelLabels}
            strings={strings}
            onBack={() => select(null)}
            onDeleted={() => {
              setReports((previous) => previous?.filter((report) => report.id !== selected.id) ?? previous)
              select(null)
            }}
          />
        )}
      </main>
    </div>
  )
}

function BackButton({ strings, onBack }: { strings: Strings; onBack: () => void }) {
  return (
    <Button type="button" variant="ghost" size="sm" onClick={onBack} className="h-7 px-2 text-xs md:hidden max-md:h-11">
      <ArrowLeft aria-hidden="true" />
      {strings.back}
    </Button>
  )
}

function ReportListItem({
  report,
  active,
  panelLabels,
  strings,
  onSelect,
}: {
  report: StoredLabDataReport
  active: boolean
  panelLabels: Record<string, string>
  strings: Strings
  onSelect: () => void
}) {
  const { t } = useLanguage()
  const problemLabels = ((t as any).labDataReport?.problemTypes ?? {}) as Record<string, string>
  const flagged = report.scope.flaggedCategories.map((id) => panelLabels[id] ?? id).join('、') || strings.noFlagged
  const left = daysLeft(report.expireAt)
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'true' : undefined}
      className={cn(
        "w-full border-b border-border/70 px-3 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
        active && "bg-primary/10",
      )}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-xs text-foreground">{report.id}</span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatTime(report.createdAt)}</span>
      </span>
      <span className="mt-0.5 block text-sm font-medium text-foreground">
        {flagged} · {problemLabels[report.problemType] ?? report.problemType}
      </span>
      <span className="mt-0.5 block text-xs text-muted-foreground">
        {fill(strings.rows, { count: report.rowCount })}
        {' · '}{strings.sources?.[report.context.dataSource] ?? report.context.dataSource}
        {report.context.site !== 'unknown' && ` · ${report.context.site}`}
        {report.description && ` · ${strings.hasNote}`}
        {left !== null && ` · ${fill(strings.daysLeft, { days: left })}`}
      </span>
    </button>
  )
}

function ReportDetail({
  report,
  panelLabels,
  strings,
  onBack,
  onDeleted,
}: {
  report: StoredLabDataReport
  panelLabels: Record<string, string>
  strings: Strings
  onBack: () => void
  onDeleted: () => void
}) {
  const { t } = useLanguage()
  const problemLabels = ((t as any).labDataReport?.problemTypes ?? {}) as Record<string, string>
  const rawErrorLabels = ((t as any).labDataReport?.rawErrors ?? {}) as Record<string, string>
  const [loaded, setLoaded] = useState<StoredLabDataReportRows | null>(null)
  const [rowsError, setRowsError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [selectedCell, setSelectedCell] = useState<{ categoryId: string; key: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    getLabDataReportRows(report.id)
      .then((result) => { if (!cancelled) setLoaded(result) })
      .catch((error) => { if (!cancelled) setRowsError(error instanceof Error ? error.message : String(error)) })
    return () => { cancelled = true }
  }, [report.id])

  const rows = loaded?.rows ?? null
  const rawRows = useMemo(() => loaded?.rawRows ?? [], [loaded])
  const pairing = useMemo(
    () => (rows && rawRows.length > 0 ? pairRawRows(rows, rawRows) : null),
    [rawRows, rows],
  )
  const rawByRef = useMemo(() => new Map(rawRows.map((row) => [row.ref, row])), [rawRows])

  const grids = useMemo(
    () => rows
      ? buildReportGrids(rows, report.scope.categories.map((entry) => entry.categoryId), report.scope.flaggedCategories)
      : [],
    [report.scope.categories, report.scope.flaggedCategories, rows],
  )

  const download = () => {
    if (!rows) return
    const body = JSON.stringify({
      ...report,
      createdAt: report.createdAt?.toISOString() ?? null,
      expireAt: report.expireAt?.toISOString() ?? null,
      rows,
      rawRows,
    }, null, 2)
    const url = URL.createObjectURL(new Blob([`${body}\n`], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${report.id}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const resolve = async () => {
    setDeleting(true)
    try {
      await deleteLabDataReport(report.id)
      toast.success(fill(strings.resolved, { id: report.id }))
      onDeleted()
    } catch (error) {
      toast.error(fill(strings.resolveFailed, { message: error instanceof Error ? error.message : String(error) }))
    } finally {
      setDeleting(false)
      setConfirmOpen(false)
    }
  }

  const meta = strings.meta ?? {}
  const left = daysLeft(report.expireAt)
  const facts: Array<[string, string]> = [
    [meta.created, formatTime(report.createdAt)],
    [meta.expires, `${formatTime(report.expireAt)}${left !== null ? `（${fill(strings.daysLeft, { days: left })}）` : ''}`],
    [meta.source, `${strings.sources?.[report.context.dataSource] ?? report.context.dataSource}${report.context.site !== 'unknown' ? ` · ${report.context.site}` : ''}`],
    [meta.app, `${report.context.appVersion} · ${report.context.language} · ${report.context.nameMode}`],
    [meta.reporter, report.reporterIsAnonymous ? strings.anonymous : strings.signedIn],
    [meta.values, report.includesValues ? strings.yes : strings.no],
    [meta.dropped, `${report.droppedStrings} / ${report.serverDroppedStrings}`],
    [meta.excluded, String(report.excludedNonLabRows)],
    [meta.truncated, String(report.truncatedRows)],
    [meta.raw, report.rawRowCount > 0
      ? fill(strings.rawSummary, {
        count: report.rawRowCount,
        s02: report.rawSource?.s02Rows ?? '?',
        s03: report.rawSource?.s03Rows ?? '?',
        version: report.rawSource?.producerVersion ?? '?',
      })
      : report.rawSourceError
        ? fill(strings.rawMissing, { reason: rawErrorLabels[report.rawSourceError] ?? report.rawSourceError })
        : strings.rawNone],
  ]

  return (
    <div className="space-y-4 p-4">
      <BackButton strings={strings} onBack={onBack} />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-mono text-sm font-semibold">{report.id}</h2>
          <p className="mt-1 text-sm">
            <span className="text-muted-foreground">{meta.flagged}：</span>
            {report.scope.flaggedCategories.map((id) => panelLabels[id] ?? id).join('、') || strings.noFlagged}
            <span className="mx-2 text-muted-foreground">·</span>
            <span className="text-muted-foreground">{meta.problem}：</span>
            {problemLabels[report.problemType] ?? report.problemType}
          </p>
          {report.description && (
            <p className="mt-1 text-sm">
              <span className="text-muted-foreground">{meta.note}：</span>
              「{report.description}」
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="outline" size="sm" onClick={download} disabled={!rows} className="max-md:h-11">
            <Download aria-hidden="true" />
            {strings.download}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setConfirmOpen(true)} className="text-destructive hover:text-destructive max-md:h-11">
            <Trash2 aria-hidden="true" />
            {strings.resolve}
          </Button>
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2 xl:grid-cols-3">
        {facts.map(([label, value]) => (
          <div key={label} className="flex gap-2">
            <dt className="shrink-0 text-muted-foreground">{label}</dt>
            <dd className="min-w-0 tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <p className="text-xs text-muted-foreground">{strings.cellHint}</p>

      {rowsError ? (
        <p className="text-sm text-destructive">{fill(strings.loadFailed, { message: rowsError })}</p>
      ) : !rows ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{strings.loading}
        </p>
      ) : (
        grids.map((grid) => (
          <section key={grid.categoryId} aria-labelledby={`panel-${grid.categoryId}`} className="space-y-1.5">
            <h3 id={`panel-${grid.categoryId}`} className="flex items-baseline gap-2 text-sm font-semibold">
              {panelLabels[grid.categoryId] ?? grid.categoryId}
              <span className="text-xs font-normal text-muted-foreground">{fill(strings.panelRows, { count: grid.rowCount })}</span>
              {grid.flagged && (
                <span className="rounded border border-primary/40 bg-primary/10 px-1.5 text-[0.6875rem] font-medium text-primary">{strings.flaggedBadge}</span>
              )}
            </h3>
            <PanelGrid
              grid={grid}
              strings={strings}
              selectedKey={selectedCell?.categoryId === grid.categoryId ? selectedCell.key : null}
              onSelect={(key) => setSelectedCell({ categoryId: grid.categoryId, key })}
            />
            {selectedCell?.categoryId === grid.categoryId && grid.cells.get(selectedCell.key) && (
              <RowDetail
                grid={grid}
                cellKey={selectedCell.key}
                panelLabel={panelLabels[grid.categoryId] ?? grid.categoryId}
                strings={strings}
                pairing={pairing}
                rawByRef={rawByRef}
                onClose={() => setSelectedCell(null)}
              />
            )}
          </section>
        ))
      )}

      {rows && rawRows.length > 0 && pairing && report.rawSource && (
        <RawRowsSection
          rows={rows}
          rawRows={rawRows}
          pairing={pairing}
          rawSource={report.rawSource}
          panelLabels={panelLabels}
          strings={strings}
        />
      )}

      <AlertDialog open={confirmOpen} onOpenChange={(open) => { if (!deleting) setConfirmOpen(open) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{strings.resolveTitle}</AlertDialogTitle>
            <AlertDialogDescription>{fill(strings.resolveBody, { id: report.id, count: report.rowCount })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{strings.resolveCancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => { event.preventDefault(); void resolve() }}
              disabled={deleting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="animate-spin" aria-hidden="true" />}
              {strings.resolveConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function PanelGrid({
  grid,
  strings,
  selectedKey,
  onSelect,
}: {
  grid: ReportPanelGrid
  strings: Strings
  selectedKey: string | null
  onSelect: (key: string) => void
}) {
  const { t } = useLanguage()
  const decidedByLabels = ((t as any).labDataReport?.decidedBy ?? {}) as Record<string, string>
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-max min-w-full border-collapse text-xs tabular-nums">
        <thead className="bg-muted text-muted-foreground">
          <tr>
            <th scope="col" className="sticky left-0 z-10 bg-muted px-2 py-1.5 text-left font-medium">{strings.dayHeader}</th>
            {grid.columns.map((column) => (
              <th key={column.label} scope="col" className="px-2 py-1.5 text-center font-medium">
                <span className="block text-foreground">{column.label}</span>
                <span className="block font-normal">{column.decidedBy.map((rule) => decidedByLabels[rule] ?? rule).join('、')}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.days.map((day) => (
            <tr key={String(day)} className="border-t border-border/70">
              <th scope="row" className="sticky left-0 bg-background px-2 py-1 text-left font-normal text-muted-foreground">
                {day === null ? strings.undated : fill(strings.dayValue, { day })}
              </th>
              {grid.columns.map((column, index) => {
                const key = cellKey(day, index)
                const cell = grid.cells.get(key)
                if (!cell) return <td key={column.label} className="px-2 py-1" />
                const many = cell.rows.length > 1
                return (
                  <td key={column.label} className="p-0.5 text-center">
                    <button
                      type="button"
                      onClick={() => onSelect(key)}
                      title={many ? fill(strings.multiValue, { count: cell.rows.length }) : undefined}
                      aria-pressed={selectedKey === key}
                      className={cn(
                        "min-h-6 w-full rounded px-1.5 py-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary max-md:min-h-11",
                        many && "font-semibold",
                        selectedKey === key && "bg-primary/10 ring-1 ring-primary",
                      )}
                    >
                      {cell.rows.map(formatReportValue).join(' / ')}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function describeRawRow(row: LabDataReportRawRow): string {
  const value = row.results.assay_value ?? row.results.assaY_VALUE
  return [
    `#${row.ref}`,
    row.fields.order_code,
    row.fields.assay_item_name ?? row.fields.assaY_NAME,
    value === undefined ? undefined : `${value}${row.fields.unit_data ? ` ${row.fields.unit_data}` : ''}`,
    row.fields.hosp,
  ].filter(Boolean).join(' · ')
}

function RowDetail({
  grid,
  cellKey: key,
  panelLabel,
  strings,
  pairing,
  rawByRef,
  onClose,
}: {
  grid: ReportPanelGrid
  cellKey: string
  panelLabel: string
  strings: Strings
  pairing: RawPairing | null
  rawByRef: Map<number, LabDataReportRawRow>
  onClose: () => void
}) {
  const { t } = useLanguage()
  const decidedByLabels = ((t as any).labDataReport?.decidedBy ?? {}) as Record<string, string>
  const rows = grid.cells.get(key)?.rows ?? []
  const fields = strings.fields ?? {}
  const first = rows[0]
  const title = first
    ? fill(strings.rowDetailTitle, {
      panel: panelLabel,
      column: first.app.column,
      day: first.day === null ? strings.undated : fill(strings.dayValue, { day: first.day }),
    })
    : ''
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold">{title}</h4>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label={strings.closeDetail} className="h-7 w-7 p-0 max-md:h-11 max-md:w-11">
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {rows.map((row) => {
          const entries: Array<[string, string]> = [
            [fields.name, row.code.text ?? '—'],
            [fields.codes, row.code.codings.map((coding) => [coding.code, coding.display, coding.system?.split('/').pop()].filter(Boolean).join(' · ')).join('\n') || '—'],
            [fields.specimen, row.specimen ?? '—'],
            [fields.value, `${formatReportValue(row)}${row.unit ? ` ${row.unit}` : ''}${row.unitCode && row.unitCode !== row.unit ? ` (${row.unitCode})` : ''}`],
            [fields.status, row.status ?? '—'],
            [fields.time, row.timeOfDay ?? '—'],
            [fields.sourceTime, row.sourceTime ? `${row.sourceTime.dayDelta >= 0 ? '+' : ''}${row.sourceTime.dayDelta}d ${row.sourceTime.time}` : '—'],
            [fields.performer, row.performer.join('、') || '—'],
            [fields.interpretation, row.interpretation.join(', ') || '—'],
            [fields.range, row.referenceRange.map((range) => range.text ?? `${range.low ?? ''}–${range.high ?? ''} ${range.unit ?? ''}`.trim()).join('；') || '—'],
            [fields.extensions, row.sourceExtensions.map((extension) => `${extension.name.replace(/^medcloud-/, '')}: ${extension.value}`).join('\n') || '—'],
            [fields.tags, row.sourceTags.join('\n') || '—'],
            [fields.decidedBy, decidedByLabels[row.app.decidedBy] ?? row.app.decidedBy],
            [fields.testKey, row.app.testKey],
            [fields.category, row.category.join(', ') || '—'],
            [fields.sameValue, row.sameValueGroup !== undefined ? `#${row.sameValueGroup}` : '—'],
            ...(pairing
              ? [[fields.pairedRaw, (() => {
                const rawRef = pairing.rawByConverted.get(row.ref)
                const raw = rawRef === undefined ? undefined : rawByRef.get(rawRef)
                if (!raw) return pairing.otherSource.includes(row.ref) ? strings.otherSource : strings.noRawPair
                const notes = [
                  pairing.valueDiffers.has(raw.ref) && strings.valueDiffers,
                  pairing.codeOnly.has(raw.ref) && strings.codeOnly,
                ].filter(Boolean)
                const merged = [...pairing.mergedInto]
                  .filter(([, into]) => into === row.ref)
                  .map(([mergedRef]) => rawByRef.get(mergedRef))
                  .filter((copy): copy is LabDataReportRawRow => !!copy)
                return [
                  `${describeRawRow(raw)}${notes.length > 0 ? `（${notes.join('、')}）` : ''}`,
                  ...merged.map((copy) => `${strings.mergedCopy}：${describeRawRow(copy)}`),
                ].join('\n')
              })()] as [string, string]]
              : []),
          ]
          return (
            <dl key={row.ref} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 rounded border border-border bg-background p-2 text-xs">
              <dt className="col-span-2 mb-1 font-mono text-muted-foreground">#{row.ref}</dt>
              {entries.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="whitespace-pre-wrap break-words">{value}</dd>
                </div>
              ))}
            </dl>
          )
        })}
      </div>
    </div>
  )
}

function RawRowsSection({
  rows,
  rawRows,
  pairing,
  rawSource,
  panelLabels,
  strings,
}: {
  rows: LabDataReportRow[]
  rawRows: LabDataReportRawRow[]
  pairing: RawPairing
  rawSource: NonNullable<StoredLabDataReport['rawSource']>
  panelLabels: Record<string, string>
  strings: Strings
}) {
  const [unmatchedOnly, setUnmatchedOnly] = useState(false)
  const convertedByRef = useMemo(() => new Map(rows.map((row) => [row.ref, row])), [rows])
  const notes = strings.rawNotes ?? {}
  const columns = strings.rawColumns ?? {}
  const sources = strings.rawSources ?? {}
  const dateLabels = strings.rawDateFields ?? {}
  const lines = [
    rawSource.droppedStrings > 0 && fill(notes.dropped, { count: rawSource.droppedStrings }),
    rawSource.unparsedDates > 0 && fill(notes.unparsed, { count: rawSource.unparsedDates }),
    rawSource.truncatedRows > 0 && fill(notes.truncated, { count: rawSource.truncatedRows }),
    rawSource.unknownFields.length > 0 && fill(notes.unknown, { fields: rawSource.unknownFields.join(', ') }),
    fill(notes.status, { s02: rawSource.endpointStatus.s02 ?? '—', s03: rawSource.endpointStatus.s03 ?? '—' }),
  ].filter((line): line is string => !!line)
  // Worth a look: rows nothing explains, pairs whose values differ, and
  // pairs made on the order code alone. Merged copies are explained.
  // Specific-allergen rows (30022C) are left out of the cumulative report on
  // purpose, so the app sends no converted row for them: not a conversion
  // error, and not worth a look.
  const excludedByDesign = (row: LabDataReportRawRow) =>
    SPECIFIC_ALLERGEN_NHI_ORDER_CODES.includes(row.fields.order_code?.trim().toUpperCase() ?? "")
    || isAllergenName(row.fields.assay_item_name ?? row.fields.assaY_NAME)
  const shown = unmatchedOnly
    ? rawRows.filter((row) => (!pairing.convertedByRaw.has(row.ref) && !pairing.mergedInto.has(row.ref) && !excludedByDesign(row))
      || pairing.valueDiffers.has(row.ref) || pairing.codeOnly.has(row.ref))
    : rawRows

  return (
    <section aria-labelledby="raw-rows-title" className="space-y-1.5">
      <h3 id="raw-rows-title" className="text-sm font-semibold">{strings.rawTitle}</h3>
      <p className="text-xs text-muted-foreground">{strings.rawIntro}</p>
      <p className="text-xs tabular-nums">
        {fill(strings.rawStats, {
          raw: rawRows.length,
          paired: pairing.convertedByRaw.size,
          differs: pairing.valueDiffers.size,
          codeOnly: pairing.codeOnly.size,
          merged: pairing.mergedInto.size,
          unmatchedRaw: pairing.unmatchedRaw.length,
          unmatchedConverted: pairing.unmatchedConverted.length,
        })}
        {pairing.otherSource.length > 0 && ` ${fill(strings.rawOtherSource, { count: pairing.otherSource.length })}`}
      </p>
      <ul className="space-y-0.5 text-xs text-muted-foreground">
        {lines.map((line) => <li key={line}>{line}</li>)}
      </ul>
      <label className="inline-flex items-center gap-1.5 text-xs max-md:min-h-11">
        <input type="checkbox" checked={unmatchedOnly} onChange={(event) => setUnmatchedOnly(event.target.checked)} />
        {strings.rawUnmatchedOnly}
      </label>
      <div
        role="region"
        aria-label={strings.rawTableLabel}
        tabIndex={0}
        className="max-h-[32rem] overflow-auto rounded-md border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <table className="w-max min-w-full border-collapse text-xs tabular-nums">
          <thead className="sticky top-0 z-10 bg-muted text-left text-muted-foreground">
            <tr>
              <th scope="col" className="sticky left-0 z-20 bg-muted px-2 py-1.5 font-medium">{columns.ref}</th>
              <th scope="col" className="px-2 py-1.5 font-medium">{columns.paired}</th>
              <th scope="col" className="px-2 py-1.5 font-medium">{columns.source}</th>
              <th scope="col" className="px-2 py-1.5 font-medium">{columns.day}</th>
              <th scope="col" className="px-2 py-1.5 font-medium">{columns.hospital}</th>
              <th scope="col" className="px-2 py-1.5 font-medium">{columns.order}</th>
              <th scope="col" className="px-2 py-1.5 font-medium">{columns.item}</th>
              <th scope="col" className="px-2 py-1.5 font-medium">{columns.value}</th>
              <th scope="col" className="px-2 py-1.5 font-medium">{columns.range}</th>
              <th scope="col" className="px-2 py-1.5 font-medium">{columns.marks}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              const pairedRef = pairing.convertedByRaw.get(row.ref)
              const paired = pairedRef === undefined ? undefined : convertedByRef.get(pairedRef)
              const mergedRef = pairing.mergedInto.get(row.ref)
              const mergedHost = mergedRef === undefined ? undefined : convertedByRef.get(mergedRef)
              const excluded = !paired && !mergedHost && excludedByDesign(row)
              const value = row.results.assay_value ?? row.results.assaY_VALUE
              const withheld = row.withheld.assay_value ?? row.withheld.assaY_VALUE
              const extra = [
                row.results.inspect_result !== undefined && `inspect_result: ${row.results.inspect_result}`,
                row.withheld.inspect_result !== undefined && `inspect_result (${row.withheld.inspect_result})`,
                row.results.memo_data !== undefined && `memo_data: ${row.results.memo_data}`,
                row.withheld.memo_data !== undefined && `memo_data (${row.withheld.memo_data})`,
              ].filter(Boolean)
              const marks = [
                row.fields.assay_mark && `mark ${row.fields.assay_mark}`,
                row.fields.data_mark && `data_mark ${row.fields.data_mark}`,
                row.fields.inspect_mode && `mode ${row.fields.inspect_mode}`,
                row.fields.assay_tp_cname,
                row.fields.assay_method,
                row.fields.func_type && `dept ${row.fields.func_type}`,
              ].filter(Boolean)
              return (
                <tr key={row.ref} className={cn('border-t border-border/70 align-top', ((!paired && !mergedHost && !excluded) || pairing.valueDiffers.has(row.ref)) && 'bg-amber-50 dark:bg-amber-950/30')}>
                  <th scope="row" className="sticky left-0 bg-background px-2 py-1 text-left font-normal text-muted-foreground">
                    {row.ref}
                  </th>
                  <td className="whitespace-nowrap px-2 py-1">
                    {paired ? (
                      <>
                        {fill(strings.pairedWith, { ref: paired.ref })}
                        {pairing.valueDiffers.has(row.ref) && (
                          <span className="ml-1 font-medium text-amber-700 dark:text-amber-400">{strings.valueDiffers}</span>
                        )}
                        {pairing.codeOnly.has(row.ref) && (
                          <span className="ml-1 text-muted-foreground">{strings.codeOnly}</span>
                        )}
                        <span className="block text-muted-foreground">
                          {(paired.app.categoryId ? panelLabels[paired.app.categoryId] ?? paired.app.categoryId : '—')} › {paired.app.column}
                        </span>
                      </>
                    ) : mergedHost ? (
                      <>
                        {fill(strings.mergedInto, { ref: mergedHost.ref })}
                        <span className="block text-muted-foreground">
                          {(mergedHost.app.categoryId ? panelLabels[mergedHost.app.categoryId] ?? mergedHost.app.categoryId : '—')} › {mergedHost.app.column}
                        </span>
                      </>
                    ) : excluded ? (
                      <span className="text-muted-foreground">{strings.excludedByDesign}</span>
                    ) : (
                      <span className="font-medium text-amber-700 dark:text-amber-400">{strings.unpaired}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1">
                    {sources[row.source] ?? row.source}
                    {row.ordinal !== undefined && <span className="ml-1 text-muted-foreground">#{row.ordinal}</span>}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1">
                    {Object.entries(row.dates).map(([field, date]) => (
                      <span key={field} className="block">
                        <span className="text-muted-foreground">{dateLabels[field] ?? field}</span>{' '}
                        {fill(strings.dayValue, { day: date!.day })}{date!.time ? ` ${date!.time}` : ''}
                      </span>
                    ))}
                  </td>
                  <td className="max-w-40 px-2 py-1">{row.fields.hosp ?? '—'}</td>
                  <td className="max-w-48 px-2 py-1">
                    <span className="font-mono">{row.fields.order_code ?? '—'}</span>
                    {row.fields.order_name && <span className="block text-muted-foreground">{row.fields.order_name}</span>}
                  </td>
                  <td className="max-w-48 px-2 py-1">{row.fields.assay_item_name ?? row.fields.assaY_NAME ?? '—'}</td>
                  <td className="whitespace-nowrap px-2 py-1">
                    {value !== undefined ? String(value) : withheld !== undefined ? `(${withheld})` : '—'}
                    {row.fields.unit_data && <span className="ml-1 text-muted-foreground">{row.fields.unit_data}</span>}
                    {extra.map((line) => <span key={String(line)} className="block text-muted-foreground">{line}</span>)}
                  </td>
                  <td className="max-w-40 px-2 py-1">{row.fields.consult_value ?? '—'}</td>
                  <td className="max-w-48 px-2 py-1 text-muted-foreground">{marks.join(' · ') || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
