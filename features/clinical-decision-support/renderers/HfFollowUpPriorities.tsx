"use client"

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/src/shared/utils/cn.utils'
import { todayIsoDate, type ClinicVitals, type ClinicVitalsPatch } from '../stores/clinic-vitals.store'
import { EMPTY_HF_HISTORY, type HfFollowUpHistory, type SymptomChange, type FollowUpComplaint } from '../utils/hf-follow-up'
import type { VisitAnswers, VisitAsk } from '../types'
import { answerToneClass, type AnswerTone } from './visit/answer-tones'
import { TINTED_PRIMARY } from './visit/visit-presentation'

type WeightChange = NonNullable<HfFollowUpHistory['weightChanges']>[number]['value']

/** This block's words for a change, and the every-visit answer each one is. */
const DYSPNOEA_ANSWER: Readonly<Partial<Record<SymptomChange, NonNullable<VisitAnswers['dyspnoea-trend']>>>> = { worse: 'worse', unchanged: 'stable', improved: 'better' }
const WEIGHT_ANSWER: Readonly<Record<WeightChange, NonNullable<VisitAnswers['weight-trend']>>> = { increased: 'up', unchanged: 'same', decreased: 'down' }
const invert = <K extends string, V extends string>(map: Readonly<Partial<Record<K, V>>>) => Object.fromEntries(Object.entries(map).map(([key, value]) => [value, key])) as Partial<Record<V, K>>
const DYSPNOEA_CHANGE = invert(DYSPNOEA_ANSWER)
const WEIGHT_CHANGE = invert(WEIGHT_ANSWER)
/** The colours the decision map gives the same answers (`answer-tones`). */
const SYMPTOM_TONE: Readonly<Partial<Record<SymptomChange, AnswerTone>>> = { worse: 'concern', unchanged: 'neutral', improved: 'reassuring' }
const WEIGHT_TONE: Readonly<Record<WeightChange, AnswerTone>> = { increased: 'concern', unchanged: 'neutral', decreased: 'change' }

/**
 * Chief-complaint and weight follow-up. `trendAsksElsewhere` is for a screen
 * that already asks 喘 and 體重 at the top (the decision map): the 喘 row and
 * the 增加／不變／減少 buttons are left out so the two are not asked twice, and
 * what stays is the rest — other tracked complaints, adding one, and the
 * weight records with their chart and new entry.
 *
 * Elsewhere (the three sections), the 喘 row's change and the weight change
 * are the same two answers the map asks: they show `trendAnswers` and write
 * through `onTrendAnswer`, so an answer given on either layout is the answer
 * on both, and the pack reads it once.
 */
