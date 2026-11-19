'use client'
import { createContext, useContext, useId } from 'react'
import type { PreventReading } from '../utils/prevent-reading'
import type { RiskCalculatorId, RiskField } from '../utils/risk-inputs'
import { usePreventStore } from '../stores/prevent-inputs.store'
import { carriedLabel, useCarriedLookup } from './visit/carried-answer-context'
import type { CdssRecommendation } from '../types'
export const PreventReadingContext = createContext<PreventReading | undefined>(undefined)
interface Summary { title: string; band?: string; recommendation: string; target: string; caveat: string; personalize: string; sourceUrl: string }

const ORIGIN_WORDS = {
  physician: { zh: '醫師輸入，請病歷註記', en: 'Physician entry; document in chart' },
  icd: { zh: '依診斷碼帶入（鎖定）', en: 'From a diagnosis code (locked)' },
  rule: { zh: '規則推論，請確認', en: 'Inferred by a rule; confirm' },
  visit: { zh: '今日問診帶入', en: 'From today\'s answer' },
  clinic: { zh: '門診今日量測', en: 'Measured in clinic today' },
  record: { zh: '依病歷帶入，請核對日期與現況', en: 'From record; verify date and current status' },
  none: { zh: '未確認', en: 'Unconfirmed' },
} as const
const CALCULATOR_WORDS: Readonly<Record<RiskCalculatorId, { zh: string; en: string }>> = {
  prevent: { zh: 'PREVENT', en: 'PREVENT' },
  pce: { zh: 'PCE', en: 'PCE' },
  hpa: { zh: '國健署', en: 'HPA' },
}

/**
 * The shared risk inputs with where each came from, editable where the
 * clinician may answer (the store `usePreventStore`, one per patient). A value
 * a rule or today's answer prefilled carries a 確認 button, which records it as
 * the clinician's own (owner 2026-11-03: 「AI 或是 RULE 判斷的結果再讓使用者確認」);
 * a positive diagnosis code is locked. Shared by the lipid card's 檢核／補齊,
 * the HTN page's PREVENT and PCE panels and its 共用輸入 panel.
 */
