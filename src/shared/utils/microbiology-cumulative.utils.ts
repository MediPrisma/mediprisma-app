import { categorizeObservation, getTestDisplayName } from '@/src/shared/utils/lab-categories'
import { isNhiOrderCodeSystem, nhiOrderCode } from '@/src/shared/utils/nhi-order-code'
import { getOriginalAnalyteDisplayForObs } from '@voho0000/clinical-lab-normalization/display'

export type MicrobiologyFamily = 'bacteriology' | 'mycobacteriology' | 'mycology'

export type MicrobiologyStage =
  | 'directExam'
  | 'molecular'
  | 'culture'
  | 'identification'
  | 'susceptibility'
  | 'other'

export type MicrobiologyResultState =
  | 'noGrowth'
  | 'notDetected'
  | 'normalFlora'
  | 'mixedFlora'
  | 'contaminated'
  | 'detected'
  | 'pending'
  | 'narrative'

export type MicrobiologySpecimenConfidence = 'source' | 'inferred' | 'missing'

export interface MicrobiologySusceptibility {
  antibiotic: string
  result: 'S' | 'I' | 'R'
}

export interface MicrobiologyCumulativeResult {
  id: string
  date: string
  effectiveDateTime: string
  family: MicrobiologyFamily
  stage: MicrobiologyStage
  standardizedName: string
  originalName: string
  specimen: string
  specimenConfidence: MicrobiologySpecimenConfidence
  organization?: string
  sourceValue: string
  value: string
  state: MicrobiologyResultState
  sourceOrderCode?: string
  sourceRoleConflict: boolean
  susceptibilities: MicrobiologySusceptibility[]
}

export interface MicrobiologyCumulativeTrack {
  key: string
  family: MicrobiologyFamily
  specimen: string
  specimenConfidence: MicrobiologySpecimenConfidence
  dates: string[]
  stages: MicrobiologyStage[]
  results: MicrobiologyCumulativeResult[]
}

export interface MicrobiologyCumulativeModel {
  tracks: MicrobiologyCumulativeTrack[]
  resultCount: number
  missingSpecimenCount: number
}

export const MICROBIOLOGY_STAGE_ORDER: MicrobiologyStage[] = [
  'directExam',
  'molecular',
  'culture',
  'identification',
  'susceptibility',
  'other',
]

const FAMILY_ORDER: MicrobiologyFamily[] = [
  'bacteriology',
  'mycobacteriology',
  'mycology',
]


const MYCOBACTERIAL_STANDARDIZED_NAME_BY_STAGE: Partial<Record<MicrobiologyStage, string>> = {
  directExam: 'AFB smear',
  culture: 'Mycobacterial Culture',
  identification: 'Mycobacterial Identification',
  susceptibility: 'Mycobacterial Susceptibility',
}

function normalizedText(value: unknown): string {
  return typeof value === 'string'
    ? value.normalize('NFKC').trim().replace(/\s+/g, ' ')
    : ''
}

function observationLabels(obs: any): string {
  const codings = Array.isArray(obs?.code?.coding) ? obs.code.coding : []
  return [obs?.code?.text, ...codings.flatMap((coding: any) => [coding?.display, coding?.code])]
    .map(normalizedText)
    .filter(Boolean)
    .join(' ')
}

function localObservationLabels(obs: any): string {
  const codings = Array.isArray(obs?.code?.coding) ? obs.code.coding : []
  const labels = [
    obs?.code?.text,
    ...codings
      .filter((coding: any) => !isNhiOrderCodeSystem(coding?.system))
      .flatMap((coding: any) => [coding?.display, coding?.code]),
  ]
    .map(normalizedText)
    .filter(Boolean)
  return [...new Set(labels)].join(' ')
}

