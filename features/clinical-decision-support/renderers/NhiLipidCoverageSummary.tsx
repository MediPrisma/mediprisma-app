"use client"

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useCopyToClipboard } from '@/src/shared/hooks/use-copy-to-clipboard'
import { useNhiLipidReviewStore, type NhiLipidAnswer } from '../stores/nhi-lipid-review.store'
import type { CdssRecommendation } from '../types'
import { carriedLabel, useCarriedLookup } from './visit/carried-answer-context'

interface CoverageCheck {
  id: string
  label: string
  value: string
  state: NhiLipidAnswer
  origin: 'record' | 'physician' | 'ai' | 'derived'
  editable: boolean
}

// Additive pack contract: older published packages do not carry this optional
// field. The local branch overlay can supply it; clinical text stays in the pack.
interface CoverageSummary {
  title: string
  conclusion: string
  basis?: string
  source: string
  sourceUrl: string
  rows: readonly { label: string; value: string }[]
  tiers: readonly { id: string; label: string; status: string; initiation: string; target: string; criteria: string; selected: boolean }[]
  factors: readonly CoverageCheck[]
  metabolicChecks?: readonly CoverageCheck[]
  diseaseChecks?: readonly CoverageCheck[]
  documentationNote?: string
  caveats: readonly string[]
}

function CheckRow({ row, patientId, en }: { row: CoverageCheck; patientId?: string; en: boolean }) {
  const answer = useNhiLipidReviewStore(state => state.answer)
  const provenance = useNhiLipidReviewStore(state => (
    state.patientId === patientId ? state.provenance[row.id] : undefined
  ))
  const carried = useCarriedLookup()(`lipid:${row.id}`)
  const options: readonly [NhiLipidAnswer, string][] = [
    ['yes', en ? '✓ Met' : '✓ 符合'], ['no', en ? '× Not met' : '× 不符合'], ['unknown', en ? '? Unconfirmed' : '? 未確認'],
  ]
  return <div className="space-y-1.5 border-b border-border py-3 last:border-0">
    <p className="font-medium">{row.label}</p>
    <p className="text-xs leading-relaxed text-muted-foreground">{row.value}</p>
    {row.editable ? <div className="flex flex-wrap items-center gap-1" role="group" aria-label={row.label}>
      {options.map(([state, label]) => <button key={state} type="button" disabled={!patientId} aria-pressed={row.state === state}
        className={`min-h-11 rounded-md border px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${row.state === state ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted/40'}`}
        onClick={() => patientId && answer(patientId, row.id, state)}>{label}</button>)}
    </div> : <p className="text-xs font-medium">{options.find(([state]) => state === row.state)?.[1]} · {en ? 'Computed from components' : '由細項計算'}</p>}
    {carried ? <p className="w-fit rounded border border-primary/25 bg-primary/5 px-1.5 text-[11px] tabular-nums text-primary" data-carried-from={carried}>{carriedLabel(carried, en)}</p> : null}
    <p className="text-xs text-muted-foreground">{provenance?.source === 'ai' || row.origin === 'ai'
      ? en ? 'AI assessment included automatically · available for clinician correction' : 'AI 判讀自動帶入 · 可由醫師修正'
      : provenance?.source === 'manual' || row.origin === 'physician'
        ? en ? 'Changed by clinician · record supporting evidence in the chart' : '醫師修正 · 請於病歷記錄確認依據'
        : row.origin === 'record' ? en ? 'Preselected from record; available for correction' : '依資料預選，可由醫師修正' : ''}
      {provenance ? <button type="button" className="ml-2 min-h-11 text-primary underline underline-offset-2" onClick={() => patientId && answer(patientId, row.id, undefined)}>{en ? 'Restore record assessment' : '恢復資料判讀'}</button> : null}
    </p>
  </div>
}

