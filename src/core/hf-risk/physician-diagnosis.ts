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
    const existing = base.bundle.entry.find((item: any) => item.resource.resourceType === 'Condition' && item.resource.encounter?.reference === entry.fullUrl
      && item.resource.code?.coding?.some((coding: any) => /icd-10-cm/.test(coding.system ?? '') && coding.code.replace('.', '').toUpperCase() === 'I509'))
    const existingReference = existing?.fullUrl
    if ((entry.resource.diagnosis ?? []).some((dx: any) => dx.rank === rank && dx.condition.reference !== existingReference)) throw new Error('physician-diagnosis-rank-conflict')
    if (existing) {
      const old = entry.resource.diagnosis?.find((dx: any) => dx.condition.reference === existingReference)
      if (old?.rank && old.rank !== rank) throw new Error('physician-diagnosis-rank-conflict')
      return { ...entry, resource: { ...entry.resource, diagnosis: [...(entry.resource.diagnosis ?? []).filter((dx: any) => dx.condition.reference !== existingReference), { condition: { reference: existingReference }, rank }] } }
    }
    const id = uuid()
    const condition = { reference: 'urn:uuid:' + id }
    additions.push({ fullUrl: condition.reference, resource: { resourceType: 'Condition', id,
      subject: { reference: patient.fullUrl }, encounter: { reference: entry.fullUrl }, code: { coding: [{ system: ICD10, code: 'I50.9' }] } } })
    return { ...entry, resource: { ...entry.resource, diagnosis: [...(entry.resource.diagnosis ?? []), { condition, rank }] } }
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
    const existing = input.bundle.entry.find((entry: any) => entry.resource.resourceType === 'Condition' && entry.resource.encounter?.reference === visit.reference
      && entry.resource.code?.coding?.some((coding: any) => /icd-10-cm/.test(coding.system ?? '') && coding.code.replace('.', '').toUpperCase() === 'I509'))
    const knownRank = existing && encounter.diagnosis?.find((dx: any) => dx.condition.reference === existing.fullUrl)?.rank
    const rank = knownRank ?? Math.max(1, encounter.diagnosis?.length ?? 0, ...(encounter.diagnosis ?? []).map((dx: any) => dx.rank ?? 0)) + 1
    if (!Number.isInteger(rank) || rank < 1 || rank > 50) return null
    ranks[visit.reference] = rank
  }
  return { quickChoice: choice, code: 'I50.9', encounters: visits.map(visit => visit.reference), ranks, confirmed: false }
}
