import { createClinicalRecordResolution } from '@/src/core/services/clinical-record-resolution'
import { graphEncounterReferenceOrganization } from '@/src/core/services/clinical-source-catalog-evidence'
import { selectClinicalSourceNodes } from '@/src/core/services/clinical-reconciliation'
import { reconcileClinicalSources } from '@/src/core/services/clinical-reconciliation'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { projectClinicalAggregate } from '@/src/infrastructure/fhir/mappers/clinical-aggregate-projection'
import { createFhirTools } from '@/src/infrastructure/ai/tools/fhir-tools'

const patient={resourceType:'Patient',id:'synthetic'}
const old={resourceType:'Encounter',id:'visit',status:'in-progress',meta:{lastUpdated:'2026-10-01'},serviceProvider:{display:'Synthetic hospital'}}
const current={...old,status:'finished',meta:{lastUpdated:'2026-10-02'}}
const procedure={resourceType:'Procedure',id:'procedure',status:'completed',encounter:{reference:'Encounter/visit'},code:{text:'Synthetic linked procedure'}}
const capture=(generation:string,resources:any[])=>({sourceId:'synthetic-source',patientScope:'synthetic',generation,resources})

it('redirects references from a dropped duplicate include to the selected encounter version',async()=>{
 const source=reconcileClinicalSources([capture('first-query',[old]),capture('second-query',[old,procedure]),capture('latest-query',[current])])
 const resolution=createClinicalRecordResolution(source)
 const edge=source.graph.references.find(edge=>edge.path==='encounter')!
 const selected=source.graph.nodes.find(node=>node.resource.resourceType==='Encounter'&&node.resource.status==='finished')!
 expect(resolution.reference(edge).targetKeys).toEqual([selected.key])
 const nodes=selectClinicalSourceNodes(source)
 const collection=projectClinicalAggregate({clinicalSource:source,conditions:[],medications:[],observations:[],diagnosticReports:[],allergies:[],encounters:nodes.filter(node=>node.resource.resourceType==='Encounter').map(node=>({...node.resource,clinicalSourceNodeKey:node.key})),procedures:nodes.filter(node=>node.resource.resourceType==='Procedure').map(node=>({...node.resource,clinicalSourceNodeKey:node.key}))} as any)
 expect(collection.encounters).toHaveLength(1)
 const tools=createFhirTools(()=>({patient:null,collection}))
 const details=await tools.getEncounterDetails.execute!({encounterId:collection.encounters[0].id},{toolCallId:'synthetic',messages:[]})
 expect(JSON.stringify(details)).toContain('Synthetic linked procedure')
})

it.each([false,true])('automatically imports the newest Patient version of the same logical identity (reverse=%s)',reverse=>{
 const records=[{...patient,name:[{text:'Synthetic old name'}],meta:{lastUpdated:'2026-10-01'}},{...patient,name:[{text:'Synthetic updated name'}],meta:{lastUpdated:'2026-10-02'}}]
 const parsed=LocalBundleService.parse({resourceType:'Bundle',entry:(reverse?records.reverse():records).map(resource=>({resource}))})!
 expect(parsed.patient.name).toEqual([{text:'Synthetic updated name'}])
 expect(parsed.collection.clinicalSource?.graph.nodes.filter(node=>node.resource.resourceType==='Patient')).toHaveLength(2)
})
it('still rejects different patient identities and unrelated absolute Patient sources',()=>{
 for(const entries of [[{resource:patient},{resource:{...patient,id:'another-patient'}}],[{fullUrl:'https://one.invalid/fhir/Patient/synthetic',resource:patient},{fullUrl:'https://two.invalid/fhir/Patient/synthetic',resource:{...patient,name:[{text:'Other source'}]}}]]) {
  expect(()=>LocalBundleService.parse({resourceType:'Bundle',entry:entries})).toThrow()
 }
})

it('retains an encounter organization in AI citation evidence after automatic version resolution',()=>{
 const document={resourceType:'Composition',id:'document',status:'final',encounter:{reference:'Encounter/visit'}}
 const source=reconcileClinicalSources([capture('same',[old,current,document])])
 const nodes=selectClinicalSourceNodes(source)
 const collection=projectClinicalAggregate({clinicalSource:source,conditions:[],medications:[],observations:[],diagnosticReports:[],allergies:[],encounters:nodes.filter(node=>node.resource.resourceType==='Encounter').map(node=>({...node.resource,clinicalSourceNodeKey:node.key})),documents:nodes.filter(node=>node.resource.resourceType==='Composition').map(node=>({...node.resource,clinicalSourceNodeKey:node.key}))} as any)
 expect(collection.encounters).toHaveLength(1)
 const origin=source.graph.nodes.find(node=>node.resource.resourceType==='Composition')!
 expect(graphEncounterReferenceOrganization(source,origin.key,'encounter','Encounter/'+collection.encounters[0].id,collection.encounters)).toEqual({encounterId:collection.encounters[0].id,organization:'Synthetic hospital'})
})


