import { QueryClient } from '@tanstack/react-query'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { projectClinicalAggregate } from '@/src/infrastructure/fhir/mappers/clinical-aggregate-projection'
import { reconcileClinicalSources } from '@/src/core/services/clinical-reconciliation'
import { selectCdssClinicalInputs } from '@/features/clinical-decision-support/utils/clinical-record-inputs'
import { CLINICAL_RECORD_VARIANT_EXTENSION } from '@/src/core/services/clinical-record-variant-modifier'
import { stripClinicalCaptureMetadata } from '@/src/core/utils/ai-clinical-scope.utils'
import { createHospitalAwareCdssPatientProfile } from '@/features/clinical-decision-support/utils/hospital-medication-profile'
import { createFhirTools } from '@/src/infrastructure/ai/tools/fhir-tools'
import { buildIpsBundle } from '@/features/ips-export/utils/ips-builder'
import crossSource from '@/e2e/fixtures/cross-source-prescriptions.json'
import { isVghtpeSource } from '@/src/shared/utils/clinical-source-identity'
import { scopeClinicalDataForAi } from '@/src/core/utils/ai-clinical-scope.utils'
import { ALL_DATA_SELECTION, ALL_DATA_FILTERS } from '@/src/shared/constants/data-selection.constants'

const patient = { resourceType: 'Patient', id: 'synthetic' }
const bundle = (resources: any[]) => ({ resourceType: 'Bundle', type: 'collection', entry: [patient, ...resources].map(resource => ({ resource })) })
const observation = (value: number, updated?: string, id = 'glucose') => ({
  resourceType: 'Observation', id, status: 'final', subject: { reference: 'Patient/synthetic' },
  code: { text: 'Glucose' }, effectiveDateTime: '2026-10-01', valueQuantity: { value, unit: 'mg/dL' },
  ...(updated ? { meta: { lastUpdated: updated } } : {}),
})
const parse = (resources: any[]) => projectClinicalAggregate(LocalBundleService.parse(bundle(resources))!.collection)

it.each([false, true])('automatically uses the latest source version in chart and CDSS (reverse=%s)', reverse => {
  const resources = [observation(100, '2026-10-01T00:00:00Z'), observation(120, '2026-10-02T00:00:00Z')]
  const collection = parse(reverse ? resources.reverse() : resources)
  expect(collection.observations).toHaveLength(1)
  expect(collection.observations[0].valueQuantity?.value).toBe(120)
  expect(collection.observations[0].clinicalRecordVariant).toBeUndefined()
  const decision = selectCdssClinicalInputs(collection)
  expect(decision.input.observations).toHaveLength(1)
  expect(decision.input.observations[0].valueQuantity?.value).toBe(120)
  expect(decision.excluded).toEqual([])
  expect(collection.clinicalSource?.graph.nodes.filter(node => node.resource.resourceType === 'Observation')).toHaveLength(2)
})

it('does not merge separate measurements simply because their clinical values match', () => {
  expect(parse([observation(100, undefined, 'first'), observation(100, undefined, 'second')]).observations).toHaveLength(2)
})

it('uses the same deterministic record when timestamps and input order cannot establish chronology', () => {
  const a = observation(100), b = observation(120)
  const forward = parse([a, b]), reverse = parse([b, a])
  expect(forward.observations).toHaveLength(1)
  expect(reverse.observations[0].valueQuantity).toEqual(forward.observations[0].valueQuantity)
})

it('links a report to the automatically selected measurement without a reconciliation step', () => {
  const collection = parse([observation(100, '2026-10-01'), observation(120, '2026-10-02'), {
    resourceType: 'DiagnosticReport', id: 'report', status: 'final', subject: { reference: 'Patient/synthetic' },
    code: { text: 'Glucose report' }, result: [{ reference: 'Observation/glucose' }],
  }])
  expect(collection.diagnosticReports[0].result?.[0].reference).toBe('Observation/' + collection.observations[0].id)
  expect(collection.diagnosticReports[0]._observations?.map(row => row.valueQuantity?.value)).toEqual([120])
})