export function RiskFieldsEditor({ fields, locale, patientId, showUsedBy = false, storeKey = (key: string) => key }: {
  fields: readonly RiskField[]
  locale: string
  patientId?: string
  /** Names the calculators each field feeds (the 共用輸入 panel). */
  showUsedBy?: boolean
  /** The store key a field writes to, where it is not the field's own key. */
  storeKey?: (key: string) => string
}) {
  const setInput = usePreventStore(s => s.setInput)
  const carriedFrom = useCarriedLookup()
  const id = useId()
  const en = locale === 'en'
  return (
      <div className="grid gap-3 @min-[40rem]:grid-cols-2">
        {fields.map(f => {
          const key = f.input.key
          // A reading built before origins were read carries the three-way source only.
          const origin: RiskField['origin'] = f.origin ?? (f.source === 'physician' ? 'physician' : f.source === 'record' ? 'record' : 'none')
          const carried = f.source === 'physician' ? carriedFrom(`prevent:${key}`) : undefined
          const originLine = carried ? `${carriedLabel(carried, en)}${en ? '; confirm it still applies' : '，請確認仍適用'}`
            : f.detail ? (en ? f.detail.en : f.detail.zh)
            : ORIGIN_WORDS[origin][en ? 'en' : 'zh']
          return <div key={key} className="min-w-0 space-y-1" data-testid={`cdss-risk-field-${key}`} data-origin={origin}>
          {f.input.type === 'select' ? <fieldset className="min-w-0 space-y-1.5" disabled={!patientId || f.locked}>
            <legend className="text-sm font-medium">{f.input.label[en ? 'en' : 'zh']}{showUsedBy ? <UsedBy usedBy={f.usedBy} en={en} /> : null}</legend>
            <div className="flex flex-wrap items-center gap-1">
              {[...f.input.options].sort((a, b) => {
                const order = ['yes', 'no', 'female', 'male', 'other', 'white', 'aa', '']
                return order.indexOf(a.value) - order.indexOf(b.value)
              }).map(o => <button key={o.value} type="button" aria-pressed={f.value === o.value}
                className={`min-h-11 rounded-md border px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${f.value === o.value ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted/40'}`}
                onClick={() => patientId && setInput(patientId, storeKey(key), o.value)}>
                {o.value === 'yes' ? '✓ ' : o.value === 'no' ? '× ' : o.value === '' ? '? ' : f.value === o.value ? '✓ ' : '○ '}{o.label[en ? 'en' : 'zh']}
              </button>)}
            </div>
          </fieldset> : f.input.type === 'number' ? <>
            <label className="block text-sm" htmlFor={`${id}-${key}`}>{f.input.label[en ? 'en' : 'zh']}{f.input.unit ? ` · ${f.input.unit}` : ''}{showUsedBy ? <UsedBy usedBy={f.usedBy} en={en} /> : null}</label>
            <input id={`${id}-${key}`} type="number" step="any" disabled={!patientId} value={f.value} className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring" onChange={e => patientId && setInput(patientId, storeKey(key), e.target.value)} />
          </> : null}
          <p className="text-xs text-muted-foreground">{originLine}{f.date ? ` · ${f.date.slice(0,10)}` : ''}{f.ageDays !== undefined && f.ageDays > 365 ? en ? ` · ${f.ageDays} days old; repeat/reconfirm` : ` · 已 ${f.ageDays} 天，請複驗／重新確認` : ''}{f.unitError ? en ? ' · Unit requires verification' : ' · 單位需核對' : ''}</p>
          <div className="flex flex-wrap gap-3">
            {f.source === 'physician' && <button type="button" className="min-h-11 text-xs text-primary underline" onClick={() => patientId && setInput(patientId, storeKey(key), undefined)}>{en ? 'Restore record value' : '恢復病歷數值'}</button>}
            {!f.locked && f.value && (origin === 'rule' || origin === 'visit' || origin === 'record' || origin === 'clinic') && (
              <button type="button" className="min-h-11 text-xs text-primary underline" data-testid={`cdss-risk-confirm-${key}`} disabled={!patientId} onClick={() => patientId && setInput(patientId, storeKey(key), f.value)}>
                {en ? 'Confirm as entered' : '確認此值'}
              </button>
            )}
          </div>
        </div>
        })}
      </div>
  )
}

function UsedBy({ usedBy, en }: { usedBy: readonly RiskCalculatorId[]; en: boolean }) {
  return (
    <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
      {usedBy.map((calculator) => (
        <span key={calculator} className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{CALCULATOR_WORDS[calculator][en ? 'en' : 'zh']}</span>
      ))}
    </span>
  )
}

/** PREVENT's own inputs from its reading, the editor the lipid card and the HTN PREVENT panel share. */
export function PreventFieldsEditor({ reading, locale, patientId }: { reading: PreventReading; locale: string; patientId?: string }) {
  return <RiskFieldsEditor fields={reading.fields} locale={locale} {...(patientId ? { patientId } : {})} />
}
export function PreventRiskSummary({ recommendation, locale, patientId }: { recommendation: CdssRecommendation; locale: string; patientId?: string }) {
  const reading = useContext(PreventReadingContext)
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
      <PreventFieldsEditor reading={reading} locale={locale} {...(patientId ? { patientId } : {})} />
    </details>
    <p className="text-xs leading-relaxed text-muted-foreground">{summary.personalize}</p>
    <p className="text-xs leading-relaxed text-muted-foreground">{summary.caveat}</p>
    <a className="inline-block min-h-11 py-3 text-xs text-primary underline" href={summary.sourceUrl} target="_blank" rel="noreferrer">ACC/AHA 2026 §4.2.3.7</a>
  </section>
}
