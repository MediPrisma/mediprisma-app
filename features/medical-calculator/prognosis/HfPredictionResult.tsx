import { ChevronRight } from 'lucide-react'
import { HF_DRY_RUN_CLAIMS, type HfDryRunClaim } from '@/src/core/hf-risk/contract'
import type { HfPredictionScore } from '@/src/core/hf-risk/prediction-result'
import type { HfClaimRun, HfClaimRuns } from '@/src/application/hooks/hf-risk/use-medcloud-hf-dry-run.hook'

export const hfHorizon = (claim: HfDryRunClaim, en: boolean) => claim === 'P1_CD_mortality_1m' ? (en ? '1 month' : '1 個月') : (en ? '3 months' : '3 個月')
export const hfPercentage = (value: number, locale: string) => value > 0 && value < 0.0001 ? '<0.01%' : new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value * 100) + '%'
const TIERS = ['low', 'intermediate', 'high'] as const
const tierLabel = (tier: HfPredictionScore['tier'], en: boolean) => ({ low: en ? 'Low' : '低', intermediate: en ? 'Intermediate' : '中', high: en ? 'High' : '高' })[tier]
const TIER_FILL = { low: 'bg-emerald-600 dark:bg-emerald-400', intermediate: 'bg-amber-500 dark:bg-amber-400', high: 'bg-destructive' }
const TIER_BADGE = {
  low: 'border-emerald-600/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200',
  intermediate: 'border-amber-600/40 bg-amber-500/10 text-amber-900 dark:text-amber-200',
  high: 'border-destructive/40 bg-destructive/10 text-destructive',
}

export const scoredRun = (run?: HfClaimRun) => run?.prediction?.verdict === 'scored' ? run.prediction : null

/** Server notes and input-check warnings, merged across horizons and grouped by what they mean for reading the score. */
export function groupHfNotes(runs: HfClaimRuns, en: boolean) {
  const seen = new Map<string, Set<HfDryRunClaim>>()
  const checkWarnings = new Set<string>()
  for (const claim of HF_DRY_RUN_CLAIMS) {
    const run = runs[claim]
    const warnings = run?.check?.issues.filter(issue => issue.severity === 'warning').map(issue => issue.text) ?? []
    warnings.forEach(warning => checkWarnings.add(warning))
    for (const note of [...(scoredRun(run)?.notes ?? []), ...warnings]) seen.set(note, (seen.get(note) ?? new Set()).add(claim))
  }
  // Notes that change how the score is read stay open; general notes start collapsed behind a count.
  const groups: { key: string; title: string; tone: 'warning' | 'neutral'; collapsed: boolean; notes: string[] }[] = [
    { key: 'under', title: en ? 'May underestimate risk' : '可能低估風險', tone: 'warning', collapsed: false, notes: [] },
    { key: 'range', title: en ? 'Outside the development data range' : '超出模型開發資料範圍', tone: 'neutral', collapsed: false, notes: [] },
    { key: 'check', title: en ? 'Input-check warnings' : '輸入檢查警告', tone: 'neutral', collapsed: false, notes: [] },
    { key: 'other', title: en ? 'Other notes' : '其他提示', tone: 'neutral', collapsed: true, notes: [] },
  ]
  const scoredClaims = HF_DRY_RUN_CLAIMS.filter(claim => runs[claim])
  for (const [note, claims] of seen) {
    const only = claims.size < scoredClaims.length ? ` (${[...claims].map(claim => hfHorizon(claim, en)).join('、')})` : ''
    const group = /低估|未測|underestimat/i.test(note) ? groups[0] : /超出開發資料範圍|outside.*range/i.test(note) ? groups[1] : checkWarnings.has(note) ? groups[2] : groups[3]
    group.notes.push(note + only)
  }
  return groups.filter(group => group.notes.length)
}

