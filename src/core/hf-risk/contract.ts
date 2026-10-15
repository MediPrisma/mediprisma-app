import type { HfPhysicianDiagnosis } from './physician-diagnosis'
/** Shared outpatient input and dry-run contracts; scoring uses a separate validated result DTO. */
export const HF_DRY_RUN_CLAIMS = ['P1_CD_mortality_1m', 'P1_CD_mortality_3m'] as const
export type HfDryRunClaim = typeof HF_DRY_RUN_CLAIMS[number]
export const HF_NAMESPACE = 'https://fhir.vghtpe.gov.tw/ig/hf-risk'
export const MEDCLOUD_PROVIDER_SYSTEM = 'https://cloud-wildcatch.invalid/fhir/sid/medcloud-provider'
export const HF_MAX_BYTES = 2 * 1024 * 1024
export type FhirRecord = Record<string, any>
export interface HfGap { code: string; count: number }
/** Browser-only diagnostics. Never put source details in the transport Bundle. */
export interface HfExcludedLab {
  row: number
  name?: string
  codes: string[]
  date?: string
  value?: string
  unit?: string
  unitCode?: string
  status?: string
  reason: string
  valueIssue?: 'value-invalid' | 'unit-missing' | 'unit-unsupported' | 'comparator-invalid'
}
export interface HfSelection { provider: string; encounter: string; claim: HfDryRunClaim }
export interface HfInput {
  bundle: FhirRecord
  indexDate: string
  claim: HfDryRunClaim
  gaps: HfGap[]
  excludedLabs?: HfExcludedLab[]
  physicianDiagnosis?: HfPhysicianDiagnosis
  indexEncounterReference?: string
  counts: Record<string, number>
}
export interface HfDryRunResult {
  checkedAt?: string
  requestId?: string
  adapterVersion?: string
  verdict: 'accepted' | 'refused'
  issues: { severity: string; code: string; text: string }[]
}
/** Full calendar dates only. Never invent a day for a masked birth year. */
export function fhirDay(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) return
  const day = value.slice(0, 10)
  const parsed = new Date(day + 'T00:00:00Z')
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return
  if (value.length > 10 && !Number.isFinite(Date.parse(value))) return
  return day
}
export function taipeiToday(): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-')
}
export function parseHfDryRunResponse(status: number, value: unknown): HfDryRunResult {
  const result = value as FhirRecord | null
  // Reject even a risk value embedded in an extension/valueString.
  if (!result || result.resourceType !== 'OperationOutcome'
    || /RiskAssessment|probabilityDecimal|qualitativeRisk/.test(JSON.stringify(result))
    || !Array.isArray(result.issue) || !result.issue.length
    || ![200, 422].includes(status)) throw new Error('invalid-dry-run-response')
  if (status === 200 && result.issue.some((issue: FhirRecord) => ['error', 'fatal'].includes(issue.severity))) throw new Error('invalid-dry-run-response')
  return {
    verdict: status === 200 ? 'accepted' : 'refused',
    issues: result.issue.slice(0, 50).map((issue: FhirRecord) => ({
      severity: ['fatal', 'error', 'warning', 'information'].includes(issue.severity) ? issue.severity : 'error',
      code: typeof issue.code === 'string' ? issue.code.slice(0, 80) : 'unknown',
      text: String(issue.details?.text ?? issue.diagnostics ?? issue.code ?? 'Unknown input issue').slice(0, 500),
    })),
  }
}