export function NhiLipidCoverageSummary({ recommendation, locale, patientId, presentation = 'all' }: {
  recommendation: CdssRecommendation
  locale: string
  patientId?: string
  presentation?: 'all' | 'diagnosis' | 'follow-up' | 'prognosis' | 'treatment'
}) {
  const { copied, copy } = useCopyToClipboard()
  const [copyError, setCopyError] = useState(false)
  const data = (recommendation as CdssRecommendation & { coverageSummary?: CoverageSummary }).coverageSummary
  if (!data) return null
  const en = locale === 'en'
  if (presentation === 'follow-up') return <section className="space-y-3 px-3 py-4 text-sm" data-testid="lipid-follow-up" aria-label={en ? 'Lipid treatment goal follow-up' : '血脂治療標的追蹤'}>
    <h4 className="font-semibold">{en ? 'Lipid treatment goal follow-up' : '血脂治療標的追蹤'}</h4>
    <p className="text-xs text-muted-foreground">{en ? 'Compare the latest measurement with the goal for the minimum supported tier. Check the sampling date and treatment; switch to Diagnosis to review the classification.' : '依目前最低已知分層，比較最新檢驗與治療標的。請核對採檢日期與當時用藥；需確認分層時可切回「診斷」。'}</p>
    <dl className="divide-y divide-border">
      {/* The pack owns the goal, freshness guard and assessment. Do not infer
          attainment from numbers or translated prose in the renderer. */}
      {[3, 2, 5, 0, 7].map(index => data.rows[index]).filter(Boolean).map(row => <div key={row.label} className="space-y-1 py-3">
        <dt className="text-muted-foreground">{row.label}</dt>
        <dd className="break-words font-semibold tabular-nums">{row.value}</dd>
      </div>)}
    </dl>
    {!data.rows.length ? <p data-cdss-action="">{en ? 'Measurement and treatment goal are pending; attainment cannot be assessed.' : '檢驗與治療標的資料待補，目前無法判定是否達標。'}</p> : null}
    <details className="border-t border-border">
      <summary className="min-h-11 cursor-pointer py-3 font-medium">{en ? 'Assessment basis and references' : '判讀依據與參考資料'}</summary>
      <p>{data.conclusion}</p>
      {data.basis ? <p className="mt-2">{data.basis}</p> : null}
      <ul className="my-3 list-disc space-y-1 pl-5">{data.caveats.map(item => <li key={item}>{item}</li>)}</ul>
      <a className="inline-block min-h-11 py-3 text-primary underline" href={data.sourceUrl} target="_blank" rel="noreferrer">{data.source}</a>
    </details>
  </section>
  if (presentation === 'diagnosis') return <section className="space-y-3 px-3 py-4 text-sm" data-testid="lipid-diagnosis-confirmation" aria-label={en ? 'Diagnoses and criteria for risk classification' : '危險分層相關診斷與條件確認'}>
    <h4 className="font-semibold">{en ? 'Diagnoses and criteria for risk classification' : '危險分層相關診斷與條件確認'}</h4>
    <p className="text-xs text-muted-foreground">{en ? 'Review the NHI classification criteria below. Unconfirmed does not mean absent; verification recalculates the classification.' : '核對下列健保危險分層條件；未確認不代表沒有，修改後會重新計算分層。'}</p>
    {[[en ? 'Diseases and higher-risk criteria' : '相關疾病與高風險條件', data.diseaseChecks ?? []], [en ? 'Cardiovascular risk factors' : '心血管危險因子', data.factors], [en ? 'Metabolic syndrome components' : '代謝症候群細項', data.metabolicChecks ?? []]].map(([title, checks]) => <div key={title as string}>
      <h5 className="border-b border-border py-2 font-medium">{title as string}</h5>
      {(checks as readonly CoverageCheck[]).map(row => <details key={row.id} className="border-b border-border">
        <summary className="min-h-11 cursor-pointer py-3"><span>{row.label}</span><span data-cdss-action={row.state === 'unknown' ? '' : undefined} className="ml-2 font-medium">{row.state === 'yes' ? (en ? '✓ Met' : '✓ 符合') : row.state === 'no' ? (en ? '× Not met' : '× 不符合') : (en ? '? Unconfirmed' : '? 待確認')}</span></summary>
        <CheckRow row={row} patientId={patientId} en={en} />
      </details>)}
    </div>)}
    <a className="inline-block min-h-11 py-3 text-xs text-primary underline" href={data.sourceUrl} target="_blank" rel="noreferrer">{data.source}</a>
  </section>
  if (presentation === 'prognosis') return <section className="space-y-3 px-3 py-4 text-sm" data-testid="lipid-risk-basis" aria-label={en ? 'Risk classification and basis' : '危險分層與依據'}>
    <h4 className="font-semibold">{en ? 'Risk classification and basis' : '危險分層與依據'}</h4>
    <p className="font-medium">{data.conclusion}</p>
    {data.basis ? <p>{data.basis}</p> : null}
    {data.tiers.filter(tier => tier.selected).map(tier => <p key={tier.id}><strong>{tier.label}</strong> · {tier.criteria}</p>)}
    <p className="text-xs text-muted-foreground">{en ? 'This classification follows NHI criteria. PREVENT is a separate risk estimate; the two are presented independently.' : '此分層依健保條件判讀；PREVENT 為另一項風險估計，兩者分別呈現。'}</p>
    <details><summary className="min-h-11 cursor-pointer py-3 font-medium">{en ? 'Classification definitions and caveats' : '危險分層定義與待核對依據'}</summary>
      <dl className="space-y-2">{data.tiers.map(tier => <div key={tier.id}><dt className="font-medium">{tier.label}</dt><dd>{tier.criteria}</dd></div>)}</dl>
      <ul className="mt-3 list-disc space-y-1 pl-4">{data.caveats.map(caveat => <li key={caveat}>{caveat}</li>)}</ul>
    </details>
    <a className="inline-block min-h-11 py-3 text-xs text-primary underline" href={data.sourceUrl} target="_blank" rel="noreferrer">{data.source}</a>
  </section>
  return (
    <section className="space-y-3 px-3 pb-4 text-sm" aria-label={data.title} data-testid="nhi-lipid-coverage-summary">
      <p className="font-medium leading-relaxed">{data.conclusion}</p>
      <a className="inline-block text-xs text-primary underline underline-offset-2" href={data.sourceUrl} target="_blank" rel="noreferrer">{data.source}</a>
      {data.basis ? <p className="text-xs leading-relaxed text-muted-foreground"><span className="font-medium text-foreground">{en ? 'Basis: ' : '判定依據：'}</span>{data.basis}</p> : null}
      <dl className="divide-y divide-border">
        {data.rows.slice(0, 4).map(row => (
          <div key={row.label} className="grid grid-cols-[minmax(7rem,0.8fr)_minmax(0,1.5fr)] gap-3 py-2">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="break-words font-medium tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>
      <div className="overflow-x-auto rounded-md border border-border" tabIndex={0} role="region" aria-label={en ? 'Six NHI tiers' : '健保六級對照'}>
        <table className="w-full min-w-[340px] text-left text-xs leading-relaxed">
          <caption className="px-2 py-2 text-left text-muted-foreground">{en ? 'LDL-C initiation / goals (LDL-C / non-HDL-C), mg/dL' : '起始值：LDL-C；標的：LDL-C／non-HDL-C（mg/dL）'}</caption>
          <thead className="border-y border-border bg-muted/40"><tr>
            {[en ? 'Tier / status' : '分級／本次狀態', en ? 'Initiation' : '起始值', en ? 'Goals' : '治療標的'].map(label => <th key={label} className="px-2 py-2 font-medium">{label}</th>)}
          </tr></thead>
          <tbody>{data.tiers.map(tier => <tr key={tier.id} className={tier.selected ? 'border-b border-border bg-primary/5' : 'border-b border-border last:border-0'}>
            <th scope="row" className="px-2 py-2 font-normal"><span className={tier.selected ? 'font-semibold text-primary' : 'font-medium'}>{tier.label}</span><span className="block text-muted-foreground">{tier.status}</span></th>
            <td className="px-2 py-2 tabular-nums">{tier.initiation}</td><td className="px-2 py-2 tabular-nums">{tier.target}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <dl className="space-y-2">{data.rows.slice(4).map(row => <div key={row.label}><dt className="font-medium">{row.label}</dt><dd className="mt-0.5 leading-relaxed text-muted-foreground">{row.value}</dd></div>)}</dl>
      {presentation !== 'treatment' ? <details className="border-t border-border pt-1">
        <summary className="min-h-11 cursor-pointer py-3 font-medium text-primary">{en ? 'Review six cardiovascular risk factors' : '檢核六項心血管風險因子'}</summary>
        <p className="text-xs leading-relaxed text-muted-foreground">{en ? 'Met / Not met / Unconfirmed. Changes recalculate the tier and are kept only for this patient visit.' : '符合／不符合／未確認。修改後重新計算分級；人工核對僅保留於本次病人工作階段。'}</p>
        {data.factors.map(row => <CheckRow key={row.id ?? row.label} row={row} patientId={patientId} en={en} />)}
        <details className="border-t border-border"><summary className="min-h-11 cursor-pointer py-3 font-medium">{en ? 'Review the five metabolic components' : '檢核代謝症候群五項細節'}</summary>
          {data.metabolicChecks?.map(row => <CheckRow key={row.id} row={row} patientId={patientId} en={en} />)}
        </details>
      </details> : null}
      {presentation !== 'treatment' ? <details className="border-t border-border pt-1"><summary className="min-h-11 cursor-pointer py-3 font-medium text-primary">{en ? 'Review disease and higher-tier criteria' : '檢核疾病與可能升級條件'}</summary>
        {data.diseaseChecks?.map(row => <CheckRow key={row.id} row={row} patientId={patientId} en={en} />)}
        <details><summary className="min-h-11 cursor-pointer py-3 font-medium">{en ? 'Six-tier definitions' : '六級定義對照'}</summary><dl className="space-y-2 pb-3">{data.tiers.map(tier => <div key={tier.id}><dt className="font-medium">{tier.label}</dt><dd className="text-muted-foreground">{tier.criteria}</dd></div>)}</dl></details>
      </details> : null}
      {data.documentationNote ? <details className="border-t border-border pt-1"><summary className="min-h-11 cursor-pointer py-3 font-medium">{en ? 'Chart documentation draft' : '病歷註記提醒與草稿'}</summary>
        <p className="mb-2 text-xs text-muted-foreground">{en ? 'Record the confirmation date and supporting evidence. Copying does not save to the medical record.' : '請於病歷記載確認日期、判斷結果與佐證來源。複製不會自動寫入病歷。'}</p>
        <textarea readOnly aria-label={en ? 'Chart note draft' : '病歷註記草稿'} value={data.documentationNote} rows={7} className="w-full rounded-md border border-border bg-background p-2 text-xs leading-relaxed" />
        <Button type="button" variant="outline" className="mt-2 min-h-11" onClick={async () => { setCopyError(!(await copy(data.documentationNote!))) }}>{copied ? en ? 'Copied' : '已複製' : en ? 'Copy chart note draft' : '複製病歷註記草稿'}</Button>
        {copyError ? <p role="alert" className="mt-1 text-xs">{en ? 'Copy failed; select the draft and copy manually.' : '複製失敗，請選取草稿文字手動複製。'}</p> : null}
      </details> : null}
      <div className="border-t border-border pt-3"><p className="mb-1 font-medium">{en ? 'Pending verification' : '待核對與可能升級條件'}</p><ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-muted-foreground">{data.caveats.map(item => <li key={item}>{item}</li>)}</ul></div>
    </section>
  )
}
