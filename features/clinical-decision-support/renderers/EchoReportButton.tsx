"use client"

import { useState } from 'react'
import { FileText } from 'lucide-react'
import { classifyReport, reportNarrative } from '@voho0000/personalized-care-fhir'
import { FormattedReportText } from '@/features/clinical-summary/reports/components/FormattedReportText'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useClinicalData } from '@/src/application/hooks/clinical-data/use-clinical-data-query.hook'
import type { HeartFailureMetric } from './heart-failure-board'

function EchoReportDialog({ metric, isEnglish, onClose, ecg = false }: { ecg?: boolean; metric: HeartFailureMetric; isEnglish: boolean; onClose: () => void }) {
  const { diagnosticReports, isLoading, error } = useClinicalData()
  const sourceIds = metric.evidence?.sources?.filter(source => source.resourceType === 'DiagnosticReport').map(source => source.resourceId) ?? []
  const matches = diagnosticReports.filter(report => {
    if (['entered-in-error', 'cancelled', 'registered', 'preliminary', 'partial'].includes(report.status ?? '')) return false
    const text = reportNarrative(report)
    if (classifyReport(report, text) !== (ecg ? 'ecg' : 'echocardiography')) return false
    if (sourceIds.length) return sourceIds.includes(report.id ?? '')
    const date = report.effectiveDateTime ?? report.effectivePeriod?.start ?? report.issued
    return Boolean(metric.date && date?.slice(0, 10) === metric.date.slice(0, 10))
  })
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent className="flex max-h-[80dvh] flex-col sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>{ecg ? (isEnglish ? 'ECG report' : '心電圖報告') : (isEnglish ? 'Echocardiography report' : '心超報告')}</DialogTitle>
        <DialogDescription>{metric.date?.slice(0, 10).replaceAll('-', '/') ?? (isEnglish ? 'Original report' : '原始報告')}</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 overflow-y-auto text-sm leading-relaxed">
        {matches.length ? matches.map(report => <article key={report.id} className="space-y-3 [&+article]:mt-5 [&+article]:border-t [&+article]:pt-4">
          <p className="font-medium">{report.code?.text ?? report.code?.coding?.find(code => code.display)?.display}{report.performer?.find(item => item.display)?.display ? ` · ${report.performer.find(item => item.display)?.display}` : ''}</p>
          {reportNarrative(report).trim() ? (
            <FormattedReportText text={reportNarrative(report)} className="text-sm leading-relaxed text-foreground/90" />
          ) : (
            <p className="text-muted-foreground">{isEnglish ? 'No report narrative is available.' : '報告未提供可顯示的文字內容。'}</p>
          )}
        </article>) : <p className="text-muted-foreground">{isLoading ? (isEnglish ? 'Loading report…' : '正在載入報告…') : error ? (isEnglish ? 'Unable to load the report.' : '無法載入報告。') : (isEnglish ? 'No matching original report.' : '沒有找到對應的原始報告。')}</p>}
      </div>
    </DialogContent>
  </Dialog>
}

/** Opens the original echo (or ECG) report. */
export function EchoReportButton({ metric, isEnglish, ecg = false }: { ecg?: boolean; metric: HeartFailureMetric; isEnglish: boolean }) {
  const [open, setOpen] = useState(false)
  const label = ecg ? (isEnglish ? 'ECG report' : '心電圖報告') : (isEnglish ? 'Echo report' : '心超報告')
  return <>
    <Button type="button" aria-label={label} variant="outline" size="sm" className="shrink-0 h-6 gap-1 px-1.5 text-xs shadow-none" onClick={() => setOpen(true)}>
      <FileText className="size-3" />{isEnglish ? 'Report' : '報告'}
    </Button>
    {open ? <EchoReportDialog ecg={ecg} metric={metric} isEnglish={isEnglish} onClose={() => setOpen(false)} /> : null}
  </>
}