function textStages(labels: string): Set<MicrobiologyStage> {
  const stages = new Set<MicrobiologyStage>()
  if (/GRAM|ACID[ -]?FAST|AFB|\bAFS?\s*STAIN\b|STAIN|SMEAR|KOH|INDIA INK|染色|抹片|鏡檢|\bEP\.?\s*CELL|\bW\.?B\.?C\.?(?:-|\s)*SPUTUM|\bNEUTROPHIL\b|\bG\([+-]\)\s*(?:BACILL|COCC)/i.test(labels)) {
    stages.add('directExam')
  }
  if (/PCR|NAAT|NUCLEIC|MOLECULAR|核酸|分子檢測/i.test(labels)) stages.add('molecular')
  if (/CULTUR|培養|\bANAEROBIC(?:\s*#\s*\d+)?\b|\bFUNG(?:US|AL)\s*#?\s*\d+\b/i.test(labels)) {
    stages.add('culture')
  }
  if (/IDENTIF|鑑定|\bORGANISM\s*\d+\b|\bID\s*\+\s*DS\s+COMMON\b/i.test(labels)) {
    stages.add('identification')
  }
  if (/SUSCEPT|SENSITIV|RESIST|ANTIBIOGRAM|\bMIC\b|藥敏|敏感性|抗藥|最低抑制濃度/i.test(labels)) {
    stages.add('susceptibility')
  }
  return stages
}

function mycobacterialStageFromResult(value: string): MicrobiologyStage | undefined {
  if (/ACID[ -]?FAST BACILLI\s*(?:[-:–—]\s*)?(?:NOT\s+FOUND|NONE\s+SEEN|NEGATIVE)|無抗酸菌/i.test(value)) {
    return 'directExam'
  }
  if (/NO\s+GROWTH\s+(?:FOR\s+MYCOBACTER(?:IUM|IA)|AFTER\s+\d+\s+WEEKS?)|NO\s+MYCOBACTER(?:IUM|IA).*(?:CULTUR|GROWTH)|MYCOBACTER(?:IUM|IA).*無生長/i.test(value)) {
    return 'culture'
  }
  return undefined
}

function isGenericOrganismSlot(labels: string): boolean {
  return /^ORGANISM\s*\d+$/i.test(labels.trim())
}

function isExplicitFungalCultureResult(value: string): boolean {
  return /(?:NO\s+)?FUNGAL\s+GROWTH(?:\s+FOR\s+\d+\s+(?:DAYS?|WEEKS?))?/i.test(value)
}

function classifyStage(obs: any, value: string): {
  stage: MicrobiologyStage
  sourceRoleConflict: boolean
  sourceOrderCode?: string
} {
  const sourceOrderCode = nhiOrderCode(obs) ?? undefined
  const localLabels = localObservationLabels(obs)
  const stagesFromLocalText = textStages(localLabels)
  const resultStage = mycobacterialStageFromResult(value)
  const genericFungalCulture = isGenericOrganismSlot(localLabels)
    && isExplicitFungalCultureResult(value)
  const sourceRoleConflict = Boolean(
    resultStage
    && stagesFromLocalText.size > 0
    && !stagesFromLocalText.has(resultStage),
  )

  // The source name is authoritative. Result wording only separates a truly
  // compound source name such as 「分枝桿菌培養及抗酸性染色」.
  const stage = genericFungalCulture
    ? 'culture'
    : stagesFromLocalText.has('susceptibility')
    ? 'susceptibility'
    : stagesFromLocalText.has('identification')
      ? 'identification'
      : stagesFromLocalText.has('molecular')
        ? 'molecular'
        : resultStage && stagesFromLocalText.has(resultStage)
          ? resultStage
          : MICROBIOLOGY_STAGE_ORDER.find((candidate) => stagesFromLocalText.has(candidate)) ?? 'other'

  return { stage, sourceRoleConflict, sourceOrderCode }
}

function classifyFamily(labels: string, value: string): MicrobiologyFamily {
  const genericMycobacterialResult = /^(?:CULTURE|SMEAR)$/i.test(labels.trim())
    && Boolean(mycobacterialStageFromResult(value))
  if (genericMycobacterialResult || /MYCOBACT|TUBERC|ACID[ -]?FAST|\bAFB\b|\bAFS\b|\bAF\s*STAIN\b|\bTB\s+CULTURE\b|結核|分枝桿菌|抗酸(?:性|菌)/i.test(labels)) {
    return 'mycobacteriology'
  }
  if (/FUNG|YEAST|MOLD|MOULD|KOH|INDIA INK|黴菌|真菌|酵母/i.test(labels)) {
    return 'mycology'
  }
  if (isGenericOrganismSlot(labels) && isExplicitFungalCultureResult(value)) {
    return 'mycology'
  }
  return 'bacteriology'
}

function standardizedNameFromOriginal(
  originalName: string,
  family: MicrobiologyFamily,
  stage: MicrobiologyStage,
): string {
  if (family === 'mycobacteriology') {
    return MYCOBACTERIAL_STANDARDIZED_NAME_BY_STAGE[stage] ?? originalName
  }
  if (family === 'mycology' && stage === 'culture') return 'Fungal Culture'
  // A culture order may carry a flattened antibiogram as its actual result.
  // Once the content proves this is susceptibility data, describe the result
  // being displayed instead of repeating the culture container name.
  if (stage === 'susceptibility') return '抗生素藥敏試驗'
  if (/BLOOD\s+CULTURE|(?:細菌)?血液(?:細菌)?培養/i.test(originalName)) return 'Blood Culture'
  if (/ANAEROBIC(?:\s+CULTU(?:RE)?)?(?:\s*#\s*\d+)?|厭氧培養/i.test(originalName)) return 'Anaerobic Culture'
  if (/AEROBIC\s+CULTURE|嗜氧培養/i.test(originalName)) return 'Aerobic Culture'
  if (/^CULTURE\s*\(\s*AEROBIC\s+CULTURE\s*\)$/i.test(originalName)) return 'Aerobic Culture'
  if (/GRAM(?:[^A-Z0-9\s]S)?\s+STAIN|革蘭氏?染色|格蘭氏?染色/i.test(originalName)) return 'Gram Stain'
  if (/FUNG(?:AL|US)(?:\s+CULTURE)?\s*#?\s*\d+|黴菌培養|真菌培養/i.test(originalName)) return 'Fungal Culture'
  if (/^URINE\s+CULTURE/i.test(originalName)) return 'Urine Culture'
  if (/\bID\s*\+\s*DS\s+COMMON\b/i.test(originalName)) return 'Culture Identification'
  if (/^ORGANISM\s*\d+$/i.test(originalName)) return 'Organism identification'
  if (/^EP\.?\s*CELL(?:-|\s)*SPUTUM$/i.test(originalName)) return 'Epithelial cells (microscopy)'
  if (/^W\.?B\.?C\.?(?:-|\s)*SPUTUM$/i.test(originalName)) return 'WBC (microscopy)'
  if (/^NEUTROPHILS?$/i.test(originalName)) return 'Neutrophils (microscopy)'
  if (/^G\(\+\)\s*BACILL/i.test(originalName)) return 'Gram-positive bacilli'
  if (/^G\(-\)\s*BACILL/i.test(originalName)) return 'Gram-negative bacilli'
  if (/^G\(\+\)\s*COCC/i.test(originalName)) return 'Gram-positive cocci'
  if (/^G\(-\)\s*COCC/i.test(originalName)) return 'Gram-negative cocci'
  if (/\bMIC\b|藥敏|敏感性|最低抑制濃度/i.test(originalName)) return '抗生素藥敏試驗'
  return originalName
}

function observationSourceValue(obs: any): string {
  if (obs?.valueString !== undefined && obs.valueString !== null) {
    return String(obs.valueString) || '—'
  }
  if (obs?.valueCodeableConcept) {
    const concept = obs.valueCodeableConcept
    return String(concept.text ?? '')
      || String(concept.coding?.[0]?.display ?? '')
      || String(concept.coding?.[0]?.code ?? '')
      || '—'
  }
  if (obs?.valueQuantity?.value !== undefined && obs.valueQuantity?.value !== null) {
    return `${obs.valueQuantity.value}${obs.valueQuantity.unit ? ` ${obs.valueQuantity.unit}` : ''}`
  }
  return '—'
}

function observationValue(obs: any): string {
  return normalizedText(observationSourceValue(obs)) || '—'
}

function classifyResultState(value: string, status: unknown): MicrobiologyResultState {
  const normalizedStatus = normalizedText(status).toLowerCase()
  if (!value || value === '—' || ['registered', 'preliminary'].includes(normalizedStatus)) return 'pending'
  if (/NO\s+GROWTH|WITHOUT\s+GROWTH|無生長|未生長|未培養出/i.test(value)) return 'noGrowth'
  if (/SALIVA\s+CONTAMINATION|CONTAMINAT|污染/i.test(value)) return 'contaminated'
  if (/NORMAL\s+(?:FLORA|MICROORGANISMS?)|正常菌叢/i.test(value)) return 'normalFlora'
  if (/MIXED\s+FLORA|MIXED\s+GROWTH|混合菌/i.test(value)) return 'mixedFlora'
  if (/NOT\s+(?:FOUND|DETECTED|SEEN|ISOLATED)|NONE\s+(?:FOUND|SEEN)|NO\s+(?:BACTERIA|FUNGUS|AEROBIC\s+PATHOGEN|ANAEROBIC\s+PATHOGEN)|NEGATIVE|未檢出|未發現|陰性|無抗酸菌/i.test(value)) {
    return 'notDetected'
  }
  // NHI free-text reports name the isolate as `菌名:...`; a named organism is
  // a positive result even when no growth keyword appears.
  if (/\bPOSITIVE\b|\bDETECTED\b|\bISOLATED\b|GROWTH\s+OF|長菌|檢出|培養出|陽性|菌名\d*\s*[:：]\s*\S/i.test(value)) {
    return 'detected'
  }
  return 'narrative'
}

function susceptibilityResult(value: string): 'S' | 'I' | 'R' | null {
  const normalized = value.normalize('NFKC').trim().toUpperCase()
  if (/^(S|SENSITIVE|SUSCEPTIBLE|敏感)$/.test(normalized)) return 'S'
  if (/^(I|INTERMEDIATE|中介)$/.test(normalized)) return 'I'
  if (/^(R|RESISTANT|RESISTANCE|抗藥)$/.test(normalized)) return 'R'
  return null
}

function extractSusceptibilities(obs: any): MicrobiologySusceptibility[] {
  const components = Array.isArray(obs?.component) ? obs.component : []
  return components.flatMap((component: any) => {
    const antibiotic = normalizedText(component?.code?.text)
      || normalizedText(component?.code?.coding?.[0]?.display)
    const rawResult = normalizedText(component?.valueCodeableConcept?.text)
      || normalizedText(component?.valueCodeableConcept?.coding?.[0]?.code)
      || normalizedText(component?.valueString)
    const result = susceptibilityResult(rawResult)
    return antibiotic && result ? [{ antibiotic, result }] : []
  })
}

function resolveSpecimen(obs: any, labels: string): {
  specimen: string
  confidence: MicrobiologySpecimenConfidence
} {
  const explicit = normalizedText(obs?.specimen?.display)
    || normalizedText(obs?.bodySite?.text)
    || normalizedText(obs?.bodySite?.coding?.[0]?.display)
  if (explicit) return { specimen: explicit, confidence: 'source' }
  if (/BLOOD\s+CULTURE|血液培養/i.test(labels)) return { specimen: 'Blood', confidence: 'inferred' }
  if (/PUS\s*\/\s*WOUND|PUS\s*(?:OR|AND|&)\s*WOUND/i.test(labels)) {
    return { specimen: 'Pus / Wound', confidence: 'inferred' }
  }
  if (/URINE\s+CULTURE\s*\(\s*MIDDLE\s+STREAM\s*\)/i.test(labels)) {
    return { specimen: 'Urine (midstream)', confidence: 'inferred' }
  }
  if (/SPUTUM/i.test(labels)) return { specimen: 'Sputum', confidence: 'inferred' }
  return { specimen: 'unknown', confidence: 'missing' }
}

function resultId(obs: any, index: number): string {
  return normalizedText(obs?.id) || `microbiology-result-${index}`
}

export function buildMicrobiologyCumulativeModel(
  observations: any[],
): MicrobiologyCumulativeModel {
  const results: MicrobiologyCumulativeResult[] = []

  observations.forEach((obs, index) => {
    if (categorizeObservation(obs)?.id !== 'microbio') return
    const effectiveDateTime = normalizedText(obs?.effectiveDateTime)
      || normalizedText(obs?.issued)
    const date = effectiveDateTime.slice(0, 10)
    if (!date) return

    const labels = observationLabels(obs)
    const sourceValue = observationSourceValue(obs)
    const value = observationValue(obs)
    const stageInfo = classifyStage(obs, value)
    const family = classifyFamily(localObservationLabels(obs), value)
    const specimen = resolveSpecimen(obs, labels)
    const originalName = getOriginalAnalyteDisplayForObs(obs)
      || getTestDisplayName(obs)
      || 'Unknown microbiology test'
    const susceptibilities = extractSusceptibilities(obs)
    const hasFreeTextSusceptibility = parseSusceptibilityFreeText(value) !== null
    const stage = susceptibilities.length > 0 || hasFreeTextSusceptibility
      ? 'susceptibility'
      : stageInfo.stage

    results.push({
      id: resultId(obs, index),
      date,
      effectiveDateTime,
      family,
      stage,
      standardizedName: standardizedNameFromOriginal(originalName, family, stage),
      originalName,
      specimen: specimen.specimen,
      specimenConfidence: specimen.confidence,
      organization: normalizedText(obs?.performer?.[0]?.display) || undefined,
      sourceValue,
      value,
      state: classifyResultState(value, obs?.status),
      sourceOrderCode: stageInfo.sourceOrderCode,
      sourceRoleConflict: stageInfo.sourceRoleConflict,
      susceptibilities,
    })
  })

  // Some source reports use only the generic names `CULTURE` and `SMEAR`.
  // `SMEAR + Negative` is ambiguous in isolation, but becomes an AFB smear
  // when its exact report context also contains a generic culture whose text
  // explicitly names Mycobacterium. This uses source-name/result context only;
  // the billing code is deliberately not consulted.
  const exactReportGroups = new Map<string, MicrobiologyCumulativeResult[]>()
  results.forEach((result) => {
    const key = [
      result.effectiveDateTime,
      result.organization ?? '',
      result.specimen,
    ].map((part) => normalizedText(part).toLowerCase()).join('|')
    const group = exactReportGroups.get(key) ?? []
    group.push(result)
    exactReportGroups.set(key, group)
  })
  exactReportGroups.forEach((group) => {
    const hasExplicitGenericMycobacterialCulture = group.some((result) => (
      /^CULTURE$/i.test(result.originalName.trim())
      && result.family === 'mycobacteriology'
      && result.stage === 'culture'
      && mycobacterialStageFromResult(result.value) === 'culture'
    ))
    if (!hasExplicitGenericMycobacterialCulture) return
    group.forEach((result) => {
      if (!/^SMEAR$/i.test(result.originalName.trim())) return
      if (result.stage !== 'directExam' || !/^NEGATIVE$/i.test(result.value.trim())) return
      result.family = 'mycobacteriology'
      result.standardizedName = MYCOBACTERIAL_STANDARDIZED_NAME_BY_STAGE.directExam ?? result.originalName
    })
  })

  // A single 13006C microscopy report is often flattened into several
  // Observations. Some component rows say "Sputum" while Gram-stain rows from
  // that same report omit specimen. Propagate only within the exact same
  // hospital, date and NHI order, and only when there is one unambiguous source
  // specimen. We deliberately do not infer across culture/stain order codes.
  const reportGroups = new Map<string, MicrobiologyCumulativeResult[]>()
  results.forEach((result) => {
    if (!result.sourceOrderCode || !result.organization) return
    const key = [result.date, result.organization, result.sourceOrderCode, result.family].join('|')
    const group = reportGroups.get(key) ?? []
    group.push(result)
    reportGroups.set(key, group)
  })
  reportGroups.forEach((group) => {
    const sourceSpecimens = [...new Set(
      group
        .filter((result) => result.specimenConfidence === 'source')
        .map((result) => result.specimen),
    )]
    if (sourceSpecimens.length !== 1) return
    group.forEach((result) => {
      if (result.specimenConfidence !== 'missing') return
      result.specimen = sourceSpecimens[0]
      result.specimenConfidence = 'inferred'
    })
  })

  // Equal-looking rows may be separate specimens or separately collected
  // smears. Preserve every distinct source resource and let the view show a
  // compact ×N count. Only remove the same FHIR resource if it was passed into
  // the model more than once.
  const seenResourceIds = new Set<string>()
  const uniqueResults = results.filter((result) => {
    if (seenResourceIds.has(result.id)) return false
    seenResourceIds.add(result.id)
    return true
  })

  const tracksByKey = new Map<string, MicrobiologyCumulativeResult[]>()
  uniqueResults.forEach((result) => {
    const specimenKey = result.specimen.normalize('NFKC').trim().toLowerCase()
    const key = `${result.family}|${specimenKey}`
    const trackResults = tracksByKey.get(key) ?? []
    trackResults.push(result)
    tracksByKey.set(key, trackResults)
  })

  const tracks = [...tracksByKey.entries()].map(([key, trackResults]) => {
    trackResults.sort((left, right) => right.effectiveDateTime.localeCompare(left.effectiveDateTime))
    const confidence: MicrobiologySpecimenConfidence = trackResults.some((result) => result.specimenConfidence === 'missing')
      ? 'missing'
      : trackResults.some((result) => result.specimenConfidence === 'inferred')
        ? 'inferred'
        : 'source'
    return {
      key,
      family: trackResults[0].family,
      specimen: trackResults[0].specimen,
      specimenConfidence: confidence,
      dates: [...new Set(trackResults.map((result) => result.date))].sort((a, b) => b.localeCompare(a)),
      stages: MICROBIOLOGY_STAGE_ORDER.filter((stage) => trackResults.some((result) => result.stage === stage)),
      results: trackResults,
    }
  })

  tracks.sort((left, right) => {
    const leftFamily = FAMILY_ORDER.indexOf(left.family)
    const rightFamily = FAMILY_ORDER.indexOf(right.family)
    if (leftFamily !== rightFamily) return leftFamily - rightFamily
    if (left.specimenConfidence !== right.specimenConfidence) {
      const confidenceOrder: MicrobiologySpecimenConfidence[] = ['source', 'inferred', 'missing']
      return confidenceOrder.indexOf(left.specimenConfidence) - confidenceOrder.indexOf(right.specimenConfidence)
    }
    if (left.specimen === 'Blood' && right.specimen !== 'Blood') return -1
    if (right.specimen === 'Blood' && left.specimen !== 'Blood') return 1
    return left.specimen.localeCompare(right.specimen)
  })

  return {
    tracks,
    resultCount: uniqueResults.length,
    missingSpecimenCount: uniqueResults.filter((result) => result.specimenConfidence === 'missing').length,
  }
}

/**
 * Display columns of the date-per-row cumulative table. Identification is the
 * outcome of a culture, so both share one column; molecular and free-text
 * "other" results only earn a column when the patient actually has them.
 */
export type MicrobiologyStageColumn =
  | 'directExam'
  | 'molecular'
  | 'culture'
  | 'susceptibility'
  | 'other'

export const MICROBIOLOGY_STAGE_COLUMN_ORDER: MicrobiologyStageColumn[] = [
  'directExam',
  'molecular',
  'culture',
  'susceptibility',
  'other',
]

export function microbiologyStageColumn(stage: MicrobiologyStage): MicrobiologyStageColumn {
  return stage === 'identification' ? 'culture' : stage
}

export interface MicrobiologyEvent {
  key: string
  date: string
  specimen: string
  specimenConfidence: MicrobiologySpecimenConfidence
  family: MicrobiologyFamily
  organization?: string
  results: MicrobiologyCumulativeResult[]
  resultsByColumn: Partial<Record<MicrobiologyStageColumn, MicrobiologyCumulativeResult[]>>
}

const RESULT_STATE_PRIORITY: Record<MicrobiologyResultState, number> = {
  detected: 0,
  contaminated: 1,
  pending: 2,
  mixedFlora: 3,
  narrative: 4,
  normalFlora: 5,
  notDetected: 6,
  noGrowth: 7,
}

/**
 * Smear-context items (WBC / epithelial cells / neutrophil counts) grade the
 * specimen instead of naming an organism; the table demotes them to one muted
 * quality line under the organism findings.
 */
export function isSmearContextResult(result: MicrobiologyCumulativeResult): boolean {
  const names = `${result.standardizedName} ${result.originalName}`
  return /\bW\.?B\.?C\b|EPITH|EP\.?\s?CELL|NEUTROPHIL|白血球|上皮/i.test(names)
}

/** A graded-negative narrative line such as `Gram(-) coccus:-`. */
export function hasNegativeGradeValue(value: string): boolean {
  return /[:：]\s*[-−]\s*$/.test(value.normalize('NFKC').trim())
}

/**
 * Clinical scan order inside one cell: significant states first, organism
 * findings before graded negatives, specimen-quality lines last.
 */
export function compareMicrobiologyCellResults(
  left: MicrobiologyCumulativeResult,
  right: MicrobiologyCumulativeResult,
): number {
  const contextDifference = Number(isSmearContextResult(left)) - Number(isSmearContextResult(right))
  if (contextDifference !== 0) return contextDifference
  // Workflow order inside a merged column (culture before its identification).
  const stageDifference = MICROBIOLOGY_STAGE_ORDER.indexOf(left.stage)
    - MICROBIOLOGY_STAGE_ORDER.indexOf(right.stage)
  if (stageDifference !== 0) return stageDifference
  const stateDifference = RESULT_STATE_PRIORITY[left.state] - RESULT_STATE_PRIORITY[right.state]
  if (stateDifference !== 0) return stateDifference
  const gradeDifference = Number(hasNegativeGradeValue(left.value)) - Number(hasNegativeGradeValue(right.value))
  if (gradeDifference !== 0) return gradeDifference
  return left.standardizedName.localeCompare(right.standardizedName)
}

/** Organism named inside a susceptibility report free text, e.g. `菌名:...`. */
export function extractSusceptibilityOrganism(value: string): string | null {
  const match = value.normalize('NFKC').match(
    /(?:菌名|Organism|Isolate)\s*[:：]\s*([^:：]+?)(?=\s+\S+[:：]|$)/i,
  )
  const organism = match?.[1]?.trim()
  return organism || null
}

export interface SusceptibilityEntry {
  antibiotic: string
  /** Verbatim result token: S/I/R, other letters (N, D), MIC (`<=0.25`), or letter+MIC (`S(≦0.12)`). */
  result: string
}

export interface SusceptibilityIsolate {
  organism: string | null
  /** 菌量／長菌量 when the report states one. */
  quantity: string | null
  entries: SusceptibilityEntry[]
}

export interface ParsedSusceptibilityText {
  /**
   * Some hospitals report several organisms in one flattened value using
   * numbered slots (`菌名1:… 菌名2:…`); each slot keeps its own drug panel.
   */
  isolates: SusceptibilityIsolate[]
  /** Any text the parser could not account for; must stay visible verbatim. */
  leftover: string
}

const SUSCEPTIBILITY_KEY_PATTERN = /^(菌名\d*|菌量\d*|長菌量\d*)[:：](.*)$/
// Result token grammar seen in real reports: S/I/R and other single letters
// (敏盛 uses N), letter with parenthesized MIC (`S(≦0.12)`), or a bare
// MIC/dilution with an optional comparator (`<=0.25`, `≧8`, `2/38`).
const SUSCEPTIBILITY_RESULT = '[A-Za-z]{1,2}(?:\\([^()]{1,16}\\))?|[<>=≦≧≤≥]{0,2}\\d+(?:\\.\\d+)?(?:\\/\\d+(?:\\.\\d+)?)?'
const SUSCEPTIBILITY_ENTRY_PATTERN = new RegExp(`^(.*[A-Za-z].*?)[:：](${SUSCEPTIBILITY_RESULT})$`)

/** `S(≦0.12)` → letter S + detail ≦0.12; `<=0.25` → MIC-only detail. */
export function splitSusceptibilityResult(result: string): { letter: string | null; detail: string | null } {
  const letterWithDetail = result.match(/^([A-Za-z]{1,2})\(([^()]+)\)$/)
  if (letterWithDetail) return { letter: letterWithDetail[1], detail: letterWithDetail[2] }
  if (/^[A-Za-z]{1,2}$/.test(result)) return { letter: result, detail: null }
  return { letter: null, detail: result }
}

/**
 * NHI exports flatten a whole antibiogram into one line:
 * `菌名:Escherichia coli 菌量:Light AN:S CTX:I … TZP:D`.
 * Split it back into isolates and drug results for display. Result tokens
 * stay verbatim (including non-S/I/R letters such as N or D) and any
 * unrecognized text is returned as `leftover` — this is layout only, never
 * value rewriting. Titers such as `1:80` never match the drug grammar (a drug
 * needs a letter), so serology narratives fall through untouched. Returns
 * null when the text is not clearly an antibiogram.
 */
export function parseSusceptibilityFreeText(value: string): ParsedSusceptibilityText | null {
  const tokens = value.normalize('NFKC').trim().split(/\s+/)
  const isolates: SusceptibilityIsolate[] = []
  const leftoverTokens: string[] = []
  // Which multi-token field is currently collecting trailing words
  // (e.g. `菌名:Escherichia` followed by the bare token `coli`).
  let collecting: 'organism' | 'quantity' | null = null

  const currentIsolate = (): SusceptibilityIsolate => {
    if (isolates.length === 0) isolates.push({ organism: null, quantity: null, entries: [] })
    return isolates[isolates.length - 1]
  }

  for (const token of tokens) {
    const key = token.match(SUSCEPTIBILITY_KEY_PATTERN)
    if (key) {
      const rest = key[2].trim()
      if (key[1].startsWith('菌名')) {
        // A new organism slot starts a new isolate once the previous one has
        // any content of its own.
        if (isolates.length === 0 || isolates[isolates.length - 1].organism !== null) {
          isolates.push({ organism: null, quantity: null, entries: [] })
        }
        collecting = 'organism'
        currentIsolate().organism = rest || null
      } else {
        collecting = 'quantity'
        currentIsolate().quantity = rest || null
      }
      continue
    }
    const entry = token.match(SUSCEPTIBILITY_ENTRY_PATTERN)
    if (entry) {
      collecting = null
      currentIsolate().entries.push({ antibiotic: entry[1], result: entry[2] })
      continue
    }
    if (collecting === 'organism') {
      const isolate = currentIsolate()
      isolate.organism = isolate.organism ? `${isolate.organism} ${token}` : token
      continue
    }
    if (collecting === 'quantity') {
      const isolate = currentIsolate()
      isolate.quantity = isolate.quantity ? `${isolate.quantity} ${token}` : token
      continue
    }
    leftoverTokens.push(token)
  }

  const totalEntries = isolates.reduce((sum, isolate) => sum + isolate.entries.length, 0)
  if (totalEntries < 3) return null
  return { isolates, leftover: leftoverTokens.join(' ') }
}

const EVENT_SPECIMEN_UNKNOWN = 'unknown'

function eventSpecimenRank(specimen: string, confidence: MicrobiologySpecimenConfidence): number {
  if (confidence === 'missing' || specimen === EVENT_SPECIMEN_UNKNOWN) return 2
  return specimen.toLowerCase() === 'blood' ? 0 : 1
}

/**
 * One row of the cumulative table: everything reported for one collection date
 * of one specimen and organism family at one hospital. Newest first; within a
 * date blood cultures lead, named specimens follow, missing-specimen rows go
 * last so the timeline stays scannable.
 */
export function buildMicrobiologyEvents(model: MicrobiologyCumulativeModel): MicrobiologyEvent[] {
  const byKey = new Map<string, MicrobiologyEvent>()
  for (const track of model.tracks) {
    for (const result of track.results) {
      const key = [result.date, result.family, result.specimen, result.organization ?? ''].join('|')
      let event = byKey.get(key)
      if (!event) {
        event = {
          key,
          date: result.date,
          specimen: result.specimen,
          specimenConfidence: result.specimenConfidence,
          family: result.family,
          organization: result.organization,
          results: [],
          resultsByColumn: {},
        }
        byKey.set(key, event)
      }
      event.results.push(result)
      if (result.specimenConfidence === 'missing') event.specimenConfidence = 'missing'
      const column = microbiologyStageColumn(result.stage)
      const cell = event.resultsByColumn[column] ?? []
      cell.push(result)
      event.resultsByColumn[column] = cell
    }
  }
  const events = [...byKey.values()]
  for (const event of events) {
    for (const cell of Object.values(event.resultsByColumn)) {
      cell.sort(compareMicrobiologyCellResults)
    }
  }
  events.sort((left, right) => {
    if (left.date !== right.date) return right.date.localeCompare(left.date)
    const familyDifference = FAMILY_ORDER.indexOf(left.family) - FAMILY_ORDER.indexOf(right.family)
    if (familyDifference !== 0) return familyDifference
    const specimenDifference = eventSpecimenRank(left.specimen, left.specimenConfidence)
      - eventSpecimenRank(right.specimen, right.specimenConfidence)
    if (specimenDifference !== 0) return specimenDifference
    if (left.specimen !== right.specimen) return left.specimen.localeCompare(right.specimen)
    return (left.organization ?? '').localeCompare(right.organization ?? '')
  })
  return events
}
