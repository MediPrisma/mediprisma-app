// Shared Zod input schemas for FHIR query tools.
// Single source of truth — `fhir-tools.ts` imports from here so the LLM
// surface stays stable.
import { z } from 'zod'

// Re-usable parameter pieces ------------------------------------------------
const limitParam = z.number().int().positive().optional()
  .describe('Max records to return (default 50). Use small values to save tokens when sampling.')
const summarizeParam = z.boolean().optional()
  .describe('If true, return only counts + dates per row (no values / details). Use for token-light summaries.')

// Existing tools (with new optional knobs) ----------------------------------
export const conditionsSchema = z.object({
  category: z.string().optional().describe('Filter by category (e.g., "problem-list-item", "encounter-diagnosis")'),
  clinicalStatus: z.string().optional().describe('Filter by clinical status (e.g., "active", "resolved")'),
  limit: limitParam,
})

export const medicationsSchema = z.object({
  query: z.string().trim().min(1).max(120).optional()
    .describe('Case-insensitive substring search across recorded/canonical product name, NHI drug code, ingredient, dose form, ATC code, and ATC class. Use this for "has the patient used X?" questions.'),
  status: z.string().optional().describe('Filter by status (e.g., "active", "completed")'),
  chronic: z.boolean().optional().describe('Filter to chronic medications only (courseOfTherapyType=continuous, 慢箋)'),
  timeRange: z.enum(['last-30-days', 'last-90-days', 'last-180-days', 'last-365-days', 'all']).optional()
    .describe('Server-resolved rolling window ending today. Prefer last-90-days for「過去三個月」so a local model does not need to calculate dates. Explicit dateFrom/dateTo override the corresponding boundary.'),
  dateFrom: z.string().optional().describe('Filter by authoredOn from this date (YYYY-MM-DD)'),
  dateTo: z.string().optional().describe('Filter by authoredOn until this date (YYYY-MM-DD)'),
  limit: limitParam,
})

export const allergiesSchema = z.object({
  type: z.string().optional().describe('Filter by type (e.g., "allergy", "intolerance")'),
  severity: z.enum(['high', 'moderate', 'low']).optional()
    .describe('Filter by criticality level'),
})

export const observationsSchema = z.object({
  category: z.string().optional().describe('Filter by category (e.g., "laboratory", "vital-signs")'),
  code: z.string().optional().describe('Filter by LOINC code or observation type (exact match). Prefer `codeQuery` for fuzzy substring search.'),
  codeQuery: z.string().optional().describe('Case-insensitive substring search on observation name (e.g., "hba1c", "cholesterol"). Use this when LOINC is unknown.'),
  abnormalOnly: z.boolean().optional().describe('Return only values flagged abnormal (interpretation H/L/A/etc, or outside referenceRange)'),
  dateFrom: z.string().optional().describe('Filter observations from this date (YYYY-MM-DD)'),
  dateTo: z.string().optional().describe('Filter observations until this date (YYYY-MM-DD)'),
  limit: limitParam,
  summarize: summarizeParam,
})

export const proceduresSchema = z.object({
  status: z.string().optional().describe('Filter by status (e.g., "completed", "in-progress")'),
  dateFrom: z.string().optional().describe('Filter procedures from this date (YYYY-MM-DD)'),
  dateTo: z.string().optional().describe('Filter procedures until this date (YYYY-MM-DD)'),
  limit: limitParam,
})

export const encountersSchema = z.object({
  class: z.string().optional().describe('Filter by encounter class. Accepts BOTH HL7 v3 ActCode short codes (IMP / AMB / EMER / HH / VR / PHARM) AND friendly names (inpatient / outpatient / emergency / home / virtual / pharmacy). Both directions map automatically.'),
  department: z.string().optional().describe('Case-insensitive substring match on type/serviceType text (e.g., "眼科", "ophthalmology")'),
  institution: z.string().optional().describe('Case-insensitive substring match on serviceProvider/location (e.g., "VGH")'),
  dateFrom: z.string().optional().describe('Filter visits from this date (YYYY-MM-DD)'),
  dateTo: z.string().optional().describe('Filter visits until this date (YYYY-MM-DD)'),
  limit: limitParam,
  summarize: summarizeParam,
})

export const encounterDiagnosisSearchSchema = z.object({
  query: z.string().trim().min(1).max(120)
    .describe('ICD code or diagnosis text to look for in every visit\'s recorded diagnoses / reasons, e.g. "R35.0", "R350", "頻尿", "E11". Matching ignores case, dots, spaces and dashes, and a code matches as a prefix (E11 matches E11.9).'),
  dateFrom: z.string().optional().describe('Only visits from this date (YYYY-MM-DD)'),
  dateTo: z.string().optional().describe('Only visits until this date (YYYY-MM-DD)'),
  limit: limitParam,
})

