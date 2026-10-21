import { isMedicationContentOnlyIncomplete } from '@/src/core/utils/clinical-query-status'
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

it('upgrades a content-only gap to a real ownership error when a later source graph excludes prescriptions',()=>{
 const request={resourceType:'MedicationRequest',id:'unknown',status:'active',subject:{reference:'Patient/synthetic'},medicationReference:{reference:'Medication/missing'}}
 const first=capture('first',[patient,request])
 const before=reconcileClinicalSources([first])
 const node=before.graph.nodes.find(node=>node.resource.resourceType==='MedicationRequest')!
 const input=projectClinicalAggregate({clinicalSource:before,medications:[{...request,clinicalSourceNodeKey:node.key}],resourceQueryStatus:{MedicationRequest:{resourceType:'MedicationRequest',state:'ok',count:1}}} as any)
 expect(input.resourceQueryStatus.MedicationRequest.medicationContentOnlyIncomplete).toBe(true)
 const source=reconcileClinicalSources([first,capture('later',[{...request,id:'foreign',subject:{reference:'Patient/another'}}])])
 const after=projectClinicalAggregate(input,source)
 expect(after.resourceQueryStatus.MedicationRequest).toMatchObject({state:'error',excludedCount:1,exclusionReason:'foreign-patient-reference'})
 expect(after.resourceQueryStatus.MedicationRequest.medicationContentOnlyIncomplete).not.toBe(true)
})

it.each([false,true])('clears a repaired modifier without making the remaining medication content gap permanently blocking (content resolved=%s)',resolved=>{
 const unknown={resourceType:'MedicationRequest',id:'unknown',status:'active',medicationReference:{reference:'Medication/missing'}}
 const invalid={resourceType:'MedicationRequest',id:'invalid',status:'active',medicationCodeableConcept:{text:'Synthetic invalid source'},modifierExtension:[{url:'https://mediprisma.app/fhir/StructureDefinition/clinical-record-variant',extension:[]}]}
 const initial=reconcileClinicalSources([capture('snapshot',[patient,unknown,invalid])])
 const before=projectClinicalAggregate({clinicalSource:initial,medications:initial.graph.nodes.filter(node=>node.resource.resourceType==='MedicationRequest').map(node=>({...node.resource,clinicalSourceNodeKey:node.key})),resourceQueryStatus:{MedicationRequest:{resourceType:'MedicationRequest',state:'ok',count:2}}} as any)
 expect(before.resourceQueryStatus.MedicationRequest).toMatchObject({state:'incomplete',medicationContentOnlyIncomplete:true,invalidModifierCount:1})
 const source=reconcileClinicalSources([capture('snapshot',[patient,unknown,...(resolved?[{resourceType:'Medication',id:'missing',code:{text:'Synthetic resolved medicine'}}]:[])])])
 const after=projectClinicalAggregate(before,source)
 expect(after.resourceQueryStatus.MedicationRequest.invalidModifierCount).toBeUndefined()
 if(resolved){expect(after.resourceQueryStatus.MedicationRequest.state).toBe('ok');expect(after.medications[0].clinicalMedicationContentUncertainty).toBeUndefined()}
 else{expect(isMedicationContentOnlyIncomplete(after.resourceQueryStatus.MedicationRequest)).toBe(true)}
})


it.each([false,true].flatMap(invalidFirst=>[false,true].map(resolved=>[invalidFirst,resolved])))('recovers content and modifier states in either arrival order (invalid first=%s, content resolved=%s)',(invalidFirst,resolved)=>{
 const unknown={resourceType:'MedicationRequest',id:'unknown',status:'active',medicationReference:{reference:'Medication/missing'}}
 const invalid={resourceType:'MedicationRequest',id:'invalid',status:'active',medicationCodeableConcept:{text:'Synthetic invalid source'},modifierExtension:[{url:'https://mediprisma.app/fhir/StructureDefinition/clinical-record-variant',extension:[]}]}
 const stage=(resources:any[],status:any={MedicationRequest:{resourceType:'MedicationRequest',state:'ok',count:1}})=>{
  const source=reconcileClinicalSources([capture('snapshot',[patient,...resources])])
  return projectClinicalAggregate({clinicalSource:source,medications:source.graph.nodes.filter(node=>node.resource.resourceType==='MedicationRequest').map(node=>({...node.resource,clinicalSourceNodeKey:node.key})),resourceQueryStatus:status} as any)
 }
 const first=stage(invalidFirst?[invalid]:[unknown])
 const mixed=stage([invalid,unknown],first.resourceQueryStatus)
 expect(mixed.resourceQueryStatus.MedicationRequest.invalidModifierCount).toBe(1)
 expect(mixed.resourceQueryStatus.MedicationRequest.message).toContain('malformed recognized modifiers')
 expect(mixed.resourceQueryStatus.MedicationRequest.message).toContain('referenced drug content is unavailable')
 expect(isMedicationContentOnlyIncomplete(mixed.resourceQueryStatus.MedicationRequest)).toBe(false)
 const remaining=[unknown,...(resolved?[{resourceType:'Medication',id:'missing',code:{text:'Synthetic resolved medicine'}}]:[])]
 const repaired=stage(remaining,mixed.resourceQueryStatus)
 const repeated=projectClinicalAggregate(repaired)
 for(const output of [repaired,repeated]){
  expect(output.resourceQueryStatus.MedicationRequest.invalidModifierCount).toBeUndefined()
  if(resolved)expect(output.resourceQueryStatus.MedicationRequest.state).toBe('ok')
  else expect(isMedicationContentOnlyIncomplete(output.resourceQueryStatus.MedicationRequest)).toBe(true)
 }
})

