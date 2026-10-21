import { ExternalLink } from 'lucide-react'
import type { CalcValues, L } from '../types'
import {
  DOAC_FIELD_LABELS,
  DOAC_RULES_VERSION,
  LABEL_SOURCES,
  TAIWAN_LABEL_CHECKS,
  calculateDoacDoses,
  checkRegimen,
  crclLabel,
  regimenDay,
  type DoacAgentResult,
  type DoacIndication,
  type DoacRuleHit,
  type LabelCite,
} from '../doac-dose-model'

const FIELD: Record<string, L> = DOAC_FIELD_LABELS
const FIELD_KEY: Record<string, string> = { CrCl: 'scr' }

const VERDICT: Record<DoacAgentResult['verdict'], { zh: string; en: string; style: string }> = {
  dose: { zh: '仿單劑量', en: 'Label dose', style: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300' },
  avoid: { zh: '應避免', en: 'Avoid', style: 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300' },
  review: { zh: '需個別判斷', en: 'Individual review', style: 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300' },
  'not-recommended': { zh: '不建議', en: 'Not recommended', style: 'bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-300' },
  contraindicated: { zh: '禁忌', en: 'Contraindicated', style: 'bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-300' },
  missing: { zh: '待補資料', en: 'Needs inputs', style: 'bg-muted text-muted-foreground' },
  prerequisite: { zh: '先完成注射抗凝', en: 'After parenteral lead-in', style: 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300' },
  'not-indicated': { zh: '未核准此適應症', en: 'Not indicated', style: 'bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-300' },
}

const INDICATION: Record<DoacIndication, L> = {
  nvaf: { zh: 'NVAF', en: 'NVAF' },
  'vte-acute': { zh: '急性 DVT／PE 治療', en: 'Acute DVT/PE treatment' },
  'vte-extended': { zh: 'VTE 延長治療', en: 'Extended VTE prevention' },
  'vtep-hip': { zh: '髖關節置換術後預防', en: 'Hip replacement prophylaxis' },
  'vtep-knee': { zh: '膝關節置換術後預防', en: 'Knee replacement prophylaxis' },
}

const CHECK_STYLE = {
  matches: 'border-emerald-300 bg-emerald-50/70 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200',
  differs: 'border-amber-300 bg-amber-50/70 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200',
  'label-against': 'border-red-300 bg-red-50/70 text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200',
  unsettled: 'border-border bg-muted/40 text-foreground',
} as const

export function citeLabel(cite: LabelCite): string {
  return `${cite.document ? `${cite.document} ` : ''}SmPC §${cite.section} · p.${cite.page}`
}

export function Cite({ cite }: { cite: LabelCite }) {
  return (
    <details className="mt-0.5">
      <summary className="cursor-pointer text-[11px] text-muted-foreground underline-offset-2 hover:underline">{citeLabel(cite)}</summary>
      <blockquote className="mt-1 border-l-2 border-border pl-2 text-[11px] italic leading-snug text-muted-foreground">“{cite.quote}”</blockquote>
    </details>
  )
}

function doseText(result: DoacAgentResult, zh: boolean): string {
  if (!result.doses.length) return '—'
  const freq = (perDay: number) => (perDay === 2 ? 'bid' : 'qd')
  return result.doses.map((dose) => `${dose.mg} mg ${freq(dose.perDay)}`).join(zh ? ' 或 ' : ' or ')
}

function Hit({ hit, zh }: { hit: DoacRuleHit; zh: boolean }) {
  return (
    <li className="text-xs leading-snug">
      <span>{zh ? hit.text.zh : hit.text.en}</span>
      <Cite cite={hit.cite} />
    </li>
  )
}

/** The four agents side by side, each by its own label; a check beside the AF dose point, never a change to it. */
export function DoacDoseResults({ values, locale, onReviewField }: {
  values: CalcValues
  locale: string
  onReviewField?: (key: string) => void
}) {
  const zh = locale === 'zh-TW'
  const { crcl, indication, results } = calculateDoacDoses(values)
  const check = checkRegimen(values.regimen, results, regimenDay(values))
  return (
    <section aria-label={zh ? 'DOAC 劑量（依仿單）' : 'DOAC dose by label'} className="overflow-hidden rounded-lg border border-border" data-testid="doac-dose-results">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 border-b bg-muted/40 px-3 py-2">
        <h3 className="text-sm font-semibold">
          {crcl
            ? `CrCl ${crclLabel(crcl.value)} mL/min${crcl.source === 'manual' ? (zh ? '（手動）' : ' (manual)') : ' · Cockcroft–Gault'}`
            : (zh ? 'CrCl 未算' : 'CrCl not computed')}
        </h3>
        <span className="text-xs text-muted-foreground" data-testid="doac-indication">{zh ? `${INDICATION[indication].zh} · 依 EU SmPC · ${DOAC_RULES_VERSION}` : `${INDICATION[indication].en} · EU SmPC · ${DOAC_RULES_VERSION}`}</span>
      </div>
      {check && (
        <div className={`border-b px-3 py-2 text-sm ${CHECK_STYLE[check.state]}`} data-testid="doac-regimen-check" data-state={check.state}>
          {zh ? check.text.zh : check.text.en}
          {check.state === 'differs' && check.cite ? <Cite cite={check.cite} /> : null}
        </div>
      )}
      <div className="divide-y divide-border">
        {results.map((result) => (
          <div key={result.agent} role="group" aria-label={result.agent} className="px-3 py-2" data-testid={`doac-agent-${result.agent}`} data-verdict={result.verdict}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <h4 className="text-sm font-medium">{result.agent}</h4>
              <div className="flex items-baseline gap-2">
                <span className="text-base font-semibold tabular-nums">{doseText(result, zh)}</span>
                <span className={`rounded px-1.5 text-xs ${VERDICT[result.verdict].style}`}>{zh ? VERDICT[result.verdict].zh : VERDICT[result.verdict].en}</span>
              </div>
            </div>
            {result.schedule.length > 0 && (
              <ol className="mt-1 space-y-1 rounded border border-border bg-muted/30 px-2 py-1" data-testid={`doac-schedule-${result.agent}`}>
                {result.schedule.map((step, index) => (
                  <li key={index} className="text-xs leading-snug">
                    <span className="font-medium">{zh ? step.text.zh : step.text.en}</span>
                    <Cite cite={step.cite} />
                  </li>
                ))}
              </ol>
            )}
            {result.options.length > 0 && (
              <ul className="mt-1 space-y-1" data-testid={`doac-options-${result.agent}`}>
                {result.options.map((option, index) => (
                  <li key={index} className="text-xs leading-snug">
                    <span>{zh ? `可考慮 ${option.regimen.mg} mg ${option.regimen.perDay === 2 ? 'bid' : 'qd'}（需確認：${option.condition.zh}）` : `For consideration: ${option.regimen.mg} mg ${option.regimen.perDay === 2 ? 'bid' : 'qd'} (confirm: ${option.condition.en})`}</span>
                    <Cite cite={option.cite} />
                  </li>
                ))}
              </ul>
            )}
            {result.duration && (
              <div className="mt-1 text-xs leading-snug">
                {zh ? `療程：${result.duration.text.zh}` : `Duration: ${result.duration.text.en}`}
                <Cite cite={result.duration.cite} />
              </div>
            )}
            {result.hits.length > 0 && <ul className="mt-1 space-y-1">{result.hits.map((hit, index) => <Hit key={index} hit={hit} zh={zh} />)}</ul>}
            {result.missing.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1 text-xs text-muted-foreground">
                <span>{zh ? '待填：' : 'To fill:'}</span>
                {result.missing.map((key) => (
                  <button
                    key={key}
                    type="button"
                    disabled={!onReviewField}
                    onClick={() => onReviewField?.(FIELD_KEY[key] ?? key)}
                    className="rounded border border-border px-1.5 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {FIELD[key] ? (zh ? FIELD[key].zh : FIELD[key].en) : key}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="space-y-1 border-t border-amber-300 bg-amber-50/60 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200" data-testid="doac-taiwan-checks">
        <p className="font-medium">{zh ? '臺灣仿單：尚待藥學部逐條核對' : 'Taiwan labels: pending pharmacy review'}</p>
        <ul className="list-disc space-y-0.5 pl-4">{TAIWAN_LABEL_CHECKS.map((item, index) => <li key={index}>{zh ? item.zh : item.en}</li>)}</ul>
      </div>
      <p className="border-t px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        {zh
          ? '僅限成人。不評估機械瓣、中重度二尖瓣狹窄、抗磷脂症候群、活動性出血、癌症相關 VTE 的藥物選擇；手術前後停藥請用「DOAC 手術前後停藥計算機」。不改變 CDSS 指引建議。'
          : 'Adults only. Does not assess mechanical valves, moderate-to-severe mitral stenosis, antiphospholipid syndrome, active bleeding or the choice of agent in cancer-associated VTE; for peri-procedural interruption use the DOAC peri-procedural calculator. Does not change the CDSS recommendation.'}
      </p>
      <ul className="border-t px-3 py-2 text-xs">
        {Object.values(LABEL_SOURCES).map((source) => (
          <li key={source.agent}>
            <a className="inline-flex min-h-8 items-center gap-1 text-primary underline underline-offset-4" href={source.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
              {source.title}
            </a>
            <span className="ml-1 text-muted-foreground">（{source.dates}；PDF {source.fileDate}）</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
