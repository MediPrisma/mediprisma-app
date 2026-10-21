// Refactored Clinical Context Hook
"use client"

import { useCallback, useMemo } from "react"
import {
  useDataSelection,
  type ConsumerProfile,
  type DataConsumer,
} from "@/src/application/providers/data-selection.provider"
import { useClinicalData } from "@/src/application/hooks/clinical-data/use-clinical-data-query.hook"
import type { ClinicalContextSection } from "@/src/core/entities/clinical-context.entity"
import { formatClinicalContext } from "./clinical-context/formatters"
import { usePatientContext } from "./clinical-context/usePatientContext"
import { useMedicationsContext } from "./clinical-context/useMedicationsContext"
import { useEncountersContext } from "./clinical-context/useEncountersContext"
import { useAllergiesContext } from "./clinical-context/useAllergiesContext"
import { useProceduresContext } from "./clinical-context/useProceduresContext"
import { useVitalSignsContext } from "./clinical-context/useVitalSignsContext"
import { useImmunizationsContext } from "./clinical-context/useImmunizationsContext"
import { useProblemListContext } from "./clinical-context/useProblemListContext"
import type { ClinicalData } from "./clinical-context/types"
import { dataCategoryRegistry } from "@/src/core/registry/data-category.registry"
import { listClinicalDocuments, resolveSelectedDocuments, formatDocumentsSection } from "@/src/core/utils/clinical-documents.utils"
import { buildPatientTextLiterals, scrubFreeText } from "@/src/shared/utils/pii-text-scrub"
import { usePatient } from "@/src/application/hooks/patient/use-patient-query.hook"
import { buildClinicalContextCoverageSection } from "@/src/core/utils/clinical-context-coverage.utils"
import { useNow } from "@/src/shared/hooks/use-now.hook"
import { filterAiExcludedClinicalDomains } from "@/src/core/utils/ai-clinical-domain-filter.utils"

import { useLanguage } from "@/src/application/providers/language.provider"
import { useRegistryContextCache } from "./clinical-context/use-registry-context-cache"

export type UseClinicalContextReturn = {
  getClinicalContext: () => ClinicalContextSection[]
  formatClinicalContext: (sections: ClinicalContextSection[]) => string
  getFormattedClinicalContext: () => string
  getFullClinicalContext: () => string
  /** Document resource ids actually included in this consumer's AI context. */
  includedDocumentIds: string[]
}

export { ClinicalContextSection }

export interface UseClinicalContextOptions {
  /** Transient model-fit view. The saved Data Selection profile is untouched. */
  profile?: ConsumerProfile
  /** Already-scoped transient FHIR view used by model-aware record
   * prioritization. The normal query result remains untouched. */
  clinicalDataOverride?: ClinicalData | null
  /** Shared maximum for selected document bodies in this generated context. */
  documentTokenBudget?: number
  /** 'first-visit-summary' (初診快覽 only): visits count their medicines
   *  instead of naming them, check-up vitals say so, and medicine supply is
   *  worded as an estimate, not a stop. Every other consumer keeps 'default'. */
  contextVariant?: 'default' | 'first-visit-summary'
}