it('does not manufacture query success when a modifier was the first status for an unfetched domain',()=>{
 const invalid={resourceType:'Observation',id:'invalid',status:'final',code:{text:'Synthetic'},modifierExtension:[{url:'https://mediprisma.app/fhir/StructureDefinition/clinical-record-variant',extension:[]}]}
 const source=reconcileClinicalSources([capture('snapshot',[patient,invalid])])
 const node=source.graph.nodes.find(node=>node.resource.resourceType==='Observation')!
 const before=projectClinicalAggregate({clinicalSource:source,observations:[{...invalid,clinicalSourceNodeKey:node.key}],resourceQueryStatus:{}} as any)
 expect(before.resourceQueryStatus.Observation).toMatchObject({state:'incomplete',invalidModifierCount:1,invalidModifierPreviouslyUnreported:true})
 expect(before.resourceQueryStatus.Observation.invalidModifierPreviousStatus).toBeUndefined()
 const clean=reconcileClinicalSources([capture('snapshot',[patient])])
 expect(projectClinicalAggregate(before,clean).resourceQueryStatus.Observation).toBeUndefined()
 const failed={...before,resourceQueryStatus:{Observation:{...before.resourceQueryStatus.Observation,state:'forbidden',httpStatus:403,message:'Synthetic authorization failure'}}}
 expect(projectClinicalAggregate(failed,clean).resourceQueryStatus.Observation).toMatchObject({state:'forbidden',httpStatus:403,message:'Synthetic authorization failure'})
})

it.each([false,true])('keeps ownership errors blocking when content and modifier defects repair together (invalid first=%s)',invalidFirst=>{
 const unknown={resourceType:'MedicationRequest',id:'unknown',status:'active',medicationReference:{reference:'Medication/missing'}}
 const invalid={resourceType:'MedicationRequest',id:'invalid',status:'active',medicationCodeableConcept:{text:'Synthetic invalid'},modifierExtension:[{url:'https://mediprisma.app/fhir/StructureDefinition/clinical-record-variant',extension:[]}]}
 const stage=(resources:any[],status:any={MedicationRequest:{resourceType:'MedicationRequest',state:'ok',count:1}})=>{
  const source=reconcileClinicalSources([capture('snapshot',[patient,...resources])])
  return projectClinicalAggregate({clinicalSource:source,medications:source.graph.nodes.filter(node=>node.resource.resourceType==='MedicationRequest').map(node=>({...node.resource,clinicalSourceNodeKey:node.key})),resourceQueryStatus:status} as any)
 }
 const first=stage(invalidFirst?[invalid]:[unknown])
 const mixed=stage([unknown,invalid],first.resourceQueryStatus)
 const excluded=stage([unknown,{...unknown,id:'foreign',subject:{reference:'Patient/another'}}],mixed.resourceQueryStatus)
 expect(excluded.resourceQueryStatus.MedicationRequest).toMatchObject({state:'error',excludedCount:1,exclusionReason:'foreign-patient-reference'})
 expect(excluded.resourceQueryStatus.MedicationRequest.invalidModifierCount).toBeUndefined()
 expect(isMedicationContentOnlyIncomplete(excluded.resourceQueryStatus.MedicationRequest)).toBe(false)
 const recovered=stage([unknown],excluded.resourceQueryStatus)
 expect(isMedicationContentOnlyIncomplete(recovered.resourceQueryStatus.MedicationRequest)).toBe(true)
})
