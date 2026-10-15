'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { ChevronDown, ChevronLeft, History, Save, Trash2, UserRound, X } from 'lucide-react'
import { isDeidentifiedPatient } from '@/src/core/entities/patient.entity'
import { useAuth } from '@/src/application/providers/auth.provider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import { storedTimestampForDisplay } from '@/src/shared/contracts/cdss-stored-save-v2'
import { cancelCdssGatewayRequests, cdssGatewayStatus, saveCdssSnapshot } from '../telemetry/cdss-gateway'
import { deleteCdssHistory, listCdssHistory, readCdssHistory, type CdssHistoryList, type CdssHistoryRecord } from '../telemetry/cdss-history'
import { authorizeFhir, captureFhirRequestAuth, disconnectFhir, fhirAuthStatus, fhirOAuthEnabled, subscribeFhirAuth } from '../telemetry/fhir-auth'
import { cdssPatientIdentity } from '../telemetry/patient-identity'
import { cdssSaveErrorDescription, cdssSaveOutcomeUncertain } from '../telemetry/save-error'
import type { CarryForwardChoices } from '../telemetry/cdss-carry-forward'

const isDeidentifiedFailure = (failure: unknown) => failure instanceof Error && failure.message === 'cdss_patient_deidentified'
const isIdentityFailure = (failure: unknown) => failure instanceof Error && failure.message === 'cdss_identity_unavailable'

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {}
const text = (value: unknown) => typeof value === 'string' ? value : ''
const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item !== '') : []
/** True when a saved value holds anything a clinician entered, not just an empty container. */
const filled = (value: unknown, depth = 0): boolean => value !== null && value !== undefined && value !== '' && depth < 8
  && (typeof value !== 'object' || Object.values(value).some(item => filled(item, depth + 1)))
const toolbarButton = 'h-[32px] min-h-[32px] gap-1.5 px-2 text-[12px] shadow-none max-md:h-[44px] max-md:min-h-[44px]'
const subscribeSite = (notify: () => void) => {
  window.addEventListener('popstate', notify)
  return () => window.removeEventListener('popstate', notify)
}
const fieldNames: Record<string, string> = { clinicVitals: '門診量測', hfpefInputs: '心超輸入', phenotypeAnswer: '疾病分型',
  evidenceOverrides: '證據選擇', afAnswers: 'AF 回答', nhiLipidReview: '血脂回答', nhiLipidReviewProvenance: '血脂資料來源',
  preventInputs: 'PREVENT 回答', visitAnswers: '本次問診回答', decision: '決策', reasons: '理由', note: '備註',
  entries: '量測項目', value: '數值', measuredOn: '日期', updatedAt: '更新時間', source: '來源' }
const fieldNamesEn: Record<string, string> = { clinicVitals: 'clinic measurements', hfpefInputs: 'echo inputs', phenotypeAnswer: 'phenotype',
  evidenceOverrides: 'evidence selections', afAnswers: 'AF answers', nhiLipidReview: 'lipid answers', preventInputs: 'PREVENT answers', visitAnswers: 'visit answers' }

type Status = 'actionable' | 'review' | 'needs-data' | 'no-action'
const statusLabel = (status: string, english: boolean) => ({
  actionable: english ? 'Act' : '建議處理', review: english ? 'Review' : '需核對',
  'needs-data': english ? 'Needs data' : '需補資料', 'no-action': english ? 'No action' : '不需處理',
} as Record<string, string>)[status] ?? status
const statusChip: Record<Status, string> = {
  actionable: 'border border-foreground/70 font-semibold text-foreground',
  review: 'border border-border text-foreground',
  'needs-data': 'bg-amber-100 font-semibold text-amber-900 dark:bg-amber-500/10 dark:text-amber-200',
  'no-action': 'text-muted-foreground',
}
const chip = 'inline-flex h-6 w-fit shrink-0 items-center whitespace-nowrap rounded px-1.5 text-[12px] leading-none'
const priorityChip = 'bg-rose-100 font-semibold text-rose-800 dark:bg-rose-500/10 dark:text-rose-200'
const sourceKind: Record<string, [string, string]> = { Observation: ['檢驗／量測', 'Observation'], MedicationRequest: ['處方', 'Prescription'],
  MedicationStatement: ['用藥紀錄', 'Medication'], Condition: ['診斷', 'Diagnosis'], DiagnosticReport: ['報告', 'Report'],
  Procedure: ['處置', 'Procedure'], Encounter: ['就診', 'Encounter'], DocumentReference: ['文件', 'Document'],
  AllergyIntolerance: ['過敏', 'Allergy'], Immunization: ['疫苗', 'Immunization'], Patient: ['基本資料', 'Patient'], CarePlan: ['照護計畫', 'Care plan'] }
