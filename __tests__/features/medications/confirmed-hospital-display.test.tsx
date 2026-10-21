import {reconcileMedicationRequests} from '@/src/infrastructure/fhir/services/medication-reconciliation'
import {renderHook} from '@testing-library/react'
import {useMedicationRows} from '@/features/clinical-summary/medications/hooks/useMedicationRows'
import {useMedicationTimeline} from '@/features/clinical-summary/medications/timeline/hooks/useMedicationTimeline'
it('displays original hospital facts even after a confirmed source union supplements its canonical record',()=>{
 const identifier=[{system:'urn:oid:vgh.medication.order',value:'synthetic-display-order',type:{coding:[{system:'http://terminology.hl7.org/CodeSystem/v2-0203',code:'PLAC'}]}}]
 const base={resourceType:'MedicationRequest',subject:{reference:'Patient/synthetic'},encounter:{reference:'Encounter/synthetic'},authoredOn:'2026-05-07',identifier,medicationCodeableConcept:{text:'Synthetic tablet 5mg',coding:[{system:'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medication-nhi-tw',code:'SYNTH001'}]}}
 const hospital:any={...base,id:'synthetic-hospital-display',meta:{source:'ehr-fhir-bridge/scraper'},status:'unknown'}
 const cloud:any={...base,id:'synthetic-cloud-display',meta:{source:'https://medcloud2.nhi.gov.tw/'},status:'active',dosageInstruction:[{text:'BID'}],dispenseRequest:{expectedSupplyDuration:{value:28,code:'d'}},courseOfTherapyType:{coding:[{code:'continuous'}]}}
 const resources=reconcileMedicationRequests([hospital,cloud])
 expect(resources).toHaveLength(1)
 expect(hospital.status).toBe('active')
 expect(hospital.dispenseRequest.expectedSupplyDuration.value).toBe(28)
 const before=JSON.stringify(resources)
 const row=renderHook(()=>useMedicationRows(resources)).result.current[0]
 expect(row).toMatchObject({dataOrigin:'hospital',status:'unknown',isInactive:true,currentnessUncertain:true,isChronic:false})
 expect(row.durationDays).toBeUndefined()
 expect(row.frequency).toBeUndefined()
 expect(row.sourceComparison?.status).toBe('confirmed')
 expect(row.sourceComparison?.records).toHaveLength(2)
 const timeline=renderHook(()=>useMedicationTimeline(resources,'medical','all','其他','zh-TW')).result.current
 expect(timeline.drugs[0].bars[0]).toMatchObject({sourceCurrent:false,sourceStatus:'unknown',supplyDaysUnrecorded:true,prescriptionType:'unrecorded'})
 expect(JSON.stringify(resources)).toBe(before)
})
