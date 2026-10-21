"use client"

// Opens an analyte trend the way the 累積報告 always has — in the shared right
// detail pane when the split workspace is there, otherwise in a dialog — so
// the 總覽 lab card and the cumulative report can never show two different
// charts for the same analyte.

import { useCallback, useState, type ReactNode } from "react"
import dynamic from "next/dynamic"
import { Loader2, TrendingUp } from "lucide-react"
import { useLanguage } from "@/src/application/providers/language.provider"
import { useOptionalRightDetail } from "@/src/application/providers/right-detail.provider"
import { buildLabTrendSeries, type LabTrendSeries } from "@/src/shared/utils/lab-trend.utils"
import {
  getResolvedCumulativeLabTrendModule,
  loadCumulativeLabTrendModule,
} from "../components/cumulative-lab-trend-loader"
import type { OpenTrendTarget } from "../components/LabPivotTable"
import type { TrendWindow } from "../utils/trend-time-scale"

// The trend chart chunk is loaded on demand (see cumulative-lab-trend-loader).
// next/dynamic options must remain inline literals because Next statically
// analyses them.
const CumulativeLabTrendDetail = dynamic(
  () => loadCumulativeLabTrendModule().then((m) => m.CumulativeLabTrendDetail),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      </div>
    ),
  },
)
const CumulativeLabTrendDialog = dynamic(
  () => loadCumulativeLabTrendModule().then((m) => m.CumulativeLabTrendDialog),
  { ssr: false },
)

interface OpenTrendRequest {
  series: LabTrendSeries
  title: string
  sourceId: string
}

export function useLabTrendOpener({
  observations,
  preferDialog = false,
  trendWindow,
  onTrendWindowChange,
}: {
  /** Every loaded Observation — a trend is never cut to a view's window. */
  observations: any[]
  /** The standalone fullscreen report has no split workspace beside it. */
  preferDialog?: boolean
  trendWindow?: TrendWindow
  onTrendWindowChange?: (window: TrendWindow) => void
}): {
  openTrend: (target: OpenTrendTarget) => void
  activeTrendSourceId?: string
  trendDialog: ReactNode
} {
  const { t } = useLanguage()
  const rightDetail = useOptionalRightDetail()
  const [dialogTrend, setDialogTrend] = useState<OpenTrendRequest | null>(null)
  const trendTitle = (t.reports as any).cumulativeTrend?.title ?? '趨勢'

  const activeTrendSourceId = dialogTrend?.sourceId
    ?? (rightDetail?.detail?.sourceId.startsWith('cumulative-trend:')
      ? rightDetail.detail.sourceId
      : undefined)

  const openTrend = useCallback((target: OpenTrendTarget) => {
    const series = buildLabTrendSeries(observations, {
      categoryId: target.categoryId,
      mapKey: target.mapKey,
      testKey: target.testKey,
      displayName: target.displayName,
      nameMode: target.nameMode,
    })
    // Availability is indexed during the pivot build. Keep this final guard so
    // a source update between render and click can never open an unsafe chart.
    if (!series.chartable) return
    const request: OpenTrendRequest = {
      series,
      title: target.title,
      sourceId: target.sourceId,
    }
    // Keep trends on the same shared detail surface as the other report tabs
    // at every split-workspace width. On phones this gives the clinician the
    // fixed close/back header and preserves the originating tab + scroll
    // position.
    if (!preferDialog && rightDetail) {
      setDialogTrend(null)
      const TrendDetail = getResolvedCumulativeLabTrendModule()?.CumulativeLabTrendDetail
        ?? CumulativeLabTrendDetail
      rightDetail.showDetail({
        sourceId: request.sourceId,
        title: (
          <span className="inline-flex items-center gap-1.5">
            <TrendingUp className="h-4 w-4 text-primary" aria-hidden="true" />
            {request.title} · {trendTitle}
          </span>
        ),
        node: (
          <TrendDetail
            key={request.sourceId}
            series={request.series}
            initialWindow={trendWindow}
            onWindowChange={onTrendWindowChange}
          />
        ),
      })
      return
    }

    setDialogTrend(request)
  }, [observations, onTrendWindowChange, preferDialog, rightDetail, trendTitle, trendWindow])

  const TrendDialog = getResolvedCumulativeLabTrendModule()?.CumulativeLabTrendDialog
    ?? CumulativeLabTrendDialog
  const trendDialog = dialogTrend ? (
    <TrendDialog
      key={dialogTrend.sourceId}
      title={`${dialogTrend.title} · ${trendTitle}`}
      series={dialogTrend.series}
      initialWindow={trendWindow}
      onWindowChange={onTrendWindowChange}
      open
      onOpenChange={(open) => {
        if (!open) setDialogTrend(null)
      }}
    />
  ) : null

  return { openTrend, activeTrendSourceId, trendDialog }
}