const when = (value: string, english: boolean) => new Date(value).toLocaleString(english ? 'en' : 'zh-TW')
const clock = (value: string, english: boolean) => new Date(value).toLocaleTimeString(english ? 'en' : 'zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })
const dayOf = (value: string, english: boolean) => new Date(value).toLocaleDateString(english ? 'en' : 'zh-TW')

/** Saved data only. No rule evaluation, HTML injection, or writes to current answer stores. */
function SavedFields({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined) return <span>—</span>
  if (typeof value !== 'object') return <span className="whitespace-pre-wrap break-words">{String(value)}</span>
  if (depth >= 8) return <span>…</span>
  if (Array.isArray(value)) return <ul className="list-inside list-disc space-y-1">{value.map((item, index) =>
    <li key={index}><SavedFields value={item} depth={depth + 1} /></li>)}</ul>
  return <dl className="space-y-1">{Object.entries(value).map(([key, item]) => <div key={key} className="grid gap-1 border-b border-border py-1 sm:grid-cols-[10rem_1fr]">
    <dt className="break-words text-muted-foreground">{fieldNames[key] ?? key}</dt>
    <dd className="min-w-0"><SavedFields value={item} depth={depth + 1} /></dd>
  </div>)}</dl>
}

function EvidenceTable({ value, english }: { value: unknown; english: boolean }) {
  const rows = Array.isArray(value) ? value.map(object) : []
  if (!rows.length) return null
  return <div className="overflow-x-auto"><table className="w-full min-w-[22rem] border-collapse text-[13px]">
    <thead><tr className="text-left text-muted-foreground">
      <th className="w-[32%] border-b border-border px-2 py-1.5 font-normal">{english ? 'Patient evidence' : '病人證據'}</th>
      <th className="w-[32%] border-b border-border px-2 py-1.5 font-normal">{english ? 'Value then' : '當時數值'}</th>
      <th className="border-b border-border px-2 py-1.5 font-normal">{english ? 'Source' : '來源'}</th>
    </tr></thead>
    <tbody>{rows.map((row, index) => {
      const sources = Array.isArray(row.sources) ? row.sources.map(object) : []
      const first = sources[0]
      const kind = first ? sourceKind[text(first.resourceType)]?.[english ? 1 : 0] ?? text(first.resourceType) : ''
      const date = first ? text(first.date).slice(0, 10) : ''
      return <tr key={index} className="align-top">
        <td className="break-words border-b border-border/60 px-2 py-1.5">{text(row.label) || '—'}</td>
        <td className="break-words border-b border-border/60 px-2 py-1.5 font-semibold tabular-nums">{text(row.value) || '—'}</td>
        <td className="break-words border-b border-border/60 px-2 py-1.5 text-muted-foreground tabular-nums">
          {first ? [kind, date].filter(Boolean).join(' ') : '—'}{sources.length > 1 ? ` +${sources.length - 1}` : ''}
        </td>
      </tr>
    })}</tbody>
  </table></div>
}

function SavedRecommendation({ value, english, today }: { value: unknown; english: boolean; today?: string | null }) {
  const recommendation = object(value)
  const status = text(recommendation.status)
  const title = text(recommendation.title)
  const moduleName = text(recommendation.moduleName)
  const missing = strings(recommendation.missingData)
  const next = strings(recommendation.nextActions)
  const changed = today !== undefined && today !== null && today !== status
  const todayText = today === undefined ? '' : today === null
    ? english ? 'Not shown today' : '今天未出現'
    : changed ? `${english ? 'Today: ' : '今天：'}${statusLabel(today, english)}` : english ? 'Same' : '相同'
  return <details className="group border-b border-border" data-testid="cdss-history-recommendation">
    <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_20px] items-start gap-x-3 gap-y-1 py-3 md:grid-cols-[88px_minmax(0,1fr)_130px_20px] [&::-webkit-details-marker]:hidden">
      <span className="flex flex-wrap gap-1 max-md:col-span-2">
        <span className={cn(chip, statusChip[status as Status] ?? statusChip.review)}>{statusLabel(status, english)}</span>
        {recommendation.priority === 'high' && <span className={cn(chip, priorityChip)}>{english ? 'Priority' : '優先'}</span>}
      </span>
      <span className="min-w-0 space-y-0.5 max-md:col-start-1">
        <h4 className="break-words text-[15px] font-semibold leading-snug">{title || moduleName}</h4>
        {title && moduleName && <span className="block break-words text-[12px] text-muted-foreground">{moduleName}</span>}
        <span className="block break-words text-[13px] leading-relaxed text-foreground/80 group-open:line-clamp-none md:line-clamp-2">{text(recommendation.recommendation)}</span>
      </span>
      <span className={cn('break-words text-[13px] max-md:col-start-1', changed || today === null ? 'font-semibold text-primary' : 'text-muted-foreground')}>{todayText}</span>
      <ChevronDown className="mt-0.5 h-5 w-5 text-muted-foreground transition-transform group-open:rotate-180 max-md:col-start-2 max-md:row-start-2" aria-hidden="true" />
    </summary>
    <dl className="mb-4 space-y-3 text-[13px] leading-relaxed md:ml-[100px]">
      {text(recommendation.rationale) && <div><dt className="font-semibold">{english ? 'Rationale' : '判斷理由'}</dt><dd className="break-words text-foreground/80">{text(recommendation.rationale)}</dd></div>}
      {Array.isArray(recommendation.patientEvidence) && recommendation.patientEvidence.length > 0 && <div><dt className="sr-only">{english ? 'Patient evidence' : '病人證據'}</dt><dd><EvidenceTable value={recommendation.patientEvidence} english={english} /></dd></div>}
      {missing.length > 0 && <div><dt className="font-semibold">{english ? 'Missing data' : '缺少資料'}</dt><dd><ul className="list-inside list-disc">{missing.map((item, index) => <li key={index} className="break-words">{item}</li>)}</ul></dd></div>}
      {next.length > 0 && <div><dt className="font-semibold">{english ? 'Next actions' : '下一步'}</dt><dd><ul className="list-inside list-disc">{next.map((item, index) => <li key={index} className="break-words">{item}</li>)}</ul></dd></div>}
      {text(recommendation.safetyBoundary) && <div><dt className="font-semibold">{english ? 'Safety boundary' : '安全範圍'}</dt><dd className="break-words text-muted-foreground">{text(recommendation.safetyBoundary)}</dd></div>}
    </dl>
  </details>
}