it('selects the Claim before deriving diagnoses, procedures, weight or visit dates', () => {
  const claim = (updated: string, text: string, value: number) => ({ resourceType: 'Claim', id: 'claim',
    patient: { reference: 'Patient/synthetic' }, created: '2026-10-01', meta: { lastUpdated: updated },
    diagnosis: [{ sequence: 1, diagnosisCodeableConcept: { text } }],
    supportingInfo: [{ category: { coding: [{ code: 'weight' }] }, valueQuantity: { value, code: 'kg' } }],
    procedure: [{ sequence: 1, procedureCodeableConcept: { text } }],
  })
  const collection = parse([claim('2026-10-01', 'Old source version', 70), claim('2026-10-02', 'Selected source version', 80)])
  expect(collection.conditions.map(row => row.code?.text)).toEqual(['Selected source version'])
  expect(collection.procedures.map(row => row.code?.text)).toEqual(['Selected source version'])
  expect(collection.observations.map(row => row.valueQuantity?.value)).toEqual([80])
  expect(selectCdssClinicalInputs(collection).excluded).toEqual([])
})

it('automatically consumes the available valid imported version while preserving its raw modifier', () => {
  const raw = { ...observation(120), modifierExtension: [{ url: CLINICAL_RECORD_VARIANT_EXTENSION, extension: [
    { url: 'groupId', valueString: 'synthetic-group' }, { url: 'classification', valueCode: 'revision' },
    { url: 'variantCount', valuePositiveInt: 2 }, { url: 'reason', valueString: 'Imported versions' },
  ] }] }
  const collection = parse([raw])
  expect(selectCdssClinicalInputs(collection).input.observations[0].valueQuantity?.value).toBe(120)
  expect(collection.observations[0].clinicalRecordVariant).toBeUndefined()
  expect(collection.clinicalSource?.graph.nodes.find(node => node.resource.resourceType === 'Observation')?.resource.modifierExtension).toEqual(raw.modifierExtension)
})

it('keeps cache-roundtripped report references pointing at the selected visible row', () => {
  const resource = { ...observation(100), encounter: { reference: 'Encounter/e' } }
  const report = { resourceType: 'DiagnosticReport', id: 'r', status: 'final', code: { text: 'Synthetic report' }, result: [{ reference: 'Observation/glucose' }] }
  const capture = (generation: string, status: string, withReport = true) => ({ sourceId: 'synthetic', patientScope: 'synthetic', generation,
    resources: [{ resourceType: 'Encounter', id: 'e', status }, resource, ...(withReport ? [report] : [])] })
  const project = (source: ReturnType<typeof reconcileClinicalSources>) => projectClinicalAggregate({ clinicalSource: source,
    observations: source.graph.nodes.filter(node => node.resource.resourceType === 'Observation').map(node => ({ ...node.resource, clinicalSourceNodeKey: node.key })),
    diagnosticReports: source.graph.nodes.filter(node => node.resource.resourceType === 'DiagnosticReport').map(node => ({ ...node.resource, clinicalSourceNodeKey: node.key })),
    encounters: source.graph.nodes.filter(node => node.resource.resourceType === 'Encounter').map(node => ({ ...node.resource, clinicalSourceNodeKey: node.key })),
  } as any)
  const client = new QueryClient()
  client.setQueryData(['reports'], project(reconcileClinicalSources([capture('a', 'finished')])).diagnosticReports)
  const fresh = project(reconcileClinicalSources([capture('b', 'finished')]))
  client.setQueryData(['reports'], fresh.diagnosticReports)
  const source = reconcileClinicalSources([capture('b', 'finished'), capture('c', 'in-progress', false)])
  const after = projectClinicalAggregate({ ...fresh, diagnosticReports: client.getQueryData(['reports']) } as any, source)
  expect(after.observations.map((row: any) => 'Observation/' + row.id)).toContain(after.diagnosticReports[0].result[0].reference)
  expect(JSON.stringify(stripClinicalCaptureMetadata(after))).not.toContain('clinicalSourceProjectedReferences')
})

