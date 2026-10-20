'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import { useMedcloudHfDryRun } from '@/src/application/hooks/hf-risk/use-medcloud-hf-dry-run.hook'
import { hfDiagnosisVisits, suggestHfDiagnosis, type HfPhysicianDiagnosisDraft } from '@/src/core/hf-risk/physician-diagnosis'
import { hasHfDiagnosis, summarizeHfInput } from '@/src/core/hf-risk/input-summary'
import { useCopyToClipboard } from '@/src/shared/hooks/use-copy-to-clipboard'
import { HfProvenance, HfResultsView, hfResultText } from './HfPredictionResult'
import { HfExcludedLabs } from './HfExcludedLabs'
import { HfProblemReport } from './HfProblemReport'
import { HF_FAILURE_MESSAGES } from '@/src/core/hf-risk/diagnostics'

const GAP: Record<string, [string, string]> = {
  'lab-subject-unlinked': ['檢驗無法核對為本病人，僅計數、不顯示內容或送出', 'Observations not linked to this patient are counted only; details are withheld and not sent'],
  'index-diagnosis-missing': ['門診缺少可核對的 ICD-10-CM／ICD-9-CM 診斷；一般 ICD-10 不自行換碼，可由醫師確認後補充本次診斷', 'The index visit lacks a verified ICD-10-CM/ICD-9-CM diagnosis; correct the source or explicitly supply HF for this exact visit'],
  'hospital-name-only': ['來源僅提供院所名稱；同名院所無法可靠區分，請核對所選院所及資料範圍', 'Source provides hospital names only; identically named institutions cannot be distinguished reliably. Verify hospital identity and record scope'],
  'patient-birthdate': ['生日未含完整年月日；不以出生年推算日期', 'Full birth date missing; no date inferred from a birth year'],
  'patient-sex': ['性別缺漏或不符合模型定義', 'Sex missing or outside the model definition'],
  'source-validation-pending': ['這份病歷來源的模型適用性尚未驗證', 'Model applicability to this record source has not been validated'],
  'history-coverage-unverified': ['尚未確認各模組、院所與期間的資料涵蓋度', 'Coverage by module, hospital and time window remains unverified'],
  'module-unknown': ['必要歷史資料模組未標示擷取狀態', 'History module capture status unknown'],
  'module-incomplete': ['歷史資料模組擷取不完整或失敗', 'History module capture incomplete or failed'],
  'source-omitted': ['其他院所、來源不明或來源衝突的紀錄未送出', 'Other-hospital, unknown-source or conflicting-source records excluded'],
  'void-omitted': ['取消、作廢或未執行紀錄未送出', 'Cancelled, void or not-done records excluded'],
  'future-omitted': ['門診基準日之後的紀錄未送出', 'Records after the index visit excluded'],
  'encounter-date': ['就診日期缺漏或無效，未送出', 'Encounter date missing or invalid; excluded'],
  'encounter-class': ['就診類別不明，未送出', 'Unknown encounter class; excluded'],
  'encounter-duplicate': ['完全相同的住院紀錄已去重', 'Identical inpatient episodes deduplicated'],
  'department-unmapped': ['科別尚未對照，相關就診次數可能低估', 'Department unmapped; visit counts may be underestimated'],
  'ongoing-diagnoses-omitted': ['基準日尚未結束的住院，未採用事後申報診斷', 'Later claims diagnoses from ongoing admissions excluded'],
  'diagnosis-unmapped': ['診斷碼系統或格式無法確認，未送出', 'Unrecognized diagnosis system or code format; excluded'],
  'diagnosis-rank-missing': ['住院診斷未提供主次序，不自行推定', 'Inpatient diagnosis rank missing; no rank inferred'],
  'lab-status': ['檢驗尚未確認完成，未送出', 'Unconfirmed laboratory results excluded'],
  'lab-status-unreported': ['雲端／健康來源未提供檢驗完成狀態；有數值與採檢日期者照常送出', 'Cloud/health-bank source gives no result status; results with a value and collection date are sent'],
  'lab-unmapped': ['檢驗項目無已核對的 LOINC 對照，或不在模型項目中，未送出', 'Lab not in the audited model mapping; excluded'],
  'lab-date': ['檢驗未提供有效採檢日期，未送出', 'Valid collection date missing; excluded'],
  'lab-value-unit': ['檢驗數值或單位無法確認／換算，未送出', 'Lab value or unit cannot be validated/converted; excluded'],
  'lab-none': ['沒有可用的模型檢驗資料', 'No usable model laboratory inputs'],
  'procedure-date': ['處置執行日期不明，未送出', 'Procedure date unknown; excluded'],
  'procedure-unmapped': ['處置缺少模型接受的 ICD 碼或住院關聯，未送出', 'Procedure lacks a supported ICD code or inpatient link; excluded'],
}
/** Reasons a laboratory result was not sent, shown when no model lab reaches the model. */
const LAB_GAPS = ['lab-status', 'lab-unmapped', 'lab-date', 'lab-value-unit']
const MODULE: Record<string, [string, string]> = {
  imue0008: ['用藥與就診', 'Medication and visits'], imue0060: ['檢驗', 'Laboratory'],
  imue0070: ['住院', 'Admissions'], imue0020: ['手術', 'Surgery'],
}
const ERRORS: Record<string, [string, string]> = {
  'physician-diagnosis-rank-conflict': ['診斷順位與既有資料衝突；請核對來源，不自動覆寫原診斷', 'Diagnosis rank conflicts with existing data; review the source record'],
  'physician-diagnosis-invalid': ['請選擇診斷碼、既有就診及有效的診斷順位', 'Select a diagnosis code, existing visits and valid diagnosis ranks'],
  'preview-fixture-required': ['本機中繼僅接受指定合成病例，這份資料未送出', 'Local relay accepts only pinned synthetic cases; this data was not sent'],
  'duplicate-reference': ['病歷包含重複資源編號，請重新匯入', 'Duplicate resource references; import the record again'],
  'index-encounter-invalid': ['所選門診資料無效，請重新整理輸入', 'Selected visit is invalid; prepare inputs again'],
  'input-invalid': ['輸入資料不符合模型契約，請核對資料', 'Inputs do not match the model contract; review the data'],
  'input-too-large': ['整理後資料超過 2 MiB，無法送出', 'Prepared data exceeds the 2 MiB limit'],
  'response-too-large': ['服務回應超過大小限制，已丟棄', 'Oversized service response discarded'],
  'source-unsupported': ['請匯入雲端、健康或北榮懷爾抓抓的單一患者病歷', 'Import a single-patient cloud, health-bank or TVGH EHR bridge record'],
  'patient-count': ['需要單一患者的原始 Bundle', 'A single-patient source Bundle is required'],
  'bundle-invalid': ['無法讀取原始病歷 Bundle', 'Cannot read the source Bundle'],
  'no-visit': ['找不到院所來源與日期皆可辨識的門診紀錄；送出前需有可核對或醫師確認的診斷', 'No outpatient visit with a known hospital and date; a diagnosis is required before submission'],
  'source-changed': ['資料已切換，請重新整理輸入', 'Record changed; prepare the input again'],
  'gateway-unauthorized': ['尚未登入或未取得 HF 服務授權', 'Sign-in or HF service authorization required'],
  'gateway-config': ['院內 HF 檢查服務尚未設定', 'Intranet HF validation service is not configured'],
  'invalid-prediction-response': ['預測回應不符合模型契約，已丟棄', 'Prediction response does not match the model contract; discarded'],
  'invalid-dry-run-response': ['服務回應不符合輸入檢查格式，已丟棄', 'Invalid input-validation response discarded'],
}

