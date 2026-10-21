import { fireEvent, render, screen } from '@testing-library/react'
import { createFhirCdssPatientProfile, type FhirCdssProfileInput } from '@voho0000/personalized-care-fhir'
import type { MedicationEntity } from '@/src/core/entities/clinical-data.entity'
import { createHospitalAwareCdssPatientProfile } from '@/features/clinical-decision-support/utils/hospital-medication-profile'
import { applyHospitalMedicationReview, buildHospitalAwareCdssResult } from '@/features/clinical-decision-support/utils/hospital-medication-review'
import { HospitalMedicationReview } from '@/features/clinical-decision-support/renderers/HospitalMedicationReview'
import { getDefaultClinicalGuidelinePack } from '@/features/clinical-decision-support/guideline-packs/registry'
import type { CdssRecommendation, CdssResult } from '@/features/clinical-decision-support/types'

const now = new Date('2026-10-01T04:00:00Z')
const input: FhirCdssProfileInput = {
  patient: { id: 'fictional-medication-patient', age: 70 },
  conditions: [], encounters: [], observations: [], medications: [],
  allergies: [], carePlans: [], now,
}
const hospital = (overrides: Partial<MedicationEntity> = {}): MedicationEntity => ({
  id: 'fictional-meitifen', status: 'active', authoredOn: '2026-09-30',
  _sourceResourceType: 'MedicationRequest',
  medicationCodeableConcept: { text: 'Meitifen SR FC * tab 75 mg', coding: [{
    system: 'urn:oid:vgh.medication.product', display: 'Meitifen SR FC * tab 75 mg', code: 'Meitifen SR FC * tab 75 mg',
  }] },
  dispenseRequest: { expectedSupplyDuration: { value: 30, unit: 'days' } },
  dosageInstruction: [{ timing: { repeat: { frequency: 2, period: 1, periodUnit: 'd' } }, doseAndRate: [{ doseQuantity: { value: 1, unit: 'TAB' } }] }],
  ...overrides,
})
const build = (medications: MedicationEntity[]) => createHospitalAwareCdssPatientProfile({ ...input, medications })

