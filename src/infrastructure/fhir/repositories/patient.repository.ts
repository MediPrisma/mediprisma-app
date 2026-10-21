import { selectClinicalSourceNodes } from '@/src/core/services/clinical-reconciliation'
import { clinicalSourceSession, mutableClinicalProjection, captureClinicalSource, clearClinicalSourceQuery, forgetClinicalSourceSession } from '../services/clinical-source-session'
// FHIR Patient Repository Implementation
import type { IPatientRepository } from '@/src/core/interfaces/repositories/patient.repository.interface'
import type { PatientEntity } from '@/src/core/entities/patient.entity'
import { fhirClient, LocalBundleModeError } from '../client/fhir-client.service'
import { PatientMapper } from '../mappers/patient.mapper'
import { FHIR_RESOURCES } from '@/src/shared/constants/fhir-systems.constants'

export class FhirPatientRepository implements IPatientRepository {
  private readonly fallbackSessionKey = {}

  private async capturePatientResponse(client: any, query: string, response: any, patientId?: string, restBase?: string): Promise<any> {
    if (client && (await fhirClient.getClient() !== client || client.state?.serverUrl !== restBase)) throw new Error('FHIR session changed during patient query')
    const session = client && typeof client === 'object'
      ? clinicalSourceSession(client, restBase, fhirClient)
      : clinicalSourceSession(this.fallbackSessionKey)
    if (!client) forgetClinicalSourceSession(fhirClient)
    const selectedId = patientId ?? (response.resourceType === 'Patient' ? response.id : response.entry?.find((entry: any) => entry.resource?.resourceType === 'Patient')?.resource.id)
    if (!selectedId) { clearClinicalSourceQuery(session, query); return response }
    const resources = response.resourceType === 'Patient' ? [response] : (response.entry ?? []).filter((entry: any) => typeof entry.resource?.resourceType === 'string')
    const source = captureClinicalSource(session, query, selectedId, resources)
    const nodes = selectClinicalSourceNodes(source)
    if (response.resourceType === 'Patient') return mutableClinicalProjection(nodes[0]?.resource ?? response)
    return { ...response, entry: nodes.map(node => ({ resource: mutableClinicalProjection(node.resource), fullUrl: node.fullUrl })) }
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
       
      const pinnedId = (client as any)?.patient?.id as string | undefined
      if (pinnedId) {
        const resource = await fhirClient.request(`${FHIR_RESOURCES.PATIENT}/${pinnedId}`)
        return PatientMapper.toDomain(await this.capturePatientResponse(client, `Patient/${pinnedId}`, resource, pinnedId, restBase))
      }
      const response = await fhirClient.request(FHIR_RESOURCES.PATIENT)
      return PatientMapper.fromBundle(await this.capturePatientResponse(client, 'Patient', response, undefined, restBase))
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
      const response = await fhirClient.request(`Patient/${patientId}`)
      return PatientMapper.toDomain(await this.capturePatientResponse(client, `Patient/${patientId}`, response, patientId, restBase))
    } catch (error) {
      if (!(error instanceof LocalBundleModeError)) {
        console.error(`[Patient Repository] Failed to fetch patient ${patientId}:`, error)
      }
      throw error
    }
  }
}
