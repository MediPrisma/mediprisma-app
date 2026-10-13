// Grouping Helper Functions
// (audit C3 — formerly under features/clinical-summary/reports; core's
// category definitions and observation selectors need these too)
interface CodeableConcept {
  coding?: Array<{ system?: string; code?: string; display?: string }>
  text?: string
}

interface DiagnosticReportLike {
  meta?: {
    source?: string
    tag?: Array<{ system?: string; code?: string; display?: string }>
  }
  category?: CodeableConcept | CodeableConcept[]
  code?: CodeableConcept
  result?: Array<{ reference?: string }>
  conclusion?: string
  conclusionCode?: unknown
  imagingStudy?: Array<{ reference?: string }>
  note?: Array<{ text?: string }>
  presentedForm?: Array<unknown>
}

export type ReportGroup = 'lab' | 'imaging' | 'cancer-screening' | 'procedures' | 'vitals' | 'other'
export type ReportDisplayGroup = ReportGroup | 'pathology'

export const HEALTH_BANK_SDK_SECTION_SYSTEM =
  'https://nhi-fhir-bridge.github.io/CodeSystem/health-bank-sdk-section'

export const MEDCLOUD_CANCER_SCREENING_CATEGORY_CODE = 'cancer-screening'
const MEDCLOUD_OBSERVATION_PROGRAM_SYSTEM_SUFFIX =
  '/codesystem/medcloud-observation-program'

/** Exact source classification for MediCloud IMUE0150 cancer-screening rows.
 * Do not infer from titles containing "cancer": tumour-marker laboratory
 * results are a different clinical data class and must remain under Lab. */
export function isCancerScreeningCategory(
  category?: CodeableConcept | CodeableConcept[],
): boolean {
  const concepts = Array.isArray(category) ? category : category ? [category] : []
  return concepts.some((concept) => concept?.coding?.some((coding) => {
    const system = coding.system?.trim().toLowerCase() || ''
    const code = coding.code?.trim().toLowerCase() || ''
    return system.endsWith(MEDCLOUD_OBSERVATION_PROGRAM_SYSTEM_SUFFIX)
      && code === MEDCLOUD_CANCER_SCREENING_CATEGORY_CODE
  }))
}

/**
 * The NHI bridge turns Health Bank laboratory Observations into lightweight
 * DiagnosticReports so the Reports UI can group and navigate them. Those
 * reports are presentation containers, not an additional clinical source:
 * their only evidence is `result`, which points back to the original
 * Observations. Keep genuine report resources (r8 imaging/pathology, narrative
 * conclusions, attachments, and non-bridge FHIR DiagnosticReports) citable.
 */
export function isNhiBridgeSyntheticLabReport(report: DiagnosticReportLike): boolean {
  if (!report.meta?.source?.toLowerCase().includes('nhi-fhir-bridge')) return false
  if (inferGroupFromCategory(report.category) !== 'lab') return false
  if (!(report.result ?? []).some((reference) => Boolean(reference?.reference))) return false

  const hasConclusion = Boolean(report.conclusion?.trim())
  const hasConclusionCode = Array.isArray(report.conclusionCode)
    ? report.conclusionCode.length > 0
    : Boolean(report.conclusionCode)
  const hasNarrativeNote = (report.note ?? []).some((note) => Boolean(note?.text?.trim()))
  const hasReportAttachment = (report.presentedForm ?? []).length > 0
  const hasImagingStudy = (report.imagingStudy ?? []).length > 0

  return !hasConclusion
    && !hasConclusionCode
    && !hasNarrativeNote
    && !hasReportAttachment
    && !hasImagingStudy
}

