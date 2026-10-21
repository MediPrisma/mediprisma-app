import { hospitalProductMayMatchConcept } from '@/src/infrastructure/fhir/services/hospital-medication-product-match'
import { reconcileMedicationRequests } from '@/src/infrastructure/fhir/services/medication-reconciliation'
import { renderHook } from '@testing-library/react'
import { useMedicationRows } from '@/features/clinical-summary/medications/hooks/useMedicationRows'
const NHI='https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medication-nhi-tw'
const name=(value:string)=>({text:value,coding:[{system:'urn:oid:vgh.medication.name',code:value,display:value}]})
const cloud=(value:string)=>({text:value,coding:[{system:NHI,code:'SYNTH001',display:value}]})
it('compares a complete ointment product with an omitted tube size without knowledge resources',()=>{
 expect(hospitalProductMayMatchConcept(name('Conlifu * oint 2% 5 g'),cloud('CONLIFU OINTMENT 2%'))).toBe(true)
 expect(hospitalProductMayMatchConcept(name('Conlifu * oint 2% 5 g'),cloud('CONLIFU OINTMENT 2% 5g'))).toBe(true)
 expect(hospitalProductMayMatchConcept(name('Conlifu * oint 2% 5 g'),cloud('CONLIFU OINTMENT 2％'))).toBe(true)
})
it.each(['CONLIFU','CONLIFU OINTMENT','CONLIFU OINTMENT 5%','CONLIFU CREAM 2%','CONLIFU OINTMENT 2% 15g','OTHER OINTMENT 2%'])('keeps a missing or conflicting product descriptor separate: %s',(value)=>{
 expect(hospitalProductMayMatchConcept(name('Conlifu * oint 2% 5 g'),cloud(value))).toBe(false)
})
it.each([['Conlifu oint 5 g','CONLIFU OINTMENT 5 G'],['Synthetic gel 10 ml','SYNTHETIC GEL 10 ML']])('does not use package quantity as topical concentration: %s',(hospital,other)=>{
 expect(hospitalProductMayMatchConcept(name(hospital),cloud(other))).toBe(false)
})
it('separates a mass-ratio concentration from its optional tube size',()=>{
 expect(hospitalProductMayMatchConcept(name('Synthetic ointment 20 mg/g 5 g'),cloud('SYNTHETIC OINTMENT 20 mg/g'))).toBe(true)
 expect(hospitalProductMayMatchConcept(name('Synthetic ointment 20 mg/g 5 g'),cloud('SYNTHETIC OINTMENT 20 mg/g 15 g'))).toBe(false)
})
it.each(['Synthetic solution 2%', 'Synthetic injection 10 mg/2 ml', 'Synthetic injection 10 mg'])('accepts a liquid product with an explicit strength: %s',(product)=>{
 expect(hospitalProductMayMatchConcept(name(product),cloud(product))).toBe(true)
})
it.each(['Synthetic solution 100 ml','Synthetic drops 5 ml','Synthetic injection 2 ml','Synthetic solution 100 g'])('keeps volume-only liquid products as separate rows: %s',(product)=>{
 const base={resourceType:'MedicationRequest',subject:{reference:'Patient/synthetic'},encounter:{reference:'Encounter/synthetic'},authoredOn:'2026-05-07',status:'active',dispenseRequest:{expectedSupplyDuration:{value:7,code:'d'}}}
 const hospital:any={...base,id:'synthetic-liquid-hospital',meta:{source:'ehr-fhir-bridge/scraper'},medicationCodeableConcept:name(product),dosageInstruction:[{text:'BID'}]}
 const other:any={...base,id:'synthetic-liquid-cloud',meta:{source:'https://medcloud2.nhi.gov.tw/'},medicationCodeableConcept:cloud(product),dosageInstruction:[{text:'BID'}]}
 const result=reconcileMedicationRequests([hospital,other])
 expect(result).toHaveLength(2)
 expect(hospital._sourceRecordComparison).toBeUndefined()
 const rows=renderHook(()=>useMedicationRows(result)).result.current
 expect(rows).toHaveLength(2)
 expect(rows.every(row=>!row.sourceComparison)).toBe(true)
})
it.each([['Conlifu * oint 2% 5 g','CONLIFU OINTMENT 2%'],['Synthetic ointment 20 mg/g 5 g','SYNTHETIC OINTMENT 20 mg/g']])('retains both raw orders and uses one hospital row for a matching topical comparison: %s',(hospitalProduct,cloudProduct)=>{
 const base={resourceType:'MedicationRequest',subject:{reference:'Patient/synthetic'},encounter:{reference:'Encounter/synthetic'},authoredOn:'2026-05-07',status:'active',dispenseRequest:{expectedSupplyDuration:{value:7,code:'d'}}}
 const hospital:any={...base,id:'synthetic-ointment-hospital',meta:{source:'ehr-fhir-bridge/scraper'},medicationCodeableConcept:name(hospitalProduct),dosageInstruction:[{text:'X1 TUB T BID',timing:{code:{text:'BID'}}}]}
 const other:any={...base,id:'synthetic-ointment-cloud',meta:{source:'https://medcloud2.nhi.gov.tw/'},medicationCodeableConcept:cloud(cloudProduct),dosageInstruction:[{text:'BID'}]}
 const result=reconcileMedicationRequests([hospital,other])
 expect(result).toHaveLength(2)
 expect(hospital._sourceRecordComparison.status).toBe('candidate')
 expect(hospital._reconciledSourceReferences).toBeUndefined()
 const rows=renderHook(()=>useMedicationRows(result)).result.current
 expect(rows).toHaveLength(1)
 expect(rows[0].dataOrigin).toBe('hospital')
 expect(rows[0].sourceComparison?.records).toHaveLength(2)
 expect(hospital.medicationCodeableConcept.coding).toEqual(name(hospitalProduct).coding)
})
