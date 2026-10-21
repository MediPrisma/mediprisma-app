'use client'
import { createContext, useContext, useId } from 'react'
import type { PreventReading } from '../utils/prevent-reading'
import { usePreventStore } from '../stores/prevent-inputs.store'
import { carriedLabel, useCarriedLookup } from './visit/carried-answer-context'
import type { CdssRecommendation } from '../types'
export const PreventReadingContext = createContext<PreventReading | undefined>(undefined)
interface Summary { title: string; band?: string; recommendation: string; target: string; caveat: string; personalize: string; sourceUrl: string }
export function PreventRiskSummary({ recommendation, locale, patientId }: { recommendation: CdssRecommendation; locale: string; patientId?: string }) {
  const reading = useContext(PreventReadingContext)
  const setInput = usePreventStore(s => s.setInput)
  const carriedFrom = useCarriedLookup()
  const id = useId()
  const en = locale === 'en'
  const summary = (recommendation as CdssRecommendation & { preventSummary?: Summary }).preventSummary
  if (!summary || !reading) return null
  const r = reading.result
  return <section className="mt-4 space-y-3 border-t border-border pt-4" aria-label={summary.title}>
    <h4 className="font-semibold">{summary.title}</h4>
    <p className="text-sm font-medium" role="status">{r.status === 'ready'
      ? `${en ? '10-year' : '10 年'} ASCVD ${r.risk10!.toFixed(2)}% · ${summary.band ?? ''} · ${en ? '30-year' : '30 年'} ${r.risk30 === undefined ? '— (30–59)' : `${r.risk30.toFixed(2)}%`}`
      : r.status === 'ineligible' ? en ? 'Outside eligibility' : '不適用本計算流程' : en ? 'Inputs require verification' : '待核對計算資料'}</p>
    {r.issues.length > 0 && <p className="text-sm text-muted-foreground">{en ? 'Check: ' : '需確認：'}{r.issues.map(k => reading.fields.find(f => f.input.key === k)?.input.label[en ? 'en' : 'zh'] ?? k).join('、')}</p>}
    <p className="text-sm leading-relaxed">{summary.recommendation}</p>
    <p className="text-sm font-medium">{summary.target}</p>
    <details>
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-primary">{en ? 'Verify PREVENT inputs' : '檢核／補齊 PREVENT 資料'}</summary>
      <div className="grid gap-3 @min-[40rem]:grid-cols-2">
        {reading.fields.map(f => <div key={f.input.key} className="min-w-0 space-y-1">
          {f.input.type === 'select' ? <fieldset className="min-w-0 space-y-1.5" disabled={!patientId || f.locked}>
            <legend className="text-sm font-medium">{f.input.label[en ? 'en' : 'zh']}</legend>
            <div className="flex flex-wrap items-center gap-1">
              {[...f.input.options].sort((a, b) => {
                const order = ['yes', 'no', 'female', 'male', '']
                return order.indexOf(a.value) - order.indexOf(b.value)
              }).map(o => <button key={o.value} type="button" aria-pressed={f.value === o.value}
                className={`min-h-11 rounded-md border px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${f.value === o.value ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted/40'}`}
                onClick={() => patientId && setInput(patientId, f.input.key, o.value)}>
                {o.value === 'yes' ? '✓ ' : o.value === 'no' ? '× ' : o.value === '' ? '? ' : f.value === o.value ? '✓ ' : '○ '}{o.label[en ? 'en' : 'zh']}
              </button>)}
            </div>
          </fieldset> : <>
            <label className="block text-sm" htmlFor={`${id}-${f.input.key}`}>{f.input.label[en ? 'en' : 'zh']}{f.input.unit ? ` · ${f.input.unit}` : ''}</label>
            <input id={`${id}-${f.input.key}`} type="number" step="any" disabled={!patientId} value={f.value} className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring" onChange={e => patientId && setInput(patientId, f.input.key, e.target.value)} />
          </>}
          <p className="text-xs text-muted-foreground">{f.source === 'physician' && carriedFrom(`prevent:${f.input.key}`) ? `${carriedLabel(carriedFrom(`prevent:${f.input.key}`) ?? '', en)}${en ? '; confirm it still applies' : '，請確認仍適用'}` : f.source === 'physician' ? en ? 'Physician entry; document in chart' : '醫師輸入，請病歷註記' : f.source === 'record' ? en ? 'From record; verify date and current status' : '依病歷帶入，請核對日期與現況' : en ? 'Unconfirmed' : '未確認'}{f.date ? ` · ${f.date.slice(0,10)}` : ''}{f.ageDays !== undefined && f.ageDays > 365 ? en ? ` · ${f.ageDays} days old; repeat/reconfirm` : ` · 已 ${f.ageDays} 天，請複驗／重新確認` : ''}{f.unitError ? en ? ' · Unit requires verification' : ' · 單位需核對' : ''}</p>
          {f.source === 'physician' && <button type="button" className="min-h-11 text-xs text-primary underline" onClick={() => patientId && setInput(patientId, f.input.key, undefined)}>{en ? 'Restore record value' : '恢復病歷數值'}</button>}
        </div>)}
      </div>
    </details>
    <p className="text-xs leading-relaxed text-muted-foreground">{summary.personalize}</p>
    <p className="text-xs leading-relaxed text-muted-foreground">{summary.caveat}</p>
    <a className="inline-block min-h-11 py-3 text-xs text-primary underline" href={summary.sourceUrl} target="_blank" rel="noreferrer">ACC/AHA 2026 §4.2.3.7</a>
  </section>
}