// 健康存摺 SDK r8 combines imaging and pathology reports. Older converted
// bundles did not preserve that source-section signal, so their NHI order code
// and title remain the compatibility fallback. Never inspect the conclusion:
// an unrelated report may mention a prior X-ray, CT, biopsy, or pathology.
const NHI_IMAGING_ORDER_CODE = /^(?:32|33)\d{3}[A-Z]$/i
const NHI_IMAGING_OR_PATHOLOGY_ORDER_CODES = new Set([
  '18001C', // Electrocardiography (EC/EKG)
  '18005C', // Echocardiography
  '18007C', // Color Doppler echocardiography
  '19005C', // Ultrasonography, other
  '19009C', // Abdominal ultrasonography
  '21010C', // Bladder ultrasonography
  '15001C', // Cytopathology
  '15017C', // Cytopathology
  '25003C', // Surgical pathology, level III
  '25004C', // Surgical pathology, level IV
  '25006B', // Surgical pathology
  '25012B', // Immunohistochemistry
  '25024C', // Surgical pathology, level V
  '25025C', // Surgical pathology, level VI
  '30103B', // Pathology
  '30105B', // Pathology
])
// NHI report category-2 (imaging/check) orders from the NHI upload
// specification effective 2026-01-01, kept identical to the medcloud2 bridge's
// NHI_NON_PATHOLOGY_REPORT_ORDER_CODES. Only these exact codes may override an
// explicit Pathology category: the wider 32xxx/33xxx range also holds
// image-guided biopsies (e.g. 33103B CT-guided biopsy) whose report can be
// pathology. 19007C (ultrasound-guided biopsy) is excluded for the same reason.
const NHI_NON_PATHOLOGY_REPORT_ORDER_CODES = new Set([
  // X-ray
  '32001C', '32002C', '32006C', '32007C', '32008C', '32009C', '32010C',
  '32011C', '32012C', '32013C', '32014C', '32015C', '32016C', '32017C',
  '32018C', '32022C', '32023C', '33005B', '33012B',
  '33070B', '33071B', '33072B', // CT
  '33084B', '33085B', // MRI
  '33074B', '33075B', // Vascular interventions
  '28002C', '28016C', '28017C', '28023C', // Endoscopy
  '17008B', '20001C', '20019B', '20023B', // Electroneurodiagnostic
  '18001C', '18015B', '18019C', // Electrocardiac
  '18008C', '18010C', '18041B', '20013C', '20026B', // Vascular ultrasound
  '18020B', '18022B', '33076B', '33077B', // Cardiac catheterization
  '26025B', '26029B', '26072B', // Nuclear medicine
  '17003C', '17004C', '17006C', '17019C', // Pulmonary function
  '18005C', '18006C', '18007C', '18033B', // Cardiac ultrasound
  '19010C', // Obstetric ultrasound
  '19001C', '19002B', '19003C', '19005C', '19009C', '19012C', '19014C',
  '19015C', '19016C', '19017C', '19018C', '21008C', '23504C', // Ultrasound
])
const NHI_PATHOLOGY_ORDER_CODES = new Set([
  '15001C', // Cytopathology
  '15017C', // Cytopathology
  '25003C', // Surgical pathology, level III
  '25004C', // Surgical pathology, level IV
  '25006B', // Surgical pathology
  '25012B', // Immunohistochemistry
  '25024C', // Surgical pathology, level V
  '25025C', // Surgical pathology, level VI
  '30103B', // Pathology
  '30105B', // Pathology
])
const V2_PATHOLOGY_CATEGORY_CODES = new Set([
  'sp', // Surgical Pathology
  'cp', // Cytopathology
  'pat', // Pathology (legacy/deprecated in v2.9, still accepted)
  'cg', // Cytogenetics in the NHI imaging/pathology report source
  'ge', // Genetics in the NHI imaging/pathology report source
  'path', 'cyt', // Legacy aliases seen in imported bundles
])
const V2_IMAGING_CATEGORY_CODES = new Set([
  'rad', 'img',
  'ct', 'nmr', 'rx',
  'rus', 'cus', 'ous', 'vus',
  'nms', 'xrc',
  'ec', // Electrocardiac reports share the NHI imaging/pathology source
  'oth', // Endoscopy/other reports share the NHI imaging/pathology source
  'mr', 'us', // Legacy aliases seen in imported bundles
])
const PATHOLOGY_ORDER_TITLE_PATTERNS = [
  /\bpatholog(?:y|ic|ical)?\b/i,
  /\bhistopatholog(?:y|ic|ical)?\b/i,
  /\bcytolog(?:y|ic|ical)?\b/i,
  /\bbiopsy\b/i,
  /病理|組織切片|細胞學/,
]
const IMAGING_OR_PATHOLOGY_ORDER_TITLE_PATTERNS = [
  /\bx[\s-]?ray\b/i,
  /\bradiograph(?:y|ic)?\b/i,
  /\bcomputed tomography\b/i,
  /\bct(?:\s+scan|\s+(?:chest|brain|head|neck|abdomen|pelvis|spine))\b/i,
  /\bmagnetic resonance\b/i,
  /\bmri?\b/i,
  /\bultrasound\b/i,
  /\bultrasonograph(?:y|ic)?\b/i,
  /\bsonograph(?:y|ic)?\b/i,
  /\bmammograph(?:y|ic)?\b/i,
  /\bpet(?:\s*[-/]?\s*ct|\s+scan)\b/i,
  /\bpatholog(?:y|ic|ical)?\b/i,
  /\bhistopatholog(?:y|ic|ical)?\b/i,
  /\bcytolog(?:y|ic|ical)?\b/i,
  /\bbiopsy\b/i,
  /[XＸ]光/,
  /放射(?:線|學)|影像醫學/,
  /電腦斷層|磁振|核磁共振/,
  /超音波|超聲波/,
  /乳房攝影|核子醫學|正子造影/,
  /病理|組織切片|細胞學/,
]