function ClaimColumn({ claim, run, busy, locale, describeError }: { claim: HfDryRunClaim; run?: HfClaimRun; busy: boolean; locale: string; describeError: (code: string) => string }) {
  const en = locale === 'en'
  const title = en ? `Within ${hfHorizon(claim, en)} of the visit` : `就診後 ${hfHorizon(claim, en)}內`
  const score = scoredRun(run)
  const refusal = run?.prediction?.verdict === 'refused' ? run.prediction.issues : run?.check?.verdict === 'refused' ? run.check.issues : null
  return <section aria-label={en ? `${hfHorizon(claim, en)} prediction` : `${hfHorizon(claim, en)}預測`} className="flex min-w-0 flex-[1_1_15rem] flex-col gap-3 rounded-md border border-border p-3" data-testid={`hf-result-${claim}`}>
    <h4 className="text-sm font-semibold">{title}</h4>
    {score ? <>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">{en ? 'Model probability' : '模型機率'}</span>
          <span className="text-3xl font-bold leading-tight tabular-nums">{hfPercentage(score.probability, locale)}</span>
        </div>
        <span className={`mb-1 rounded-md border px-2 py-0.5 text-sm font-semibold ${TIER_BADGE[score.tier]}`}>{en ? `${tierLabel(score.tier, en)} risk tier` : `${tierLabel(score.tier, en)}風險層`}</span>
      </div>
      <div aria-hidden="true" className="space-y-1">
        <div className="grid grid-cols-3 gap-0.5">{TIERS.map(tier => <span key={tier} className={`h-2 first:rounded-l last:rounded-r ${tier === score.tier ? TIER_FILL[tier] : 'bg-muted'}`} />)}</div>
        <div className="grid grid-cols-3 gap-0.5 text-xs text-muted-foreground">{TIERS.map(tier => <span key={tier} className={tier === score.tier ? 'font-semibold text-foreground' : ''}>{tierLabel(tier, en)}</span>)}</div>
      </div>
      {score.observedIncidence && <div className="space-y-0.5 border-t border-border pt-2 text-xs">
        <p><span className="font-semibold">{en ? 'Observed rate in this tier (group)' : '同層實際發生率（群體）'}</span>　<span className="tabular-nums">{hfPercentage(score.observedIncidence.rate, locale)}（95% CI {hfPercentage(score.observedIncidence.ciLow, locale)}–{hfPercentage(score.observedIncidence.ciHigh, locale)}）</span></p>
        {/* Cohort details are reference, not something to reread on every run. */}
        <details className="group/basis" data-testid={`hf-incidence-basis-${claim}`}>
          <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1 text-muted-foreground [&::-webkit-details-marker]:hidden"><ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 transition-transform group-open/basis:rotate-90" />{en ? 'Basis' : '依據'}</summary>
          <p className="break-words text-muted-foreground">{en ? 'Group rate, not an individual probability' : '群體發生率，非個人機率'} · n={score.observedIncidence.patients}</p>
          <p className="break-words text-muted-foreground">{en ? 'Cohort' : '依據族群'}：{score.observedIncidence.basis}</p>
        </details>
      </div>}
    </> : refusal ? <div className="space-y-1">
      <p className="text-sm font-semibold text-destructive">{en ? 'Insufficient or incompatible data; unable to assess' : '資料不足或不相容，無法評估'}</p>
      <p className="text-sm">{en ? 'This is not a low-risk result.' : '這不是低風險結果。'}</p>
      <ul className="space-y-1 break-words text-xs text-muted-foreground">{refusal.filter(issue => issue.severity !== 'information').map((issue, i) => <li key={i}>{['error', 'fatal'].includes(issue.severity) ? (en ? 'Error: ' : '錯誤：') : issue.severity === 'warning' ? (en ? 'Warning: ' : '警告：') : ''}{issue.text}</li>)}</ul>
    </div> : run?.error ? <p className="text-sm">{describeError(run.error)}</p>
      : busy ? <p className="text-sm text-muted-foreground">{en ? 'Checking inputs and predicting…' : '檢查資料與預測中…'}</p>
      : run?.check?.verdict === 'accepted' ? <p className="text-sm text-muted-foreground">{en ? 'Input check passed; not yet scored.' : '輸入檢查通過，尚未預測。'}</p>
      : null}
  </section>
}

