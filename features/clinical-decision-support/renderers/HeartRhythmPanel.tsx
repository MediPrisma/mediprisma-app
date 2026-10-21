"use client"

import type { HfpefInputReading } from '../utils/hfpef-scores'
import type { HfpefInputsPatch } from '../stores/hfpef-inputs.store'
import { classifyReport, extractEcgFindings, reportNarrative } from '@voho0000/personalized-care-fhir'
import { useClinicalData } from '@/src/application/hooks/clinical-data/use-clinical-data-query.hook'
import { EchoReportButton } from './EchoReportButton'

/** The rhythm the record's latest ECG report reads, or the clinician's override. */
function useRhythmReading(isEnglish: boolean, reading?: HfpefInputReading) {
  const { diagnosticReports } = useClinicalData()
  const reports = diagnosticReports.filter(report => {
    const text = reportNarrative(report)
    return !['entered-in-error', 'cancelled', 'registered', 'preliminary', 'partial'].includes(report.status ?? '') && classifyReport(report, text) === 'ecg'
  }).sort((a, b) => (b.effectiveDateTime ?? b.effectivePeriod?.start ?? b.issued ?? '').localeCompare(a.effectiveDateTime ?? a.effectivePeriod?.start ?? a.issued ?? ''))
  const report = reports[0]
  const findings = report ? extractEcgFindings(reportNarrative(report)) : undefined
  const rhythm = findings?.rhythm
  const recordLabel = rhythm === 'sinus' ? 'Sinus rhythm' : rhythm === 'paced' ? 'Paced rhythm' : rhythm === 'not-sinus' ? (/atrial\s+fibrillation|心房顫動/i.test(findings?.rhythmFragment ?? '') ? 'AF' : /flutter|心房撲動/i.test(findings?.rhythmFragment ?? '') ? 'Atrial flutter' : (isEnglish ? 'Non-sinus rhythm' : '非竇性心律')) : report ? (isEnglish ? 'Rhythm not identified from report' : '未能從報告辨識心律') : (isEnglish ? 'Not documented' : '紀錄無值')
  const date = report?.effectiveDateTime ?? report?.effectivePeriod?.start ?? report?.issued
  const override = reading?.origin === 'physician' ? reading : undefined
  const label = override?.value === 'af' ? 'AF' : override?.value === 'sr' ? 'Sinus rhythm' : recordLabel
  const shownDate = (override?.date ?? date)?.slice(0, 10)
  const reportMetric = report ? { factKey: 'rhythm', label, date, kind: 'measure' as const, stale: false, entered: false, evaluated: Boolean(rhythm), evidence: { label: 'ECG', value: label, factKeys: [], sources: [{ resourceType: 'DiagnosticReport' as const, resourceId: report.id ?? '' }] } } : undefined
  return { label, shownDate, report, reportMetric, documented: Boolean(report || override) }
}

export function HeartRhythmPanel({ isEnglish, reading }: { isEnglish: boolean; reading?: HfpefInputReading; onSave?: (patch: HfpefInputsPatch) => void }) {
  const { label, shownDate, report, reportMetric } = useRhythmReading(isEnglish, reading)
  return <>
    <div className="text-xs text-muted-foreground">{isEnglish ? 'Rhythm' : '心律'}</div>
    <div className="flex items-center gap-2"><div className="mt-1 text-base font-semibold">{label}</div>
    </div>
    <div className="flex w-full items-center justify-between gap-2"><span className="whitespace-nowrap text-xs text-muted-foreground">{shownDate?.replaceAll('-', '/')}</span>
    {report && reportMetric ? <EchoReportButton ecg isEnglish={isEnglish} metric={reportMetric} /> : (
      <span className="text-xs text-muted-foreground">{isEnglish ? 'No ECG report found' : '查無心電圖報告'}</span>
    )}
    </div>
  </>
}
