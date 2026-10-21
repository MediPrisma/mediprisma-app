"use client"

import { memo, useState } from "react"
import { ChevronDown, PanelRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  CLINICAL_ABNORMAL_TONE,
  CLINICAL_CATEGORY_TONE,
  CLINICAL_INPATIENT_TONE,
  CLINICAL_LIST_ROW_HOVER_TONE,
  CLINICAL_LIST_ROW_TONE,
  CLINICAL_SOURCE_TONE,
} from "@/features/clinical-summary/components/clinical-color-roles"
import {
  clinicalIcdChipClass,
  clinicalIcdCodeClass,
  clinicalIcdDescriptionClass,
  clinicalIcdDescriptionToneClass,
  clinicalIcdMoreButtonClass,
  clinicalTooltipSurfaceClass,
} from "@/features/clinical-summary/components/clinical-metadata-styles"
import { VisitDetailContent, visitHasDetails } from "./VisitDetailContent"
import { useDocumentSummaryStrings } from "@/features/clinical-summary/document-summary/utils/strings"
import type { DocumentEntry } from "@/features/clinical-summary/document-summary/types"
import type { VisitRecord } from "../hooks/useVisitHistory"
import type { EncounterDetails } from "../hooks/useEncounterDetails"
import { useLanguage } from "@/src/application/providers/language.provider"
import { useRightDetail } from "@/src/application/providers/right-detail.provider"
import { useResourceAnchor } from "@/src/application/hooks/use-resource-anchor.hook"
import { RIGHT_PANE_ACTION_CLASSES } from "@/src/shared/config/ui-theme.config"
import { formatDate as formatDateUtil } from "@/src/shared/utils/date.utils"
import { cn } from "@/src/shared/utils/cn.utils"
import { VisitSourceComparisonBadge } from './VisitSourceComparisonBadge'

type VisitType = 'outpatient' | 'outpatient-or-emergency' | 'inpatient' | 'emergency' | 'home' | 'virtual' | 'pharmacy' | 'other'

interface VisitItemProps {
  visit: VisitRecord
  details?: EncounterDetails
  /** Documents linked to this visit's Encounter (e.g. 出院病摘 / discharge
   *  summary) — surfaced inline so the user can open the full text from the
   *  visit without hunting through the 文件 tab. */
  documents?: DocumentEntry[]
  abnormalCount?: number
  isExpanded: boolean
  onToggle: (visitId: string) => void
}

const getTypeBadge = (type: VisitType, labels: any) => {
  // Visit setting is classification, not status. Inpatient uses blue so it can
  // be distinguished from outpatient at a glance; emergency keeps attention.
  const typeMap: Record<VisitType, { label: string; className: string }> = {
    outpatient: { label: labels.outpatient, className: CLINICAL_CATEGORY_TONE },
    'outpatient-or-emergency': { label: labels['outpatient-or-emergency'], className: CLINICAL_CATEGORY_TONE },
    inpatient:  { label: labels.inpatient,  className: CLINICAL_INPATIENT_TONE },
    emergency:  { label: labels.emergency,  className: CLINICAL_ABNORMAL_TONE },
    home:       { label: labels.home,       className: CLINICAL_CATEGORY_TONE },
    virtual:    { label: labels.virtual,    className: CLINICAL_CATEGORY_TONE },
    pharmacy:   { label: labels.pharmacy || '藥局', className: CLINICAL_CATEGORY_TONE },
    other:      { label: labels.other,      className: CLINICAL_CATEGORY_TONE },
  }
  const { label, className } = typeMap[type] || typeMap.other
  return <Badge variant="outline" className={cn("h-5 border-transparent px-1 py-0 text-[0.6875rem]", className)}>{label}</Badge>
}

const getCareDisciplineBadge = (
  discipline: VisitRecord['careDiscipline'],
  labels: Record<VisitRecord['careDiscipline'], string>,
) => {
  return (
    <Badge
      variant="outline"
      data-care-discipline={discipline}
      className="h-5 border-transparent bg-transparent px-0 py-0 text-[0.6875rem] font-normal text-muted-foreground"
    >
      {labels[discipline]}
    </Badge>
  )
}

