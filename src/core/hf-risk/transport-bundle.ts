import { HF_LABS } from './labs'
import { fhirDay, HF_NAMESPACE, type FhirRecord } from './contract'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const keys = (value: any, allowed: string[]) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key))
const array = (value: any) => Array.isArray(value) && value.length > 0
const concept = (value: any, systems: string[]) => keys(value, ['coding']) && array(value.coding) && value.coding.every((item: any) =>
  keys(item, ['system', 'code']) && systems.includes(item.system) && typeof item.code === 'string' && /^[A-Za-z0-9.*_-]{1,64}$/.test(item.code))
const ICD = [
  'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/icd-10-cm-2023-tw',
  'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/icd-9-cm-2001-tw',
  'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/icd-10-cm-2014-tw',
  'http://hl7.org/fhir/sid/icd-10-cm',
  'http://hl7.org/fhir/sid/icd-9-cm',
]
const ICD9 = [ICD[1], 'http://hl7.org/fhir/sid/icd-9-cm']
const PCS = ['https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/icd-10-pcs-2023-tw', 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/icd-10-pcs-2014-tw', 'http://www.cms.gov/Medicare/Coding/ICD10']
/** Server-side privacy boundary. Reject arbitrary clinical Bundles, not just top-level Patient identifiers. */
export function validateHfTransportBundle(value: unknown, indexDate: string): value is FhirRecord {
  const bundle = value as FhirRecord
  if (!fhirDay(indexDate) || !keys(bundle, ['resourceType', 'type', 'entry']) || bundle.resourceType !== 'Bundle'
    || bundle.type !== 'collection' || !array(bundle.entry) || bundle.entry.length > 10000) return false
  const byReference = new Map<string, FhirRecord>()
  for (const entry of bundle.entry) {
    if (!keys(entry, ['fullUrl', 'resource']) || !UUID.test(entry.resource?.id ?? '') || entry.fullUrl !== 'urn:uuid:' + entry.resource.id || byReference.has(entry.fullUrl)) return false
    byReference.set(entry.fullUrl, entry.resource)
  }
  const patients = bundle.entry.filter((item: any) => item.resource.resourceType === 'Patient')
  if (patients.length !== 1) return false
  const patientReference = patients[0].fullUrl
  const ref = (value: any, type: string) => keys(value, ['reference']) && byReference.get(value.reference)?.resourceType === type
  const day = (value: unknown) => typeof value === 'string' && fhirDay(value) === value && value <= indexDate
  const referenceKeys = ['resourceType', 'id', 'subject']
  for (const { resource: resource } of bundle.entry) {
    if (resource.resourceType === 'Patient') {
      if (!keys(resource, ['resourceType', 'id', 'birthDate', 'gender']) || (resource.gender !== undefined && !['male', 'female'].includes(resource.gender))
        || (resource.birthDate !== undefined && !day(resource.birthDate))) return false
      continue
    }
    if (!keys(resource.subject, ['reference']) || resource.subject.reference !== patientReference) return false
    switch (resource.resourceType) {
      case 'Encounter':
        if (!keys(resource, [...referenceKeys, 'status', 'class', 'period', 'diagnosis', 'serviceType', 'type'])
          || !['finished', 'in-progress'].includes(resource.status)
          || !keys(resource.class, ['system', 'code']) || resource.class.system !== 'http://terminology.hl7.org/CodeSystem/v3-ActCode' || !['AMB', 'IMP', 'EMER'].includes(resource.class.code)
          || !keys(resource.period, ['start', 'end']) || !day(resource.period.start)
          || (resource.period.end !== undefined && (!day(resource.period.end) || resource.period.end < resource.period.start))
          || (resource.serviceType && (!concept(resource.serviceType, [HF_NAMESPACE + '/CodeSystem/nhi-func-type']) || !resource.serviceType.coding.every((c: any) => ['AB','AD','22'].includes(c.code))))
          || (resource.type && (!array(resource.type) || !resource.type.every((item: any) => concept(item, [HF_NAMESPACE + '/CodeSystem/nhi-case-type']) && item.coding.every((c: any) => /^\d{2}$/.test(c.code)))))
          || (resource.diagnosis && (!array(resource.diagnosis) || !resource.diagnosis.every((item: any) =>
            keys(item, ['condition', 'rank']) && ref(item.condition, 'Condition') && (item.rank === undefined || (Number.isInteger(item.rank) && item.rank > 0)))))) return false
        break
      case 'Condition':
        if (!keys(resource, [...referenceKeys, 'encounter', 'code']) || !ref(resource.encounter, 'Encounter') || !concept(resource.code, ICD)
          || !resource.code.coding.every((code: any) => !ICD9.includes(code.system) ? /^[A-Z][0-9][A-Z0-9](?:\.?[A-Z0-9]{1,4})?$/.test(code.code) : /^(?:\d{3}|V\d{2}|E\d{3})(?:\.?\d{1,2})?$/.test(code.code))) return false
        break
      case 'Procedure':
        if (!keys(resource, [...referenceKeys, 'status', 'encounter', 'performedDateTime', 'code']) || resource.status !== 'completed'
          || !ref(resource.encounter, 'Encounter') || !day(resource.performedDateTime)
          || !concept(resource.code, [...ICD9, ...PCS]) || !resource.code.coding.every((c: any) => PCS.includes(c.system) ? /^[0-9A-HJ-NP-Z]{7}$/.test(c.code) : /^\d{2}(?:\.?\d{1,2})?$/.test(c.code))) return false
        break
      case 'Observation':
        if (!keys(resource, [...referenceKeys, 'status', 'category', 'code', 'effectiveDateTime', 'valueQuantity'])
          || resource.status !== 'final' || !day(resource.effectiveDateTime)
          || !array(resource.category) || !resource.category.every((item: any) => concept(item, ['http://terminology.hl7.org/CodeSystem/observation-category']))
          || !concept(resource.code, [HF_NAMESPACE + '/CodeSystem/hf-source-lab-item', 'http://loinc.org'])
          || !keys(resource.valueQuantity, ['value', 'unit', 'code', 'system', 'comparator'])
          || typeof resource.valueQuantity.value !== 'number' || !Number.isFinite(resource.valueQuantity.value)
          || resource.valueQuantity.system !== 'http://unitsofmeasure.org'
          || typeof resource.valueQuantity.code !== 'string' || !/^[A-Za-z0-9%/*._-]{1,24}$/.test(resource.valueQuantity.code)
          || resource.valueQuantity.unit !== resource.valueQuantity.code
          || (resource.valueQuantity.comparator !== undefined && !['<', '<=', '>', '>='].includes(resource.valueQuantity.comparator))) return false
        if (!HF_LABS.some(lab => resource.valueQuantity.code === lab.unit && resource.code.coding.length === 2
          && resource.code.coding.some((code: any) => code.system === 'http://loinc.org' && code.code === lab.loinc[0])
          && resource.code.coding.some((code: any) => code.system === HF_NAMESPACE + '/CodeSystem/hf-source-lab-item' && code.code === lab.key))) return false
        break
      default: return false
    }
  }
  return bundle.entry.some((entry: any) => entry.resource.resourceType === 'Encounter' && entry.resource.class.code === 'AMB'
    && entry.resource.period.start === indexDate && entry.resource.diagnosis?.length
    && !(entry.resource.type ?? []).some((item: any) => item.coding.some((code: any) => code.code === '08')))
}