it('selects an error retraction over an undated final value without treating clinical event dates as version clocks', () => {
  const collection = parse([observation(100), {...observation(120),status:'entered-in-error',effectiveDateTime:'2026-09-01'}])
  expect(collection.observations).toHaveLength(1)
  expect(collection.observations[0].status).toBe('entered-in-error')
  expect(collection.clinicalSource?.graph.nodes.filter(node=>node.resource.resourceType==='Observation')).toHaveLength(2)
})

it('automatically honors a stopped hospital order when update ordering is unavailable', () => {
  const order={resourceType:'MedicationRequest',id:'order',status:'active',authoredOn:'2026-10-01',medicationCodeableConcept:{text:'Meitifen SR FC * tab 75 mg',coding:[{system:'urn:oid:vgh.medication.product',display:'Meitifen SR FC * tab 75 mg'}]}}
  const collection=parse([order,{...order,status:'stopped'}])
  expect(collection.medications).toHaveLength(1)
  expect(collection.medications[0].status).toBe('stopped')
  const profile=createHospitalAwareCdssPatientProfile({...collection,patient:{id:'synthetic',age:70},now:new Date('2026-10-02')})
  expect(profile.hospitalMedicationEvidence?.[0].useState).toBe('not-current')
  expect(profile.facts.currentNsaid).toBeUndefined()
})

it('does not restore a retracted potassium measurement as a current clinical fact',()=>{
  const code={coding:[{system:'http://loinc.org',code:'2823-3'}]}
  const collection=parse([{...observation(4.2),code},{...observation(6.8),code,status:'entered-in-error'}])
  const profile=createHospitalAwareCdssPatientProfile({...collection,patient:{id:'synthetic',age:70},now:new Date('2026-10-02')})
  expect(profile.facts.potassium?.numericValue).toBeUndefined()
})

it('uses a documented later restart instead of always preferring a stopped status',()=>{
  const order={resourceType:'MedicationRequest',id:'order',medicationCodeableConcept:{text:'Synthetic medicine'}}
  const collection=parse([{...order,status:'stopped',meta:{lastUpdated:'2026-10-01'}},{...order,status:'active',meta:{lastUpdated:'2026-10-02'}}])
  expect(collection.medications[0].status).toBe('active')
})

it('selects the same record for every order of three versions with mixed update metadata',()=>{
  for(const value of [1,2,3,4,5,6]) {
    const records=[observation(100,'2026-10-02'),{...observation(120,'2026-10-01'),status:'entered-in-error'},observation(value)]
    const values=new Set<string>()
    for(const order of [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]]) {
      const data=parse(order.map(index=>records[index]))
      expect(data.observations).toHaveLength(1)
      values.add(JSON.stringify([data.observations[0].status,data.observations[0].valueQuantity]))
      expect(data.observations[0].status).not.toBe('entered-in-error')
    }
    expect(values.size).toBe(1)
  }
})

it('selects an explicitly corrected result without mistaking its corrected event date for an older version',()=>{
  const collection=parse([{...observation(100),effectiveDateTime:'2026-10-02'},{...observation(120),status:'corrected',effectiveDateTime:'2026-10-01'}])
  expect(collection.observations[0].status).toBe('corrected')
  expect(collection.observations[0].valueQuantity?.value).toBe(120)
})

it('automatically resolves versions of a referenced medication instead of creating a content-reconciliation task',()=>{
  const collection=parse([{resourceType:'MedicationRequest',id:'prescription',status:'active',medicationReference:{reference:'Medication/drug'}},
    ...['1','2'].map(version=>({resourceType:'Medication',id:'drug',meta:{versionId:version,lastUpdated:`2026-10-0${version}`},code:{text:'Drug version '+version}}))])
  expect(collection.medications[0].medicationCodeableConcept?.text).toBe('Drug version 2')
  expect(collection.medications[0].clinicalMedicationContentUncertainty).toBeUndefined()
})

