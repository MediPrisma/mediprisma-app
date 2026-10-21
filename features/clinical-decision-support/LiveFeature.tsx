"use client"
import { ClinicalRecordVariantsNotice } from './renderers/ClinicalRecordVariantsNotice'

import { usePreventInputs, usePreventStore } from './stores/prevent-inputs.store'
import { buildPreventReading, applyPreventReading } from './utils/prevent-reading'
import { PreventReadingContext } from './renderers/PreventRiskSummary'


import { useEffect, useMemo, useState } from 'react'
import { FileSearch, RotateCcw, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useClinicalData } from '@/src/application/hooks/clinical-data/use-clinical-data-query.hook'
import { usePatient } from '@/src/application/hooks/patient/use-patient-query.hook'
import { hfFollowUpHistory } from './utils/hf-follow-up'
import { useLanguage } from '@/src/application/providers/language.provider'
import { createHospitalAwareCdssPatientProfile } from './utils/hospital-medication-profile'
import { buildHospitalAwareCdssResult } from './utils/hospital-medication-review'
import { HospitalMedicationReview } from './renderers/HospitalMedicationReview'
import {
  getApplicableClinicalGuidelinePacks,
  getDefaultClinicalGuidelinePack,
  getEnabledClinicalGuidelinePacks,
} from './guideline-packs/registry'
import { ClinicalHandoffCard } from './renderers/ClinicalHandoffCard'
import { ClinicalDecisionSupportView } from './renderers/ClinicalDecisionSupportView'
import { VisitBookChromeContext, isVisitBookMode } from './renderers/visit/visit-book-chrome'
import {
  useNhiLipidReview,
  useNhiLipidReviewProvenance,
  useNhiLipidReviewStore,
} from './stores/nhi-lipid-review.store'
import { selectNhiLipidAiCriteria } from './ai/nhi-lipid-ai-assist'
import { useNhiLipidAiAssist } from './hooks/use-nhi-lipid-ai-assist.hook'
import {
  useEvidenceOverrides,
  useEvidenceOverridesHydrated,
  useEvidenceOverridesStore,
} from './stores/evidence-overrides.store'
import {
  useClinicVitals,
  useClinicVitalsHydrated,
  useClinicVitalsStore,
} from './stores/clinic-vitals.store'
import {
  useHfpefInputs,
  useHfpefInputsHydrated,
  useHfpefInputsStore,
} from './stores/hfpef-inputs.store'
import {
  usePhenotypeAnswer,
  usePhenotypeAnswerHydrated,
  usePhenotypeAnswerStore,
} from './stores/phenotype-answer.store'
import {
  usePhysicianDecisions,
  usePhysicianDecisionsHydrated,
  usePhysicianDecisionsStore,
} from './stores/physician-decisions.store'
import {
  AF_SWITCHABLE_LAYOUTS,
  CDSS_SWITCHABLE_LAYOUTS,
  LIPID_SWITCHABLE_LAYOUTS,
  RETIRED_LAYOUTS,
  defaultLayoutFor,
  type CdssLayout,
  useCdssLayoutStore,
} from './stores/layout-preference.store'
import {
  useVisitAnswerRecord,
  useVisitAnswersHydrated,
  useVisitAnswersStore,
  visitAnswerSourcesOf,
  visitAnswersOf,
} from './stores/visit-answers.store'
import { applyFmtIntolerance, applyPreviousVisit, applyVisitAnswers, buildVisitModel, hasVisitMap, visitMapOf } from './renderers/visit/visit-model.source'
import { intolerantPillars } from './renderers/visit/visit-decisions'
import type { VisitAnswerProvenance } from './renderers/visit/VisitAsks'
import { useAfAnswers, useAfAnswersHydrated, useAfAnswersStore } from './stores/af-answers.store'
import { useCoronaryPhaseAnswer, useCoronaryPhaseHydrated, useCoronaryPhaseStore } from './stores/coronary-phase.store'
import { useLocalDay } from './hooks/use-local-day.hook'
import { HEART_FAILURE_PACK_ID } from './renderers/heart-failure-board'
import { useLabAutofill } from '@/features/medical-calculator/hooks/use-lab-autofill.hook'
import { applyClinicVitals } from './utils/apply-clinic-vitals'
import { applyPhenotypeAnswer } from './utils/apply-phenotype-answer'
import { applyAfCalculatorResults } from './utils/af-calculators'
import { applyHfpefReading, buildHfpefReading } from './utils/hfpef-scores'
import type { CdssLocale, CdssResult, ClinicalGuidelinePack } from './types'
import { CdssStorageActions } from './renderers/CdssStorageActions'
import { carryableAnswers, carryForwardCdss } from './telemetry/cdss-carry-forward'
import { carriedFrom, staleCarriedKeys, useCarriedAnswers, useCarriedAnswersStore } from './stores/carried-answers.store'
import { CarriedAnswerContext, type CarriedLookup } from './renderers/visit/carried-answer-context'
import { cdssSourceRecords } from './telemetry/source-records'
import { useCdssGateway } from './telemetry/use-cdss-gateway'
import { recordCdssEvent } from './telemetry/cdss-gateway'

const AF_PACK_ID = 'atrial-fibrillation-cdss'
const LIPID_PACK_ID = 'hyperlipidemia-cdss'

function LoadingState({ locale }: { locale: CdssLocale }) {
  return (
    <div
      className="@container mx-auto w-full max-w-[84rem] animate-pulse space-y-3 py-1"
      aria-label={locale === 'en' ? 'Building clinical decision support' : '正在整理臨床決策支援'}
    >
      <div className="h-5 w-32 rounded bg-muted" />
      <div className="h-8 w-2/3 rounded bg-muted" />
      <div className="h-24 rounded-lg border border-border bg-muted/20" />
      <div className="h-36 rounded-lg border border-border bg-muted/20" />
    </div>
  )
}