/**
 * True when the report's order is an NHI category-2 (imaging/check) report
 * code. Such a report is never a pathology report, whatever its category or
 * narrative says.
 */
export function hasNhiNonPathologyReportOrderCode(report?: Pick<DiagnosticReportLike, 'code'> | null): boolean {
  return (report?.code?.coding ?? []).some((coding) => {
    const code = coding.code?.trim().toUpperCase()
    return !!code && NHI_NON_PATHOLOGY_REPORT_ORDER_CODES.has(code)
  })
}

function collectCategoryTokens(input?: CodeableConcept | CodeableConcept[]): Set<string> {
  const concepts = Array.isArray(input) ? input : input ? [input] : []
  const tokens = new Set<string>()
  for (const concept of concepts) {
    if (concept?.text) tokens.add(concept.text.toLowerCase())
    concept?.coding?.forEach((coding: any) => {
      if (coding?.code) tokens.add(coding.code.toLowerCase())
      if (coding?.display) tokens.add(coding.display.toLowerCase())
      if (coding?.system) tokens.add(coding.system.toLowerCase())
    })
  }
  return tokens
}

function isPathologyCategory(category?: CodeableConcept | CodeableConcept[]): boolean {
  const concepts = Array.isArray(category) ? category : category ? [category] : []
  let hasExplicitImagingCode = false

  for (const concept of concepts) {
    for (const coding of concept?.coding ?? []) {
      const system = coding.system?.toLowerCase() || ''
      const code = coding.code?.toLowerCase() || ''
      if (V2_PATHOLOGY_CATEGORY_CODES.has(code)) return true
      if (
        (system.includes('v2-0074') && V2_IMAGING_CATEGORY_CODES.has(code))
        || (system.includes('observation-category') && code === 'imaging')
      ) {
        hasExplicitImagingCode = true
      }
    }
  }

  if (hasExplicitImagingCode) return false
  const categoryText = concepts.flatMap((concept) => [
    concept?.text,
    ...(concept?.coding ?? []).map((coding) => coding.display),
  ]).filter((value): value is string => !!value).join(' ')
  return PATHOLOGY_ORDER_TITLE_PATTERNS.some((pattern) => pattern.test(categoryText))
}

export function inferGroupFromCategory(category?: CodeableConcept | CodeableConcept[]): ReportGroup {
  const concepts = Array.isArray(category) ? category : category ? [category] : []

  if (isCancerScreeningCategory(concepts)) return 'cancer-screening'
  
  // First, check for FHIR standard codes
  for (const concept of concepts) {
    if (concept?.coding) {
      for (const coding of concept.coding) {
        const system = coding.system?.toLowerCase() || ''
        const code = coding.code?.toLowerCase() || ''

        if (system === HEALTH_BANK_SDK_SECTION_SYSTEM.toLowerCase() && code === 'r8') {
          return 'imaging'
        }
        
        // Check for observation-category system
        if (system.includes('observation-category')) {
          if (code === 'procedure') {
            return 'procedures'
          }
          if (code === 'laboratory') {
            return 'lab'
          }
          if (code === 'imaging') {
            return 'imaging'
          }
          if (code === 'vital-signs') {
            return 'vitals'
          }
        }
        
        // Check v2-0074 Diagnostic Service Section ID
        if (system.includes('v2-0074')) {
          if (code === 'lab' || code === 'hm' || code === 'ch' || code === 'mb') {
            return 'lab'
          }
          if (
            V2_IMAGING_CATEGORY_CODES.has(code)
            // Pathology shares the broad imaging/pathology data scope. The
            // Reports UI refines it into a separate display group below.
            || V2_PATHOLOGY_CATEGORY_CODES.has(code)
          ) {
            return 'imaging'
          }
        }
        
        // Check SNOMED CT codes
        if (system.includes('snomed')) {
          // Common SNOMED codes for imaging
          if (['363679005', '77477000', '363680008'].includes(code)) {
            return 'imaging'
          }
          // Common SNOMED codes for laboratory
          if (['15220000', '108252007'].includes(code)) {
            return 'lab'
          }
        }
        
        // Check LOINC system
        if (system.includes('loinc')) {
          const display = coding.display?.toLowerCase() || ''
          if (display.includes('radiology') || display.includes('imaging')) {
            return 'imaging'
          }
          if (display.includes('laboratory') || display.includes('lab')) {
            return 'lab'
          }
        }
      }
    }
  }
  
  // Fallback to keyword matching (case-insensitive)
  const tokens = collectCategoryTokens(category)
  const tokenArray = Array.from(tokens)
  
  if (tokenArray.some((token) => token === "procedure")) {
    return "procedures"
  }
  
  if (tokenArray.some((token) => 
    token.includes("vital") || 
    token === "vital-signs"
  )) {
    return "vitals"
  }
  
  if (tokenArray.some((token) => 
    token.includes("lab") || 
    token.includes("laboratory") || 
    token.includes("chemistry") || 
    token.includes("hematology")
  )) {
    return "lab"
  }
  
  if (tokenArray.some((token) => 
    token.includes("img") || 
    token.includes("imaging") || 
    token.includes("radiology") || 
    token.includes("pathology") ||
    token.includes("histology") ||
    token.includes("cytology") ||
    token.includes("ct") || 
    token.includes("mri") || 
    token.includes("x-ray") || 
    token.includes("ultrasound")
  )) {
    return "imaging"
  }
  
  return "other"
}