interface VisitStatProps {
  kind: string
  label: string
  count: number
  attention?: boolean
  title?: string
  className?: string
  fullLabel?: string
}

/**
 * Dense, scan-friendly visit metadata. Short visible labels are clearer than
 * category icons in this clinical context and consume less width when used
 * alone. The value keeps a small aligned surface for comparison; only abnormal
 * results use the semantic attention colour.
 */
function VisitStat({ kind, label, count, attention = false, title, className }: VisitStatProps) {
  return (
    <span
      data-visit-stat={kind}
      aria-label={`${label} ${count}`}
      title={title}
      className={cn(
        "inline-flex h-5 min-w-0 shrink-0 items-center gap-1 border-l border-border/60 pl-1 text-[0.625rem] leading-none first:border-l-0 first:pl-0 max-sm:h-5 max-sm:gap-0.5 max-sm:border-l-0 max-sm:pl-0 max-sm:text-[10px]",
        className,
      )}
    >
      {attention ? (
        <span
          className={cn(
            "inline-flex h-5 items-center gap-1 rounded-full px-1.5 font-medium max-sm:h-5 max-sm:gap-0.5 max-sm:px-1",
            CLINICAL_ABNORMAL_TONE,
          )}
        >
          <span className="whitespace-nowrap">{label}</span>
          <span className="tabular-nums">{count}</span>
        </span>
      ) : (
        <>
          <span className="whitespace-nowrap text-muted-foreground">{label}</span>
          <span className="inline-flex h-4 min-w-4 items-center justify-center px-0.5 tabular-nums text-muted-foreground max-sm:h-[16px] max-sm:min-w-[16px]">
            {count}
          </span>
        </>
      )}
    </span>
  )
}