export function useClinicalContext(
  consumer?: DataConsumer,
  options: UseClinicalContextOptions = {},
): UseClinicalContextReturn {
  const ds = useDataSelection()
  // Each consumer (chat / insights / ips) reads its own profile. The main scope
  // editor targets summary/insights and mirrors chat only for stored-profile
  // compatibility; agent chat queries FHIR on demand instead of preloading it.
  const activeConsumer: DataConsumer = consumer ?? 'chat'
  const profile = options.profile ?? ds.getProfile(activeConsumer)
  const selectedData = profile.selection
  const firstVisitSummary = options.contextVariant === 'first-visit-summary'
  const filters = profile.filters
  const { patient } = usePatient()
  const nowMs = useNow()
  const { locale } = useLanguage()

  const queriedClinicalData = (useClinicalData() as ClinicalData | null) ?? null
  const sourceClinicalData = options.clinicalDataOverride === undefined
    ? queriedClinicalData
    : options.clinicalDataOverride
  const clinicalData = useMemo(
    () => sourceClinicalData
      ? filterAiExcludedClinicalDomains(sourceClinicalData as any) as ClinicalData
      : null,
    [sourceClinicalData],
  )

  // Hook-driven sections (richer formatting than registry can provide)
  const patientSection = usePatientContext(selectedData.patientInfo ?? false)
  const encountersSection = useEncountersContext(
    selectedData.encounters ?? false,
    clinicalData,
    filters.encounterTimeRange,
    {
      includeMedications: selectedData.medications ?? false,
      includeProcedures: selectedData.procedures ?? false,
      filters,
      nowMs,
      visitMedications: firstVisitSummary ? 'count' : 'list',
    },
  )
  const medicationsSection = useMedicationsContext(
    selectedData.medications ?? false,
    clinicalData,
    filters,
    selectedData.encounters ?? false,
    nowMs,
    firstVisitSummary ? 'neutral' : 'default',
  )
  const allergiesSection = useAllergiesContext(selectedData.allergies ?? false, clinicalData)
  const proceduresSection = useProceduresContext(selectedData.procedures ?? false, clinicalData, filters, selectedData.encounters ?? false)
  const vitalSignsSections = useVitalSignsContext(
    selectedData.vitalSigns ?? false,
    clinicalData,
    filters,
    firstVisitSummary,
  )
  const immunizationsSection = useImmunizationsContext(
    selectedData.immunizations ?? false,
    clinicalData,
    filters
  )

  const problemListSection = useProblemListContext(
    selectedData.problemList ?? false,
    clinicalData,
    filters
  )

  // Registry-driven sections (extensible via dataCategoryRegistry)
  const cachedRegistryContext = useRegistryContextCache(clinicalData, nowMs, locale)

  const labReportsSection = useMemo(() => {
    if (!selectedData.labReports || !clinicalData) return null
    return cachedRegistryContext('labReports', filters)
  }, [selectedData.labReports, clinicalData, filters, cachedRegistryContext])

  const imagingReportsSection = useMemo(() => {
    if (!selectedData.imagingReports || !clinicalData) return null
    return cachedRegistryContext('imagingReports', filters)
  }, [selectedData.imagingReports, clinicalData, filters, cachedRegistryContext])

  const observationsSection = useMemo(() => {
    if (!selectedData.observations || !clinicalData) return null
    return dataCategoryRegistry.getCategoryContext('observations', clinicalData, filters)
  }, [selectedData.observations, clinicalData, filters])

  const advanceDirectivesSection = useMemo(() => {
    if (!selectedData.advanceDirectives || !clinicalData) return null
    return dataCategoryRegistry.getCategoryContext('advanceDirectives', clinicalData, filters)
  }, [selectedData.advanceDirectives, clinicalData, filters])

  const medicalDevicesSection = useMemo(() => {
    if (!selectedData.medicalDevices || !clinicalData) return null
    return dataCategoryRegistry.getCategoryContext('medicalDevices', clinicalData, filters)
  }, [selectedData.medicalDevices, clinicalData, filters])

  const carePlansSection = useMemo(() => {
    if (!selectedData.carePlans || !clinicalData) return null
    return dataCategoryRegistry.getCategoryContext('carePlans', clinicalData, filters)
  }, [selectedData.carePlans, clinicalData, filters])

  // Decode + HTML-strip every document ONCE per clinicalData load. This is the
  // expensive step (base64 + regex strip per discharge summary). Keeping it out
  // of the per-selection memo below means ticking a document checkbox no
  // longer re-decodes all documents, which lagged the checkbox by seconds.
  // clinicalData is the full ClinicalDataCollection at runtime (carries
  // compositions + documentReferences); the hook's local type omits them.
  const allDocuments = useMemo(
    () =>
      clinicalData && selectedData.documents
        ? listClinicalDocuments(clinicalData as unknown as Parameters<typeof listClinicalDocuments>[0])
        : [],
    [clinicalData, selectedData.documents],
  )

  const selectedDocuments = useMemo(() => {
    if (!selectedData.documents || !clinicalData) return null
    return resolveSelectedDocuments(allDocuments, profile.documentMode, profile.documentIds)
  }, [selectedData.documents, clinicalData, allDocuments, profile.documentMode, profile.documentIds])
  const documentsSection = useMemo(
    () => formatDocumentsSection(selectedDocuments ?? [], options.documentTokenBudget),
    [selectedDocuments, options.documentTokenBudget],
  )
  const includedDocumentIds = useMemo(
    () => (selectedDocuments ?? []).map((document) => document.id),
    [selectedDocuments],
  )
  const coverageSection = useMemo(
    () => buildClinicalContextCoverageSection(
      selectedData,
      filters,
      clinicalData as unknown as Parameters<typeof buildClinicalContextCoverageSection>[2],
      includedDocumentIds,
      nowMs,
    ),
    [selectedData, filters, clinicalData, includedDocumentIds, nowMs],
  )

  const pushRegistrySection = useCallback(
    (
      sections: ClinicalContextSection[],
      section: ClinicalContextSection | ClinicalContextSection[] | null
    ) => {
      if (!section) return
      if (Array.isArray(section)) sections.push(...section)
      else sections.push(section)
    },
    []
  )

  const getClinicalContext = useCallback((): ClinicalContextSection[] => {
    const sections: ClinicalContextSection[] = []

    // Patient group
    if (patientSection) sections.push(patientSection)
    sections.push(...vitalSignsSections)
    if (problemListSection) sections.push(problemListSection)
    pushRegistrySection(sections, advanceDirectivesSection)
    pushRegistrySection(sections, medicalDevicesSection)
    pushRegistrySection(sections, carePlansSection)

    // Visit group
    if (encountersSection) sections.push(encountersSection)

    // Reports group
    pushRegistrySection(sections, labReportsSection)
    pushRegistrySection(sections, imagingReportsSection)
    pushRegistrySection(sections, observationsSection)
    if (proceduresSection) sections.push(proceduresSection)

    // Medication group
    if (medicationsSection) sections.push(medicationsSection)
    if (allergiesSection) sections.push(allergiesSection)
    if (immunizationsSection) sections.push(immunizationsSection)

    // Documents group
    pushRegistrySection(sections, documentsSection)

    // Retrieval/coverage metadata belongs last: it informs absence semantics
    // without interrupting the clinical chronology above.
    pushRegistrySection(sections, coverageSection)

    return sections
  }, [
    patientSection,
    vitalSignsSections,
    problemListSection,
    advanceDirectivesSection,
    medicalDevicesSection,
    carePlansSection,
    encountersSection,
    labReportsSection,
    imagingReportsSection,
    observationsSection,
    proceduresSection,
    medicationsSection,
    allergiesSection,
    immunizationsSection,
    documentsSection,
    coverageSection,
    pushRegistrySection,
  ])

  const getFormattedClinicalContext = useMemo(() => {
    let formatted: string | undefined
    return () => (formatted ??= formatClinicalContext(getClinicalContext()))
  }, [getClinicalContext])

  const getFullClinicalContext = useMemo(() => {
    let masked: string | undefined
    // Outbound-only PII mask (身分證字號, labeled 病歷號/姓名 values): this
    // string goes to cloud LLMs (summary / safety / insights context) —
    // discharge-summary bodies included via 文件 selection are the main carrier.
    // Internal formatted-context consumers stay unmasked.
    return () => (masked ??= scrubFreeText(getFormattedClinicalContext(), buildPatientTextLiterals(patient)))
  }, [getFormattedClinicalContext, patient])

  return {
    getClinicalContext,
    formatClinicalContext,
    getFormattedClinicalContext,
    getFullClinicalContext,
    includedDocumentIds,
  }
}
