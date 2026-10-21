import { classifyFhirQueryError } from '@/src/infrastructure/fhir/utils/fhir-query-status'
import { FhirPaginationLimitError } from '@/src/infrastructure/fhir/client/fhir-client.service'
import { projectClinicalAggregate } from '@/src/infrastructure/fhir/mappers/clinical-aggregate-projection'
import { reconcileClinicalSources } from '@/src/core/services/clinical-reconciliation'

it.each([new FhirPaginationLimitError('Observation?patient=synthetic',2,100),{status:503,message:'Synthetic transport failure'},{status:403,message:'Synthetic forbidden'}])('preserves a real retained query failure while excluding foreign rows: %j',error=>{
 const status=classifyFhirQueryError(error,'Observation')
 expect(status.state).not.toBe('incomplete')
 const source=reconcileClinicalSources([{sourceId:'synthetic',patientScope:'synthetic',generation:'one',resources:[{resourceType:'Patient',id:'synthetic'},{resourceType:'Observation',id:'foreign',status:'final',subject:{reference:'Patient/another'},code:{text:'Synthetic foreign result'},valueQuantity:{value:7}}]}])
 const node=source.graph.nodes.find(node=>node.resource.resourceType==='Observation')!
 const data=projectClinicalAggregate({clinicalSource:source,observations:[{...node.resource,clinicalSourceNodeKey:node.key}],resourceQueryStatus:{Observation:status}} as any)
 expect(data.observations).toHaveLength(0)
 expect(data.resourceQueryStatus.Observation).toEqual(status)
 expect(data.resourceQueryStatus.Observation.exclusionPreviousStatus).toBeUndefined()
})