/** Both outpatient horizons side by side; a failure in one never hides the other. */
export function HfResultsView({ runs, busy, locale, describeError }: { runs: HfClaimRuns; busy: boolean; locale: string; describeError: (code: string) => string }) {
  const en = locale === 'en'
  const checks = HF_DRY_RUN_CLAIMS.map(claim => runs[claim]?.check)
  const allChecked = checks.every(Boolean)
  const verdict = !allChecked ? null : checks.every(check => check!.verdict === 'accepted')
    ? (checks.some(check => check!.issues.some(issue => issue.severity === 'warning')) ? (en ? 'Input check passed with warnings; review the gaps below.' : '輸入檢查通過，但有資料警告；請核對下列缺漏。') : (en ? 'Input check passed; source applicability still requires validation.' : '輸入檢查通過；資料來源適用性仍待驗證。'))
    : checks.every(check => check!.verdict === 'refused') ? (en ? 'Input check refused; review missing or incompatible data.' : '輸入檢查未通過；請核對缺漏或不相容資料。') : null
  const groups = groupHfNotes(runs, en)
  const anyScored = HF_DRY_RUN_CLAIMS.some(claim => scoredRun(runs[claim]))
  return <div className="space-y-3">
    {verdict && <p className="text-xs text-muted-foreground">{verdict}</p>}
    <div className="flex flex-wrap gap-2">{HF_DRY_RUN_CLAIMS.map(claim => <ClaimColumn key={claim} claim={claim} run={runs[claim]} busy={busy} locale={locale} describeError={describeError} />)}</div>
    {anyScored && <p className="text-xs text-muted-foreground">{en ? 'Research pilot; no medical device license. NHI cloud applicability remains unvalidated. Deaths are ascertained from TVGH records; deaths outside TVGH may be missed. A physician must interpret the result; do not use it as the sole basis for treatment.' : '研究試辦版本，尚未取得醫療器材許可證；健保雲端來源適用性尚未驗證。死亡事件依北榮資料認定，院外或他院死亡可能未納入；須由醫師綜合判讀，不可單獨作為處置依據。'}</p>}
    {(anyScored || groups.length > 0) && <section aria-label={en ? 'Notes to read before interpreting' : '判讀前先看'} className="space-y-2 border-t border-border pt-3">
      <h4 className="text-sm font-semibold">{en ? 'Read before interpreting' : '判讀前先看'}</h4>
      {groups.length ? groups.map(group => {
        const list = <ul className={`space-y-1 break-words text-xs ${group.tone === 'warning' ? 'rounded-md bg-amber-500/10 px-2 py-1.5 text-amber-900 dark:text-amber-200' : 'text-muted-foreground'}`}>{group.notes.map(note => <li key={note}>{note}</li>)}</ul>
        return group.collapsed
          ? <details key={group.key} className="group space-y-1" data-testid={`hf-notes-${group.key}`}>
            <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1.5 text-xs font-semibold [&::-webkit-details-marker]:hidden"><ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90" />{group.title} · {group.notes.length}</summary>
            {list}
          </details>
          : <div key={group.key} className="space-y-1">
            <h5 className={`text-xs font-semibold ${group.tone === 'warning' ? 'text-amber-900 dark:text-amber-200' : ''}`}>{group.title} · {group.notes.length}</h5>
            {list}
          </div>
      }) : <p className="text-xs text-muted-foreground">{en ? 'No notes returned; this does not establish data completeness.' : '服務未回傳提示，不代表資料完整。'}</p>}
    </section>}
  </div>
}

/** Plain text for the note; carries the same caveats as the screen. */
export function hfResultText(runs: HfClaimRuns, { indexDate, hospital, attestation, locale }: { indexDate: string; hospital: string; attestation?: string; locale: string }) {
  const en = locale === 'en'
  const lines = [en ? `TVGH HF outpatient prognosis (research pilot) · index visit ${indexDate} ${hospital}` : `北榮 HF 門診預後模型（研究試辦）· 基準門診 ${indexDate} ${hospital}`]
  for (const claim of HF_DRY_RUN_CLAIMS) {
    const score = scoredRun(runs[claim])
    const outcome = en ? `Death within ${hfHorizon(claim, en)} of the visit` : `就診後 ${hfHorizon(claim, en)}內死亡`
    lines.push(`${outcome}：${score ? `${hfPercentage(score.probability, locale)}（${en ? `${tierLabel(score.tier, en)} risk tier` : `${tierLabel(score.tier, en)}風險層`}）` : (en ? 'not assessed' : '無法評估')}`)
  }
  if (attestation) lines.push(attestation)
  lines.push(en ? 'Deaths are ascertained from TVGH records; deaths outside TVGH may be missed; for physician interpretation only.' : '死亡事件依北榮資料認定，院外或他院死亡可能未納入；須由醫師綜合判讀。')
  return lines.join('\n')
}

export function HfProvenance({ runs, locale }: { runs: HfClaimRuns; locale: string }) {
  const en = locale === 'en'
  return <div className="space-y-3">{HF_DRY_RUN_CLAIMS.map(claim => {
    const run = runs[claim]
    if (!run) return null
    const score = scoredRun(run)
    return <div key={claim} className="space-y-1">
      <p className="font-medium text-foreground">{hfHorizon(claim, en)}</p>
      {run.check && <p>{en ? 'Input check' : '輸入檢查'}：{run.check.verdict === 'accepted' ? (en ? 'accepted' : '通過') : (en ? 'refused' : '未通過')} · {run.check.checkedAt ?? (en ? 'time not provided' : '未提供時間')}{run.check.requestId ? ` · ${run.check.requestId}` : ''}</p>}
      {score && <>
        <p className="break-words">{score.model.name} · {en ? 'computed' : '計算時間'} {score.computedAt}</p>
        <dl>{score.model.versions.map(version => <div key={version.type} className="mt-1"><dt className="font-medium">{version.type}</dt><dd className="break-all">{version.value}</dd></div>)}</dl>
        <p>{en ? 'Adapter version' : '串接版本'}：{score.adapterVersion ?? run.check?.adapterVersion ?? (en ? 'Not provided' : '未提供')}</p>
        {score.requestId && <p className="break-all">Request ID：{score.requestId}</p>}
      </>}
    </div>
  })}</div>
}
