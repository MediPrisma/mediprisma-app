'use client'
/**
 * The hypertension page's two risk calculators as the 計算機 panel shows them
 * (plan 05 §19, owner 2026-11-03). Neither is the generic calculator form: the
 * host already computes both from the record and the PREVENT answers
 * (`applyHtnRiskReadings`), so the panel shows that reading and lets the
 * clinician complete the PREVENT answers the pack's facts are built from.
 * What is typed here is the same store the lipid card's PREVENT 檢核 writes.
 */
import { createContext, useContext } from 'react'
import { HpaRiskResults } from '@/features/medical-calculator/components/HpaRiskResults'
import { PreventFieldsEditor, PreventReadingContext } from '../PreventRiskSummary'
import { usePreventStore } from '../../stores/prevent-inputs.store'
import type { HpaReading } from '../../utils/htn-risk-readings'

export const HpaReadingContext = createContext<HpaReading | undefined>(undefined)

/** PREVENT at DP-08: the ASCVD result the pack shows, and the inputs behind it. */
export function PreventVisitPanel({ isEnglish }: { isEnglish: boolean }) {
  const reading = useContext(PreventReadingContext)
  const patientId = usePreventStore((state) => state.patientId)
  const locale = isEnglish ? 'en' : 'zh-TW'
  if (!reading) return <p className="text-sm text-muted-foreground">{isEnglish ? 'No record to read PREVENT from.' : '沒有可供 PREVENT 讀取的病歷。'}</p>
  const result = reading.result
  return (
    <section className="space-y-3" data-testid="cdss-htn-prevent-panel">
      <p className="text-sm font-medium" role="status">
        {result.status === 'ready'
          ? `${isEnglish ? '10-year ASCVD' : '10 年 ASCVD'} ${result.risk10!.toFixed(1)}%${result.risk30 !== undefined ? ` · ${isEnglish ? '30-year' : '30 年'} ${result.risk30.toFixed(1)}%` : ''}`
          : result.status === 'ineligible'
            ? (isEnglish ? 'Outside eligibility: the model is for primary prevention.' : '不適用：此模型只用於初級預防。')
            : (isEnglish ? 'Inputs still to confirm; no result is handed to the pack until they are.' : '輸入尚待核對；核對完成前不會把結果交給規則。')}
      </p>
      {result.issues.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          {isEnglish ? 'Check: ' : '需確認：'}
          {result.issues.map((key) => reading.fields.find((field) => field.input.key === key)?.input.label[isEnglish ? 'en' : 'zh'] ?? key).join(isEnglish ? ', ' : '、')}
        </p>
      ) : null}
      <p className="text-xs leading-relaxed text-muted-foreground">
        {isEnglish
          ? 'The base model ends at ASCVD (Khan 2024 Table S12). The AHA 2025 threshold of 7.5% reads total CVD, which this host does not compute yet, so the pack shows this value and reads no threshold from it. The history answers below also feed the HPA MACE estimate.'
          : '基礎模型的終點是 ASCVD（Khan 2024 Table S12）；AHA 2025 的 7.5% 門檻讀的是 total CVD，本系統尚未接入，所以規則只顯示此值、不以它判定門檻。下方的病史回答同時供國健署 MACE 估計使用。'}
      </p>
      <PreventFieldsEditor reading={reading} locale={locale} {...(patientId ? { patientId } : {})} />
    </section>
  )
}

const SOURCE_WORDS = {
  physician: { zh: '醫師填', en: 'physician' },
  record: { zh: '病歷', en: 'record' },
  none: { zh: '未填', en: 'empty' },
} as const

/** The HPA (國健署) reconstruction at DP-08: the five outcomes as the host's inputs stand. */
export function HpaVisitPanel({ isEnglish }: { isEnglish: boolean }) {
  const reading = useContext(HpaReadingContext)
  if (!reading) return <p className="text-sm text-muted-foreground">{isEnglish ? 'No record to read the HPA model from.' : '沒有可供國健署模型讀取的病歷。'}</p>
  const mace = reading.mace
  return (
    <section className="space-y-3" data-testid="cdss-htn-hpa-panel">
      <p className="text-sm font-medium" role="status">
        {mace?.status === 'estimated' && mace.risk !== undefined
          ? `${isEnglish ? '10-year MACE' : '10 年 MACE'} ${mace.risk}%${mace.level ? (isEnglish ? ` (${mace.level})` : `（${{ low: '低', moderate: '中', high: '高' }[mace.level]}）`) : ''}`
          : (isEnglish ? 'MACE not estimated for these inputs; the rows below say why.' : 'MACE 目前無法估計；下方列出原因。')}
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {isEnglish
          ? 'A local reconstruction of the HPA five-outcome model, not the official coefficients; 35–70 years, no prior coronary disease or stroke. The pack shows the MACE estimate as a Taiwanese reference and reads no threshold from it. History fields come from the PREVENT answers (open PREVENT to change them); measurements come from the record.'
          : '國健署五項慢性病風險的本地重建版，非官方係數；適用 35–70 歲、無既往冠心病或中風。規則只把 MACE 當台灣族群參考顯示，不以它判定門檻。病史欄位來自 PREVENT 的回答（要改請開 PREVENT），量測值來自病歷。'}
      </p>
      <HpaRiskResults values={reading.values} locale={isEnglish ? 'en' : 'zh-TW'} />
      <details>
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-primary">{isEnglish ? 'Inputs read' : '讀到的輸入'}</summary>
        <ul className="grid gap-1 text-xs text-muted-foreground @min-[40rem]:grid-cols-2">
          {reading.fields.map((field) => (
            <li key={field.key}>
              {field.label[isEnglish ? 'en' : 'zh']}：{field.value || '—'}{field.unit && field.value ? ` ${field.unit}` : ''}
              {' · '}{SOURCE_WORDS[field.source][isEnglish ? 'en' : 'zh']}{field.date ? ` · ${field.date.slice(0, 10)}` : ''}
            </li>
          ))}
        </ul>
      </details>
    </section>
  )
}