describe('hospital medications entering CDSS', () => {
  it('feeds the verified ingredient to the real classifier and preserves source and dose', () => {
    const source = hospital({ _sourceResourceType: 'MedicationStatement' })
    const before = JSON.stringify(source)
    const profile = build([source])
    expect(profile.medicationClassContexts?.['nsaid-or-cox2-inhibitor']).toMatchObject({
      state: 'confirmed-current', medicationNames: ['Diclofenac sodium'],
    })
    expect(profile.medicationClassContexts?.['nsaid-or-cox2-inhibitor']).not.toHaveProperty('nhiDrugCodes')
    expect(profile.facts.hfHarmfulNsaid.zh).toContain('Diclofenac sodium')
    expect(profile.facts.hfHarmfulNsaid.sources?.[0]).toMatchObject({
      resourceType: 'MedicationStatement', resourceId: source.id, status: 'active', coding: source.medicationCodeableConcept?.coding,
    })
    expect(profile.hospitalMedicationEvidence?.[0].name).toMatchObject({ source: 'verified-product-alias', referenceUrl: expect.any(String) })
    expect(profile.medicationClassContexts?.['nsaid-or-cox2-inhibitor']?.prescriptions?.[0]).toMatchObject({
      ingredient: 'diclofenac sodium', dailyDose: 2, doseUnit: 'TAB',
    })
    expect(JSON.stringify(source)).toBe(before)
    expect(source.drugTerminology).toBeUndefined()
    expect(JSON.stringify(profile)).not.toContain('draft:mediprisma-hospital:')
    expect(profile.hospitalMedicationEvidence?.[0].source).not.toHaveProperty('dosageInstruction')
  })

  it('uses an active hospital order within its supply period without a confirmation task', () => {
    const profile = build([hospital()])
    expect(profile.medicationClassContexts?.['nsaid-or-cox2-inhibitor']?.state).toBe('confirmed-current')
    expect(profile.facts.hfHarmfulNsaid.zh).toContain('Diclofenac sodium')
    expect(profile.facts.currentNsaid.zh).not.toContain('待確認')
  })

  it('automatically treats a hospital record with an ended supply period as historical', () => {
    const profile = build([hospital({ authoredOn: '2024-06-14', meta: {source:'ehr-fhir-bridge/scraper'}, dispenseRequest: {
      validityPeriod: { start: '2024-06-14', end: '2024-07-14' },
    } })])
    expect(profile.medicationClassContexts?.['nsaid-or-cox2-inhibitor']?.state).toBe('not-found')
    expect(profile.facts.currentNsaid).toBeUndefined()
    expect(profile.facts['hospitalMedication:MedicationRequest:fictional-meitifen'].sources?.[0].status).toBe('active')
  })

  it('preserves statuses in dated and undated native timelines, including identical names and dates', () => {
    const profile = build([hospital(), hospital({ id: 'ended', status: 'completed' }),
      hospital({ id: 'undated', authoredOn: undefined, status: 'unknown' })])
    const context = profile.medicationClassContexts?.['nsaid-or-cox2-inhibitor']
    expect(context?.prescriptions?.map((item) => item.status)).toEqual(['active'])
    expect(profile.hospitalMedicationEvidence?.find(item=>item.source.resourceId==='undated')?.source.status).toBe('unknown')
    expect(JSON.stringify(profile)).not.toContain('"status":"draft"')
    expect(context?.state).toBe('confirmed-current')
    expect(profile.facts.hfHarmfulNsaid.zh).toContain('Diclofenac sodium')
    expect(profile.hospitalMedicationEvidence?.find(item=>item.source.resourceId==='ended')?.useState).toBe('not-current')
  })

  it('uses the explicit active hospital status when dispensing validity is not a treatment interval', () => {
    expect(build([hospital({ dispenseRequest: { validityPeriod: { start: '2026-09-01', end: '2026-12-31' } } })])
      .medicationClassContexts?.['nsaid-or-cox2-inhibitor']?.state).toBe('confirmed-current')
  })

  it.each(['cancelled', 'entered-in-error', 'stopped', 'completed', 'not-taken'])('respects the source %s status', (status) => {
    const profile = build([hospital({ status })])
    expect(profile.medicationClassContexts?.['nsaid-or-cox2-inhibitor']?.state).toBe('not-found')
    expect(profile.facts.hfHarmfulNsaid).toBeUndefined()
    expect(profile.hospitalMedicationEvidence?.[0].useState).toBe('not-current')
  })

  it('keeps on-hold separate, and rejects a future active statement as current', () => {
    expect(build([hospital({ status: 'on-hold' })]).medicationClassContexts?.['nsaid-or-cox2-inhibitor']?.state).toBe('on-hold')
    expect(build([hospital({ _sourceResourceType: 'MedicationStatement', authoredOn: '2027-01-01' })])
      .medicationClassContexts?.['nsaid-or-cox2-inhibitor']?.state).toBe('not-found')
  })

  it('leaves the official national cloud interpretation unchanged, including same-class current evidence', () => {
    const official: MedicationEntity = {
      id: 'fictional-nhi-diclofenac', status: 'active', authoredOn: '2026-09-30',
      drugTerminology: { source: 'nhi-official-drug-master', snapshotId: 'synthetic', ingredientText: 'DICLOFENAC SODIUM', atcCode: 'M01AB05' },
    }
    expect(build([official])).toEqual(createFhirCdssPatientProfile({ ...input, medications: [official] }))
    const mixed = build([official, hospital()])
    expect(mixed.medicationClassContexts?.['nsaid-or-cox2-inhibitor']?.state).toBe('confirmed-current')
    expect(mixed.facts.hfHarmfulNsaid.sources?.map((source) => source.resourceId)).toEqual([official.id, 'fictional-meitifen'])
  })

  it('gives official ingredient terminology priority and retains an unknown alias without inventing codes', () => {
    const official = hospital({ drugTerminology: { source: 'nhi-official-drug-master', snapshotId: 'synthetic', ingredientText: 'ACETAMINOPHEN' } })
    expect(build([official]).hospitalMedicationEvidence?.[0].ingredientName).toBe('ACETAMINOPHEN')
    const unknown = hospital({ medicationCodeableConcept: { coding: [{ system: 'urn:oid:vgh.medication.product', display: 'Unlisted tablet' }] } })
    const profile = build([unknown])
    expect(profile.hospitalMedicationEvidence?.[0]).toMatchObject({ ingredientName: undefined, classIds: [], name: { status: 'unresolved' } })
    expect(profile.facts['hospitalMedication:MedicationRequest:fictional-meitifen'].zh).toContain('成分未確認')
    expect(profile.medicationClassContexts?.['loop-diuretic']?.state).toBe('uncertain')
    expect(profile.hospitalMedicationEvidence?.[0].source.coding).toEqual(unknown.medicationCodeableConcept?.coding)
  })

  it('keeps a possible harmful exposure actionable in real pack output with unconfirmed-use provenance', () => {
    const profile = createHospitalAwareCdssPatientProfile({ ...input, medications: [hospital()],
      conditions: [{ id: 'fictional-hf', clinicalStatus: 'active', code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'I50.22' }] } }],
      observations: [{ id: 'fictional-lvef', status: 'final', effectiveDateTime: '2026-09-30',
        code: { coding: [{ system: 'http://loinc.org', code: '10230-1' }] }, valueQuantity: { value: 32, unit: '%' } }],
    })
    const result = buildHospitalAwareCdssResult(getDefaultClinicalGuidelinePack(), profile, 'zh-TW')
    const modules = [...result.recommendations, ...(result.automatedChecks ?? []).flatMap((check) => check.recommendation ? [check.recommendation] : [])]
    const safetyModule = modules.find((item) => item.evidenceTables?.some((table) => table.concept === 'hf-harmful-medication'))
    expect(safetyModule).toBeDefined()
    expect(safetyModule?.status).toBe('actionable')
    const row = safetyModule?.evidenceTables?.flatMap((table) => table.items).find((item) => item.id === 'hf-harm:nsaid')
    expect(row).toMatchObject({ direction: 'supports', defaultEnabled: true, value: expect.stringContaining('Diclofenac sodium') })
    expect(row?.sources?.[0]).toMatchObject({ resourceId: 'fictional-meitifen', status: 'active' })
  })

  it('keeps a therapy decision directly usable with an active recorded hospital medication', () => {
    const source = hospital({ medicationCodeableConcept: { coding: [{ system: 'urn:oid:vgh.medication.generic', display: 'Furosemide tab 40 mg VPP' }] } })
    const profile = build([source])
    const recommendation: CdssRecommendation = { id: 'synthetic-therapy', domain: 'medication', priority: 'routine', status: 'no-action',
      title: 'Synthetic therapy', recommendation: 'Synthetic decision', rationale: '', nextActions: ['Synthetic next step'], guidelineReferences: [], safetyBoundary: '',
      patientEvidence: [{ label: 'Therapy', value: profile.facts.loopDiureticTherapy.zh, factKeys: ['loopDiureticTherapy'] }],
      visitDecision: { state: 'act', headline: 'Start a loop diuretic', step: 'whether', actions: [] },
    }
    const result: CdssResult = { title: 'Synthetic', summary: '', packId: 'synthetic', packVersion: '0', recommendations: [recommendation],
      automatedChecks: [{ id: 'synthetic-check', label: 'Completed', value: 'Done', recommendation }], notEvaluated: [], disclaimer: '' }
    const reviewed = applyHospitalMedicationReview(result, profile, 'en')
    expect(reviewed.recommendations[0].status).toBe('no-action')
    expect(reviewed.automatedChecks?.[0].recommendation?.status).toBe('no-action')
    expect(reviewed.recommendations[0].visitDecision).toEqual(recommendation.visitDecision)
    expect(reviewed.recommendations[0].nextActions).toEqual(recommendation.nextActions)
  })

  it('preserves a known actionable safety alert when another ingredient is unresolved', () => {
    const profile = createHospitalAwareCdssPatientProfile({ ...input, medications: [
      hospital({ _sourceResourceType: 'MedicationStatement' }),
      hospital({ id: 'unknown', medicationCodeableConcept: { coding: [{ system: 'urn:oid:vgh.medication.product', display: 'Unlisted tablet' }] } }),
    ], conditions: [{ id: 'hf', clinicalStatus: 'active', code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'I50.22' }] } }],
    observations: [{ id: 'lvef', status: 'final', effectiveDateTime: '2026-09-30', code: { coding: [{ system: 'http://loinc.org', code: '10230-1' }] }, valueQuantity: { value: 32, unit: '%' } }],
    })
    const result = buildHospitalAwareCdssResult(getDefaultClinicalGuidelinePack(), profile, 'zh-TW')
    const alert = result.recommendations.find((item) => item.id === 'heart-failure-medication-safety')
    expect(alert).toMatchObject({ status: 'actionable', priority: 'high' })
    const rows = alert?.evidenceTables?.flatMap((table) => table.items)
    expect(rows?.find((item) => item.id === 'hf-harm:nsaid')?.direction).toBe('supports')
    expect(rows?.find((item) => item.id === 'hf-harm:non-dhp-ccb')?.direction).toBe('unknown')
  })

  it('shows ingredient provenance and source dates in the reconciliation panel; cancelled drugs stay out', () => {
    const profile = build([hospital(), hospital({ id: 'cancelled', status: 'cancelled' })])
    render(<HospitalMedicationReview evidence={profile.hospitalMedicationEvidence} locale="zh-TW" />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '院內用藥 1 筆處方' }))
    expect(screen.getByText('1 筆院內處方')).toBeInTheDocument()
    expect(screen.queryByText(/目前使用待確認|請先核對/)).not.toBeInTheDocument()
    expect(screen.getByText('Diclofenac sodium')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '對照來源' })).toHaveAttribute('href', expect.stringContaining('licId=01044041'))
    expect(screen.getByText(/2026-09-30/)).toBeInTheDocument()
  })

  it('names an unresolved medication in the on-demand review instead of a generic ingredient placeholder', () => {
    const profile = build([hospital({ medicationCodeableConcept: { coding: [{ system: 'urn:oid:vgh.medication.name', code: 'Synthetic unnamed ointment 2%', display: 'Synthetic unnamed ointment 2%' }] } })])
    render(<HospitalMedicationReview evidence={profile.hospitalMedicationEvidence} locale="zh-TW" />)
    fireEvent.click(screen.getByRole('button', { name: '院內用藥 1 筆處方' }))
    expect(screen.getByText('Synthetic unnamed ointment 2%')).toBeInTheDocument()
    expect(screen.queryByText('成分未確認')).not.toBeInTheDocument()
  })
})