function StateMessage({
  locale,
  title,
  body,
}: {
  locale: CdssLocale
  title: string
  body: string
}) {
  return (
    <section
      className="@container mx-auto w-full max-w-[84rem] rounded-lg border border-border bg-background p-4"
      role="status"
      data-testid="clinical-decision-support-state"
    >
      <div className="flex gap-3">
        <FileSearch className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
          <p className="mt-2 flex items-center gap-1.5 text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
            {locale === 'en'
              ? 'Missing data is treated as unknown, never as a negative finding.'
              : '缺少資料一律視為未知，不會轉成陰性結果。'}
          </p>
        </div>
      </div>
    </section>
  )
}

function DiseaseSwitcher({
  locale,
  packs,
  applicablePackIds,
  selectedPackId,
  onSelect,
}: {
  locale: CdssLocale
  packs: readonly ClinicalGuidelinePack[]
  applicablePackIds: ReadonlySet<string>
  selectedPackId: string
  onSelect: (packId: string) => void
}) {
  const isEnglish = locale === 'en'
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="cdss-disease-switch"
    >
      {/* The switch itself names the diseases, and dims the ones this record
          does not activate; the count is read out, not printed. */}
      <span className="sr-only">
        {isEnglish
          ? `Disease (${applicablePackIds.size} applicable)`
          : `疾病（${applicablePackIds.size} 項適用）`}
      </span>
      <div
        className="inline-flex rounded-md border border-border bg-muted/30 p-0.5"
        role="group"
        aria-label={isEnglish ? 'Select disease guidance' : '選擇疾病指引'}
      >
        {packs.map((pack) => {
          const selected = pack.id === selectedPackId
          // Non-applicable pathways stay reachable but are dimmed, so the
          // clinician can see at a glance which ones this record activates
          // instead of clicking through every disease to find out.
          const applicable = applicablePackIds.has(pack.id)
          // A pack in this list that the package has not released is here
          // because the pilot gate let it through for this browser. Say so, so
          // a tester never mistakes it for generally available guidance.
          const pilot = !pack.enabled
          return (
            <button
              key={pack.id}
              type="button"
              className={[
                'inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition-colors',
                selected
                  ? 'bg-background text-foreground shadow-sm'
                  : applicable
                    ? 'text-muted-foreground hover:text-foreground'
                    : 'text-muted-foreground/50 hover:text-muted-foreground',
              ].join(' ')}
              aria-pressed={selected}
              title={applicable
                ? undefined
                : isEnglish
                  ? 'This record does not activate the pathway'
                  : '本次資料未啟動此路徑'}
              data-testid={`cdss-disease-switch-${pack.id}`}
              data-applicable={applicable ? 'true' : 'false'}
              data-pilot={pilot ? 'true' : undefined}
              onClick={() => onSelect(pack.id)}
            >
              {pack.label[isEnglish ? 'en' : 'zh']}
              {pilot && (
                <span
                  className="rounded-sm bg-amber-500/15 px-1 py-px text-[0.9em] font-normal text-amber-700 dark:text-amber-400"
                  data-testid={`cdss-disease-switch-pilot-${pack.id}`}
                >
                  {isEnglish ? 'Pilot' : '試辦'}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * The available layouts, side by side in the header so
 * a pilot user can flip between them on the same patient. Same pack, same
 * result; only the placement differs.
 */
function LayoutSwitcher({
  locale,
  layout,
  packId,
  mapAvailable,
  onSelect,
}: {
  locale: CdssLocale
  layout: CdssLayout
  packId: string
  /** Whether the pack produced a decision map for this record. */
  mapAvailable: boolean
  onSelect: (layout: CdssLayout) => void
}) {
  const isEnglish = locale === 'en'
  const labels: Record<'map' | 'sections' | 'nhi', { label: string; title: string }> = {
    // The first decision map was retired on 2026-10-01; v2 kept its name.
    map: {
      label: isEnglish ? 'Decision map v2' : '決策地圖 v2',
      title: isEnglish
        ? 'The decision map as a pocket-handbook page: the map on the left, each point once on the right'
        : '口袋手冊版面：左邊決策地圖，右邊每個決策點寫一次',
    },
    sections: {
      label: isEnglish ? 'Three sections' : '三區塊',
      title: isEnglish ? 'Diagnosis / condition follow-up, treatment and prognosis' : '診斷／病況追蹤、治療與預後；展開模組查看依據',
    },
    nhi: {
      label: isEnglish ? 'NHI Table 1' : '健保表一',
      title: isEnglish
        ? 'Review the NHI lipid tier, supporting criteria and treatment response'
        : '核對健保血脂分級、支持條件與治療反應',
    },
  }
  const layoutIds = (packId === LIPID_PACK_ID
    ? LIPID_SWITCHABLE_LAYOUTS
    : packId === AF_PACK_ID
      ? AF_SWITCHABLE_LAYOUTS
      : CDSS_SWITCHABLE_LAYOUTS
  ).filter((id) => id !== 'map' || mapAvailable)
  const options = layoutIds.map((id) => ({ id, ...labels[id as keyof typeof labels] }))
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="cdss-layout-switch">
      <span className="sr-only">
        {isEnglish ? 'View' : '畫面'}
      </span>
      <div
        className="inline-flex rounded-md border border-border bg-muted/30 p-0.5"
        role="group"
        aria-label={isEnglish ? 'Choose the guidance layout' : '選擇指引畫面'}
      >
        {options.map((option) => {
          const selected = option.id === layout
          return (
            <button
              key={option.id}
              type="button"
              className={[
                'inline-flex items-center rounded px-2.5 py-1 text-xs font-medium transition-colors',
                selected ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              ].join(' ')}
              aria-pressed={selected}
              title={option.title}
              data-testid={`cdss-layout-switch-${option.id}`}
              onClick={() => onSelect(option.id)}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function LiveClinicalDecisionSupportFeature({
  previousCdssVisit,
}: {
  /**
   * The date of the last visit this CDSS recorded for the patient, when a
   * store hands one in. None yet: every visit is the system's first, which
   * shows the baseline work-up and asks the diagnosis (clinician decision
   * 2026-09-28). The scenario harness passes one for a returning patient.
   */
  previousCdssVisit?: string
}) {
  const { patient, loading: patientLoading, error: patientError } = usePatient()
  const clinicalData = useClinicalData()
  const { autofill } = useLabAutofill()
  const { locale } = useLanguage()
  const cdssLocale: CdssLocale = locale === 'en' ? 'en' : 'zh-TW'
  const guidelinePacks = useMemo(() => getEnabledClinicalGuidelinePacks(), [])
  const [requestedPackId, setRequestedPackId] = useState<string | null>(null)
  // `?visit=book` opens the decision map over the whole window, where the map is the layout.
  const [urlBookMode] = useState(isVisitBookMode)
  // 決策地圖 v2 opened over the whole window from the panel; a new page load opens it in the panel.
  const [bookFullWindow, setBookFullWindow] = useState(false)
  const [bookSaveTarget, setBookSaveTarget] = useState<HTMLDivElement | null>(null)
  const [nhiPageResetKey, setNhiPageResetKey] = useState(0)

  const patientId = patient?.id
  const nhiLipidReview = useNhiLipidReview(patientId)
  const nhiLipidReviewProvenance = useNhiLipidReviewProvenance(patientId)
  const preventInputs = usePreventInputs(patientId)
  const afAnswers = useAfAnswers(patientId)
  useEffect(() => { useAfAnswersStore.getState().setPatient(patientId) }, [patientId])
  const coronaryPhaseAnswer = useCoronaryPhaseAnswer(patientId)
  useEffect(() => { useCoronaryPhaseStore.getState().setPatient(patientId) }, [patientId])
  const evidenceOverrides = useEvidenceOverrides(patientId)
  const hydrateEvidenceOverrides = useEvidenceOverridesStore((state) => state.hydrate)
  const clearEvidenceOverrides = useEvidenceOverridesStore((state) => state.clearOverrides)
  const clinicVitals = useClinicVitals(patientId)
  const setClinicVitals = useClinicVitalsStore((state) => state.setVitals)
  const clearClinicVitals = useClinicVitalsStore((state) => state.clearVitals)
  const hydrateClinicVitals = useClinicVitalsStore((state) => state.hydrate)
  const physicianDecisions = usePhysicianDecisions(patientId)
  const recordPhysicianDecision = usePhysicianDecisionsStore((state) => state.recordDecision)
  const clearPhysicianDecision = usePhysicianDecisionsStore((state) => state.clearDecision)
  const clearPhysicianDecisions = usePhysicianDecisionsStore((state) => state.clearDecisions)
  const hydratePhysicianDecisions = usePhysicianDecisionsStore((state) => state.hydrate)
  const hfpefInputs = useHfpefInputs(patientId)
  const setHfpefInputs = useHfpefInputsStore((state) => state.setInputs)
  const clearHfpefInputs = useHfpefInputsStore((state) => state.clearInputs)
  const hydrateHfpefInputs = useHfpefInputsStore((state) => state.hydrate)
  const phenotypeAnswer = usePhenotypeAnswer(patientId)
  const setPhenotypeAnswer = usePhenotypeAnswerStore((state) => state.setAnswer)
  const clearPhenotypeAnswer = usePhenotypeAnswerStore((state) => state.clearAnswer)
  const hydratePhenotypeAnswer = usePhenotypeAnswerStore((state) => state.hydrate)
  const layout = useCdssLayoutStore((state) => state.layout)
  const setLayout = useCdssLayoutStore((state) => state.setLayout)
  const visitAnswerRecord = useVisitAnswerRecord(patientId)
  // Today's answers only, and 「today」 turns at midnight on an open page too.
  const today = useLocalDay()
  const visitAnswers = useMemo(() => visitAnswersOf(visitAnswerRecord, today), [today, visitAnswerRecord])
  // Where each of today's answers was given, named as the disease switcher
  // names that page.
  const visitAnswerSources = useMemo((): VisitAnswerProvenance => {
    const sources = visitAnswerSourcesOf(visitAnswerRecord, today)
    return Object.fromEntries(Object.entries(sources).map(([id, source]) => {
      const pack = source?.packId ? guidelinePacks.find((candidate) => candidate.id === source.packId) : undefined
      return [id, { ...source, ...(pack ? { pageLabel: pack.label[cdssLocale === 'en' ? 'en' : 'zh'] } : {}) }]
    }))
  }, [cdssLocale, guidelinePacks, today, visitAnswerRecord])
  const hydrateVisitAnswers = useVisitAnswersStore((state) => state.hydrate)
  const answerVisitAsk = useVisitAnswersStore((state) => state.answer)
  const clearVisitAnswers = useVisitAnswersStore((state) => state.clearAnswers)
  // Answers brought in from a saved record carry 「帶入 · 日期」 while they still hold the carried value.
  const carriedAnswers = useCarriedAnswers(patientId)
  useEffect(() => { if (patientId) useCarriedAnswersStore.getState().hydrate(patientId) }, [patientId])
  const carriedLookup = useMemo((): CarriedLookup => {
    if (!patientId || !Object.keys(carriedAnswers.marks).length) return () => null
    const current = carryableAnswers(patientId, new Date(), 'held')
    return (key) => carriedFrom(carriedAnswers, key, current[key])
    // The answers it compares against are read from their stores; these are what change them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, carriedAnswers, clinicVitals, visitAnswers, afAnswers, evidenceOverrides, preventInputs, physicianDecisions, hfpefInputs, nhiLipidReview, today])

  // Reading an answer back is a decryption, so it is asynchronous. 「沒作答」
  // and 「還沒讀到」 render identically and mean opposite things, so the
  // guidance waits here rather than drawing every question unanswered and
  // jumping when the reads land. A chart with nothing stored resolves in the
  // same tick, so a first visit never sees this.
  const answersHydrated = [
    useClinicVitalsHydrated(patientId),
    usePhysicianDecisionsHydrated(patientId),
    useHfpefInputsHydrated(patientId),
    usePhenotypeAnswerHydrated(patientId),
    useVisitAnswersHydrated(patientId),
    useAfAnswersHydrated(patientId),
    useCoronaryPhaseHydrated(patientId),
    useEvidenceOverridesHydrated(patientId),
  ].every(Boolean)
  // A carried answer the clinician changed or cleared is theirs from then on: its mark goes
  // for good, so putting the same value back does not bring 「帶入」 back. Only once every
  // answer has been read back, so an answer still decrypting is not taken for a cleared one.
  const carriedHydrated = useCarriedAnswersStore((state) => !patientId || Boolean(state.hydratedPatientIds[patientId]))
  useEffect(() => {
    if (!patientId || !answersHydrated || !carriedHydrated || !Object.keys(carriedAnswers.marks).length) return
    const stale = staleCarriedKeys(carriedAnswers, carryableAnswers(patientId, new Date(), 'held'))
    if (stale.length) useCarriedAnswersStore.getState().unmark(patientId, stale)
  }, [patientId, answersHydrated, carriedHydrated, carriedAnswers, carriedLookup])

  // The switches this physician set on this chart survive a reload of the tab,
  // so they are read back before the cards are shown rather than after.
  useEffect(() => {
    if (patientId) hydrateEvidenceOverrides(patientId)
  }, [hydrateEvidenceOverrides, patientId])

  // What this physician answered on the phenotype gate for this chart, read
  // back before the pack runs so the answer selects the pathway rather than
  // arriving after the cards were built.
  useEffect(() => {
    if (patientId) hydratePhenotypeAnswer(patientId)
  }, [hydratePhenotypeAnswer, patientId])

  // Last visit's measurements, answers and decisions, for the same reason: an
  // answer read back after the cards were built is an answer the cards ignored.
  useEffect(() => {
    if (patientId) hydrateClinicVitals(patientId)
  }, [hydrateClinicVitals, patientId])

  useEffect(() => {
    if (patientId) hydratePhysicianDecisions(patientId)
  }, [hydratePhysicianDecisions, patientId])

  useEffect(() => {
    if (patientId) hydrateHfpefInputs(patientId)
  }, [hydrateHfpefInputs, patientId])

  // Today's answers to the every-visit questions, for the same reason again:
  // the pack reads them as facts.
  // Again when the day turns, so an answer from an earlier day leaves storage too.
  useEffect(() => {
    if (patientId) hydrateVisitAnswers(patientId)
  }, [hydrateVisitAnswers, patientId, today])

  // The chart half of the profile: expensive, and independent of the switches.
  // Rebuild on a new local day, but read a fresh instant on every chart refresh
  // or patient switch so same-day records are never compared with an old clock.
  const recordProfile = useMemo(() => {
    if (!patient) return null
    return createHospitalAwareCdssPatientProfile({
      now: new Date(),
      patient,
      conditions: clinicalData.conditions,
      encounters: clinicalData.encounters,
      observations: clinicalData.observations,
      medications: clinicalData.medications,
      allergies: clinicalData.allergies,
      carePlans: clinicalData.carePlans,
      procedures: clinicalData.procedures,
      immunizations: clinicalData.immunizations,
      // Report narrative is structured evidence too: a chest film's conclusion
      // and a discharge summary's physical examination each state findings the
      // structured record does not otherwise carry.
      diagnosticReports: clinicalData.diagnosticReports,
      documentReferences: clinicalData.documentReferences,
    })
    // The local day invalidates the clock; every rebuild takes a fresh instant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    today,
    clinicalData.conditions,
    clinicalData.encounters,
    clinicalData.medications,
    clinicalData.allergies,
    clinicalData.observations,
    clinicalData.carePlans,
    clinicalData.procedures,
    clinicalData.immunizations,
    clinicalData.diagnosticReports,
    clinicalData.documentReferences,
    patient,
  ])

  // Toggling a row re-enters the pack through the profile, so a module's status
  // follows what the physician left standing. Nothing patches a rendered card.
  // The vitals measured in the room travel the same way: as facts on the
  // profile, so every module that reads them recomputes.
  // Nothing answer-dependent is built until every answer has been read back:
  // the loading state hides it anyway, and a pack run on the record's defaults
  // while the answers decrypt would be thrown away when they land. The record
  // half above does not wait; it needs no answer, and is ready when they are.
  const answeredProfile = useMemo(() => (
    recordProfile && answersHydrated
      ? { ...applyPhenotypeAnswer(
          applyClinicVitals({
            ...recordProfile,
            evidenceOverrides,
            afClinicalAnswers: afAnswers,
            ...(coronaryPhaseAnswer ? { coronaryPhaseAnswer } : {}),
          }, clinicVitals),
          phenotypeAnswer,
        ),
        nhiLipidReview,
        nhiLipidReviewProvenance: Object.fromEntries(
          Object.entries(nhiLipidReviewProvenance).map(([criterionId, provenance]) => [
            criterionId,
            {
              source: provenance.source,
              ...(provenance.runId ? { runId: provenance.runId } : {}),
              ...(provenance.inputSignature ? { inputSignature: provenance.inputSignature } : {}),
              ...(provenance.sourceScopeSignature ? { sourceScopeSignature: provenance.sourceScopeSignature } : {}),
              ...(provenance.promptVersion ? { promptVersion: provenance.promptVersion } : {}),
            },
          ]),
        ),
      }
      : null
  ), [afAnswers, answersHydrated, clinicVitals, coronaryPhaseAnswer, evidenceOverrides, phenotypeAnswer, recordProfile, nhiLipidReview, nhiLipidReviewProvenance])

  // The HFpEF scores are computed here, once, by the host's own calculator —
  // reading the echo report, the ECG and what the clinician typed — and handed
  // to the pack as facts. The clinic measurements are applied first because the
  // BMI H₂FPEF weighs most is derived from the height and weight taken in the
  // room, and the phenotype answer because the LVEF decides whether the scores
  // are read at all.
  const hfpefReading = useMemo(() => (
    answeredProfile
      ? buildHfpefReading({
        profile: answeredProfile,
        autofill,
        ...(hfpefInputs ? { inputs: hfpefInputs } : {}),
      })
      : undefined
  ), [answeredProfile, autofill, hfpefInputs])

  const preventReading = useMemo(() => answeredProfile ? buildPreventReading(answeredProfile, autofill, preventInputs, clinicVitals) : undefined, [answeredProfile, autofill, preventInputs, clinicVitals])
  // The every-visit answers enter last, as the pack's own facts
  // (`applyVisitAnswers`), so 「喘變差」 changes the recommendation it bears on
  // on every layout, not only on the map where it was asked. A pillar the
  // clinician marked 「不耐受」 travels the same way, for DP-19, and so does a
  // stored previous visit, which makes this one a follow-up.
  const intolerant = useMemo(() => intolerantPillars(physicianDecisions), [physicianDecisions])
  const profile = useMemo(() => (
    answeredProfile
      ? applyPreviousVisit(
        applyFmtIntolerance(
          applyVisitAnswers(
            applyAfCalculatorResults(applyPreventReading(applyHfpefReading(answeredProfile, hfpefReading), preventReading)),
            visitAnswers,
          ),
          intolerant,
        ),
        previousCdssVisit,
      )
      : null
  ), [answeredProfile, hfpefReading, intolerant, preventReading, previousCdssVisit, visitAnswers])

  const applicablePacks = useMemo(() => (
    profile ? getApplicableClinicalGuidelinePacks(profile) : []
  ), [profile])
  const applicablePackIds = useMemo(
    () => new Set(applicablePacks.map((pack) => pack.id)),
    [applicablePacks],
  )

  // Opening on a pathway this record cannot activate made the clinician click
  // through every disease to find the ones that apply, so the first applicable
  // pack wins until a disease is chosen explicitly.
  const selectedPack = (requestedPackId
    ? guidelinePacks.find((pack) => pack.id === requestedPackId)
    : undefined)
    ?? applicablePacks[0]
    ?? getDefaultClinicalGuidelinePack()

  useCdssGateway({ patientId, packId: selectedPack?.id ?? 'unknown', ready: answersHydrated })

  const result = useMemo(() => {
    if (!profile) return null
    return selectedPack.applies(profile)
      ? buildHospitalAwareCdssResult(selectedPack, profile, cdssLocale)
      : null
  }, [cdssLocale, profile, selectedPack])

  const englishResult = useMemo(() => {
    if (cdssLocale === 'en') return result
    return profile && selectedPack.applies(profile)
      ? buildHospitalAwareCdssResult(selectedPack, profile, 'en') : null
  }, [cdssLocale, profile, result, selectedPack])

  // The layout this browser chose, or — when it never chose — the pack's own
  // default: the decision map wherever the pack declares one (heart failure
  // and atrial fibrillation today).
  // A retired layout (新版流程, 原版看板) stored before it went reads as no choice.
  const preferredLayout: CdssLayout = layout && !RETIRED_LAYOUTS.includes(layout) ? layout : defaultLayoutFor(selectedPack.id)
  const wantsMap = preferredLayout === 'map' && hasVisitMap(selectedPack.id)

  // A map can read other packs' results beside the page's own — the pack
  // names them (`VisitMapDefinition.companions`): on the heart-failure page,
  // atrial fibrillation's anticoagulation and rate/rhythm points (DP-14,
  // DP-28). Each is built only when that pack is visible here and applies to
  // this record, and a failure there leaves the page's own map as it is.
  const companionPacks = useMemo((): readonly ClinicalGuidelinePack[] => {
    if (!wantsMap) return []
    return (visitMapOf(selectedPack.id)?.companions ?? [])
      .flatMap((id) => guidelinePacks.filter((pack) => pack.id === id))
  }, [guidelinePacks, selectedPack.id, wantsMap])
  const companionResults = useMemo((): readonly CdssResult[] => {
    if (!profile || !result || result.packId !== selectedPack.id) return []
    return companionPacks.flatMap((pack) => {
      try {
        return pack.applies(profile)
          ? [buildHospitalAwareCdssResult(pack, profile, cdssLocale)] : []
      } catch (error) {
        if (process.env.NODE_ENV !== 'production') {
          console.error(`[cdss] companion ${pack.id} could not be built`, error)
        }
        return []
      }
    })
  }, [cdssLocale, companionPacks, profile, result, selectedPack.id])

  // The same companions in English, beside the page's own English build, so
  // an AF card opened on the heart-failure page copies its rationale in English.
  const englishCompanionResults = useMemo((): readonly CdssResult[] => {
    if (!profile || companionResults.length === 0) return []
    if (cdssLocale === 'en') return companionResults
    return companionResults.flatMap((companion) => {
      const pack = companionPacks.find((candidate) => candidate.id === companion.packId)
      try {
        return pack ? [buildHospitalAwareCdssResult(pack, profile, 'en')] : []
      } catch {
        return []
      }
    })
  }, [cdssLocale, companionPacks, companionResults, profile])

  const visitModel = useMemo(() => {
    if (!wantsMap || !profile || !result || !hasVisitMap(result.packId)) return undefined
    return buildVisitModel({
      packId: result.packId,
      result,
      profile,
      companions: Object.fromEntries(companionResults.map((companion) => [companion.packId, companion])),
      locale: cdssLocale,
    })
  }, [cdssLocale, companionResults, profile, result, wantsMap])

  // Keep the AI scope watcher mounted for the whole clinical workspace. A
  // chart revision must retire AI-derived tiering even while another lipid
  // layout is open; the Table 1 panel is only one view of the same profile.
  const nhiCoverageSummary = result?.packId === 'hyperlipidemia-cdss'
    ? result.recommendations.find((item) => item.id === 'dyslipidemia-risk-and-target')?.coverageSummary
    : undefined
  const nhiAiCriteria = useMemo(() => {
    if (!nhiCoverageSummary) return []
    const checks = [
      ...nhiCoverageSummary.factors,
      ...nhiCoverageSummary.metabolicChecks,
      ...nhiCoverageSummary.diseaseChecks,
    ]
    const selected = selectNhiLipidAiCriteria(checks).filter(
      (check) => nhiLipidReviewProvenance[check.id]?.source !== 'manual',
    )
    const selectedIds = new Set(selected.map((check) => check.id))
    for (const check of checks) {
      if (
        check.editable
        && nhiLipidReviewProvenance[check.id]?.source === 'ai'
        && !selectedIds.has(check.id)
      ) selected.push(check)
    }
    return selected
  }, [nhiCoverageSummary, nhiLipidReviewProvenance])
  const nhiLipidAiAssist = useNhiLipidAiAssist({
    patientId,
    criteria: nhiAiCriteria,
    locale: cdssLocale,
  })

  if (patientLoading || clinicalData.isLoading || clinicalData.isFetching || !answersHydrated) {
    return <LoadingState locale={cdssLocale} />
  }

  if (patientError || clinicalData.error) {
    return (
      <StateMessage
        locale={cdssLocale}
        title={cdssLocale === 'en' ? 'Clinical data could not be loaded' : '目前無法載入臨床資料'}
        body={patientError ?? clinicalData.error?.message ?? (
          cdssLocale === 'en' ? 'Try loading the patient record again.' : '請重新載入病人病歷後再試。'
        )}
      />
    )
  }

  if (!patient) {
    return (
      <StateMessage
        locale={cdssLocale}
        title={cdssLocale === 'en' ? 'No patient record is loaded' : '尚未載入病人病歷'}
        body={cdssLocale === 'en'
          ? 'Load the patient record before running personalized disease guidance.'
          : '請先載入病人資料，再執行個人化疾病指引。'}
      />
    )
  }

  if (clinicalData.hasBlockingQueryIssues) {
    return (
      <StateMessage
        locale={cdssLocale}
        title={cdssLocale === 'en' ? 'Required patient data are incomplete' : '必要的病人資料尚未完整'}
        body={cdssLocale === 'en'
          ? 'Diagnosis, medication, laboratory, or encounter data did not load completely. No patient-specific recommendation was generated.'
          : '診斷、藥物、檢驗或就醫資料未完整載入；為避免錯配，本次不產生個人化建議。'}
      />
    )
  }

  if (!profile || !result) {
    // Why a pathway did not activate is governed clinical language, so the pack
    // that owns the eligibility rule owns the wording too.
    const unresolvedDiagnosis = recordProfile?.excludedClinicalRecordVariants?.some(item => item.resourceType === 'Condition')
    const notApplicable = unresolvedDiagnosis ? {
      title: cdssLocale === 'en' ? 'Guideline applicability requires diagnosis reconciliation' : '診斷來源有未決版本，指引適用性待核對',
      body: cdssLocale === 'en' ? 'Unresolved diagnosis records were excluded. Their absence from decision inputs does not mean the patient has no disease. Other verified data remain available.' : '未決診斷紀錄暫不採用，不代表沒有疾病；其他已確認資料仍可評估。',
    } : selectedPack.notApplicable(cdssLocale)
    return (
      <div className="@container mx-auto w-full max-w-[84rem] space-y-3 py-1">
        <DiseaseSwitcher
          locale={cdssLocale}
          packs={guidelinePacks}
          applicablePackIds={applicablePackIds}
          selectedPackId={selectedPack.id}
          onSelect={setRequestedPackId}
        />
        <ClinicalRecordVariantsNotice excluded={recordProfile?.excludedClinicalRecordVariants} locale={cdssLocale} />
        <StateMessage
          locale={cdssLocale}
          title={notApplicable.title}
          body={notApplicable.body}
        />
      </div>
    )
  }

  // A layout can be remembered while the clinician moves between diseases.
  // Map a disease-specific choice to its closest valid view without rewriting
  // the stored preference; returning to that disease restores the choice. The
  // decision map exists only where the pack produced one; anywhere else, and
  // whenever the model could not be built, the page opens on three sections.
  const mapAvailable = Boolean(visitModel)
  // The switch offers the map wherever the package can build one; only a map
  // that was asked for and could not be built is withdrawn from it.
  const mapOffered = hasVisitMap(result.packId) && (!wantsMap || mapAvailable)
  const prefersMap = preferredLayout === 'map'
  const chosenLayout: CdssLayout = result.packId === LIPID_PACK_ID
    ? preferredLayout === 'flow' || prefersMap ? 'sections' : preferredLayout
    : preferredLayout === 'nhi' || (prefersMap && !mapAvailable) ? 'sections' : preferredLayout
  const effectiveLayout: CdssLayout = chosenLayout
  const isMap = effectiveLayout === 'map'
  const isVisitFlow = (effectiveLayout === 'flow' || effectiveLayout === 'sections') && result.packId === HEART_FAILURE_PACK_ID
  const isNhiTable = effectiveLayout === 'nhi' && result.packId === LIPID_PACK_ID
  // Atrial fibrillation has two faces: the map, and its own three-section flow,
  // which is what every other stored layout has always shown there.
  const switcherLayout: CdssLayout = result.packId === AF_PACK_ID && !isMap ? 'sections' : chosenLayout
  const showLayoutSwitcher = result.packId === HEART_FAILURE_PACK_ID
    || result.packId === LIPID_PACK_ID
    || mapOffered
  const highPriorityCount = result.recommendations.filter((item) => item.priority === 'high').length
  const needsDataCount = result.recommendations.filter((item) => item.status === 'needs-data').length
  const resetVisitDefaults = () => {
    if (patientId) recordCdssEvent(patientId, result.packId, { kind: 'interaction', action: 'page_reset' })
    if (!patientId) return
    if (isNhiTable) {
      useNhiLipidReviewStore.getState().clear(patientId)
      // The same in-memory reset removes answers and their retained evidence.
      setNhiPageResetKey((current) => current + 1)
      toast.success(cdssLocale === 'en' ? 'Page defaults restored.' : '已恢復本頁預設。')
      return
    }
    clearEvidenceOverrides(patientId)
    clearClinicVitals(patientId)
    useNhiLipidReviewStore.getState().clear(patientId)
    usePreventStore.getState().clear(patientId)
    clearPhysicianDecisions(patientId)
    clearHfpefInputs(patientId)
    clearPhenotypeAnswer(patientId)
    clearVisitAnswers(patientId)
    useAfAnswersStore.getState().clear(patientId)
    useCoronaryPhaseStore.getState().clear(patientId)
    useCarriedAnswersStore.getState().clear(patientId)
    toast.success(cdssLocale === 'en' ? 'Page defaults restored.' : '已恢復本頁預設。')
  }

  return (
    <div
      className="@container mx-auto w-full max-w-[84rem] space-y-3 py-1"
      data-testid="live-clinical-decision-support"
    >
      <header
        className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border pb-2"
        title={cdssLocale === 'en'
          ? `Clinical rules ${result.packVersion}`
          : `臨床規則版本 ${result.packVersion}`}
      >
        {/* One line: the disease and the layout, so the page's own content
            starts near the top (clinician feedback 2026-09-28: 「集中一行，不然
            資訊都一半的頁高才出現」). The selected disease names the page; the
            title is read out, not printed (owner feedback 2026-09-30). */}
        <h2 className="sr-only">
          {result.title}
        </h2>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5 [&>[data-testid=cdss-layout-switch]]:ml-auto">
          <DiseaseSwitcher
            locale={cdssLocale}
            packs={guidelinePacks}
            applicablePackIds={applicablePackIds}
            selectedPackId={selectedPack.id}
            onSelect={id => { if (patientId) recordCdssEvent(patientId, id, { kind: 'interaction', action: 'disease_selected' }); setRequestedPackId(id) }}
          />
          {/* Beside the diseases, so the layout switch keeps the row's right end (owner request 2026-10-07). */}
          <CdssStorageActions key={patientId} english={cdssLocale === 'en'} saveTarget={bookSaveTarget}
            // Saving and records are offered on the decision map and the NHI table, not on 三區塊 (owner decision 2026-10-07).
            offered={isMap || isNhiTable}
            packLabel={(packId) => guidelinePacks.find((pack) => pack.id === packId)?.label[cdssLocale === 'en' ? 'en' : 'zh']}
            onCarryForward={(record, choices) => { if (!patientId || !recordProfile) throw new Error('cdss_carry_forward_unavailable'); return carryForwardCdss(patientId, record, result.packId, result.packVersion, recordProfile, choices) }} input={{ patient,
            packId: result.packId, profile, result,
            physicianInputs: { clinicVitals, hfpefInputs, phenotypeAnswer, evidenceOverrides, afAnswers, coronaryPhaseAnswer,
              nhiLipidReview, nhiLipidReviewProvenance, preventInputs, visitAnswers },
            physicianDecisions: { ...physicianDecisions },
          }} sourceRecords={() => cdssSourceRecords(profile, result, clinicalData.observations, clinicalData.diagnosticReports ?? [])} />
          <HospitalMedicationReview evidence={recordProfile?.hospitalMedicationEvidence} locale={cdssLocale} />
          {showLayoutSwitcher ? (
            <LayoutSwitcher
              locale={cdssLocale}
              layout={switcherLayout}
              packId={result.packId}
              mapAvailable={mapOffered}
              onSelect={next => { if (patientId) recordCdssEvent(patientId, result.packId, { kind: 'interaction', action: 'layout_selected', target: next }); setLayout(next) }}
            />
          ) : null}
          {(isVisitFlow || isNhiTable) && patientId ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 px-2.5 text-xs shadow-none"
              onClick={resetVisitDefaults}
              data-testid={isNhiTable ? 'cdss-nhi-reset-page-defaults' : 'cdss-hf-reset-page-defaults'}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              {cdssLocale === 'en' ? 'Restore page defaults' : '恢復本頁預設'}
            </Button>
          ) : null}
          {/* The map's 今天待決定 and its rail say what needs the clinician,
              point by point; these two counts would repeat it less exactly,
              so the map leaves them out. */}
          {isMap ? null : (
            <div className="flex shrink-0 items-center gap-1.5">
              <Badge className="h-5 bg-rose-100 px-1.5 text-[11px] tabular-nums text-rose-800 hover:bg-rose-100 dark:bg-rose-500/10 dark:text-rose-200">
                {cdssLocale === 'en' ? `${highPriorityCount} priority` : `${highPriorityCount} 優先`}
              </Badge>
              <Badge className="h-5 bg-amber-100 px-1.5 text-[11px] tabular-nums text-amber-900 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-200">
                {cdssLocale === 'en' ? `${needsDataCount} need data` : `${needsDataCount} 需資料`}
              </Badge>
            </div>
          )}
        </div>
      </header>


      <ClinicalRecordVariantsNotice excluded={recordProfile?.excludedClinicalRecordVariants} locale={cdssLocale} />

      {/*
        The visit flow carries the handoff inside 紀錄與追蹤, where the copy
        button for it sits beside the one for this visit's summary.
      */}
      {/* The decision map draws no handoff card (owner decision 2026-09-30,
          docs/LAUNCH-ROUTE-GATES.md); the three sections carry it. */}
      {result.clinicalHandoff && !isVisitFlow && !isNhiTable && !isMap ? (
        <ClinicalHandoffCard handoff={result.clinicalHandoff} />
      ) : null}
      <PreventReadingContext.Provider value={preventReading}>
      {/* The decision map (決策地圖 v2, the pocket-handbook page) stays in this
          panel, under the header above. Opened by `?visit=book`, or 全螢幕
          from the panel, it draws its own header over the whole window, and
          the disease tabs go into it. */}
      <VisitBookChromeContext.Provider value={!isMap ? null : !urlBookMode && !bookFullWindow ? {
        inline: true,
        onExpand: () => setBookFullWindow(true),
      } : {
        onSaveTarget: setBookSaveTarget,
        tabs: (
          <DiseaseSwitcher
            locale={cdssLocale}
            packs={guidelinePacks}
            applicablePackIds={applicablePackIds}
            selectedPackId={selectedPack.id}
            onSelect={setRequestedPackId}
          />
        ),
        // Opened from the panel, it goes back there; opened by `?visit=book`, it leaves by its link.
        ...(urlBookMode ? {} : { onCollapse: () => setBookFullWindow(false) }),
      }}>
      <CarriedAnswerContext.Provider value={carriedLookup}>
      <ClinicalDecisionSupportView
        afAnswers={afAnswers}
        onAfAnswer={patientId ? (id, value) => useAfAnswersStore.getState().answer(patientId, id, value) : undefined}
        coronaryPhaseAnswer={coronaryPhaseAnswer}
        onCoronaryPhase={patientId ? (answer) => useCoronaryPhaseStore.getState().setAnswer(patientId, answer) : undefined}
        result={result}
        englishResult={englishResult ?? undefined}
        locale={cdssLocale}
        patientId={patientId}
        nhiLipidAiAssist={nhiLipidAiAssist}
        nhiLipidAnswerProvenance={nhiLipidReviewProvenance}
        profileFacts={profile.facts}
        followUpHistory={hfFollowUpHistory(clinicalData.observations)}
        layout={effectiveLayout}
        clinicVitals={clinicVitals}
        onSaveClinicVitals={patientId ? (patch) => setClinicVitals(patientId, patch) : undefined}
        onClearClinicVitals={patientId ? () => clearClinicVitals(patientId) : undefined}
        phenotypeAnswer={phenotypeAnswer}
        onAnswerPhenotype={patientId
          ? (answer) => setPhenotypeAnswer(patientId, answer)
          : undefined}
        physicianDecisions={physicianDecisions}
        onRecordDecision={patientId
          ? (moduleId, input) => recordPhysicianDecision(patientId, moduleId, input)
          : undefined}
        onClearDecision={patientId
          ? (moduleId) => clearPhysicianDecision(patientId, moduleId)
          : undefined}
        hfpefReading={hfpefReading}
        nhiPageResetKey={nhiPageResetKey}
        onSaveHfpefInputs={patientId
          ? (patch) => setHfpefInputs(patientId, patch)
          : undefined}
        visitModel={isMap ? visitModel : undefined}
        companionResults={isMap ? companionResults : undefined}
        englishCompanionResults={isMap ? englishCompanionResults : undefined}
        visitAnswers={visitAnswers}
        visitAnswerSources={visitAnswerSources}
        onVisitAnswer={patientId
          // Kept per observation, with the page it was given on: another
          // disease's page that asks the same thing shows it, and says where.
          ? (id, value) => answerVisitAsk(patientId, id, value, undefined, { packId: result.packId })
          : undefined}
      />
      </CarriedAnswerContext.Provider>
      </VisitBookChromeContext.Provider>
      </PreventReadingContext.Provider>
      {/* On the map, the reset sits at the foot, after today's plan: it clears
          every answer and decision on the page, and has no business beside
          the first things a clinician reads. */}
      {isMap && patientId ? (
        <div className="flex justify-end border-t border-border pt-3">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-9 gap-1.5 px-2.5 text-xs text-muted-foreground shadow-none"
            onClick={resetVisitDefaults}
            data-testid="cdss-hf-reset-page-defaults"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            {cdssLocale === 'en' ? 'Restore page defaults' : '恢復本頁預設'}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