it.each(['Condition','AllergyIntolerance'])('never collapses different %s identities based only on an imported group label',resourceType=>{
 const modifierExtension=[{url:'https://mediprisma.app/fhir/StructureDefinition/clinical-record-variant',extension:[{url:'groupId',valueString:'same-external-label'},{url:'classification',valueCode:'revision'},{url:'variantCount',valuePositiveInt:2},{url:'reason',valueString:'Synthetic imported metadata'}]}]
 const resources=[patient,...['a','b'].map(id=>({resourceType,id,clinicalStatus:{coding:[{code:'active'}]},code:{text:id},modifierExtension}))]
 const collection=LocalBundleService.parse({resourceType:'Bundle',entry:resources.map(resource=>({resource}))})!.collection
 expect(resourceType==='Condition'?collection.conditions:collection.allergies).toHaveLength(2)
})

it.each(['Condition','AllergyIntolerance'])('keeps active %s safety evidence when update ordering is missing',resourceType=>{
 for(const reverse of [false,true]) {
  const records=['active','resolved'].map(code=>({resourceType,id:'same',clinicalStatus:{coding:[{code}]},code:{text:'Synthetic safety fact'}}))
  const collection=LocalBundleService.parse({resourceType:'Bundle',entry:[patient,...(reverse?records.reverse():records)].map(resource=>({resource}))})!.collection
  const rows=resourceType==='Condition'?collection.conditions:collection.allergies
  expect(rows).toHaveLength(1)
  expect(rows[0].clinicalStatus).toBe('active')
 }
})

it.each(['birthDate','gender','identifier'])('rejects contradictory undated Patient %s but automatically uses a documented later correction',field=>{
 const values:any={birthDate:['1950-01-01','1980-01-01'],gender:['male','female'],identifier:[[{system:'urn:synthetic:id',value:'one'}],[{system:'urn:synthetic:id',value:'two'}]]}
 const resources=values[field].map((value:any,index:number)=>({...patient,[field]:value,...(index?{name:[{text:'Synthetic correction'}]}:{})}))
 const input=(rows:any[])=>({resourceType:'Bundle',entry:rows.map(resource=>({resource}))})
 expect(()=>LocalBundleService.parse(input(resources))).toThrow(/病人身分/)
 const ordered=resources.map((resource:any,index:number)=>({...resource,meta:{lastUpdated:`2026-10-0${index+1}`}}))
 expect(LocalBundleService.parse(input(ordered))!.patient.name).toEqual([{text:'Synthetic correction'}])
})

it.each([false,true])('accepts compatible identifier additions independent of Patient entry order (reverse=%s)',reverse=>{
 const one={...patient,name:[{text:'Synthetic patient'}],identifier:[{system:'urn:synthetic:mrn',value:'one'}]}
 const two={...one,identifier:[...one.identifier,{system:'urn:synthetic:mrn',value:'two'}]}
 const rows=reverse?[two,one]:[one,two]
 const parsed=LocalBundleService.parse({resourceType:'Bundle',entry:rows.map(resource=>({resource}))})!
 expect(parsed.patient.identifier).toHaveLength(2)
})

it.each([false,true])('accepts an ordered Patient correction when its winning version has equivalent URL copies (reverse=%s)',reverse=>{
 const old={...patient,birthDate:'1950-01-01',meta:{versionId:'1',lastUpdated:'2026-10-01'}}
 const current={...patient,birthDate:'1980-01-01',meta:{versionId:'2',lastUpdated:'2026-10-02'}}
 const entries=[{fullUrl:'https://one.invalid/fhir/Patient/synthetic/_history/1',resource:old},{fullUrl:'https://one.invalid/fhir/Patient/synthetic',resource:current},{fullUrl:'https://one.invalid/fhir/Patient/synthetic/_history/2',resource:current}]
 const parsed=LocalBundleService.parse({resourceType:'Bundle',entry:reverse?entries.reverse():entries})!
 expect(parsed.patient.birthDate).toBe('1980-01-01')
})
