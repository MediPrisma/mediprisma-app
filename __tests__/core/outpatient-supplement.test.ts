import { FhirMapper } from '@/src/infrastructure/fhir/mappers/fhir.mapper'
import { listClinicalDocuments, resolveSelectedDocuments, formatDocumentsSection } from '@/src/core/utils/clinical-documents.utils'
import { scopeClinicalDataForAi } from '@/src/core/utils/ai-clinical-scope.utils'
import { DEFAULT_DATA_SELECTION, DEFAULT_DATA_FILTERS } from '@/src/shared/constants/data-selection.constants'
import { createHospitalAwareCdssPatientProfile } from '@/features/clinical-decision-support/utils/hospital-medication-profile'
import { documentNarrative } from '@voho0000/personalized-care-fhir'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'

// Entirely synthetic: two physicians, primary/secondary diagnoses and orders
// without results. Exercise the real import, AI selection and CDSS adapters.
const note = (id: string, date: string, body: string) => FhirMapper.toDocumentReference({
  resourceType: 'DocumentReference', id, status: 'current', date,
  meta: { tag: [{ system: 'urn:wildcatch:source', code: 'vghtpe-outpatient-supplement' }] },
  type: { text: 'Outpatient SOAP and orders' },
  content: [{ attachment: { contentType: 'text/html', data: Buffer.from(body).toString('base64') } }],
})
const documents = [
  note('vgh-one', '2026-01-27', '<p>S: Follow-up</p><p>O: Pulse: 72 bpm</p><p>A: Primary I10 hypertension; Secondary E11.9 diabetes</p><p>P: Order TSH and Free T4; results pending</p>'),
  note('vgh-two', '2025-11-04', '<p>S: Second physician follow-up</p><p>O: Stable</p><p>A: Dyslipidemia</p><p>P: Order lipid panel; results pending</p>'),
]

test('both physician notes, diagnoses and pending orders reach default AI document context', () => {
  const listed = listClinicalDocuments({ documentReferences: documents })
  const selected = resolveSelectedDocuments(listed, 'latestAdmission', [])
  expect(selected.map(d => d.id)).toEqual(['vgh-one', 'vgh-two'])
  const scoped = scopeClinicalDataForAi({ documentReferences: documents }, DEFAULT_DATA_SELECTION,
    DEFAULT_DATA_FILTERS, selected.map(d => d.id), Date.parse('2026-10-15'))
  const context = JSON.stringify(formatDocumentsSection(listClinicalDocuments(scoped)))
  for (const text of ['S: Follow-up', 'O: Pulse', 'Primary I10', 'Secondary E11.9', 'Order TSH and Free T4', 'Second physician', 'Order lipid panel', 'results pending']) {
    expect(context).toContain(text)
  }
  expect(resolveSelectedDocuments(listed, 'custom', ['vgh-two']).map(d => d.id)).toEqual(['vgh-two'])
  const excluded = scopeClinicalDataForAi({ documentReferences: documents }, { ...DEFAULT_DATA_SELECTION, documents: false },
    DEFAULT_DATA_FILTERS, selected.map(d => d.id), Date.parse('2026-10-15'))
  expect(excluded.documentReferences).toEqual([])
})

test('CDSS reads the same SOAP narrative and preserves both diagnosis references/ranks', () => {
  const conditions = ['I10', 'E11.9'].map((code, index) => FhirMapper.toCondition({
    resourceType: 'Condition', id: `dx-${index}`, code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code }] },
    subject: { reference: 'Patient/synthetic' }, category: [{ coding: [{ code: 'encounter-diagnosis' }] }],
  } as any))
  const encounter = FhirMapper.toEncounter({ id: 'visit', diagnosis: conditions.map((c, i) => ({ condition: { reference: `Condition/${c.id}` }, rank: i + 1 })) })
  expect(encounter.diagnosis?.map(d => d.rank)).toEqual([1, 2])
  const profile = createHospitalAwareCdssPatientProfile({
    patient: { id: 'synthetic', age: 60 }, conditions, encounters: [encounter],
    observations: [], medications: [], allergies: [], carePlans: [], documentReferences: documents,
    now: new Date('2026-10-15'),
  })
  expect(profile.facts.noteVitalHeartRate).toMatchObject({ numericValue: 72 })
  expect(profile.facts.type2DiabetesDiagnosis.sources?.some(source => source.resourceId === 'dx-1')).toBe(true)
  expect(JSON.stringify(profile.facts)).toContain('vgh-one')
  expect(documentNarrative(documents[0])).toContain('Order TSH and Free T4; results pending')
  expect(documentNarrative(documents[1])).toContain('Order lipid panel; results pending')
})

test('local bundle ingestion retains supplement metadata and both documents', () => {
  const parsed = LocalBundleService.parse({ resourceType: 'Bundle', type: 'collection', entry: [
    { resource: { resourceType: 'Patient', id: 'synthetic', name: [{ text: 'Synthetic Patient' }] } },
    ...documents.map(document => ({ resource: { resourceType: 'DocumentReference', ...document } })),
  ] })
  expect(parsed).not.toBeNull()
  const selected = resolveSelectedDocuments(listClinicalDocuments(parsed!.collection), 'latestAdmission', [])
  expect(selected.map(d => d.id)).toEqual(['vgh-one', 'vgh-two'])
})