export const diagnosticReportsSchema = z.object({
  category: z.string().optional().describe('Filter by category (e.g., "LAB", "RAD")'),
  query: z.string().optional().describe('Case- and separator-insensitive fuzzy search across report/panel/test name, code, component observation names, conclusion, notes, and attachment titles. Comma-separated test names are matched independently. Use this for "does the patient have X?" questions.'),
  queries: z.array(z.string().min(1)).max(20).optional().describe('When checking multiple specific tests, pass each name separately (for example ["CA125", "CA199"]). Records matching any requested name are returned, together with matchedQueryTerms and unmatchedQueryTerms.'),
  abnormalOnly: z.boolean().optional().describe('Return only reports containing at least one abnormal observation'),
  dateFrom: z.string().optional().describe('Filter reports from this date (YYYY-MM-DD)'),
  dateTo: z.string().optional().describe('Filter reports until this date (YYYY-MM-DD)'),
  limit: limitParam,
  summarize: summarizeParam,
})

export const labResultsByCategorySchema = z.object({
  category: z.enum([
    'cbc',
    'coag',
    'chem',
    'endocrine',
    'lipid',
    'glucose',
    'hep',
    'tumor',
    'urine',
    'bloodgas',
    'serology',
    'immuno',
  ]).describe('Semantic lab category. Use tumor for tumor/cancer markers (腫瘤標記/癌症指數), cbc for blood counts, coag for coagulation, chem for biochemistry/renal/liver/electrolytes, endocrine for hormones, lipid for lipids, glucose for glucose/HbA1c, hep for hepatitis markers, urine for urinalysis, bloodgas for blood gases, serology for viral antigen/serology, and immuno for immunoglobulins, complement (C3/C4), autoantibodies (ANA, dsDNA, RF, ENA, myositis blot). Specific IgE tests against individual triggers (30022C) belong to no category: look them up with searchObservationByName or queryObservations, never conclude their absence from this tool.'),
  withTrend: z.boolean().optional().describe('If true, return up to 10 latest values per analyte. Default false returns the latest value of every analyte in the category.'),
  abnormalOnly: z.boolean().optional().describe('Return only abnormal observations within the selected category.'),
  dateFrom: z.string().optional().describe('Filter observations from this date (YYYY-MM-DD)'),
  dateTo: z.string().optional().describe('Filter observations until this date (YYYY-MM-DD)'),
  limit: z.number().int().positive().max(100).optional().describe('Maximum distinct analytes to return (default 50).'),
})

export const imagingRecordsSchema = z.object({
  query: z.string().optional().describe('Case-insensitive fuzzy search across imaging/pathology report names, codes, conclusions, notes, attachment titles, ImagingStudy descriptions, procedure/reason text, and series metadata.'),
  modality: z.string().optional().describe('Filter by modality text/code (e.g., CT, MR, US, X-ray).'),
  bodySite: z.string().optional().describe('Filter by body-site text/code (e.g., chest, brain, abdomen).'),
  status: z.string().optional().describe('Filter by report/study status (e.g., final, available).'),
  dateFrom: z.string().optional().describe('Filter imaging records from this date (YYYY-MM-DD)'),
  dateTo: z.string().optional().describe('Filter imaging records until this date (YYYY-MM-DD)'),
  limit: limitParam,
  summarize: summarizeParam,
})

export const immunizationsSchema = z.object({
  dateFrom: z.string().optional().describe('Filter immunizations from this date (YYYY-MM-DD)'),
  dateTo: z.string().optional().describe('Filter immunizations until this date (YYYY-MM-DD)'),
  limit: limitParam,
})

export const patientInfoSchema = z.object({})
export const healthSummarySnapshotSchema = z.object({})

// ----------------------------------------------------------------------------
// Phase 3 — cross-resource tools
// ----------------------------------------------------------------------------

export const encounterDetailsSchema = z.object({
  encounterId: z.string().describe('The encounter id returned by queryEncounters or getRecentVisits'),
})

export const activeMedicationsSchema = z.object({
  chronicOnly: z.boolean().optional().describe('Restrict to chronic prescriptions (慢箋) only'),
})

export const observationSearchSchema = z.object({
  query: z.string().describe('Case-insensitive substring of the lab/vital name (e.g., "HbA1c", "creatinine")'),
  withTrend: z.boolean().optional().describe('If true, return up to 10 most recent values for trending; otherwise return latest only'),
  limit: limitParam,
})

export const recentVisitsSchema = z.object({
  limit: z.number().int().positive().optional().describe('How many most-recent visits to return (default 10)'),
  type: z.enum(['outpatient', 'inpatient', 'emergency', 'pharmacy', 'home', 'virtual']).optional()
    .describe('Filter by visit type'),
})

// ----------------------------------------------------------------------------
// Phase 4 — discovery / metadata tools
// ----------------------------------------------------------------------------

export const overviewSchema = z.object({})
export const listDepartmentsSchema = z.object({})
export const listObservationCodesSchema = z.object({})
