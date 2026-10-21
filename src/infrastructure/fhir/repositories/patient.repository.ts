import { reconcileClinicalSources, selectClinicalSourceNodes } from '@/src/core/services/clinical-reconciliation'
import { clinicalSourceSession, mutableClinicalProjection, captureClinicalSource, clearClinicalSourceQuery, forgetClinicalSourceSession, type ClinicalSourceSession } from '../services/clinical-source-session'
// FHIR Patient Repository Implementation
import type { IPatientRepository } from '@/src/core/interfaces/repositories/patient.repository.interface'
import type { PatientEntity } from '@/src/core/entities/patient.entity'
import { fhirClient, LocalBundleModeError } from '../client/fhir-client.service'
import { PatientMapper } from '../mappers/patient.mapper'
import { FHIR_RESOURCES } from '@/src/shared/constants/fhir-systems.constants'

export class FhirPatientRepository implements IPatientRepository {
  private readonly fallbackSessionKey = {}

  private requestSession(client: any, restBase?: string): ClinicalSourceSession {
    if (client && typeof client === 'object') return clinicalSourceSession(client, restBase, fhirClient)
    forgetClinicalSourceSession(fhirClient)
    return clinicalSourceSession(this.fallbackSessionKey)
  }

  private async capturePatientResponse(client: any, session: ClinicalSourceSession, query: string, response: any, patientId?: string, restBase?: string): Promise<any> {
    if (session.revoked || (client && (await fhirClient.getClient() !== client || client.state?.serverUrl !== restBase))) throw new Error('FHIR session changed during patient query')
    const selectedId = patientId ?? (response.resourceType === 'Patient' ? response.id : response.entry?.find((entry: any) => entry.resource?.resourceType === 'Patient')?.resource.id)
    const resources = response.resourceType === 'Patient' ? [response] : (response.entry ?? []).filter((entry: any) => typeof entry.resource?.resourceType === 'string')
    const unassignedScope = 'unassigned:' + session.sourceId + ':patient-search'
    const preview = reconcileClinicalSources([{ sourceId: session.sourceId, restBase: session.restBase, patientScope: unassignedScope, generation: 'preview', resources }])
    const nodes = selectClinicalSourceNodes(preview)
    const selected = nodes.find(node => node.resource.resourceType === 'Patient' && node.resource.id === selectedId)
    const selectedResources: Array<{ resource: any; fullUrl?: string }> = []
    const unassigned: Array<{ resource: any; fullUrl?: string }> = []
    for (const node of nodes) {
      const patientReferences = preview.graph.references.filter(edge => edge.origin.key === node.key && (edge.path === 'subject' || edge.path === 'patient'))
      const belongs = selected && (node.key === selected.key || (patientReferences.length > 0 && patientReferences.every(edge => edge.status === 'resolved' && edge.targetKeys.includes(selected.key))))
      ;(belongs ? selectedResources : unassigned).push({ resource: node.resource, fullUrl: node.fullUrl })
    }
    // A complete Patient search replaces the previous search selection, including
    // when it selects a different patient or returns no Patient at all.
    clearClinicalSourceQuery(session, query)
    captureClinicalSource(session, query, unassignedScope, unassigned)
    const source = selectedId ? captureClinicalSource(session, query, selectedId, selectedResources) : undefined
    if (!source) return response
    const projected = selectClinicalSourceNodes(source)
    if (response.resourceType === 'Patient') return mutableClinicalProjection(projected[0]?.resource ?? response)
    return { ...response, entry: projected.map(node => ({ resource: mutableClinicalProjection(node.resource), fullUrl: node.fullUrl })) }
  }

  async getCurrentPatient(): Promise<PatientEntity | null> {
    try {
      // Prefer the patient that fhirclient's SMART session pins to. The
      // standard SMART launch flow always sets `client.patient.id`; our
      // TWCAT `synthesizeSmartSession` bridge does the same. Falling back
      // to a `/Patient` search picks the first bundle entry, which on
      // multi-patient servers (e.g. 智群 OCTOFLOW with `example`,
      // `test-patient-001`, `pat-a123456789`) often lands on an orphan
      // demo record without any Observations attached — vitals card stays
      // empty even when real data exists for another patient on the
      // server. Reading by id avoids that.
      const client = await fhirClient.getClient()
      const restBase = client?.state?.serverUrl
      const session = this.requestSession(client, restBase)
       
      const pinnedId = (client as any)?.patient?.id as string | undefined
      if (pinnedId) {
        const resource = await fhirClient.request(`${FHIR_RESOURCES.PATIENT}/${pinnedId}`)
        return PatientMapper.toDomain(await this.capturePatientResponse(client, session, `Patient/${pinnedId}`, resource, pinnedId, restBase))
      }
      const response = await fhirClient.request(FHIR_RESOURCES.PATIENT)
      return PatientMapper.fromBundle(await this.capturePatientResponse(client, session, 'Patient', response, undefined, restBase))
    } catch (error) {
      // LocalBundleModeError is the "no SMART client" sentinel — expected
      // when callers race against a mode change; not a real failure.
      if (!(error instanceof LocalBundleModeError)) {
        console.error('[Patient Repository] Failed to fetch current patient:', error)
      }
      throw error
    }
  }

  async getPatientById(patientId: string): Promise<PatientEntity | null> {
    try {
      const client = await fhirClient.getClient()
      const restBase = client?.state?.serverUrl
      const session = this.requestSession(client, restBase)
      const response = await fhirClient.request(`Patient/${patientId}`)
      return PatientMapper.toDomain(await this.capturePatientResponse(client, session, `Patient/${patientId}`, response, patientId, restBase))
    } catch (error) {
      if (!(error instanceof LocalBundleModeError)) {
        console.error(`[Patient Repository] Failed to fetch patient ${patientId}:`, error)
      }
      throw error
    }
  }
}