function VisitItemComponent({
  visit,
  details,
  documents,
  abnormalCount = 0,
  isExpanded,
  onToggle,
}: VisitItemProps) {
  const { t, locale } = useLanguage()
  const docStrings = useDocumentSummaryStrings()
  const { detail: rightDetail, toggleDetail } = useRightDetail()
  const reasonCodes = visit.icdCodes
  const hasIcdCodes = reasonCodes.length > 0 && /^[A-Z]\d/.test(reasonCodes[0].code)
  const hasSecondaryIcds = hasIcdCodes && reasonCodes.length > 1
  const [icdExpanded, setIcdExpanded] = useState(false)
  const docs = documents ?? []
  const hasDetails = visitHasDetails(details, documents)
  const hasDischargeDocument = docs.some((document) => document.isDischargeSummary)
  const isRightActive = rightDetail?.sourceId === visit.id
  const showMedicationExecutionPeriods = visit.type === 'inpatient'

  // Date label: a "住院日 ~ 出院日" range for inpatient stays that carry a
  // discharge date (Encounter.period.end on a different day); otherwise the
  // single visit date. Single-day visits and inpatient records with no
  // discharge data keep showing just the one date.
  const startLabel = formatDateUtil(visit.date, locale)
  const endLabel = visit.endDate ? formatDateUtil(visit.endDate, locale) : ''
  const showRange = !!visit.endDate && !!visit.date &&
    visit.endDate.slice(0, 10) !== visit.date.slice(0, 10)
  const dateLabel = showRange
    ? `${startLabel} ~ ${endLabel}`
    : startLabel
  const mobileDateLabel = showRange && /^\d{4}\//.test(startLabel) &&
    endLabel.startsWith(startLabel.slice(0, 5))
    ? `${startLabel}–${endLabel.slice(5)}`
    : dateLabel
  const secondaryIcdCount = Math.max(0, reasonCodes.length - 1)
  const icdToggleLabel = icdExpanded
    ? (locale.startsWith('zh') ? '收合其他 ICD 碼' : 'Collapse additional ICD codes')
    : (locale.startsWith('zh')
      ? `預覽並展開其他 ${secondaryIcdCount} 個 ICD 碼`
      : `Preview and expand ${secondaryIcdCount} additional ICD codes`)

  const detailStats: VisitStatProps[] = []
  if (details?.diagnoses.length) detailStats.push({ kind: 'diagnoses', label: t.visitHistory.diagnoses, count: details.diagnoses.length })
  if (details?.tests.length) detailStats.push({ kind: 'tests', label: t.visitHistory.tests, count: details.tests.length })
  if (abnormalCount > 0) detailStats.push({ kind: 'abnormal', label: (t.visitHistory as any).abnormal ?? 'Abnormal', count: abnormalCount, attention: true })
  if (details?.medications.length) detailStats.push({ kind: 'medications', label: t.visitHistory.medications, count: details.medications.length })
  if (details?.reports.length) detailStats.push({ kind: 'reports', label: t.visitHistory.examReportsShort, count: details.reports.length, title: t.visitHistory.examReports })
  if (details?.procedures.length) detailStats.push({ kind: 'procedures', label: t.visitHistory.procedures, count: details.procedures.length })

  const mobileStats: VisitStatProps[] = [...detailStats]
  if (docs.length > 0) {
    const fullDocumentLabel = hasDischargeDocument
      ? docStrings.dischargeBadge
      : docStrings.documentBadge
    mobileStats.push({
      kind: 'documents',
      label: hasDischargeDocument && locale.startsWith('zh') ? '病摘' : fullDocumentLabel,
      fullLabel: fullDocumentLabel,
      count: docs.length,
      title: hasDischargeDocument ? docStrings.dischargeBadgeTooltip : docStrings.documentBadgeTooltip,
    })
  }
  const hiddenMobileStatCount = Math.max(0, mobileStats.length - 4)

  // Open this visit's detail in the right pane (向右展開). Reuses the very same
  // VisitDetailContent that renders inline.
  const openInRightPane = (e: React.MouseEvent) => {
    e.stopPropagation()
    toggleDetail({
      sourceId: visit.id,
      title: (
        <span className="flex items-center gap-1.5">
          {getTypeBadge(visit.type, t.visitHistory.badges)}
          {getCareDisciplineBadge(visit.careDiscipline, t.visitHistory.careDisciplines)}
          <span>{dateLabel}</span>
          {visit.location && <span className="text-xs font-normal text-muted-foreground">· {visit.location}</span>}
        </span>
      ),
      node: (
        <VisitDetailContent
          details={details}
          documents={documents}
          abnormalCount={abnormalCount}
          showMedicationExecutionPeriods={showMedicationExecutionPeriods}
        />
      ),
    })
  }

  // Resource-navigation anchor: a cited Encounter in the Medical Summary tab
  // scroll-flashes this card.
  const anchorRef = useResourceAnchor('Encounter', visit.sourceIds ?? visit.id)

  return (
    <div
      ref={anchorRef}
      data-tour="visit-tour-row"
      className={cn(
        "reveal-scope min-w-0 max-w-full overflow-hidden rounded-none border transition-colors",
        CLINICAL_LIST_ROW_TONE,
        // 向右展開 active: tint the whole row so it's clear which visit the
        // right pane is showing.
        isRightActive && "bg-accent",
      )}
    >
      {/* role="button" instead of <button> so we can nest the +N ICD-expand
          <button> inside without producing invalid HTML (button-in-button
          triggers React hydration error). Keyboard accessibility preserved
          via tabIndex + Enter/Space handler. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onToggle(visit.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle(visit.id)
          }
        }}
        className={cn(
          "w-full cursor-pointer px-2 py-1.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40",
          CLINICAL_LIST_ROW_HOVER_TONE,
        )}
      >
        {/* Two content rows share one fixed action column. The expand control
            stays above the right-pane control, so document metadata and long
            ICD text never move either action horizontally. */}
        <div
          data-testid="visit-row-grid"
          className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_1.5rem] grid-rows-[auto_auto] gap-x-1.5"
        >
          <div
            data-testid="visit-primary-metadata"
            className="col-start-1 row-start-1 flex min-w-0 items-center gap-x-1.5 overflow-hidden leading-5 max-sm:col-end-3 max-sm:gap-x-1"
          >
            {/* The date leads the row; setting, source and place follow as
                muted context. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  aria-label={dateLabel}
                  data-testid="visit-date-label"
                  className="min-w-0 shrink-0 truncate text-[13px] font-medium leading-5 sm:text-[0.9375rem]"
                >
                  <span className="sm:hidden">{mobileDateLabel}</span>
                  <span className="max-sm:hidden">{dateLabel}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                data-testid="visit-date-tooltip"
                className={clinicalTooltipSurfaceClass}
              >
                <span className="tabular-nums">{dateLabel}</span>
              </TooltipContent>
            </Tooltip>
            {getTypeBadge(visit.type, t.visitHistory.badges)}
            <VisitSourceComparisonBadge visit={visit} />
            {getCareDisciplineBadge(visit.careDiscipline, t.visitHistory.careDisciplines)}
            {visit.location && (
              <span
                className={cn(
                  "inline-flex h-5 min-w-0 max-w-[9rem] shrink-0 items-center gap-1 text-[0.6875rem] max-sm:max-w-none max-sm:flex-1 max-sm:shrink max-sm:text-[12px]",
                  CLINICAL_SOURCE_TONE,
                )}
                title={visit.location}
              >
                <span className="truncate">{visit.location}</span>
              </span>
            )}
            {visit.status === "in-progress" && (
              <Badge variant="outline" className="h-5 px-1.5 py-0 text-[0.6875rem] border-green-500 text-green-700 dark:border-green-500/40 dark:bg-green-500/10 dark:text-green-300">
                {t.visitHistory.inProgress}
              </Badge>
            )}
          </div>
          {/* Right cluster: compact text labels with tabular values. Category
              colour is neutral; abnormal is the sole attention colour. On
              phones, at most four statistics remain visible; the rest move
              into an explicit +N popover instead of clipping or scrolling. */}
            <div
              data-testid="visit-stat-strip"
              className="col-start-2 row-start-1 flex max-w-none shrink-0 flex-nowrap items-center justify-end gap-1 overflow-visible whitespace-nowrap max-sm:col-end-4 max-sm:row-start-2 max-sm:max-w-[200px] max-sm:justify-self-end max-sm:gap-1 max-sm:overflow-hidden"
            >
              {mobileStats.map((stat, index) => (
                <VisitStat
                  key={stat.kind}
                  {...stat}
                  className={cn(
                    index >= 4 && "max-sm:hidden",
                    stat.kind === 'documents' && "sm:hidden",
                  )}
                />
              ))}
              {hiddenMobileStatCount > 0 && (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      data-testid="visit-stat-more"
                      aria-label={locale.startsWith('zh')
                        ? `顯示全部 ${mobileStats.length} 項統計`
                        : `Show all ${mobileStats.length} statistics`}
                      onClick={(event) => event.stopPropagation()}
                      onMouseDown={(event) => event.stopPropagation()}
                      className="inline-flex h-5 shrink-0 items-center justify-center rounded-md px-1.5 text-[0.6875rem] font-medium text-muted-foreground hover:bg-muted sm:hidden"
                    >
                      +{hiddenMobileStatCount}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    data-testid="visit-stat-popover"
                    align="end"
                    side="top"
                    onClick={(event) => event.stopPropagation()}
                    className="w-auto min-w-36 space-y-1.5 p-2.5"
                  >
                    {mobileStats.map((stat) => (
                      <VisitStat
                        key={`popover-${stat.kind}`}
                        {...stat}
                        label={stat.fullLabel ?? stat.label}
                        className="border-l-0 pl-0"
                      />
                    ))}
                  </PopoverContent>
                </Popover>
              )}
            </div>

          {hasDetails && (
            <button
              type="button"
              data-testid="visit-expand-action"
              aria-label={isExpanded ? t.visitHistory.hideDetails : t.visitHistory.viewDetails}
              aria-expanded={isExpanded}
              title={isExpanded ? t.visitHistory.hideDetails : t.visitHistory.viewDetails}
              onClick={(event) => {
                event.stopPropagation()
                onToggle(visit.id)
              }}
              onMouseDown={(event) => event.stopPropagation()}
              className="col-start-3 row-start-1 inline-flex h-6 w-6 items-center justify-center self-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              <ChevronDown
                className={cn("h-4 w-4 transition-transform", isExpanded && "rotate-180")}
                aria-hidden
              />
            </button>
          )}

          <div
            data-testid="visit-context-row"
            className={cn(
              "col-start-1 row-start-2 mt-0.5 flex min-w-0 items-end justify-between gap-2 text-sm leading-5 max-sm:col-end-2 max-sm:col-start-1",
              icdExpanded ? "items-start overflow-visible" : "items-center overflow-x-clip",
            )}
          >
            <div
              className={cn(
                "flex min-w-0 flex-1 gap-1",
                icdExpanded ? "items-start overflow-visible" : "items-center overflow-x-clip",
              )}
            >
              {visit.department && (
                <span
                  data-testid="visit-channel-label"
                  className="max-w-[8rem] shrink-0 truncate text-xs leading-5 text-muted-foreground max-sm:hidden"
                  title={visit.department}
                >
                  {visit.department}
                </span>
              )}
              {visit.physician && (
                <span className="max-w-[9rem] shrink-0 truncate text-xs leading-5 text-muted-foreground" title={`${t.visitHistory.physician} ${visit.physician}`}>
                  {t.visitHistory.physician} {visit.physician}
                </span>
              )}
              {visit.reason && (
                <span className={cn(
                  "flex min-w-0 flex-1 gap-1",
                  icdExpanded ? "items-start" : "items-center",
                )}>
                <span
                  data-testid="visit-icd-field-label"
                  className="sr-only"
                  title={(t.visitHistory as any).icdCodesTooltip}
                >
                  {(t.visitHistory as any).recordedIcdCodes ?? t.visitHistory.reason}:{' '}
                </span>
                {hasIcdCodes ? (
                  <span
                    data-icd-list-state={icdExpanded ? 'expanded' : 'collapsed'}
                    className={cn(
                      "min-w-0 gap-1 align-middle",
                      icdExpanded
                        ? "flex flex-1 flex-wrap items-start overflow-visible"
                        : "inline-flex items-center overflow-x-clip",
                    )}
                  >
                    {/* Default: primary only. After explicit expansion, wrap
                        complete diagnoses instead of requiring hover to read. */}
                    {(icdExpanded ? reasonCodes : reasonCodes.slice(0, 1)).map((rc, i) => {
                      const fullIcdLabel = [rc.code, rc.description].filter(Boolean).join(' ')
                      return (
                        <Tooltip key={`${rc.code}-${i}`}>
                          <TooltipTrigger asChild>
                            <span
                              aria-label={fullIcdLabel}
                              tabIndex={0}
                              onClick={(e) => e.stopPropagation()}
                              onMouseDown={(e) => e.stopPropagation()}
                              className={cn(
                                clinicalIcdChipClass,
                                "cursor-text select-text",
                                icdExpanded && "h-auto min-h-5 max-w-[18rem] items-start py-0.5",
                              )}
                            >
                              <span className={clinicalIcdCodeClass}>{rc.code}</span>
                              {rc.description && (
                                <span className={icdExpanded
                                  ? cn(
                                    "min-w-0 whitespace-normal break-words text-clip leading-4",
                                    clinicalIcdDescriptionToneClass,
                                  )
                                  : clinicalIcdDescriptionClass}
                                >
                                  {rc.description}
                                </span>
                              )}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent
                            side="top"
                            data-testid="visit-icd-tooltip"
                            className={cn(
                              clinicalTooltipSurfaceClass,
                              "max-w-[min(90vw,28rem)] whitespace-normal break-words text-xs leading-relaxed",
                            )}
                          >
                            {fullIcdLabel}
                          </TooltipContent>
                        </Tooltip>
                      )
                    })}
                    {hasSecondaryIcds && (
                      icdExpanded ? (
                        <button
                          type="button"
                          aria-label={icdToggleLabel}
                          aria-expanded
                          onClick={(e) => {
                            e.stopPropagation()
                            setIcdExpanded(false)
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                          className={clinicalIcdMoreButtonClass}
                        >
                          −
                        </button>
                      ) : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              aria-label={icdToggleLabel}
                              aria-expanded={false}
                              onClick={(e) => {
                                e.stopPropagation()
                                setIcdExpanded(true)
                              }}
                              onMouseDown={(e) => e.stopPropagation()}
                              className={clinicalIcdMoreButtonClass}
                            >
                              +{secondaryIcdCount}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent
                            side="top"
                            data-testid="secondary-icd-preview"
                            className={cn(
                              clinicalTooltipSurfaceClass,
                              "max-h-[min(20rem,60vh)] max-w-[min(90vw,32rem)] overflow-y-auto p-2.5 text-xs leading-relaxed",
                            )}
                          >
                            <div className="space-y-1.5">
                              {reasonCodes.slice(1).map((rc, index) => (
                                <div
                                  key={`${rc.code}-preview-${index}`}
                                  className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2"
                                >
                                  <span className="font-mono font-semibold text-secondary-foreground">
                                    {rc.code}
                                  </span>
                                  {rc.description && (
                                    <span className="whitespace-normal break-words text-secondary-foreground/80">
                                      {rc.description}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      )
                    )}
                  </span>
                ) : (
                  <span
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="min-w-0 truncate select-text cursor-text"
                  >
                    {visit.reason}
                  </span>
                )}
                </span>
              )}
              {!visit.reason && visit.diagnosis && (
                <span className="flex min-w-0 flex-1 items-center gap-1">
                  <span className="shrink-0 font-medium text-muted-foreground">{t.visitHistory.diagnosis}: </span>
                  <span className="min-w-0 truncate">{visit.diagnosis}</span>
                </span>
              )}
            </div>

          </div>

          {docs.length > 0 && (
            <div
              data-testid="visit-secondary-metadata"
              className="col-start-2 row-start-2 flex shrink-0 items-center justify-end gap-1 max-sm:hidden"
            >
              <VisitStat
                kind="documents"
                label={hasDischargeDocument ? docStrings.dischargeBadge : docStrings.documentBadge}
                count={docs.length}
                title={hasDischargeDocument ? docStrings.dischargeBadgeTooltip : docStrings.documentBadgeTooltip}
              />
            </div>
          )}

          {hasDetails && (
            <div data-testid="visit-secondary-actions" className="col-start-3 row-start-2 flex h-6 w-6 items-center justify-center self-center max-sm:hidden">
              <button
                type="button"
                data-tour="visit-open-right"
                onClick={openInRightPane}
                onMouseDown={(e) => e.stopPropagation()}
                title={(t.visitHistory as any).openRight ?? '在右側展開'}
                aria-label={(t.visitHistory as any).openRight ?? '在右側展開'}
                className={cn(
                  RIGHT_PANE_ACTION_CLASSES,
                  "h-6 w-6 border-transparent bg-transparent p-0 text-muted-foreground/75 hover:border-border hover:bg-background/80 hover:text-foreground focus-visible:border-border focus-visible:bg-background",
                  isRightActive && "!opacity-100 bg-foreground/[0.07] text-foreground",
                )}
              >
                <PanelRight className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>

      </div>

      {isExpanded && (
        <div className="min-w-0 max-w-full overflow-hidden border-t bg-muted/30 px-3 py-3 text-sm">
          <VisitDetailContent
            details={details}
            documents={documents}
            abnormalCount={abnormalCount}
            showMedicationExecutionPeriods={showMedicationExecutionPeriods}
          />
        </div>
      )}
    </div>
  )
}

// Expanding one visit used to recreate callbacks for every visible row and
// re-render all 25 cards. With stable parent props, only the changed row now
// commits; clinical details and source data remain untouched.
export const VisitItem = memo(VisitItemComponent)
VisitItem.displayName = 'VisitItem'