export function HfFollowUpPriorities({ history = EMPTY_HF_HISTORY, vitals, onSave, now, isEnglish, onBreathDetails, trendAsksElsewhere = false, trendAnswers, onTrendAnswer }: {
  history?: HfFollowUpHistory; vitals?: ClinicVitals; onSave?: (patch: ClinicVitalsPatch) => void; now: Date; isEnglish: boolean; onBreathDetails: () => void; trendAsksElsewhere?: boolean
  trendAnswers?: VisitAnswers; onTrendAnswer?: (id: VisitAsk['id'], value: string) => void
}) {
  const today = todayIsoDate(now)
  const [text, setText] = useState('')
  const [date, setDate] = useState(today)
  const [weight, setWeight] = useState('')
  const [weightDate, setWeightDate] = useState(today)
  const [adding, setAdding] = useState(false)
  const [notesOpen, setNotesOpen] = useState<string | null>(null)
  const [weightRecordsOpen, setWeightRecordsOpen] = useState(false)
  const local = vitals?.hfFollowUp ?? EMPTY_HF_HISTORY
  const complaints = [...history.complaints, ...local.complaints].filter(item => item.date <= today)
  const previousDate = complaints.filter(item => item.date < today).map(item => item.date).sort().at(-1)
  const previous = complaints.filter(item => item.date === previousDate)
  const current = complaints.filter(item => item.date === today)
  const recordedRows = [...new Map([...previous, ...current].map(item => [item.text, item])).values()]
  const isBreath = (text: string) => /喘|breath|dyspn/i.test(text)
  const rows = trendAsksElsewhere
    ? recordedRows.filter(item => !isBreath(item.text))
    : recordedRows.some(item => isBreath(item.text)) ? recordedRows : [{ text: isEnglish ? 'Breathlessness' : '喘', date: today, source: 'clinic' }, ...recordedRows]
  const answeredWeight = trendAnswers?.['weight-trend']
  const weightChange = (answeredWeight ? WEIGHT_CHANGE[answeredWeight] : undefined) ?? local.weightChanges?.find(item => item.date === today)?.value
  const answeredDyspnoea = trendAnswers?.['dyspnoea-trend']
  const breathChange = answeredDyspnoea ? DYSPNOEA_CHANGE[answeredDyspnoea] : undefined
  const saveComplaint = (item: FollowUpComplaint) => onSave?.({ hfFollowUp: { ...local, complaints: [...local.complaints.filter(row => !(row.date === item.date && row.text === item.text)), { ...local.complaints.find(row => row.date === item.date && row.text === item.text), ...item }] } })
  const points = [...new Map([...history.weights, ...local.weights, ...(vitals?.entries.bodyWeight ? [{ value: vitals.entries.bodyWeight.value, date: vitals.entries.bodyWeight.measuredOn, source: 'clinic' }] : [])].filter(point => point.date <= today).sort((a, b) => a.date.localeCompare(b.date)).map(point => [point.date, point])).values()]
  const latest = points.at(-1)
  const prior = points.at(-2)
  const currentWeight = latest?.date === today ? latest : undefined
  const range = points.slice(-12)
  const low = Math.min(...range.map(point => point.value))
  const high = Math.max(...range.map(point => point.value))
  const start = Date.parse(range[0]?.date ?? today)
  const end = Date.parse(range.at(-1)?.date ?? today)
  const xy = range.map(point => `${10 + (Date.parse(point.date) - start) / Math.max(1, end - start) * 280},${70 - (point.value - low) / Math.max(1, high - low) * 50}`).join(' ')
  const choices: [SymptomChange, string, string][] = [['worse', '惡化', 'Worse'], ['unchanged', '穩定', 'Stable'], ['improved', '進步', 'Improved']]
  const sourceName = (source: string) => source === 'clinic' ? (isEnglish ? 'Clinic entry' : '門診輸入') : source
  const saveNewComplaint = () => { if (!text.trim() || !date || date > today) return; saveComplaint({ text: text.trim(), date, source: 'clinic' }); setText(''); setAdding(false) }
  const saveWeight = () => { const value = Number(weight); if (!Number.isFinite(value) || value <= 0 || !weightDate || weightDate > today) return; onSave?.({ entries: { bodyWeight: { value, measuredOn: weightDate } } }); setWeight('') }
  const chart = range.length > 1
    ? <svg viewBox="0 0 300 90" role="img" aria-label={isEnglish ? 'Weight trend; dated measurements below' : '體重趨勢，日期與數值詳見下表'} className="h-28 w-full text-primary"><polyline points={xy} fill="none" stroke="currentColor" strokeWidth="2" />{xy.split(' ').map((pair, index) => <circle key={range[index].date} cx={pair.split(',')[0]} cy={pair.split(',')[1]} r="3" fill="currentColor" />)}</svg>
    : <p className="text-xs text-muted-foreground">{isEnglish ? 'At least two dated weights are needed for a trend.' : '至少兩筆不同日期的體重才能顯示趨勢。'}</p>

  // The decision map's form (clinician feedback 2026-09-28: 「這邊的 UI 設計也跟
  // 決策地圖不符合」): two boxes drawn as the questions above them are — a name,
  // a line of what the record holds, and a text link where the other boxes
  // have 修改／收合 — with each entry on one row and the map's tinted save.
  if (trendAsksElsewhere) {
    const BOX = 'rounded-md border border-border bg-background px-2.5 py-2'
    const LINK = 'ml-auto inline-flex min-h-8 shrink-0 items-center rounded-md px-2 text-sm font-medium text-primary transition-colors hover:bg-primary/5 pointer-coarse:min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
    const FIELD = 'h-9 pointer-coarse:h-11'
    return <div className="space-y-2" data-testid="cdss-followup-priorities">
      <section className={BOX} aria-label={isEnglish ? 'Other complaints' : '其他主訴'} data-testid="cdss-followup-complaints">
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="text-sm font-medium text-foreground">{isEnglish ? 'Other complaints' : '其他主訴'}</span>
          <span className="text-xs text-muted-foreground">
            {rows.length ? (previousDate ? `${isEnglish ? 'previous record' : '上次紀錄'} ${previousDate}` : '') : (isEnglish ? 'none followed' : '沒有追蹤中的其他主訴')}
          </span>
          {onSave ? (
            <button type="button" className={LINK} aria-expanded={adding} onClick={() => setAdding(open => !open)} data-testid="cdss-followup-complaint-add">
              {adding ? (isEnglish ? 'Cancel' : '取消') : (isEnglish ? '+ Add' : '＋ 新增')}
            </button>
          ) : null}
        </div>
        {rows.map(item => {
          const recorded = current.find(row => row.text === item.text)
          const baseline = previous.find(row => row.text === item.text)
          const noteOpen = notesOpen === item.text
          return <div key={item.text} className="mt-2 space-y-1.5 border-t border-border pt-2" data-testid="cdss-followup-complaint-row">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="break-words text-sm font-medium text-foreground">{item.text}</span>
              <span className="text-xs text-muted-foreground">{baseline ? `${baseline.date} · ${sourceName(baseline.source)}` : recorded ? `${item.date} · ${sourceName(item.source)}` : (isEnglish ? 'not yet recorded' : '尚未記錄')}</span>
              <button type="button" className={LINK} aria-expanded={noteOpen} onClick={() => setNotesOpen(noteOpen ? null : item.text)}>
                {recorded?.note ? (isEnglish ? 'Note ✓' : '補充 ✓') : (isEnglish ? 'Note' : '補充')}
              </button>
            </div>
            <div role="group" aria-label={`${item.text} ${isEnglish ? 'change' : '變化'}`} className="flex flex-wrap gap-1">{choices.map(([value, zh, en]) => <Button key={value} variant="outline" className={cn('h-9 min-w-14 px-3 pointer-coarse:h-11', answerToneClass(SYMPTOM_TONE[value] ?? 'neutral', recorded?.change === value))} disabled={!onSave} aria-pressed={recorded?.change === value} onClick={() => saveComplaint({ text: item.text, date: today, source: 'clinic', change: value, comparedWith: baseline?.date })}>{isEnglish ? en : zh}</Button>)}</div>
            {recorded?.change === 'resolved' ? <p className="text-xs text-muted-foreground">{isEnglish ? 'Previously recorded: resolved' : '既有紀錄：已消失'}</p> : null}
            {noteOpen ? <Input key={`${item.text}-${today}`} className={FIELD} aria-label={isEnglish ? 'Details (saved on leaving field)' : '補充細節（離開欄位時儲存）'} placeholder={isEnglish ? 'Details, saved on leaving the field' : '補充細節，離開欄位時儲存'} defaultValue={recorded?.note ?? ''} disabled={!onSave} maxLength={1000} onBlur={event => { if (event.target.value !== (recorded?.note ?? '')) saveComplaint({ text: item.text, date: today, source: 'clinic', note: event.target.value, comparedWith: baseline?.date }) }} /> : null}
          </div>
        })}
        {adding ? (
          <form className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2" onSubmit={event => { event.preventDefault(); saveNewComplaint() }} data-testid="cdss-followup-complaint-form">
            <Input className={cn(FIELD, 'min-w-48 flex-1')} aria-label={isEnglish ? 'Complaint' : '主訴'} value={text} maxLength={500} onChange={event => setText(event.target.value)} placeholder={isEnglish ? 'e.g. breathlessness when walking' : '例如：走路會喘、腳腫'} autoFocus />
            <Input className={cn(FIELD, 'w-40')} type="date" aria-label={isEnglish ? 'Complaint date' : '主訴日期'} value={date} max={today} onChange={event => setDate(event.target.value)} />
            <Button type="submit" variant="outline" className={cn('h-9 px-4 font-semibold pointer-coarse:h-11', TINTED_PRIMARY)} disabled={!text.trim() || !date || date > today}>{isEnglish ? 'Save' : '儲存'}</Button>
          </form>
        ) : null}
      </section>
      <section className={BOX} aria-label={isEnglish ? 'Weight' : '體重'} data-testid="cdss-followup-weight">
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="text-sm font-medium text-foreground">{isEnglish ? 'Weight' : '體重'}</span>
          <span className="text-xs tabular-nums text-muted-foreground" data-testid="cdss-followup-weight-latest">
            {latest
              ? `${latest.value.toFixed(1)} kg · ${latest.date}${prior ? `（${isEnglish ? 'previous' : '前次'} ${prior.value.toFixed(1)} kg · ${prior.date}，Δ ${(latest.value - prior.value).toFixed(1)}）` : ''}`
              : (isEnglish ? 'not recorded yet' : '尚無紀錄')}
          </span>
          {points.length ? (
            <button type="button" className={LINK} aria-expanded={weightRecordsOpen} onClick={() => setWeightRecordsOpen(open => !open)} data-testid="cdss-weight-records">
              {weightRecordsOpen ? (isEnglish ? 'Fold' : '收合') : (isEnglish ? 'Trend and sources' : '趨勢與來源')}
            </button>
          ) : null}
        </div>
        {onSave ? (
          <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); saveWeight() }}>
            <Input className={cn(FIELD, 'w-28')} type="number" step="0.1" min="0.1" aria-label={isEnglish ? 'Weight (kg)' : '體重（kg）'} placeholder="kg" value={weight} onChange={event => setWeight(event.target.value)} />
            <Input className={cn(FIELD, 'w-40')} type="date" aria-label={isEnglish ? 'Measurement date' : '量測日期'} max={today} value={weightDate} onChange={event => setWeightDate(event.target.value)} />
            <Button type="submit" variant="outline" className={cn('h-9 px-4 font-semibold pointer-coarse:h-11', TINTED_PRIMARY)} disabled={!weight || Number(weight) <= 0 || !weightDate || weightDate > today}>{isEnglish ? 'Record weight' : '記錄體重'}</Button>
          </form>
        ) : null}
        {weightRecordsOpen ? (
          <div className="mt-2 space-y-1.5 border-t border-border pt-2">
            {chart}
            {range.length > 1 ? <p className="text-xs text-muted-foreground">{range[0].date} → {range.at(-1)?.date} · {low.toFixed(1)}–{high.toFixed(1)} kg</p> : null}
            <ul className="space-y-0.5 text-xs text-muted-foreground">{range.map(point => <li key={point.date} className="break-words tabular-nums">{point.date} · {point.value.toFixed(1)} kg · {sourceName(point.source)}</li>)}</ul>
          </div>
        ) : null}
      </section>
    </div>
  }

  return <div className="space-y-4 px-3 py-3" data-testid="cdss-followup-priorities">
    <section className="space-y-3" aria-label={isEnglish ? 'Chief complaint follow-up' : '主訴追蹤'}>
      <h4 className="font-semibold">{trendAsksElsewhere ? (isEnglish ? 'Other complaints' : '其他主訴') : (isEnglish ? 'Chief complaint · change since last visit' : '主要主訴・與上次相比')}</h4>
      {!trendAsksElsewhere || rows.length ? <p className="text-xs text-muted-foreground">{previousDate ? `${isEnglish ? 'Previous record' : '上次紀錄'}：${previousDate}` : (isEnglish ? 'No previous chief complaint available. Add the symptom to follow.' : '未取得上次主訴，請新增要追蹤的症狀。')}</p> : null}
      {rows.map(item => { const breath = isBreath(item.text); const recorded = current.find(row => row.text === item.text); const answer = breath && breathChange ? { ...recorded, change: breathChange } : recorded; const baseline = previous.find(row => row.text === item.text); return <div key={item.text} className="space-y-2 rounded-md border border-border bg-card p-3">
        <p className="break-words font-medium">{item.text}</p>
        <p className="break-words text-xs text-muted-foreground">{baseline ? `${baseline.date} · ${sourceName(baseline.source)}` : answer ? `${item.date} · ${sourceName(item.source)}` : (isEnglish ? 'Not yet recorded' : '尚未記錄')}</p>
        {!answer?.change ? <p data-cdss-action="" className="text-sm">{isEnglish ? 'Confirm today’s symptom status' : '請確認本次症狀變化'}</p> : null}
        {answer?.change === 'worse' ? <p data-cdss-action="" className="text-sm">{isEnglish ? 'Worsening reported · review this visit' : '主訴加重・請於本次評估'}</p> : null}
        <div role="group" aria-label={`${item.text} ${isEnglish ? 'change' : '變化'}`} className="flex flex-wrap gap-1">{choices.map(([value, zh, en]) => <Button key={value} variant="outline" className={cn('min-h-11', answerToneClass(SYMPTOM_TONE[value] ?? 'neutral', answer?.change === value))} disabled={!onSave} aria-pressed={answer?.change === value} onClick={() => { saveComplaint({ text: item.text, date: today, source: 'clinic', change: value, comparedWith: baseline?.date }); const shared = breath ? DYSPNOEA_ANSWER[value] : undefined; if (shared) onTrendAnswer?.('dyspnoea-trend', shared) }}>{isEnglish ? en : zh}</Button>)}</div>
        {answer?.change === 'resolved' ? <p className="text-sm">{isEnglish ? 'Previously recorded: resolved' : '既有紀錄：已消失'}</p> : null}
        <details data-testid="cdss-symptom-details"><summary className="min-h-11 cursor-pointer py-3 text-sm">{isEnglish ? 'Record details' : '展開紀錄細節'}{answer?.note ? (isEnglish ? ' · note saved' : '・已記錄') : ''}</summary>
          <label className="block text-sm">{isEnglish ? 'Details (saved on leaving field)' : '補充細節（離開欄位時儲存）'}<Input key={`${item.text}-${today}`} defaultValue={answer?.note ?? ''} disabled={!onSave} maxLength={1000} onBlur={event => { if (event.target.value !== (answer?.note ?? '')) saveComplaint({ text: item.text, date: today, source: 'clinic', note: event.target.value, comparedWith: baseline?.date }) }} /></label>
          {breath ? <Button variant="outline" className="mt-2 min-h-11" onClick={onBreathDetails}>{isEnglish ? 'Breathlessness assessment' : '記錄喘的細節'}</Button> : null}
        </details>
      </div> })}
      <details><summary className="min-h-11 cursor-pointer py-3 text-sm">{isEnglish ? 'Add another complaint' : '新增／補記其他主訴'}</summary>
      <form className="space-y-2" onSubmit={event => { event.preventDefault(); if (!text.trim() || !date || date > today) return; saveComplaint({ text: text.trim(), date, source: 'clinic' }); setText('') }}>
        <label className="block text-sm">{isEnglish ? 'Add / supplement chief complaint' : '新增／補記主訴'}<Input value={text} maxLength={500} onChange={event => setText(event.target.value)} placeholder={isEnglish ? 'e.g. breathlessness when walking' : '例如：走路會喘、腳腫'} disabled={!onSave} /></label>
        <label className="block text-sm">{isEnglish ? 'Complaint date' : '主訴日期'}<Input type="date" value={date} max={today} onChange={event => setDate(event.target.value)} disabled={!onSave} /></label>
        <Button variant="outline" type="submit" disabled={!onSave || !text.trim() || !date || date > today}>{isEnglish ? 'Save complaint' : '儲存主訴'}</Button>
      </form>
      </details>
    </section>
    <section className="space-y-3 border-t border-border pt-3" aria-label={isEnglish ? 'Weight trend' : '體重趨勢'}>
      <h4 className="font-semibold">{isEnglish ? 'Weight · kg' : '體重・kg'}</h4>
      {trendAsksElsewhere ? null : <>
      <div role="group" aria-label={isEnglish ? 'Weight change' : '體重變化'} className="flex flex-wrap gap-1">{([['increased', '增加', 'Increased'], ['unchanged', '不變', 'Unchanged'], ['decreased', '減少', 'Decreased']] as const).map(([value, zh, en]) => <Button key={value} variant="outline" className={cn('min-h-11', answerToneClass(WEIGHT_TONE[value], weightChange === value))} disabled={!onSave} aria-pressed={weightChange === value} onClick={() => { onSave?.({ hfFollowUp: { ...local, weightChanges: [...(local.weightChanges ?? []).filter(item => item.date !== today), { date: today, value }] } }); onTrendAnswer?.('weight-trend', WEIGHT_ANSWER[value]) }}>{isEnglish ? en : zh}</Button>)}</div>
      <p className="text-xs text-muted-foreground">{isEnglish ? 'Reported change this visit; measured values are shown separately.' : '本次回報的體重變化；實際量測差值另列如下。'}</p>
      <p>{isEnglish ? 'Today' : '本日'}：{currentWeight ? `${currentWeight.value.toFixed(1)} kg` : (isEnglish ? 'Not recorded' : '尚未量測')}</p>
      </>}
      <details data-testid="cdss-weight-records"><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">{isEnglish ? 'Weight records · chart and new entry' : '體重紀錄・圖表與新增量測'}</summary>
      {latest ? <p className="text-sm">{isEnglish ? 'Latest' : '最近一次'}：{latest.value.toFixed(1)} kg · {latest.date}{prior ? ` ／ ${isEnglish ? 'Previous' : '前次'}：${prior.value.toFixed(1)} kg · ${prior.date} ／ Δ ${(latest.value - prior.value).toFixed(1)} kg` : ''}</p> : <p data-cdss-action="" className="text-sm">{isEnglish ? 'Record weight to start tracking' : '請記錄體重以開始追蹤'}</p>}
      {range.length > 1 ? <svg viewBox="0 0 300 90" role="img" aria-label={isEnglish ? 'Weight trend; dated measurements below' : '體重趨勢，日期與數值詳見下表'} className="h-28 w-full text-primary"><polyline points={xy} fill="none" stroke="currentColor" strokeWidth="2" />{xy.split(' ').map((pair, index) => <circle key={range[index].date} cx={pair.split(',')[0]} cy={pair.split(',')[1]} r="3" fill="currentColor" />)}</svg> : <p className="text-xs text-muted-foreground">{isEnglish ? 'At least two dated weights are needed for a trend.' : '至少兩筆不同日期的體重才能顯示趨勢。'}</p>}
      {range.length > 1 ? <p className="text-xs text-muted-foreground">{range[0].date} → {range.at(-1)?.date} · {low.toFixed(1)}–{high.toFixed(1)} kg</p> : null}
      <details><summary className="min-h-11 cursor-pointer py-3 text-sm">{isEnglish ? 'Measurements and sources' : '量測紀錄與來源'}</summary><ul className="space-y-1 text-xs">{range.map(point => <li key={point.date} className="break-words">{point.date} · {point.value.toFixed(1)} kg · {sourceName(point.source)}</li>)}</ul></details>
      <form className="space-y-2" onSubmit={event => { event.preventDefault(); const value = Number(weight); if (!Number.isFinite(value) || value <= 0 || !weightDate || weightDate > today) return; onSave?.({ entries: { bodyWeight: { value, measuredOn: weightDate } } }); setWeight('') }}>
        <label className="block text-sm">{isEnglish ? 'Weight (kg)' : '輸入體重（kg）'}<Input type="number" step="0.1" min="0.1" value={weight} onChange={event => setWeight(event.target.value)} disabled={!onSave} /></label>
        <label className="block text-sm">{isEnglish ? 'Measurement date' : '量測日期'}<Input type="date" max={today} value={weightDate} onChange={event => setWeightDate(event.target.value)} disabled={!onSave} /></label>
        <Button variant="outline" type="submit" disabled={!onSave || !weight || Number(weight) <= 0 || !weightDate || weightDate > today}>{isEnglish ? 'Save weight' : '儲存體重'}</Button>
      </form>
      </details>
    </section>
  </div>
}
