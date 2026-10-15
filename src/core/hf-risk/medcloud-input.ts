import { normalizeHfRecordSource, type HfRecordSource } from './record-source'
import { fhirDay, taipeiToday, HF_DRY_RUN_CLAIMS, HF_NAMESPACE, MEDCLOUD_PROVIDER_SYSTEM, type FhirRecord, type HfInput, type HfSelection, type HfExcludedLab } from './contract'
import { HF_LABS, normalizeHfLab } from './labs'

const ICD10 = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/icd-10-cm-2023-tw'
const ICD9 = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/icd-9-cm-2001-tw'
const ICD10_SYSTEMS = [ICD10, 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/icd-10-cm-2014-tw', 'http://hl7.org/fhir/sid/icd-10-cm']
const ICD9_SYSTEMS = [ICD9, 'http://hl7.org/fhir/sid/icd-9-cm']
const PCS_SYSTEMS = ['https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/icd-10-pcs-2023-tw', 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/icd-10-pcs-2014-tw', 'http://www.cms.gov/Medicare/Coding/ICD10']
const VOID = ['entered-in-error', 'cancelled', 'not-done', 'refuted']
function coding(concept: FhirRecord | undefined): FhirRecord[] {
  return Array.isArray(concept?.coding) ? concept.coding.filter((item: unknown) => !!item && typeof item === 'object') : []
}
function records(input: unknown): { entry: FhirRecord[]; bundle: FhirRecord; source: HfRecordSource } {
  const bundle = input as FhirRecord | null
  if (!bundle || bundle.resourceType !== 'Bundle' || !Array.isArray(bundle.entry)) throw new Error('bundle-invalid')
  const entry = bundle.entry.filter((item: FhirRecord) => item?.resource && typeof item.resource === 'object')
  if (entry.filter((item: FhirRecord) => item.resource.resourceType === 'Patient').length !== 1) throw new Error('patient-count')
  const normalized = normalizeHfRecordSource(bundle)
  return { entry: normalized.bundle.entry.filter((item: FhirRecord) => item?.resource), bundle: normalized.bundle, source: normalized.source }
}
function lookup(entry: FhirRecord[]) {
  const index = new Map<string, FhirRecord>()
  for (const item of entry) {
    const resource = item.resource
    for (const key of [item.fullUrl, resource.id && resource.resourceType + '/' + resource.id]) {
      if (!key) continue
      if (index.has(key) && index.get(key) !== resource) throw new Error('duplicate-reference')
      index.set(key, resource)
    }
  }
  return (ref: unknown): FhirRecord | undefined => typeof ref === 'string' ? index.get(ref) : undefined
}
function providerOf(organization: FhirRecord | undefined): string | undefined {
  if (organization?.resourceType !== 'Organization') return
  const identifiers = (organization.identifier ?? []).filter((item: FhirRecord) => item.system === MEDCLOUD_PROVIDER_SYSTEM && typeof item.value === 'string')
  const values = [...new Set(identifiers.map((item: FhirRecord) => item.value))] as string[]
  return values.length === 1 ? values[0] : undefined
}
function diagnoses(resource: FhirRecord, resolve: ReturnType<typeof lookup>, indexDate?: string, unmapped?: () => void): { code: FhirRecord; rank?: number }[] {
  const found: { code: FhirRecord; rank?: number }[] = []
  const add = (concept: FhirRecord | undefined, rank?: number) => {
    for (const item of coding(concept)) {
      if (typeof item.code !== 'string' || typeof item.system !== 'string') { unmapped?.(); continue }
      const value = item.code.toUpperCase()
      const system = [...ICD10_SYSTEMS, ...ICD9_SYSTEMS].includes(item.system) ? item.system : null
      if (!system || !(ICD10_SYSTEMS.includes(system) ? /^[A-Z][0-9][A-Z0-9](?:\.?[A-Z0-9]{1,4})?$/.test(value) : /^(?:\d{3}|V\d{2}|E\d{3})(?:\.?\d{1,2})?$/.test(value))) { unmapped?.(); continue }
      if (!found.some(existing => ICD10_SYSTEMS.includes(existing.code.system) === ICD10_SYSTEMS.includes(system) && existing.code.code === value)) found.push({ code: { system, code: value }, ...(rank && Number.isInteger(rank) ? { rank } : {}) })
    }
  }
  for (const item of resource.diagnosis ?? []) {
    const condition = resolve(item.condition?.reference)
    if (condition?.resourceType === 'Condition' && resolve(condition.subject?.reference) === resolve(resource.subject?.reference)
      && (!indexDate || !condition.recordedDate || (fhirDay(condition.recordedDate) && fhirDay(condition.recordedDate)! <= indexDate)) && !coding(condition.verificationStatus).some(item => VOID.includes(item.code))) add(condition.code, item.rank)
  }
  for (const reason of resource.reasonCode ?? []) add(reason)
  return found
}
export interface HfVisit { reference: string; provider: string; providerName?: string; date: string }
export function medcloudHfVisits(input: unknown, today = taipeiToday()): HfVisit[] {
  const { entry } = records(input)
  const resolve = lookup(entry)
  const patient = entry.find(item => item.resource.resourceType === 'Patient')!.resource
  return entry.flatMap(item => {
    const resource = item.resource
    const date = fhirDay(resource.period?.start)
    const provider = providerOf(resolve(resource.serviceProvider?.reference))
    if (resource.resourceType !== 'Encounter' || resource.class?.code !== 'AMB'
      || VOID.includes(resource.status) || !date || date > today || !provider
      || resolve(resource.subject?.reference) !== patient
      || (resource.type ?? []).some((type: FhirRecord) => coding(type).some(code => code.code === '08' && /case-type/.test(code.system ?? '')))) return []
    const providerName = resolve(resource.serviceProvider?.reference)?.name
    return [{ reference: item.fullUrl ?? 'Encounter/' + resource.id, provider, ...(typeof providerName === 'string' ? { providerName } : {}), date }]
  }).sort((a, b) => b.date.localeCompare(a.date))
}
/** A fresh UUID namespace per preparation; no names, identifiers, raw IDs or narrative leave the browser. */
export function buildMedcloudHfInput(input: unknown, selection: HfSelection, options: { today?: string; uuid?: () => string } = {}): HfInput {
  const { entry, bundle: original, source } = records(input)
  const resolve = lookup(entry)
  const selected = medcloudHfVisits(input, options.today).find(item => item.reference === selection.encounter && item.provider === selection.provider)
  if (!selected || !HF_DRY_RUN_CLAIMS.includes(selection.claim)) throw new Error('index-encounter-invalid')
  const indexDate = selected.date
  const uuid = options.uuid ?? (() => crypto.randomUUID())
  const gaps = new Map<string, number>()
  const excludedLabs: HfExcludedLab[] = []
  const gap = (code: string, count = 1) => gaps.set(code, (gaps.get(code) ?? 0) + count)
  const output: FhirRecord[] = []
  const add = (resource: FhirRecord) => output.push({ fullUrl: 'urn:uuid:' + resource.id, resource })
  const patient = entry.find(item => item.resource.resourceType === 'Patient')!.resource
  const patientId = uuid()
  const subject = { reference: 'urn:uuid:' + patientId }
  const birthDate = fhirDay(patient.birthDate)
  const gender = ['male', 'female'].includes(patient.gender) ? patient.gender : undefined
  if (!birthDate || birthDate > indexDate) gap('patient-birthdate')
  if (!gender) gap('patient-sex')
  add({ resourceType: 'Patient', id: patientId, ...(birthDate && birthDate <= indexDate ? { birthDate } : {}), ...(gender ? { gender } : {}) })
  // A capture-complete flag does not establish feature/time/facility coverage.
  gap('source-validation-pending')
  gap('history-coverage-unverified')
  if (source === 'health-bank') gap('hospital-name-only')
  const tags = Array.isArray(original.meta?.tag) ? original.meta.tag : []
  for (const moduleName of source === 'medcloud' ? ['imue0008', 'imue0060', 'imue0070', 'imue0020'] : []) {
    const statuses = tags.filter((tag: FhirRecord) => /\/module-completeness$/.test(tag.system ?? '') && typeof tag.code === 'string' && tag.code.startsWith(moduleName + '-')).map((tag: FhirRecord) => tag.code.slice(moduleName.length + 1))
    if (!statuses.length) gap('module-unknown:' + moduleName)
    else if (statuses.some((status: string) => !['complete', 'empty'].includes(status))) gap('module-incomplete:' + moduleName)
  }
  const belongs = (resource: FhirRecord) => resolve(resource.subject?.reference) === patient
  const voided = (resource: FhirRecord) => VOID.includes(resource.status) || coding(resource.verificationStatus).some(item => VOID.includes(item.code))
  const provider = (resource: FhirRecord) => {
    const linked = resolve(resource.encounter?.reference)
    const linkedProvider = providerOf(resolve(linked?.serviceProvider?.reference))
    const direct = resource.resourceType === 'Encounter' ? providerOf(resolve(resource.serviceProvider?.reference))
      : undefined
    const performers = (resource.performer ?? []).map((performer: FhirRecord) => providerOf(resolve(performer.reference ?? performer.actor?.reference))).filter(Boolean)
    const values = [...new Set([direct, linkedProvider, ...performers].filter(Boolean))]
    return values.length === 1 ? values[0] : undefined
  }
  const encounterIds = new Map<FhirRecord, string>()
  const inpatientSeen = new Map<string, string>()
  for (const item of entry) {
    const resource = item.resource
    if (resource.resourceType !== 'Encounter' || !belongs(resource)) continue
    if (provider(resource) !== selection.provider) { gap('source-omitted'); continue }
    if (voided(resource)) { gap('void-omitted'); continue }
    const start = fhirDay(resource.period?.start)
    if (!start) { gap('encounter-date'); continue }
    if (start > indexDate) { gap('future-omitted'); continue }
    if (!['AMB', 'EMER', 'IMP'].includes(resource.class?.code)) { gap('encounter-class'); continue }
    const end = fhirDay(resource.period?.end)
    const dx = diagnoses(resource, resolve, indexDate, () => gap('diagnosis-unmapped'))
    // Only exact inpatient episode duplicates are collapsed; no same-day outpatient merging.
    const episode = JSON.stringify([start, end, dx])
    if (resource.class.code === 'IMP' && end && inpatientSeen.has(episode)) { encounterIds.set(resource, inpatientSeen.get(episode)!); gap('encounter-duplicate'); continue }
    const id = uuid()
    if (resource.class.code === 'IMP' && end) inpatientSeen.set(episode, id)
    encounterIds.set(resource, id)
    const mapped: FhirRecord = { resourceType: 'Encounter', id, subject, status: resource.class.code === 'IMP' && (!end || end > indexDate) ? 'in-progress' : 'finished',
      class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: resource.class.code },
      period: { start, ...(end && end <= indexDate ? { end } : {}) } }
    if (resource.class.code === 'AMB' || resource.class.code === 'EMER') {
      const department = coding(resource.serviceType).find(item => item.system === HF_NAMESPACE + '/CodeSystem/nhi-func-type' && ['AB', 'AD', '22'].includes(item.code))
      // No free-text department inference in this adapter.
      if (department) mapped.serviceType = { coding: [{ system: department.system, code: department.code }] }
      else gap('department-unmapped')
      const caseType = (resource.type ?? []).flatMap(coding).find((item: FhirRecord) => /\/nhi-case-type$/.test(item.system ?? '') && /^\d{2}$/.test(item.code ?? ''))
      if (caseType) mapped.type = [{ coding: [{ system: HF_NAMESPACE + '/CodeSystem/nhi-case-type', code: caseType.code }] }]
    }
    const diagnosis: FhirRecord[] = []
    // For an episode still ongoing at the historical index, claims-derived discharge diagnoses cannot establish what was known then.
    if (resource.class.code === 'IMP' && (!end || end > indexDate)) gap('ongoing-diagnoses-omitted')
    else for (const item of dx) {
      const conditionId = uuid()
      add({ resourceType: 'Condition', id: conditionId, subject, encounter: { reference: 'urn:uuid:' + id }, code: { coding: [item.code] } })
      diagnosis.push({ condition: { reference: 'urn:uuid:' + conditionId }, ...(item.rank ? { rank: item.rank } : {}) })
    }
    if (diagnosis.length) mapped.diagnosis = diagnosis
    if (resource.class.code === 'IMP' && diagnosis.some(item => !item.rank)) gap('diagnosis-rank-missing')
    add(mapped)
  }
  // Keep one diagnostic per excluded observation, at the first failing gate.
  // Only observations belonging to this patient reach this helper.
  const text = (value: unknown) => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined
  const omitLab = (resource: FhirRecord, row: number, reason: string) => {
    gap(reason)
    if (resource.resourceType !== 'Observation') return
    const codes = coding(resource.code)
    const quantity = resource.valueQuantity
    const matchedLab = HF_LABS.find(lab => codes.some(code => code.system === 'http://loinc.org' && lab.loinc.includes(code.code)))
    let valueIssue: HfExcludedLab['valueIssue']
    if (reason === 'lab-value-unit') {
      if (typeof quantity?.value !== 'number' || !Number.isFinite(quantity.value)) valueIssue = 'value-invalid'
      else if (!(quantity.code || quantity.unit)) valueIssue = 'unit-missing'
      else if (matchedLab && !normalizeHfLab(matchedLab, { ...quantity, value: 1, comparator: undefined })) valueIssue = 'unit-unsupported'
      else if (quantity.comparator && !['<', '<=', '>', '>='].includes(quantity.comparator)) valueIssue = 'comparator-invalid'
      else valueIssue = 'value-invalid' // Conversion overflow is not an unsupported unit.
    }
    excludedLabs.push({ row, reason,
      ...(valueIssue ? { valueIssue } : {}),
      name: text(resource.code?.text) || codes.map(code => text(code.display)).find(Boolean) || matchedLab?.key,
      codes: codes.map(code => [text(code.system), text(code.code)].filter(Boolean).join(' | ')).filter(Boolean),
      date: text(resource.effectiveDateTime ?? resource.effectivePeriod?.start),
      value: quantity ? [text(quantity.comparator), text(quantity.value)].filter(value => value !== undefined).join(' ') || undefined
        : text(resource.valueString) ?? text(resource.valueCodeableConcept?.text),
      unit: text(quantity?.unit), unitCode: text(quantity?.code), status: text(resource.status),
    })
  }
  for (const [row, item] of entry.entries()) {
    const resource = item.resource
    if (!['Observation', 'Procedure'].includes(resource.resourceType) || !belongs(resource)) continue
    if (provider(resource) !== selection.provider) { omitLab(resource, row + 1, 'source-omitted'); continue }
    if (voided(resource)) { omitLab(resource, row + 1, 'void-omitted'); continue }
    if (resource.resourceType === 'Observation') {
      // NHI cloud and health-bank results carry no workflow status; the bridges mark them unknown.
      // A reported value with a collection date is accepted from those sources; anything else stays strict.
      const unreported = resource.status === 'unknown' && (source === 'medcloud' || source === 'health-bank')
      if (!['final', 'amended', 'corrected'].includes(resource.status) && !unreported) { omitLab(resource, row + 1, 'lab-status'); continue }
      const lab = HF_LABS.find(lab => coding(resource.code).some(code => code.system === 'http://loinc.org' && lab.loinc.includes(code.code)))
      if (!lab) { omitLab(resource, row + 1, 'lab-unmapped'); continue }
      // issued/report/visit dates are not replacements for the collection date.
      const date = fhirDay(resource.effectiveDateTime ?? resource.effectivePeriod?.start)
      if (!date) { omitLab(resource, row + 1, 'lab-date'); continue }
      if (date > indexDate) { omitLab(resource, row + 1, 'future-omitted'); continue }
      const quantity = resource.valueQuantity && normalizeHfLab(lab, resource.valueQuantity)
      if (!quantity) { omitLab(resource, row + 1, 'lab-value-unit'); continue }
      if (unreported) gap('lab-status-unreported')
      add({ resourceType: 'Observation', id: uuid(), subject, status: 'final',
        category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
        code: { coding: [{ system: HF_NAMESPACE + '/CodeSystem/hf-source-lab-item', code: lab.key }, { system: 'http://loinc.org', code: lab.loinc[0] }] },
        effectiveDateTime: date, valueQuantity: quantity })
    } else {
      const date = fhirDay(resource.performedDateTime ?? resource.performedPeriod?.end)
      if (!date) { gap('procedure-date'); continue }
      if (date > indexDate) { gap('future-omitted'); continue }
      const code = coding(resource.code).find(item => typeof item.system === 'string' && typeof item.code === 'string'
        && (PCS_SYSTEMS.includes(item.system) ? /^[0-9A-HJ-NP-Z]{7}$/.test(item.code.toUpperCase()) : ICD9_SYSTEMS.includes(item.system) && /^\d{2}(?:\.?\d{1,2})?$/.test(item.code)))
      const encounter = resolve(resource.encounter?.reference)
      const encounterId = encounter && encounterIds.get(encounter)
      if (!code || !encounterId || encounter?.class?.code !== 'IMP' || resource.status !== 'completed') { gap('procedure-unmapped'); continue }
      add({ resourceType: 'Procedure', id: uuid(), subject, status: 'completed', encounter: { reference: 'urn:uuid:' + encounterId },
        performedDateTime: date, code: { coding: [{ system: code.system, code: code.code.toUpperCase() }] } })
    }
  }
  const counts: Record<string, number> = {}
  for (const item of output) counts[item.resource.resourceType] = (counts[item.resource.resourceType] ?? 0) + 1
  if (!counts.Observation) gap('lab-none')
  const indexEncounter = output.find(item => item.resource.id === encounterIds.get(resolve(selection.encounter)!))?.resource
  if (!indexEncounter?.diagnosis?.length) gap('index-diagnosis-missing')
  return { bundle: { resourceType: 'Bundle', type: 'collection', entry: output }, indexDate, indexEncounterReference: indexEncounter ? 'urn:uuid:' + indexEncounter.id : undefined, claim: selection.claim,
    gaps: [...gaps].map(([code, count]) => ({ code, count })), counts, excludedLabs }
}