it('canonicalizes an explicit old-version report reference to the selected visible measurement before Local consumers run',()=>{
  const resources=[{...observation(100,'2026-10-01'),meta:{versionId:'1',lastUpdated:'2026-10-01'}},{...observation(120,'2026-10-02'),meta:{versionId:'2',lastUpdated:'2026-10-02'}},
    {resourceType:'DiagnosticReport',id:'report',status:'final',code:{text:'Synthetic report'},result:[{reference:'Observation/glucose/_history/1'}]}]
  const collection=LocalBundleService.parse(bundle(resources))!.collection
  expect(collection.observations).toHaveLength(1)
  expect(collection.observations[0].valueQuantity?.value).toBe(120)
  expect(collection.diagnosticReports[0].result?.[0].reference).toBe('Observation/'+collection.observations[0].id)
  const projected=projectClinicalAggregate(collection)
  expect(projected.diagnosticReports[0]._observations?.[0]).toBe(projected.observations[0])
  expect(JSON.stringify(buildIpsBundle({patient:{resourceType:'Patient',id:'synthetic'},data:projected}))).not.toContain('clinicalSourceProjectedReferences')
})

it('keeps AI visit details linked to the same automatically selected encounter as the chart',async()=>{
  const collection=parse([{resourceType:'Encounter',id:'visit',status:'in-progress',meta:{lastUpdated:'2026-10-01'},period:{start:'2026-10-01'}},
    {resourceType:'Encounter',id:'visit',status:'finished',meta:{lastUpdated:'2026-10-02'},period:{start:'2026-10-01'}},
    {...observation(100),encounter:{reference:'Encounter/visit'}}])
  expect(collection.encounters).toHaveLength(1)
  expect(collection.observations[0].encounter?.reference).toBe('Encounter/'+collection.encounters[0].id)
  const tools=createFhirTools(()=>({patient:null,collection}))
  const details:any=await tools.getEncounterDetails.execute!({encounterId:collection.encounters[0].id},{toolCallId:'synthetic',messages:[]})
  expect(JSON.stringify(details)).toContain('Glucose')
})

it('uses the hospital-primary prescription in AI, CDSS and IPS while keeping original cloud copies as audit evidence',()=>{
  const parsed=LocalBundleService.parse(crossSource)!
  const data=parsed.collection
  const selected=selectCdssClinicalInputs(data).input
  const paired=selected.medications.filter(row=>row._sourceRecordComparison?.status==='candidate')
  expect(paired).toHaveLength(1)
  expect(isVghtpeSource(paired[0])).toBe(true)
  const ai=scopeClinicalDataForAi(data,ALL_DATA_SELECTION,ALL_DATA_FILTERS,[],Date.parse('2026-10-20'))
  expect(ai.medications?.filter(row=>row._sourceRecordComparison?.status==='candidate')).toHaveLength(1)
  const exported=buildIpsBundle({patient:parsed.patient!,data})
  const statements=exported.entry.filter(entry=>entry.resource.resourceType==='MedicationStatement')
  expect(statements).toHaveLength(5)
  expect(statements.some(entry=>(entry.resource.contained as any[])?.length===2)).toBe(true)
  const imported=LocalBundleService.parse(exported as any)!.collection
  expect(imported.medications).toHaveLength(5)
  expect(data.medications).toHaveLength(6)
})

it('exports each distinct hospital order without attaching the other hospital order as its source',()=>{
 const input=JSON.parse(JSON.stringify(crossSource))
 const original=input.entry.find((entry:any)=>entry.resource?.id==='synthetic-order-a')
 input.entry.push({...original,resource:{...original.resource,id:'synthetic-order-b'}})
 const data=LocalBundleService.parse(input)!.collection
 const bundle=buildIpsBundle({patient:{resourceType:'Patient',id:'synthetic'},data})
 const roots=bundle.entry.map((entry:any)=>entry.resource).filter((resource:any)=>resource.resourceType==='MedicationStatement'&&/Aromasin/i.test(JSON.stringify(resource.medicationCodeableConcept)))
 expect(roots).toHaveLength(2)
 const withCopies=roots.filter((root:any)=>root.contained?.length)
 expect(withCopies).toHaveLength(1)
 expect(withCopies[0].contained).toHaveLength(2)
 expect(withCopies[0].contained.filter((record:any)=>record.note?.some((note:any)=>note.text?.startsWith('Hospital record:')))).toHaveLength(1)
})