type StorageProps = {
  /** Keep the save controller mounted when its button moves into the full-window header. */
  saveTarget?: HTMLElement | null
  onCarryForward?: (record: CdssHistoryRecord, choices: CarryForwardChoices) => number
  /** Clinician-facing disease name for a stored pack id. */
  packLabel?: (packId: string) => string | undefined
  /**
   * Whether this layout offers saving and records (owner decision 2026-10-07: not on 三區塊).
   * Kept mounted when not offered, so switching layouts neither cancels a save nor drops the FHIR grant.
   */
  offered?: boolean
  input: Omit<Parameters<typeof saveCdssSnapshot>[0], 'sourceRecords'>
  sourceRecords: () => Parameters<typeof saveCdssSnapshot>[0]['sourceRecords']; english?: boolean
}

export function CdssStorageActions(props: StorageProps) {
  // Provider loading also includes Firestore profile writes; a known account can already authorize FHIR.
  const { user } = useAuth()
  const ownerUid = user?.uid
  return <OwnedStorageActions key={JSON.stringify([props.input.patient.id, ownerUid, isDeidentifiedPatient(props.input.patient)])} {...props} ownerUid={ownerUid} />
}

function OwnedStorageActions({ input, sourceRecords, english = false, saveTarget, ownerUid, onCarryForward, packLabel, offered = true }: StorageProps & { ownerUid?: string }) {
  const enabled = useSyncExternalStore(subscribeSite, () => cdssGatewayStatus().enabled, () => false)
  const authorized = useSyncExternalStore(subscribeFhirAuth, () => fhirAuthStatus(ownerUid), () => false)
  const [authorizing, setAuthorizing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<'identity' | 'deidentified' | 'unavailable' | null>(null)
  const [history, setHistory] = useState<CdssHistoryList | null>(null)
  const [selected, setSelected] = useState<CdssHistoryRecord | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [filter, setFilter] = useState<string | null>(null)
  const [showQuiet, setShowQuiet] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [applying, setApplying] = useState(false)
  const [choices, setChoices] = useState<CarryForwardChoices>({ inputs: true, decisions: true })
  const [noLatest, setNoLatest] = useState(false)
  const [appliedFrom, setAppliedFrom] = useState<string | null>(null)
  const [deleteAsked, setDeleteAsked] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const current = useRef({ input, onCarryForward })
  useEffect(() => { current.current = { input, onCarryForward } }, [input, onCarryForward])
  const context = JSON.stringify([input.patient.name, input.patient.birthDate, input.patient.identifier, input.packId, input.result.packVersion])
  useEffect(() => {
    // Invalidate patient/pack-scoped history without disconnecting the patient-scoped FHIR grant or cancelling saves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    controller.current?.abort(); setOpen(false); setHistory(null); setSelected(null); setPendingId(null); setConfirming(false); setAppliedFrom(null)
    setNoLatest(false); setLoading(false); setApplying(false); setError(null); setFilter(null)
  }, [context])
  useEffect(() => { mounted.current = true; return () => {
    mounted.current = false; controller.current?.abort(); cancelCdssGatewayRequests(); disconnectFhir()
  } }, [])
  const deidentifiedHelp = english
    ? 'Turn off the de-identification option in the export tool, then reimport the patient data.'
    : '請取消雲抓的「去識別化」選項後，重新匯入病人資料。'
  const identityHelp = english
    ? 'Check that the patient name retains at least two recognizable letters (unrecognized source characters may appear as *; names masked with ○ are not supported), with a valid date of birth and a supported national ID: a partially masked national ID from the cloud or a full Taiwan national ID from the TVGH bridge. Hospital resident IDs and MRN-only records are not supported yet. Then reimport the data and try again.'
    : '請確認姓名至少保留兩個可辨識文字（來源未辨識字元可保留 *，但不支援含 ○ 的遮蔽姓名），並有有效出生日期與支援的身分證欄位：雲端部分遮蔽的身分證字號，或北榮懷爾抓抓的完整臺灣身分證字號。目前尚不支援院內居留證或僅有病歷號的資料。確認後重新匯入資料再試。'
  /** Opens on the newest record of the disease on screen, the one a clinician most often brings back. */
  const run = async (saveId?: string, latest = false) => {
    if (!ownerUid) return
    controller.current?.abort()
    const request = new AbortController()
    controller.current = request
    setLoading(true); setError(null); setSelected(null); setConfirming(false); setNoLatest(false); setApplying(false); setShowQuiet(false)
    setPendingId(saveId ?? null)
    if (!saveId) setHistory(null)
    try {
      if (saveId) {
        const result = await readCdssHistory(input.patient, saveId, request.signal, ownerUid)
        if (!request.signal.aborted) setSelected(result)
      } else {
        const result = await listCdssHistory(input.patient, request.signal, ownerUid)
        if (!request.signal.aborted) {
          setHistory(result)
          if (latest) {
            const item = [...result.records].filter(item => item.packId === input.packId)
              .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt))[0]
            if (item) {
              setPendingId(item.saveId)
              const detail = await readCdssHistory(input.patient, item.saveId, request.signal, ownerUid)
              if (!request.signal.aborted) setSelected(detail)
            } else setNoLatest(true)
          }
        }
      }
    } catch (failure) {
      if (!request.signal.aborted) setError(isDeidentifiedFailure(failure) ? 'deidentified' : isIdentityFailure(failure) ? 'identity' : 'unavailable')
    }
    finally { if (!request.signal.aborted) setLoading(false) }
  }
  const save = async () => {
    if (!ownerUid || saving) return
    setSaving(true)
    try {
      await saveCdssSnapshot({ ...input, ownerUid, sourceRecords: sourceRecords() })
      if (mounted.current) toast.success(english ? 'CDSS record saved.' : 'CDSS 紀錄已儲存。')
    } catch (failure) {
      if (mounted.current) {
        if (isDeidentifiedFailure(failure)) {
          toast.error(english ? 'De-identified patient data cannot be saved as a CDSS record.' : '去識別化資料無法儲存 CDSS 紀錄。',
            { description: deidentifiedHelp, duration: 10000 })
        } else if (isIdentityFailure(failure)) {
          toast.error(english ? 'Patient identification failed. CDSS record was not saved.' : '病人識別失敗，CDSS 紀錄未儲存。',
            { description: identityHelp, duration: 10000 })
        } else {
          const uncertain = cdssSaveOutcomeUncertain(failure)
          toast.error(uncertain ? (english ? 'CDSS save was not confirmed.' : 'CDSS 儲存結果未確認。')
            : (english ? 'CDSS record was not saved.' : 'CDSS 紀錄未儲存。'),
            { description: cdssSaveErrorDescription(failure, english), duration: 15000 })
        }
      }
    }
    finally { if (mounted.current) setSaving(false) }
  }
  const apply = async () => {
    if (!selected || !ownerUid || !onCarryForward || applying || (!choices.inputs && !choices.decisions)) return
    const request = new AbortController()
    controller.current?.abort(); controller.current = request
    setApplying(true)
    try {
      const [auth, identity] = await Promise.all([captureFhirRequestAuth(ownerUid), cdssPatientIdentity(input.patient)])
      if (request.signal.aborted || !mounted.current || !cdssGatewayStatus().enabled || !auth.isCurrent()
        || identity.patient_key_sha256 !== selected.save.patient_key_sha256
        || selected.save.pack_id !== input.packId || selected.save.result.packVersion !== input.result.packVersion) throw new Error('cdss_carry_forward_unavailable')
      const latest = current.current
      if (latest.input.packId !== input.packId || latest.input.result.packVersion !== input.result.packVersion) throw new Error('cdss_carry_forward_unavailable')
      const count = latest.onCarryForward?.(selected, choices) ?? 0
      if (!count) { setConfirming(false); toast.info(english ? 'No eligible empty fields. Current entries were kept.' : '沒有可補入的空白欄位，已保留目前內容。'); return }
      setAppliedFrom(selected.savedAt); setOpen(false); setConfirming(false)
      toast.success(english ? `${count} answer(s) carried forward, each marked "Carried · date". Review the recalculated guidance.` : `已帶入 ${count} 項，帶入的答案標示「帶入 · 日期」；請確認重新計算的建議。`)
    } catch {
      if (!request.signal.aborted && mounted.current) toast.error(english ? 'Could not carry forward this record. Reopen the records and try again.' : '未能帶入此紀錄，請重新開啟紀錄後再試。')
    } finally { if (mounted.current && controller.current === request) setApplying(false) }
  }
  /** Asked twice: the button, then the confirmation. The server retracts the snapshot (entered-in-error) and keeps its audit trail. */
  const remove = async () => {
    if (!selected || !ownerUid || deleting) return
    const request = new AbortController()
    controller.current?.abort(); controller.current = request
    const saveId = selected.saveId
    setDeleting(true)
    try {
      await deleteCdssHistory(input.patient, saveId, request.signal, ownerUid)
      if (request.signal.aborted || !mounted.current) return
      setHistory(current => current && { ...current, records: current.records.filter(item => item.saveId !== saveId) })
      setSelected(null); setPendingId(null); setConfirming(false); setDeleteAsked(false)
      toast.success(english ? 'Record deleted.' : '已刪除這筆紀錄。')
    } catch {
      if (!request.signal.aborted && mounted.current) toast.error(english ? 'Could not delete this record. Please try again.' : '未能刪除此紀錄，請稍後重試。')
    } finally { if (mounted.current) setDeleting(false) }
  }
  if (!enabled) return null
  const label = english ? 'CDSS records' : 'CDSS 紀錄'
  const nameOf = (packId: string) => packLabel?.(packId) ?? packId
  const result = object(selected?.save.result)
  const recommendations = Array.isArray(result.recommendations) ? result.recommendations.map(object) : []
  // Prompts that need nothing wait behind one button, unless they are all there is.
  const anyActive = recommendations.some(item => item.status !== 'no-action')
  const prominent = anyActive ? recommendations.filter(item => item.status !== 'no-action') : recommendations
  const quiet = anyActive ? recommendations.filter(item => item.status === 'no-action') : []
  const priorityCount = recommendations.filter(item => item.priority === 'high').length
  const needsDataCount = recommendations.filter(item => item.status === 'needs-data').length
  const sameDisease = selected?.save.pack_id === input.packId
  const todayById = new Map(input.result.recommendations.map(item => [item.id, item.status as string]))
  const todayOf = (item: Record<string, unknown>) => !sameDisease || typeof item.id !== 'string' ? undefined : todayById.get(item.id) ?? null
  const compatible = sameDisease && selected?.save.result.packVersion === input.result.packVersion
  const savedInputs = Object.entries(object(selected?.save.physician_inputs))
    .filter(([key, value]) => key !== 'nhiLipidReviewProvenance' && filled(value))
    .map(([key]) => (english ? fieldNamesEn : fieldNames)[key] ?? key)
  const savedDecisions = Object.values(object(selected?.save.physician_decisions)).filter(value => filled(value)).length
  const chosen = (choices.inputs ? 1 : 0) + (choices.decisions ? 1 : 0)
  const records = [...(history?.records ?? [])].sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt))
  const packs = [...new Set(records.map(item => item.packId))]
  // A filter whose disease no longer has a record (its last one deleted) falls back to all records.
  const activeFilter = filter && packs.length > 1 && packs.includes(filter) ? filter : null
  const visible = records.filter(item => !activeFilter || item.packId === activeFilter)
  const newest = new Set(packs.map(packId => records.find(item => item.packId === packId)?.saveId))
  const groups = visible.reduce<{ day: string; items: typeof visible }[]>((all, item) => {
    const day = dayOf(item.receivedAt, english)
    const last = all[all.length - 1]
    if (last?.day === day) last.items.push(item); else all.push({ day, items: [item] })
    return all
  }, [])
  const todayLabel = dayOf(new Date().toISOString(), english)
  const detailOpen = Boolean(selected || pendingId || (error && history))
  const busyDetail = loading && Boolean(history)
  // Short labels keep the controls on the disease row (owner request 2026-10-07); the full name is the accessible one.
  const saveName = !ownerUid ? english ? 'Sign in to save' : '請先登入後儲存' : saving ? english ? 'Saving…' : '儲存中…' : english ? 'Save CDSS record' : '儲存 CDSS 紀錄'
  const saveButton = <Button type="button" size="sm" variant="outline" className={toolbarButton} onClick={() => void save()} disabled={!ownerUid || saving || (fhirOAuthEnabled() && !authorized)} aria-busy={saving} data-testid="cdss-save-record"
    aria-label={saveName} title={saveName}>
      <Save className="h-3.5 w-3.5" aria-hidden="true" />
      {!ownerUid ? english ? 'Sign in' : '請先登入' : saving ? english ? 'Saving…' : '儲存中…' : english ? 'Save' : '儲存'}
    </Button>
  const appliedDetail = appliedFrom ? `${english ? 'Carried forward from: ' : '帶入來源：'}${when(storedTimestampForDisplay(appliedFrom), english)}${english ? '. Existing entries kept; guidance recalculated.' : '；保留當次已填內容，建議已重新計算。'}` : ''
  const sourceNotice = appliedFrom && <span role="status" title={appliedDetail} className="whitespace-nowrap text-[12px] text-muted-foreground">
      <span aria-hidden="true">{english ? 'Carried ' : '已帶入 '}{dayOf(storedTimestampForDisplay(appliedFrom), english).replace(/^\d{4}\//, '')}{english ? ' record' : ' 紀錄'}</span>
      <span className="sr-only">{appliedDetail}</span>
    </span>
  const authButton = fhirOAuthEnabled() && <Button type="button" size="sm" variant="outline" className={toolbarButton} disabled={!ownerUid || authorizing}
      data-testid="cdss-fhir-authorize" onClick={() => {
        if (authorized) { disconnectFhir(); return }
        setAuthorizing(true)
        void authorizeFhir(ownerUid).catch(() => { if (mounted.current) toast.error(english ? 'FHIR authorization failed. Please try again.' : 'FHIR 授權未完成，請重試。') })
          .finally(() => { if (mounted.current) setAuthorizing(false) })
      }}>{authorizing ? english ? 'Authorizing…' : '授權中…' : authorized ? english ? 'Disconnect FHIR' : '斷開 FHIR 授權' : english ? 'Authorize FHIR' : '登入 FHIR 授權'}</Button>
  const historyName = onCarryForward ? english ? 'CDSS records and carry forward' : 'CDSS 紀錄與帶入' : label
  // One door for viewing and bringing back: the records open on the newest
  // one of this disease, and any of them can be brought in from there.
  const historyButton = <Button type="button" size="sm" variant="outline" className={toolbarButton} disabled={!ownerUid || (fhirOAuthEnabled() && !authorized)}
    onClick={() => { setOpen(true); setFilter(null); void run(undefined, true) }} data-testid="cdss-history-records"
    aria-label={historyName} title={historyName}>
      <History className="h-3.5 w-3.5" aria-hidden="true" />
      {english ? 'Records' : '紀錄'}
    </Button>
  const controls = <>{authButton}{saveButton}{historyButton}{sourceNotice}</>
  const errorView = error && <div role="alert" className="space-y-2 p-4 text-sm md:p-6"><p>{error === 'deidentified'
      ? english ? 'CDSS history cannot be retrieved for de-identified patient data.' : '去識別化資料無法查詢 CDSS 歷史紀錄。'
      : error === 'identity'
      ? english ? 'Patient identification failed. CDSS history cannot be retrieved.' : '病人識別失敗，無法取得 CDSS 歷史紀錄。'
      : english ? 'Records unavailable. Please try again.' : '目前無法取得紀錄，請稍後重試。'}</p>
    {error === 'deidentified' && <p className="break-words">{deidentifiedHelp}</p>}
    {error === 'identity' && <p className="break-words">{identityHelp}</p>}
    <Button type="button" variant="outline" className="min-h-[44px]" onClick={() => void run()}>{english ? 'Retry' : '重試'}</Button></div>
  const backToList = <Button type="button" variant="outline" className="min-h-[44px] gap-1 pl-2 md:hidden" disabled={applying}
    onClick={() => { controller.current?.abort(); setLoading(false); setSelected(null); setPendingId(null); setConfirming(false); setError(null) }}>
      <ChevronLeft className="h-4 w-4" aria-hidden="true" />{english ? 'Back to records' : '返回清單'}
    </Button>

  const list = <nav aria-label={english ? 'Saved snapshots' : '快照清單'} className={cn('flex min-h-0 flex-col border-border bg-muted/40 md:border-r', detailOpen && 'max-md:hidden')}>
    {packs.length > 1 && <div role="group" aria-label={english ? 'Filter by disease' : '依疾病篩選'} className="flex flex-wrap gap-1.5 px-4 pt-3">
      {[null, ...packs].map(packId => <button key={packId ?? 'all'} type="button" aria-pressed={activeFilter === packId}
        onClick={() => setFilter(packId)} className={cn('h-8 rounded-full border px-3 text-[13px] max-md:h-11',
          activeFilter === packId ? 'border-foreground bg-foreground text-background' : 'border-border bg-background text-foreground')}>
        {packId ? nameOf(packId) : english ? 'All' : '全部'}
      </button>)}
    </div>}
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
      {records.length === 0 && <p className="px-1 text-sm text-muted-foreground">{english ? 'No saved records.' : '尚無儲存紀錄。'}</p>}
      {groups.map(group => <section key={group.day} className="space-y-1.5">
        <h3 className="px-1 text-[12px] font-semibold text-muted-foreground">{group.day === todayLabel ? `${english ? 'Today' : '今天'} · ${group.day}` : group.day}</h3>
        {group.items.map(item => {
          const current = (selected?.saveId ?? pendingId) === item.saveId
          return <button key={item.saveId} type="button" aria-current={current ? 'true' : undefined} data-testid={`cdss-history-row-${item.saveId}`}
            onClick={() => void run(item.saveId)}
            className={cn('flex min-h-[44px] w-full flex-col gap-0.5 rounded-md border px-3 py-2 text-left',
              current ? 'border-primary bg-primary/10 shadow-[inset_3px_0_0_var(--primary)]' : 'border-border bg-background hover:bg-muted')}>
            <span className="flex w-full items-baseline gap-2">
              <span className="text-[17px] font-semibold tabular-nums">{clock(item.receivedAt, english)}</span>
              <span className="min-w-0 break-words text-[14px] font-medium">{nameOf(item.packId)}</span>
              {newest.has(item.saveId) && <span className="ml-auto shrink-0 text-[12px] text-muted-foreground">{english ? 'Latest' : '最新'}</span>}
            </span>
            {item.packId !== input.packId && <span className="text-[12px] text-muted-foreground">{english ? 'Other disease · view only' : '其他疾病・僅供調閱'}</span>}
          </button>
        })}
      </section>)}
      {history?.hasMore && <p className="px-1 text-[12px] text-muted-foreground">{english ? 'Showing the 10 most recently received records.' : '目前顯示最近收到的 10 筆紀錄。'}</p>}
    </div>
  </nav>

  const detail = selected && <article className="flex min-h-0 flex-1 flex-col">
    <div className="min-h-0 flex-1 overflow-y-auto px-4 md:px-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border py-3">
        {backToList}
        <h3 className="text-[18px] font-semibold">{text(result.title) || nameOf(selected.packId)}</h3>
        <p className="text-[14px] tabular-nums text-foreground/80">{english ? 'Saved at: ' : '儲存時間：'}{when(storedTimestampForDisplay(selected.savedAt), english)}</p>
        <p className="flex items-center gap-1 rounded border border-border px-1.5 text-[12px] text-muted-foreground">
          <UserRound className="h-3.5 w-3.5" aria-hidden="true" />{english ? 'Historical snapshot · clinician identity unverified' : '歷史快照・醫師身分尚未驗證'}
        </p>
        <Button type="button" variant="outline" size="sm" className="ml-auto h-9 gap-1.5 px-2.5 text-[13px] text-destructive shadow-none max-md:h-11"
          disabled={deleting || applying} onClick={() => setDeleteAsked(true)} data-testid="cdss-history-delete">
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />{english ? 'Delete' : '刪除'}
        </Button>
      </div>
      <dl className="grid grid-cols-3 gap-2 py-3 md:gap-3">
        {([[english ? 'Prompts' : '提示', recommendations.length, ''],
          [english ? 'Priority' : '優先處理', priorityCount, priorityCount ? 'border-rose-300 bg-rose-50 dark:border-rose-500/40 dark:bg-rose-500/10' : ''],
          [english ? 'Need data' : '需補資料', needsDataCount, needsDataCount ? 'border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10' : '']] as const)
          .map(([name, count, tone]) => <div key={name} className={cn('rounded-md border border-border px-3 py-2', tone)}>
            <dt className="text-[12px] text-muted-foreground">{name}</dt><dd className="text-[24px] font-semibold leading-tight tabular-nums">{count}</dd>
          </div>)}
      </dl>
      <div className="hidden grid-cols-[88px_minmax(0,1fr)_130px_20px] gap-3 border-b border-border pb-2 text-[12px] text-muted-foreground md:grid" aria-hidden="true">
        <span>{english ? 'Then' : '當時狀態'}</span><span>{english ? 'Prompt and recommendation' : '提示與建議'}</span><span>{sameDisease ? english ? 'Today' : '今天' : ''}</span><span />
      </div>
      {prominent.map((item, index) => <SavedRecommendation key={index} value={item} english={english} today={todayOf(item)} />)}
      {quiet.length > 0 && (showQuiet
        ? quiet.map((item, index) => <SavedRecommendation key={`quiet-${index}`} value={item} english={english} today={todayOf(item)} />)
        : <Button type="button" variant="ghost" className="mt-1 min-h-[40px] px-2 text-[13px] text-primary" onClick={() => setShowQuiet(true)}>
            {english ? `Show ${quiet.length} more with no action` : `顯示其餘 ${quiet.length} 項不需處理的提示`}
          </Button>)}
      <details className="mt-3 text-sm"><summary className="min-h-[44px] cursor-pointer py-3 font-medium">{english ? 'Clinician inputs then' : '當時的人工輸入'}</summary><SavedFields value={selected.save.physician_inputs} /></details>
      <details className="mb-3 text-sm"><summary className="min-h-[44px] cursor-pointer py-3 font-medium">{english ? 'Clinician decisions then' : '當時的醫師決策'}</summary><SavedFields value={selected.save.physician_decisions} /></details>
    </div>
    {onCarryForward && <footer className="flex flex-wrap items-center gap-3 border-t border-border bg-muted/30 px-4 py-3 md:px-6">
      {compatible ? <>
        <div className="min-w-0 flex-1 basis-60">
          <p className="text-[14px] font-semibold">{english ? 'Can bring in: your inputs and decisions from then' : '可帶入：您當時的人工輸入與醫師決策'}</p>
          <p className="text-[12px] text-muted-foreground">{english ? 'Only empty fields are filled; the guidance is recalculated from today\'s record.' : '只補入目前空白的欄位；當時的判讀不帶入，建議依今天資料重新計算。'}</p>
        </div>
        <Button type="button" className="min-h-[44px] px-5 max-md:w-full" data-testid="cdss-carry-forward-review"
          onClick={() => { setChoices({ inputs: true, decisions: true }); setConfirming(true) }}>{english ? 'Bring in this record…' : '帶入這筆…'}</Button>
      </> : <p role="status" className="text-[13px] text-muted-foreground">{english ? 'Different disease or rules version. View this record for reference; it cannot be applied.' : '疾病或指引版本不同，此紀錄僅供調閱，無法帶入。'}</p>}
    </footer>}
  </article>

  const confirm = selected && <section aria-labelledby="cdss-carry-title" className="flex min-h-0 flex-1 flex-col">
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 md:px-6">
      <Button type="button" variant="outline" className="min-h-[44px] gap-1 pl-2" disabled={applying} onClick={() => setConfirming(false)}>
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />{english ? 'Back to record' : '返回紀錄'}
      </Button>
      <h3 id="cdss-carry-title" className="text-[18px] font-semibold">
        {english ? 'Bring in ' : '帶入 '}{text(result.title) || nameOf(selected.packId)} · {when(storedTimestampForDisplay(selected.savedAt), english)}
      </h3>
      <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[13px] leading-relaxed">{english ? 'Confirm the previous answers still apply. Only empty fields are filled, and each carried answer is marked "Carried · date" until you change it. Measurement and decision dates stay unchanged; current record measurements take precedence. Not carried: dyspnoea and weight since last visit, dyspnoea today (answer these every visit), manually entered lab values, PREVENT values other than smoking and family history (today\'s record is used), and AI answers.' : '請確認上次回答仍適用。只補入目前空白的欄位，帶入的答案會標示「帶入 · 日期」，改答後標示消失；量測與決策保留原日期，今天病歷已有的量測優先。不帶入：喘比上次、體重比上次、今天有沒有喘（每次重新填）、手動輸入的檢驗值、吸菸與家族史以外的 PREVENT 數值（改用今天病歷）與 AI 回答。'}</p>
      {([['inputs', english ? 'Manual inputs (measurements, NYHA, signs, visit answers, AF, evidence selections, PREVENT smoking and family history)' : '人工輸入（量測、NYHA、徵候、本次問診、AF、證據勾選、PREVENT 吸菸與家族史）',
          savedInputs.length ? savedInputs.join(english ? ', ' : '、') : english ? 'Nothing saved' : '當時沒有填寫'],
        ['decisions', english ? 'Previous decisions, reasons and notes (original dates)' : '上次決策、理由與備註（保留原日期）',
          savedDecisions ? english ? `${savedDecisions} decision(s)` : `${savedDecisions} 項決策` : english ? 'Nothing saved' : '當時沒有決策']] as const)
        .map(([key, name, detailText]) => <label key={key} className={cn('flex min-h-[44px] cursor-pointer items-start gap-3 rounded-md border px-4 py-3',
          choices[key] ? 'border-primary bg-primary/5' : 'border-border')}>
          <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--primary)]" checked={choices[key]}
            onChange={event => setChoices(current => ({ ...current, [key]: event.target.checked }))} />
          <span className="min-w-0 space-y-1"><span className="block text-[15px] font-semibold">{name}</span>
            <span className="block break-words text-[13px] text-muted-foreground">{detailText}</span></span>
        </label>)}
    </div>
    <footer className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/30 px-4 py-3 md:px-6">
      <span className="mr-auto text-[14px]">{english ? `${chosen} of 2 selected` : `已選 ${chosen} / 2 組`}</span>
      <Button type="button" variant="outline" className="min-h-[44px]" disabled={applying} onClick={() => setConfirming(false)}>{english ? 'Cancel' : '取消'}</Button>
      <Button type="button" className="min-h-[44px] px-5" disabled={applying || !chosen} data-testid="cdss-carry-forward-confirm" onClick={() => void apply()}>
        {applying ? english ? 'Applying…' : '帶入中…' : english ? `Bring in ${chosen}` : `帶入 ${chosen} 組`}
      </Button>
    </footer>
  </section>

  const preview = <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', !detailOpen && 'max-md:hidden')}>
    {error ? <>{<div className="px-4 pt-3">{backToList}</div>}{errorView}</>
      : busyDetail ? <div className="p-4 md:p-6">{backToList}<p role="status" className="py-3 text-sm">{english ? 'Loading…' : '載入中…'}</p></div>
      : selected ? confirming && onCarryForward && compatible ? confirm : detail
      : <p role="status" className="p-6 text-sm text-muted-foreground">{noLatest
          ? english ? 'No record for this disease in the latest 10 saves. Choose a record to view it.' : '最近 10 筆儲存中沒有此疾病的紀錄；可選左側紀錄調閱。'
          : english ? 'Choose a record to view it.' : '選一筆紀錄查看當時的提示。'}</p>}
  </div>

  return <div className="flex min-w-0 flex-wrap items-center gap-1" data-testid="cdss-record-toolbar">
    {!offered ? null : saveTarget ? createPortal(controls, saveTarget) : controls}
    <Dialog open={open && offered} onOpenChange={value => { setOpen(value); if (!value) { controller.current?.abort(); setApplying(false); setConfirming(false) } }}>
      {/* Above the full-window handbook (its layer is 60), where the buttons also live. */}
      <DialogContent className="z-[70] flex h-[min(90dvh,780px)] max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl" overlayClassName="z-[70]" showCloseButton={false}
        // Opened from the full-window handbook, focus can land back on its header button;
        // that must not close the records. Esc closes only the records, not the handbook under them.
        onFocusOutside={event => event.preventDefault()} onEscapeKeyDown={event => event.stopPropagation()}>
        <header className="flex items-start gap-3 border-b border-border px-4 py-3 md:px-6 md:py-4">
          <div className="min-w-0 flex-1 space-y-1">
            <DialogTitle className="text-[20px]">{label}</DialogTitle>
            <DialogDescription className="text-[13px]">{onCarryForward
              ? english ? 'Pick a snapshot to see its prompts, then decide whether to bring your inputs back. Viewing leaves the current assessment unchanged.' : '選一筆查看當時的提示，再決定要不要帶回您當時的輸入；調閱時保留目前的評估。'
              : english ? 'Your saved snapshots for this patient. Viewing leaves the current assessment unchanged.' : '您為此病人儲存的快照；調閱時保留目前的評估。'}</DialogDescription>
          </div>
          <Button type="button" variant="outline" size="icon" className="h-11 w-11 shrink-0 md:h-9 md:w-9" aria-label={english ? 'Close' : '關閉'}
            onClick={() => { setOpen(false); controller.current?.abort() }}><X className="h-[18px] w-[18px]" aria-hidden="true" /></Button>
        </header>
        {!history ? loading ? <p role="status" className="p-6 text-sm">{english ? 'Loading…' : '載入中…'}</p> : errorView
          : <div className="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[300px_minmax(0,1fr)]">{list}{preview}</div>}
      </DialogContent>
    </Dialog>
    <AlertDialog open={deleteAsked && Boolean(selected) && offered} onOpenChange={value => { if (!deleting) setDeleteAsked(value) }}>
      <AlertDialogContent data-testid="cdss-history-delete-confirm" className="z-[80]" overlayClassName="z-[80]" onEscapeKeyDown={event => event.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>{english ? 'Delete this record?' : '確定要刪除這筆紀錄嗎？'}</AlertDialogTitle>
          <AlertDialogDescription>
            {selected ? `${text(result.title) || nameOf(selected.packId)} · ${when(storedTimestampForDisplay(selected.savedAt), english)}` : ''}
            {english
              ? '. It will no longer appear in the records and cannot be carried forward. Answers already carried into today stay as they are.'
              : '。刪除後不會再出現在紀錄清單，也無法再帶入；已經帶入今天的答案不受影響。'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="min-h-[44px]" disabled={deleting}>{english ? 'Cancel' : '取消'}</AlertDialogCancel>
          <Button type="button" variant="destructive" className="min-h-[44px]" disabled={deleting} aria-busy={deleting}
            onClick={() => void remove()} data-testid="cdss-history-delete-confirm-button">
            {deleting ? english ? 'Deleting…' : '刪除中…' : english ? 'Delete' : '刪除'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
}