/**
 * Classify a DiagnosticReport using its explicit FHIR category first, then
 * linked ImagingStudy metadata, and finally narrow NHI code/title rules for
 * older category-less Health Bank SDK r8 reports. The broad `imaging` group
 * intentionally contains both imaging and pathology for AI/data-selection
 * consumers; the Reports UI refines it with inferReportDisplayGroup.
 */
export function inferGroupFromDiagnosticReport(report?: DiagnosticReportLike | null): ReportGroup {
  if (!report) return 'other'

  const isHealthBankSdkR8 = report.meta?.tag?.some((tag) =>
    tag.system?.toLowerCase() === HEALTH_BANK_SDK_SECTION_SYSTEM.toLowerCase()
    && tag.code?.toLowerCase() === 'r8',
  )
  if (isHealthBankSdkR8) return 'imaging'

  const categoryGroup = inferGroupFromCategory(report.category)
  if (categoryGroup !== 'other') return categoryGroup
  if ((report.imagingStudy?.length ?? 0) > 0) return 'imaging'

  const codings = report.code?.coding ?? []
  const orderCodes = codings
    .map((coding) => coding.code?.trim().toUpperCase())
    .filter((code): code is string => !!code)
  if (orderCodes.some((code) =>
    NHI_IMAGING_ORDER_CODE.test(code) || NHI_IMAGING_OR_PATHOLOGY_ORDER_CODES.has(code),
  )) {
    return 'imaging'
  }

  const orderTitle = [
    report.code?.text,
    ...codings.map((coding) => coding.display),
  ].filter((value): value is string => !!value).join(' ')
  if (IMAGING_OR_PATHOLOGY_ORDER_TITLE_PATTERNS.some((pattern) => pattern.test(orderTitle))) {
    return 'imaging'
  }

  return 'other'
}

/**
 * Refine the broad imaging/pathology scope into the mutually exclusive groups
 * shown by ReportsCard. Explicit FHIR category wins, followed by reviewed NHI
 * pathology codes and the report order name. Report conclusions are never
 * inspected because mentioning a biopsy or pathology result is not proof that
 * the current DiagnosticReport is itself a pathology report.
 */
export function inferReportDisplayGroup(
  report?: DiagnosticReportLike | null,
): ReportDisplayGroup {
  if (!report) return 'other'

  const categoryGroup = inferGroupFromCategory(report.category)
  if (categoryGroup !== 'other' && categoryGroup !== 'imaging') return categoryGroup

  // An NHI category-2 report order (X-ray/CT/MRI, ultrasound, endoscopy,
  // cardiac…) names the exam itself. Older MediCloud bundles tagged
  // such reports Pathology when the narrative quoted the patient's
  // pathological diagnosis; the order code wins.
  if (hasNhiNonPathologyReportOrderCode(report)) return 'imaging'
  if (isPathologyCategory(report.category)) return 'pathology'
  if (categoryGroup === 'imaging') return 'imaging'

  const codings = report.code?.coding ?? []
  const orderCodes = codings
    .map((coding) => coding.code?.trim().toUpperCase())
    .filter((code): code is string => !!code)
  if (orderCodes.some((code) => NHI_PATHOLOGY_ORDER_CODES.has(code))) {
    return 'pathology'
  }

  const orderTitle = [
    report.code?.text,
    ...codings.map((coding) => coding.display),
  ].filter((value): value is string => !!value).join(' ')
  if (PATHOLOGY_ORDER_TITLE_PATTERNS.some((pattern) => pattern.test(orderTitle))) {
    return 'pathology'
  }

  return inferGroupFromDiagnosticReport(report)
}

export function inferGroupFromObservation(observation: any): ReportGroup {
  if (!observation) return "other"
  const group = inferGroupFromCategory(observation.category)
  if (group !== "other") return group
  
  const codeText = (observation.code?.text || observation.code?.coding?.[0]?.display || "").toLowerCase()
  if (codeText.includes("x-ray") || codeText.includes("ct") || codeText.includes("mri") || codeText.includes("ultrasound")) {
    return "imaging"
  }
  if (codeText.includes("lab") || codeText.includes("panel") || codeText.includes("blood")) {
    return "lab"
  }
  return "other"
}