const LAB_NAMES: Record<string, string> = {
  BNP: 'NT-proBNP', CREAT: 'Creatinine', BUN: 'BUN', K: 'K', HGB: 'Hemoglobin', ALB: 'Albumin', PLT: 'Platelet', WBC: 'WBC', CRP: 'CRP',
  GLU: 'Glucose', HBA1C: 'HbA1c', BILI: 'Bilirubin', ALT: 'ALT', AST: 'AST', UA: 'Uric acid', LDLC: 'LDL-C', HDLC: 'HDL-C', CHOL: 'Cholesterol',
  RDW: 'RDW', LYMP: 'Lymphocyte', SEG: 'Segment', TG: 'Triglyceride',
}
const GUIDE_KEY = 'mediprisma.hf-samd.guide-dismissed'
const readGuideDismissed = () => { try { return window.localStorage.getItem(GUIDE_KEY) === '1' } catch { return false } }

export function HfMedcloudDryRun({ locale }: { locale: string }) {
  return <HfMedcloudDetail locale={locale} state={useMedcloudHfDryRun()} />
}

function Step({ number, done, active, title, status, children, label }: { number: number; done: boolean; active?: boolean; title: string; status?: ReactNode; children: ReactNode; label?: string }) {
  return <section aria-label={label ?? title} className={`space-y-3 rounded-lg border bg-background p-3 ${active ? 'border-primary ring-1 ring-primary' : 'border-border'}`}>
    <div className="flex flex-wrap items-center gap-2">
      <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${done ? 'bg-emerald-700 text-white dark:bg-emerald-500 dark:text-emerald-950' : active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{done ? <Check className="h-3.5 w-3.5" /> : number}</span>
      <h4 className="text-sm font-semibold">{title}</h4>
      {status && <span className="ml-auto text-xs text-muted-foreground">{status}</span>}
    </div>
    {children}
  </section>
}

export function HfMedcloudDetail({ locale, state }: { locale: string; state: ReturnType<typeof useMedcloudHfDryRun> }) {
  const en = locale === 'en'
  const { current, configured, intranet, busy, runs, message: visibleMessage, diagnostics, setReportSnapshot, recordKey, prepare, select, supplementDiagnosis, predict } = state
  const [guideOpen, setGuideOpen] = useState(true)
  const [diagnosisOpen, setDiagnosisOpen] = useState(!current?.input.physicianDiagnosis)
  const { copied, copy } = useCopyToClipboard()
  const [copyFailed, setCopyFailed] = useState(false)
  // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only preference, read after hydration
  useEffect(() => { if (readGuideDismissed()) setGuideOpen(false) }, [])
  // Preparing is local and sends nothing; do it as soon as the view opens or the record changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!current && !busy) void prepare() }, [recordKey])
  const summary = current ? summarizeHfInput(current.input) : null
  const missingIndexDiagnosis = current?.input.gaps.some(gap => gap.code === 'index-diagnosis-missing')
  // The model only applies to patients with heart failure; without any HF code, step 2 must be answered first.
  const missingHfDiagnosis = !!current && !hasHfDiagnosis(current.input)
  const diagnosisVisits = current ? hfDiagnosisVisits(current.baseInput) : []
  const draft = current?.diagnosisDraft
  const invalidDiagnosisRank = !!draft?.encounters.some(reference => !Number.isInteger(draft.ranks[reference]) || draft.ranks[reference] < 1 || draft.ranks[reference] > 50)
  const outpatientSuggestion = current ? suggestHfDiagnosis(current.baseInput, 'outpatient') : null
  const inpatientSuggestion = current ? suggestHfDiagnosis(current.baseInput, 'inpatient') : null
  const chooseDiagnosis = (next: HfPhysicianDiagnosisDraft) => supplementDiagnosis({
    ...next,
    confirmed: next.code === 'I50.9' && next.encounters.length > 0
      && next.encounters.every(reference => Number.isInteger(next.ranks[reference]) && next.ranks[reference] >= 1 && next.ranks[reference] <= 50),
  })
  const text = (pair: [string, string]) => pair[en ? 1 : 0]
  const describeError = (code: string) => code === 'gateway-unauthorized' && intranet ? (en ? 'The service denied hospital network access; verify the approved network and ingress settings.' : '院內服務拒絕存取；請確認核准網段與入口設定。') : text(HF_FAILURE_MESSAGES[code] ?? ERRORS[code] ?? ['發生未預期錯誤，尚無法確認原因。請回報本次診斷。', 'An unexpected error occurred. Report this run’s diagnostics to identify the cause.'])
  const hospital = current ? current.visits.find(visit => visit.reference === current.selection.encounter)?.providerName ?? current.selection.provider : ''
  const confirmed = current?.input.physicianDiagnosis
  const suggestionDates = (suggestion: HfPhysicianDiagnosisDraft | null) => suggestion ? diagnosisVisits.filter(visit => suggestion.encounters.includes(visit.reference))
    .map(visit => visit.date + (visit.reference === current?.baseInput.indexEncounterReference ? (en ? ' (index)' : '（基準）') : '')).join('、') : ''
  const attestation = confirmed ? `${en ? 'Physician confirmation (user attestation)' : '醫師確認（使用者聲明）'}：I50.9 · ${confirmed.visits.map(visit => `${visit.date} (${en ? 'rank' : '順位'} ${visit.rank})`).join('、')}` : undefined
  // Copy only once every horizon has settled, so a pending horizon is never pasted as not assessed.
  const hasScore = !busy && !!runs && Object.values(runs).some(run => run?.prediction?.verdict === 'scored')
  const button = 'min-h-11 rounded-md border border-border px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'
  const link = 'min-h-8 rounded-sm text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'
  const control = 'min-h-11 w-full rounded-md border border-border bg-background px-2 text-sm'
  const chevron = <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90" />
  const quickChoice = (choice: 'outpatient' | 'inpatient', suggestion: HfPhysicianDiagnosisDraft | null, label: string, unavailable: string) => {
    const id = `hf-dx-${choice}`
    const checked = draft?.quickChoice === choice
    return <div className={`rounded-md border p-3 ${checked ? 'border-primary bg-primary/5' : 'border-border'} ${suggestion ? '' : 'opacity-70'}`}>
      <label className="flex min-h-6 items-start gap-3 text-sm font-medium">
        <input type="radio" name="hf-diagnosis-quick-choice" className="mt-0.5 h-4 w-4 shrink-0" checked={checked} disabled={!suggestion} aria-describedby={id} onChange={() => suggestion && chooseDiagnosis(suggestion)} />
        <span>{label}</span>
      </label>
      <p id={id} className="pl-7 text-xs text-muted-foreground tabular-nums">{suggestion ? `${suggestionDates(suggestion)} · ${hospital}` : unavailable}</p>
    </div>
  }

  return <section aria-label={en ? 'HF record model' : 'HF 病歷模型'} className="@container min-w-0 space-y-3 px-2.5 pb-3 pt-2" data-testid="hf-medcloud-dry-run">
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">{en ? 'TVGH HF research trial' : '北榮 HF 研究試用'}</h3>
        <span className="rounded-full border border-amber-600/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-900 dark:text-amber-200">{en ? 'Research pilot' : '研究試辦'}</span>
      </div>
      <p className="text-sm text-muted-foreground">{en ? 'Estimates the risk of death within 1 and 3 months after an outpatient visit.' : '估計門診後 1 個月與 3 個月內的死亡風險。'}</p>
    </div>

    <details className="group rounded-lg border border-border bg-background" open={guideOpen} onToggle={event => setGuideOpen(event.currentTarget.open)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">{chevron}{en ? 'How to use: three steps' : '使用說明：三個步驟'}</summary>
      <div className="space-y-3 px-3 pb-3">
        <ol className="grid gap-2 @md:grid-cols-3">
          {[
            [en ? '1 Choose the index visit' : '1 選基準門診', en ? 'The visit the 1- and 3-month predictions start from.' : '以哪一次門診為起點，同時預測 1 與 3 個月。'],
            [en ? '2 Confirm HF history' : '2 確認心衰病史', en ? 'The model applies only to patients with an HF diagnosis; cloud records often omit it.' : '模型只適用已有心衰診斷的病人，雲端資料常缺，由您確認。'],
            [en ? '3 Run prediction' : '3 執行預測', en ? 'Inputs are checked first; gaps are listed.' : '自動檢查資料，通過才計算；缺漏會列出。'],
          ].map(([title, body]) => <li key={title} className="space-y-1 rounded-md bg-muted/50 p-2.5">
            <p className="text-xs font-semibold text-primary">{title}</p>
            <p className="text-xs text-muted-foreground">{body}</p>
          </li>)}
        </ol>
        <p className="text-xs text-muted-foreground">{en ? 'Supports imported cloud, health-bank and TVGH EHR bridge records; available inputs depend on the source.' : '支援雲端、健康與北榮懷爾抓抓匯入的病歷；可用欄位依來源資料而定。'}</p>
        {intranet && <p className="text-xs text-muted-foreground">{en ? 'Hospital network authorization; no Firebase sign-in required. The service verifies access.' : '院內網路授權模式，不需 Firebase 登入；是否可用由院內服務驗證。'}</p>}
        <button type="button" className={button + ' min-h-9 py-1 text-xs text-primary'} onClick={() => { try { window.localStorage.setItem(GUIDE_KEY, '1') } catch { /* preference only */ } setGuideOpen(false) }}>{en ? 'Got it; keep collapsed' : '知道了，之後收起'}</button>
      </div>
    </details>
    {process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_HF_LOCAL_PREVIEW_RELAY === 'synthetic' && <p className="text-xs text-muted-foreground">{en ? 'Local preview relay: only the supplied synthetic fixture is accepted. Production browser CORS is not verified by this preview.' : '本機驗收中繼：僅接受指定合成病例；此預覽不代表正式瀏覽器 CORS 已通過。'}</p>}
    {!configured && <p className="text-sm font-medium">{text(ERRORS['gateway-config'])}</p>}
    {!current && !visibleMessage && <p className="text-sm text-muted-foreground" role="status">{en ? 'Preparing the record…' : '整理病歷資料中…'}</p>}
    {!current && visibleMessage && <button type="button" className={link} onClick={prepare}>{en ? 'Prepare the record again' : '重新整理病歷資料'}</button>}

    {current && <>
      <Step number={1} done title={en ? 'Step 1 · Index visit' : '步驟 1　基準門診'} status={en ? 'Most recent visit selected' : '已自動帶入最近一次門診'}>
        <label className="block min-w-0 space-y-1 text-sm">{en ? 'Index visit / hospital' : '門診基準日／院所'}
          <select className={control} value={current.selection.encounter} disabled={busy} onChange={event => {
            const visit = current.visits.find(visit => visit.reference === event.target.value)
            if (visit) { setDiagnosisOpen(true); select({ ...current.selection, encounter: visit.reference, provider: visit.provider }) }
          }}>{current.visits.map((visit, index) => <option key={visit.reference} value={visit.reference}>{visit.date} · {visit.providerName ?? visit.provider}{current.source === 'medcloud' ? ` · ${visit.provider}` : ''} · {index + 1}</option>)}</select>
        </label>
        <p className="text-xs text-muted-foreground">{en ? 'Both 1- and 3-month outcomes are calculated. Only this hospital\'s records on or before the index date are used.' : '同時計算 1 個月與 3 個月。只用這家院所、基準日當天及以前的紀錄。'}{' '}
          <button type="button" className={link + ' text-xs'} disabled={busy} onClick={prepare}>{en ? 'Prepare again' : '重新整理'}</button>
        </p>
      </Step>

      <Step number={2} done={!!confirmed && !diagnosisOpen} active={!confirmed || diagnosisOpen} label={en ? 'Physician-supplied HF diagnosis' : '醫師補充心衰診斷'} title={en ? 'Step 2 · Confirm HF history' : '步驟 2　確認心衰病史'}
        status={confirmed ? (en ? 'Confirmed' : '已確認') : (en ? 'Needs confirmation' : '待確認')}>
        {confirmed && !diagnosisOpen ? <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 text-sm">{draft?.quickChoice === 'inpatient' ? (en ? 'HF diagnosed during the most recent admission' : '最近一次住院有心衰診斷') : draft?.quickChoice === 'outpatient' ? (en ? 'HF diagnosed at the two most recent outpatient visits' : '最近兩次門診皆有心衰診斷') : (en ? 'Custom visits' : '自訂就診')} · I50.9</p>
          <button type="button" className={button + ' min-h-9 py-1 text-primary'} disabled={busy} onClick={() => setDiagnosisOpen(true)}>{en ? 'Change' : '修改'}</button>
        </div> : <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{en ? 'Cloud records often omit HF diagnoses. Choose the option that matches the chart; I50.9 is added to those visits for this request only.' : '雲端病歷常未帶出心衰診斷。請選一項與病歷相符的情況，系統只在本次請求為那幾次就診補上 I50.9。'}</p>
          <fieldset disabled={busy} className="grid gap-2 @md:grid-cols-2">
            <legend className="sr-only">{en ? 'Confirm HF history' : '確認心衰病史'}</legend>
            {quickChoice('outpatient', outpatientSuggestion, en ? 'HF diagnosed at the two most recent outpatient visits' : '最近兩次門診皆有心衰診斷', en ? 'Unavailable: requires the index visit and one other eligible outpatient visit.' : '門診選項無法使用：需有基準門診及另一筆可用門診紀錄。')}
            {quickChoice('inpatient', inpatientSuggestion, en ? 'HF diagnosed during the most recent admission' : '最近一次住院有心衰診斷', en ? 'Unavailable: no eligible completed admission on or before the index date.' : '住院選項無法使用：基準日以前沒有可用的已結束住院紀錄。')}
          </fieldset>
          {draft?.encounters.some(reference => diagnosisVisits.some(visit => visit.reference === reference && diagnosisVisits.some(other => other.reference !== reference && draft.encounters.includes(other.reference) && other.date === visit.date))) && <p className="text-xs text-amber-900 dark:text-amber-200">{en ? 'Same-day visits are separate encounters. Match the displayed visit number in advanced settings before selecting.' : '同日紀錄是不同次就診，請依進階設定的就診編號核對，勿將同日紀錄視為同一次。'}</p>}
          <details className="group border-t border-border pt-1">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">{chevron}{en ? 'Different dates? Choose visits and diagnosis ranks' : '日期不同？自訂就診與診斷順位'}</summary>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{en ? 'Tick the visits that had HF and enter each rank (1 is primary). The API does not recognize unranked supplemental codes; acceptance is still decided by the API. The source record is unchanged.' : '勾選確有心衰診斷的就診並填順位（1 為主診斷，2 以上為次診斷）。API 不辨識未標順位的補充碼，是否接受仍由 API 判定。原始病歷不變。'}</p>
              <label className="block space-y-1 text-sm">{en ? 'Supplemental ICD-10-CM code' : '補充 ICD-10-CM 診斷碼'}
                <select className={control} value={draft?.code ?? ''} disabled={busy} onChange={event => chooseDiagnosis({ ...current.diagnosisDraft, quickChoice: undefined, code: event.target.value, confirmed: false })}>
                  <option value="">{en ? 'Select a diagnosis' : '請選擇診斷'}</option>
                  <option value="I50.9">{en ? 'I50.9 — Heart failure, unspecified' : 'I50.9 — 心衰竭，未特指'}</option>
                </select>
              </label>
              <fieldset className="space-y-1" disabled={busy}>
                <legend className="text-sm font-medium">{en ? 'Visits with physician-confirmed HF' : '醫師確認已有心衰診斷的就診日期'}</legend>
                <div className="max-h-44 overflow-y-auto rounded-md border border-border px-2">
                  {diagnosisVisits.map(visit => <div key={visit.reference} className="py-1">
                    <label className="flex min-h-11 items-center gap-2 text-sm">
                      <input type="checkbox" checked={draft?.encounters.includes(visit.reference) ?? false} onChange={event => chooseDiagnosis({ ...current.diagnosisDraft, quickChoice: undefined, confirmed: false, encounters: event.target.checked ? [...current.diagnosisDraft.encounters, visit.reference] : current.diagnosisDraft.encounters.filter(reference => reference !== visit.reference) })} />
                      <span className="tabular-nums">{visit.date} · {visit.encounterClass === 'AMB' ? (en ? 'Outpatient' : '門診') : visit.encounterClass === 'IMP' ? (en ? 'Admission' : '住院') : (en ? 'Emergency' : '急診')} · #{diagnosisVisits.findIndex(item => item.reference === visit.reference) + 1}{visit.reference === current.baseInput.indexEncounterReference ? (en ? ' · Index visit' : ' · 基準就診') : ''}</span>
                    </label>
                    {draft?.encounters.includes(visit.reference) && <label className="block space-y-1 pb-2 text-sm">{en ? `Diagnosis rank for ${visit.date}` : `${visit.date} 診斷順位`}
                      <input type="number" min={1} max={50} step={1} className={control} value={draft.ranks[visit.reference] || ''} onChange={event => chooseDiagnosis({ ...current.diagnosisDraft, quickChoice: undefined, confirmed: false, ranks: { ...current.diagnosisDraft.ranks, [visit.reference]: Number(event.target.value) } })} />
                    </label>}
                  </div>)}
                </div>
              </fieldset>
              {visibleMessage === 'physician-diagnosis-rank-conflict' && <p className="text-xs font-medium" role="alert">{text(ERRORS['physician-diagnosis-rank-conflict'])}</p>}
              {invalidDiagnosisRank && <p className="text-xs font-medium" role="status" aria-live="polite">{en ? 'Enter an integer diagnosis rank from 1 to 50 for every selected visit. Incomplete supplementation is not applied.' : '每次所選就診的診斷順位須為 1–50 的整數；補充資料未完整前不會套用。'}</p>}
            </div>
          </details>
        </div>}
        {confirmed && <p className="text-xs" role="note">{attestation}<span className="block text-muted-foreground">{en ? 'Confirmed at' : '確認時間'}：{confirmed.confirmedAt} · {en ? 'This request only; the source record is unchanged' : '僅本次請求，不改原始病歷'}</span></p>}
      </Step>

      {!runs && summary && (summary.missingLabs.includes('BNP') || summary.missingLabs.length > 0) && <section aria-label={en ? 'Before running' : '執行前提醒'} className="space-y-1.5">
        {summary.presentLabs.length === 0 && <div className="space-y-1 rounded-md border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200" role="note">
          <p className="font-semibold">{en ? 'No model laboratory result will be sent.' : '本次沒有任何模型檢驗會送出。'}{en ? ' The model will treat every lab as untested, which may underestimate risk.' : '模型會視所有檢驗為未測，結果可能低估。'}</p>
          {current.input.gaps.some(gap => LAB_GAPS.includes(gap.code)) && <ul className="list-disc pl-5 text-xs">{current.input.gaps.filter(gap => LAB_GAPS.includes(gap.code)).map(gap => <li key={gap.code}>{text(GAP[gap.code])} · {gap.count}</li>)}</ul>}
        </div>}
        {summary.presentLabs.length > 0 && summary.missingLabs.includes('BNP') && <p className="rounded-md border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200"><span className="font-semibold">{en ? 'No NT-proBNP in this record.' : '本次資料沒有 NT-proBNP。'}</span>{en ? ' The estimate may be affected; the model reports this with the result.' : '仍可計算，但可能影響估計；模型會在結果中提示。'}</p>}
        {summary.presentLabs.length > 0 && summary.missingLabs.filter(key => key !== 'BNP').length > 0 && <p className="text-xs text-muted-foreground">{en ? `${summary.missingLabs.filter(key => key !== 'BNP').length} other model lab items are not provided; missing values are not treated as normal. See “Data used” below.` : `另有 ${summary.missingLabs.filter(key => key !== 'BNP').length} 項模型檢驗未提供；缺值不當作正常。明細見下方「本次使用的資料」。`}</p>}
      </section>}

      <div className="sticky top-0 z-10 space-y-1.5 rounded-lg border border-border bg-background p-3" data-testid="hf-model-actions">
        <button type="button" className={button + ' w-full min-w-0 border-primary bg-primary px-2 text-base text-primary-foreground'} disabled={busy || !configured || missingIndexDiagnosis || missingHfDiagnosis} onClick={() => { setDiagnosisOpen(false); void predict() }}>
          {busy ? (en ? 'Checking inputs and predicting…' : '檢查資料與預測中…') : (en ? 'Run HF model prediction' : '執行 HF 模型預測')}
        </button>
        {missingHfDiagnosis && !missingIndexDiagnosis && <p className="rounded-md bg-amber-500/10 px-2 py-1.5 text-xs font-medium text-amber-900 dark:text-amber-200" role="note">{en ? 'No heart-failure diagnosis was found in this record. Confirm the HF history in step 2 first; the model applies only to patients with heart failure.' : '未偵測到心衰診斷，請先在步驟 2 確認心衰病史；模型只適用於心衰病人。'}</p>}
        {missingIndexDiagnosis && <p className="rounded-md bg-amber-500/10 px-2 py-1.5 text-xs font-medium text-amber-900 dark:text-amber-200" role="note">{en ? 'The index visit has no usable diagnosis. Supply HF for this exact outpatient visit in step 2 (custom visits), or choose another index visit with a verified diagnosis. Admission confirmation alone does not supply a diagnosis for the index outpatient visit.' : '基準門診缺少可用診斷。請在步驟 2「自訂就診」補充這次門診的心衰診斷，或改選已有診斷的基準門診；只確認住院診斷不會補上基準門診診斷。'}</p>}
        <p className="text-xs text-muted-foreground">{en ? 'Inputs are checked before prediction. Submitting sends the prepared birth date, sex and selected-hospital clinical inputs to the intranet service. Names and identity numbers are excluded. You can switch views while it runs.' : '執行時先檢查資料再計算，將生日、性別與所選院所臨床資料送至院內服務；不含姓名、身分證或無關內容。執行中可切到其他畫面。'}</p>
      </div>
    </>}

    <div role="status" aria-live="polite" className="space-y-2 text-sm">
      {visibleMessage && visibleMessage !== 'physician-diagnosis-rank-conflict' && <p className="font-medium">{describeError(visibleMessage)}</p>}
      {runs && current && (busy || Object.values(runs).some(run => run?.check || run?.prediction || run?.error)) && <section aria-label={en ? 'HF model prediction' : 'HF 模型預測結果'} className="space-y-3 rounded-lg border border-border bg-background p-3">
        <div className="space-y-0.5">
          <h4 className="text-base font-semibold">{en ? 'Risk of death within 1 and 3 months' : '就診後 1／3 個月內死亡風險'}</h4>
          <p className="text-xs text-muted-foreground tabular-nums">{en ? 'Index visit' : '基準門診'} {current.input.indexDate} · {hospital}</p>
        </div>
        <HfResultsView runs={runs} busy={busy} locale={locale} describeError={describeError} />
        {hasScore && <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={button + ' border-primary text-primary'} onClick={async () => setCopyFailed(!await copy(hfResultText(runs, { indexDate: current.input.indexDate, hospital, attestation, locale })))}>{copied ? (en ? 'Copied' : '已複製') : (en ? 'Copy results for the note' : '複製結果到病歷')}</button>
          {copyFailed && <span className="text-xs">{en ? 'Copy failed; select the text manually.' : '無法複製，請手動選取文字。'}</span>}
        </div>}
      </section>}
    </div>

    {current && diagnostics && diagnostics.records.length > 0 && !busy && <HfProblemReport key={diagnostics.runId} runId={diagnostics.runId} records={diagnostics.records} source={current.source} locale={locale} describeError={describeError} snapshot={diagnostics.report ?? null} onSnapshotChange={setReportSnapshot} />}

    {current && <details className="group rounded-lg border border-border bg-background">
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-2 px-3 py-2 [&::-webkit-details-marker]:hidden">{chevron}<span className="text-sm font-semibold">{en ? 'Data used' : '本次使用的資料'}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{en ? 'visits' : '就診'} {current.input.counts.Encounter ?? 0} · {en ? 'diagnoses' : '診斷'} {current.input.counts.Condition ?? 0} · {en ? 'labs' : '檢驗'} {summary?.presentLabs.length ?? 0}／{(summary?.presentLabs.length ?? 0) + (summary?.missingLabs.length ?? 0)} {en ? 'items' : '項'} · {en ? 'procedures' : '處置'} {current.input.counts.Procedure ?? 0}</span>
      </summary>
      <div className="space-y-4 px-3 pb-3 text-sm">
        <p className="text-xs text-muted-foreground">{hospital} · {en ? `records on or before ${current.input.indexDate}` : `${current.input.indexDate} 當天及以前的全部紀錄`} · {en ? 'Record source' : '病歷來源'}：{current.source === 'medcloud' ? (en ? 'NHI cloud bridge' : '雲端懷爾抓抓') : current.source === 'health-bank' ? (en ? 'Health-bank bridge' : '健康懷爾抓抓') : (en ? 'TVGH EHR bridge' : '北榮懷爾抓抓')}</p>
        <div className="space-y-1">
          <h5 className="text-sm font-semibold">{en ? 'Sent to the model' : '送給模型'}</h5>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{en ? 'Patient' : '病人'}</dt><dd>{en ? 'Birth date (full date), sex' : '生日（完整年月日）、性別'}</dd>
            <dt className="text-muted-foreground">{en ? 'Visits' : '就診'}</dt><dd className="tabular-nums">{current.input.counts.Encounter ?? 0}{summary && ` · ${[['AMB', en ? 'outpatient' : '門診'], ['EMER', en ? 'emergency' : '急診'], ['IMP', en ? 'admission' : '住院']].filter(([code]) => summary.encounterClasses[code]).map(([code, name]) => `${name} ${summary.encounterClasses[code]}`).join(' · ')}`}</dd>
            <dt className="text-muted-foreground">{en ? 'Diagnoses' : '診斷'}</dt><dd className="tabular-nums">{current.input.counts.Condition ?? 0} · ICD-10-CM／ICD-9-CM{confirmed ? (en ? ` · includes physician-supplied I50.9 × ${confirmed.visits.length}` : ` · 含醫師補充 I50.9 × ${confirmed.visits.length}`) : ''}</dd>
            <dt className="text-muted-foreground">{en ? 'Labs' : '檢驗'}</dt><dd className="tabular-nums">{current.input.counts.Observation ?? 0} {en ? 'results' : '筆'}{summary?.dates.length ? ` · ${summary.dates[0]} – ${summary.dates.at(-1)}` : (en ? ' · No usable labs' : ' · 沒有可用檢驗')}</dd>
            <dt className="text-muted-foreground">{en ? 'Procedures' : '處置'}</dt><dd className="tabular-nums">{current.input.counts.Procedure ?? 0}</dd>
          </dl>
        </div>
        {summary && <div className="space-y-2">
          <h5 className="text-sm font-semibold">{en ? `Model lab items · ${summary.presentLabs.length} of ${summary.presentLabs.length + summary.missingLabs.length}` : `模型檢驗 ${summary.presentLabs.length + summary.missingLabs.length} 項 · 有 ${summary.presentLabs.length} · 缺 ${summary.missingLabs.length}`}</h5>
          <div className="grid gap-3 @md:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-200">{en ? 'Sent' : '有送出'} · {summary.presentLabs.length}</p>
              <p className="break-words text-xs">{summary.presentLabs.length ? summary.presentLabs.map(key => LAB_NAMES[key] ?? key).join('、') : (en ? 'None' : '無')}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">{en ? 'Missing model lab items' : '未提供的模型檢驗項目'} · {summary.missingLabs.length}</p>
              <p className="break-words text-xs">{summary.missingLabs.map(key => LAB_NAMES[key] ?? key).join('、')}</p>
              <p className="text-xs text-muted-foreground">{en ? 'Missing tests are not treated as normal or zero. The model may accept inputs with warnings.' : '缺值不當作正常或零值；模型可能接受輸入並回傳缺漏警告。'}</p>
            </div>
          </div>
        </div>}
        <div className="space-y-1">
          <h5 className="text-sm font-semibold">{en ? 'Not sent' : '不送給模型'}</h5>
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            <li>{en ? 'Medications, vital signs and free text: not used by this model' : '用藥、生命徵象、自由文字：此模型不使用'}</li>
            <li>{en ? 'Name, ID number and chart number: removed and replaced with one-time identifiers' : '姓名、身分證、病歷號：去除，改用一次性編號'}</li>
          </ul>
        </div>
        <div className="space-y-1">
          <h5 className="text-sm font-semibold">{en ? 'Source checks and gaps' : '來源檢查與缺漏'}</h5>
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">{current.input.gaps.map(gap => {
            const [code, moduleName] = gap.code.split(':')
            return <li key={gap.code}>{text(GAP[code] ?? [code, code])}{moduleName ? ' (' + text(MODULE[moduleName] ?? [moduleName, moduleName]) + ')' : ''}{gap.count > 1 ? ' · ' + gap.count : ''}</li>
          })}</ul>
          <p className="text-xs text-muted-foreground">{en ? 'Outcome: death within 1 or 3 months after the index visit. '+'Deaths are ascertained from TVGH records; deaths outside TVGH may be missed.' : '結局為基準門診後 1 或 3 個月內死亡；死亡事件依北榮資料認定，院外或他院死亡可能未納入；這份病歷來源適用性尚待驗證。'}</p>
        </div>
      </div>
    </details>}

    {current && <HfExcludedLabs key={`${current.importId}:${current.selection.provider}:${current.selection.encounter}`} items={current.input.excludedLabs ?? []} unlinkedCount={current.input.unlinkedObservationCount ?? 0} indexDate={current.input.indexDate} locale={locale} />}

    {runs && <details className="group rounded-lg border border-border bg-background">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">{chevron}{en ? 'Attestation and calculation record' : '醫師聲明與計算紀錄'}</summary>
      <div className="space-y-2 px-3 pb-3 text-xs text-muted-foreground">
        {attestation && <p>{attestation}</p>}
        <p>{en ? 'Model version and calibration are established only by a scored prediction, not by the input check.' : '模型版本與校正以預測結果為準；dry-run 不確認模型版本。'}</p>
        <HfProvenance runs={runs} locale={locale} />
      </div>
    </details>}
  </section>
}
