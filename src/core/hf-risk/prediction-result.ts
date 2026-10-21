import { HF_DRY_RUN_CLAIMS, type HfInput, type HfDryRunClaim, type HfDryRunResult } from './contract'

export interface HfPredictionScore {
  schemaVersion: 1; verdict: 'scored'; claim: HfDryRunClaim; indexDate: string
  probability: number; tier: 'low' | 'intermediate' | 'high'; horizonMonths: 1 | 3
  computedAt: string; notes: string[]
  model: { name: string; versions: { type: string; value: string }[] }
  observedIncidence?: { rate: number; ciLow: number; ciHigh: number; tierShare: number; patients: number; basis: string }
  requestId?: string; adapterVersion?: string; checkedAt?: string
}
export type HfPredictionResult = HfPredictionScore | (HfDryRunResult & { schemaVersion: 1; verdict: 'refused'; claim: HfDryRunClaim; indexDate: string })
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const keys = (v: Record<string, any>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k))
const text = (v: unknown, max = 500): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)
const rate = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
/** Accept only the service's validated DTO, never an arbitrary upstream FHIR Bundle. */
export function parseHfPredictionResult(status: number, value: unknown, input: HfInput): HfPredictionResult {
  const bad = () => { throw new Error('invalid-prediction-response') }
  if (!object(value) || value.schemaVersion !== 1 || value.claim !== input.claim || value.indexDate !== input.indexDate || !HF_DRY_RUN_CLAIMS.includes(value.claim)) return bad()
  if (status === 422) {
    if (!keys(value, ['schemaVersion', 'verdict', 'claim', 'indexDate', 'issues']) || value.verdict !== 'refused' || !Array.isArray(value.issues) || !value.issues.length || value.issues.length > 50
      || !value.issues.every((i: unknown) => object(i) && keys(i, ['severity','code','text']) && ['fatal','error','warning','information'].includes(i.severity) && text(i.code,80) && text(i.text))
      || !value.issues.some((i: any) => ['error','fatal'].includes(i.severity))) return bad()
    return value as HfPredictionResult
  }
  if (status !== 200 || !keys(value, ['schemaVersion','verdict','claim','indexDate','probability','tier','horizonMonths','computedAt','notes','model','observedIncidence'])
    || value.verdict !== 'scored' || !rate(value.probability) || !['low','intermediate','high'].includes(value.tier)
    || value.horizonMonths !== (input.claim === 'P1_CD_mortality_1m' ? 1 : 3)
    || !text(value.computedAt,64) || !/^\d{4}-\d{2}-\d{2}T/.test(value.computedAt) || !Number.isFinite(Date.parse(value.computedAt))
    || !Array.isArray(value.notes) || value.notes.length > 50 || !value.notes.every((n: unknown) => text(n,1000))
    || !object(value.model) || !keys(value.model,['name','versions']) || !text(value.model.name,200)
    || !Array.isArray(value.model.versions) || !value.model.versions.length || value.model.versions.length > 20
    || !value.model.versions.every((v: unknown) => object(v) && keys(v,['type','value']) && text(v.type,80) && text(v.value,500))
    || new Set(value.model.versions.map((v: any) => v.type)).size !== value.model.versions.length
    || !value.model.versions.some((v: any) => v.type === 'claim' && v.value === input.claim)
    || !value.model.versions.some((v: any) => v.type === 'locked-package-manifest-sha256' && /^[0-9a-f]{64}$/i.test(v.value))
    || !value.model.versions.some((v: any) => v.type === 'model-sha256' && (/^[0-9a-f]{64}$/i.test(v.value)
      || input.claim === 'P1_CD_mortality_3m' && /^m1:[0-9a-f]{64};m2:[0-9a-f]{64}$/i.test(v.value)))) return bad()
  const observed = value.observedIncidence
  if (observed !== undefined && (!object(observed) || !keys(observed,['rate','ciLow','ciHigh','tierShare','patients','basis'])
    || !rate(observed.rate) || !rate(observed.ciLow) || !rate(observed.ciHigh) || !rate(observed.tierShare)
    || observed.ciLow > observed.rate || observed.rate > observed.ciHigh || !Number.isSafeInteger(observed.patients) || observed.patients < 1 || !text(observed.basis,500))) return bad()
  return value as HfPredictionScore
}
