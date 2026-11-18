import { fhirDay, type HfInput } from './contract'

export type HfDiagnosisQuickChoice = 'outpatient' | 'inpatient'
export interface HfPhysicianDiagnosisDraft { quickChoice?: HfDiagnosisQuickChoice; code: string; encounters: string[]; ranks: Record<string, number>; confirmed: boolean }
export interface HfPhysicianDiagnosis {
  source: 'physician-attestation'
  code: 'I50.9'
  confirmedAt: string
  visits: { reference: string; date: string; encounterClass: string; rank: number }[]
}
export const emptyHfDiagnosisDraft = (): HfPhysicianDiagnosisDraft => ({ code: '', encounters: [], ranks: {}, confirmed: false })
const ICD10 = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/icd-10-cm-2023-tw'

/** An HF diagnosis (ICD-10-CM I50.x) already linked to the visit; it is moved instead of duplicated. */
function existingHf(input: HfInput, encounter: string) {
  return input.bundle.entry.find((item: any) => item.resource.resourceType === 'Condition' && item.resource.encounter?.reference === encounter
    && item.resource.code?.coding?.some((coding: any) => /icd-10-cm/.test(coding.system ?? '') && /^I50/i.test(coding.code)))
}
/** The upstream model only counts HF diagnoses ranked 1–3 (verified 2026-11-18); supplemented HF is placed at rank 2. */
export const HF_SUPPLEMENT_RANK = 2
const HF_COUNTED_RANK = 3

/** Only actual, completed, already-projected same-patient/hospital visits may receive an attested diagnosis. */
export function hfDiagnosisVisits(input: HfInput): { reference: string; date: string; encounterClass: string }[] {
  return input.bundle.entry.filter((entry: any) => entry.resource.resourceType === 'Encounter'
    && entry.resource.status === 'finished' && ['AMB', 'IMP', 'EMER'].includes(entry.resource.class?.code)
    && !(entry.resource.type ?? []).some((type: any) => (type.coding ?? []).some((coding: any) => coding.code === '08' && /case-type/.test(coding.system ?? '')))
    && fhirDay(entry.resource.period?.start) === entry.resource.period.start && entry.resource.period.start <= input.indexDate)
    .map((entry: any) => ({ reference: entry.fullUrl as string, date: entry.resource.period.start as string, encounterClass: entry.resource.class.code as string }))
    .sort((a: { date: string }, b: { date: string }) => b.date.localeCompare(a.date))
}

/** Provenance stays in the in-memory request context; only minimal Conditions enter the upstream Bundle. */
export function withPhysicianHfDiagnosis(base: HfInput, draft: HfPhysicianDiagnosisDraft, uuid = () => crypto.randomUUID(), now = () => new Date().toISOString()): HfInput {
  if (!draft.confirmed) return base
  if (draft.code !== 'I50.9' || !draft.encounters.length || new Set(draft.encounters).size !== draft.encounters.length) throw new Error('physician-diagnosis-invalid')
  const eligible = hfDiagnosisVisits(base)
  const visits = draft.encounters.map(reference => {
    const visit = eligible.find(visit => visit.reference === reference)
    if (!visit) throw new Error('physician-diagnosis-invalid')
    const rank = draft.ranks[reference]
    if (!Number.isInteger(rank) || rank < 1 || rank > 50) throw new Error('physician-diagnosis-invalid')
    return { ...visit, rank }
  })
  const patient = base.bundle.entry.find((entry: any) => entry.resource.resourceType === 'Patient')
  if (!patient) throw new Error('physician-diagnosis-invalid')
  const additions: any[] = []
  const entries = base.bundle.entry.map((entry: any) => {
    if (!draft.encounters.includes(entry.fullUrl)) return entry
    const rank = draft.ranks[entry.fullUrl]
    const existingReference = existingHf(base, entry.fullUrl)?.fullUrl
    // The confirmed HF takes the chosen rank; other diagnoses at or after it move down by one in this request only.
    const others = (entry.resource.diagnosis ?? []).filter((dx: any) => dx.condition.reference !== existingReference)
    const shift = others.some((dx: any) => dx.rank === rank)
    const shifted = others.map((dx: any) => shift && dx.rank >= rank ? { ...dx, rank: dx.rank + 1 } : dx)
    if (existingReference) return { ...entry, resource: { ...entry.resource, diagnosis: [...shifted, { condition: { reference: existingReference }, rank }] } }
    const id = uuid()
    const condition = { reference: 'urn:uuid:' + id }
    additions.push({ fullUrl: condition.reference, resource: { resourceType: 'Condition', id,
      subject: { reference: patient.fullUrl }, encounter: { reference: entry.fullUrl }, code: { coding: [{ system: ICD10, code: 'I50.9' }] } } })
    return { ...entry, resource: { ...entry.resource, diagnosis: [...shifted, { condition, rank }] } }
  })
  return { ...base, bundle: { ...base.bundle, entry: [...entries, ...additions] },
    counts: { ...base.counts, Condition: (base.counts.Condition ?? 0) + additions.length },
    gaps: base.gaps.filter(gap => gap.code !== 'index-diagnosis-missing' || !draft.encounters.includes(base.indexEncounterReference ?? '')),
    physicianDiagnosis: { source: 'physician-attestation', code: 'I50.9', confirmedAt: now(), visits } }
}

/** Suggest existing dated encounters only. The caller applies the draft only after an explicit user selection; opening the calculator never applies it. */
export function suggestHfDiagnosis(input: HfInput, choice: HfDiagnosisQuickChoice): HfPhysicianDiagnosisDraft | null {
  const needed = choice === 'outpatient' ? 2 : 1
  const eligible = hfDiagnosisVisits(input).filter(visit => visit.encounterClass === (choice === 'outpatient' ? 'AMB' : 'IMP'))
  const index = eligible.find(visit => visit.reference === input.indexEncounterReference)
  if (choice === 'outpatient' && !index) return null
  const visits = (choice === 'outpatient' ? [index!, ...eligible.filter(visit => visit.reference !== index!.reference)] : eligible).slice(0, needed)
  if (visits.length !== needed) return null
  const ranks: Record<string, number> = {}
  for (const visit of visits) {
    const encounter = input.bundle.entry.find((entry: any) => entry.fullUrl === visit.reference).resource
    const existing = existingHf(input, visit.reference)
    const knownRank = existing && encounter.diagnosis?.find((dx: any) => dx.condition.reference === existing.fullUrl)?.rank
    const rank = knownRank && knownRank <= HF_COUNTED_RANK ? knownRank : HF_SUPPLEMENT_RANK
    ranks[visit.reference] = rank
  }
  return { quickChoice: choice, code: 'I50.9', encounters: visits.map(visit => visit.reference), ranks, confirmed: false }
}
