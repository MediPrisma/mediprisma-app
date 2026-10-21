import { buildIpsBundle } from '@/features/ips-export/utils/ips-builder'
import { validateIpsBundle } from '@/features/ips-export/utils/ips-lite-validator'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { CLINICAL_RECORD_VARIANT_EXTENSION } from '@/features/ips-export/utils/ips-constants'
import {
  COMPOSITION_TYPE_LOINC,
  IPS_PROFILES,
  IPS_SECTION,
} from '@/features/ips-export/utils/ips-constants'
import type { ClinicalDataCollection } from '@/src/core/entities/clinical-data.entity'
import type { PatientEntity } from '@/src/core/entities/patient.entity'
import type { FhirResource, IpsCompositionSection } from '@/features/ips-export/utils/ips-types'

function emptyCollection(): ClinicalDataCollection {
  return {
    conditions: [],
    medications: [],
    medicationRemainingSummaries: [],
    allergies: [],
    observations: [],
    vitalSigns: [],
    diagnosticReports: [],
    imagingStudies: [],
    procedures: [],
    encounters: [],
    documentReferences: [],
    compositions: [],
    immunizations: [],
    consents: [],
    devices: [],
    carePlans: [],
  }
}

const PATIENT: PatientEntity = {
  id: 'pat-1',
  resourceType: 'Patient',
  name: [{ given: ['Test'], family: 'Patient' }],
  gender: 'female',
  birthDate: '1980-01-15',
}

function sectionByLoinc(bundle: ReturnType<typeof buildIpsBundle>, loinc: string) {
  const composition = bundle.entry[0].resource as FhirResource
  const sections = (composition.section as IpsCompositionSection[]) ?? []
  return sections.find((s) => s.code?.coding?.some((c) => c.code === loinc))
}

describe('buildIpsBundle — structure', () => {
  it('exports unresolved source versions as modifiers with complete human-readable meaning', async () => {
    const parsed = await LocalBundleService.parse({ resourceType: 'Bundle', entry: [
      { resource: PATIENT },
      ...['1', '2'].flatMap(version => [
        { resource: { resourceType: 'Observation', id: 'potassium', meta: { versionId: version }, status: 'final', code: { text: 'Potassium' }, effectiveDateTime: '2026-10-01', valueQuantity: { value: version === '1' ? 5 : 6.2, unit: 'mmol/L' } } },
        { resource: { resourceType: 'Condition', id: 'problem', meta: { versionId: version }, code: { text: version === '1' ? 'First problem' : 'Revised problem' } } },
      ]),
    ] })
    if (!parsed) throw new Error('Synthetic source bundle must parse before export')
    const bundle = buildIpsBundle({ patient: PATIENT, data: parsed.collection })
    const resources = bundle.entry.map(entry => entry.resource).filter(resource => ['Observation', 'Condition'].includes(resource.resourceType))
    expect(resources).toHaveLength(4)
    for (const resource of resources) {
      expect(resource.modifierExtension).toContainEqual(expect.objectContaining({ url: CLINICAL_RECORD_VARIANT_EXTENSION }))
      expect((resource.extension as Array<{ url: string }> | undefined)?.some(extension => extension.url === CLINICAL_RECORD_VARIANT_EXTENSION)).not.toBe(true)
      const narrative = resource.text as { status: string; div: string }
      expect(narrative.status).toBe('extensions')
      expect(narrative.div).toContain('Manual reconciliation required')
      expect(narrative.div).toContain('Do not treat these variants as concurrent facts')
      expect(narrative.div).toContain((resource.code as { text: string }).text)
      expect(resource).not.toHaveProperty('clinicalRecordVariant')
    }
    expect((resources.find(resource => resource.resourceType === 'Observation' && (resource.valueQuantity as { value: number }).value === 6.2)!.text as { div: string }).div).toContain('6.2')
    expect(validateIpsBundle(bundle).ok).toBe(true)
  })

  it('produces a document Bundle with a Composition first entry', () => {
    const bundle = buildIpsBundle({ patient: PATIENT, data: emptyCollection() })
    expect(bundle.resourceType).toBe('Bundle')
    expect(bundle.type).toBe('document')
    expect(bundle.timestamp).toBeTruthy()

    const first = bundle.entry[0].resource
    expect(first.resourceType).toBe('Composition')
    expect(first.meta?.profile).toContain(IPS_PROFILES.composition)
    const type = first.type as { coding?: Array<{ code?: string }> }
    expect(type.coding?.[0]?.code).toBe(COMPOSITION_TYPE_LOINC)
    expect((first.author as Array<{ display?: string }>)[0].display).toContain('no clinical attestation')
    expect((first.subject as { reference?: string }).reference).toBe(bundle.entry[1].fullUrl)
  })

  it('second entry is the Patient with the IPS profile', () => {
    const bundle = buildIpsBundle({ patient: PATIENT, data: emptyCollection() })
    const patient = bundle.entry[1].resource
    expect(patient.resourceType).toBe('Patient')
    expect(patient.meta?.profile).toContain(IPS_PROFILES.patient)
    expect((patient.name as Array<{ family?: string }>)[0].family).toBe('Patient')
    expect(patient.birthDate).toBe('1980-01-15')
  })

  it('marks user-entered patient demographics in the exported Patient', () => {
    const bundle = buildIpsBundle({
      patient: {
        ...PATIENT,
        demographicsSource: 'user-entered-local-profile',
        userEnteredDemographicFields: ['name', 'gender', 'birthDate'],
      },
      data: emptyCollection(),
    })
    const patient = bundle.entry
      .map((entry: any) => entry.resource)
      .find((resource: any) => resource.resourceType === 'Patient')

    expect(patient.meta.tag).toContainEqual(expect.objectContaining({
      code: 'user-entered-local-profile',
    }))
  })

  it('preserves Patient identifiers in the IPS Patient resource', () => {
    const bundle = buildIpsBundle({
      patient: {
        ...PATIENT,
        identifier: [
          {
            use: 'official',
            system: 'https://twcore.mohw.gov.tw/IdentifierSystem/national-id',
            value: 'A123456789',
            type: {
              coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'NI' }],
            },
          },
        ],
      },
      data: emptyCollection(),
    })
    const patient = bundle.entry[1].resource as FhirResource & {
      identifier?: Array<{
        use?: string
        system?: string
        value?: string
        type?: { coding?: Array<{ system?: string; code?: string }> }
      }>
    }

    expect(patient.identifier).toEqual([
      {
        use: 'official',
        system: 'https://twcore.mohw.gov.tw/IdentifierSystem/national-id',
        value: 'A123456789',
        type: {
          coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'NI' }],
        },
      },
    ])
  })

  it('can mask direct identifiers while preserving the document references', () => {
    const bundle = buildIpsBundle({
      patient: {
        ...PATIENT,
        identifier: [{ system: 'urn:test:mrn', value: 'MRN-123' }],
      },
      data: emptyCollection(),
      includePatientIdentifiers: false,
    })
    const patient = bundle.entry[1].resource
    const composition = bundle.entry[0].resource

    expect(patient.name).toEqual([{ text: 'Identity masked by the exporter' }])
    expect(patient.identifier).toBeUndefined()
    expect(patient.birthDate).toBeUndefined()
    expect(patient.gender).toBe('female')
    expect((composition.subject as { reference?: string }).reference).toBe(bundle.entry[1].fullUrl)
  })

  it('marks the Bundle as IPS-formatted, restricted, and patient-mediated', () => {
    const bundle = buildIpsBundle({ patient: PATIENT, data: emptyCollection() })
    expect(bundle.meta?.profile).toContain(IPS_PROFILES.bundle)
    expect(bundle.meta?.security).toContainEqual(expect.objectContaining({ code: 'R' }))
    expect(bundle.meta?.tag).toContainEqual(expect.objectContaining({ code: 'patient-mediated-health-bank-export' }))
    expect(bundle.entry[0].resource.text).toEqual(expect.objectContaining({
      div: expect.stringContaining('My Health Bank'),
    }))
    expect(bundle.entry[0].resource.attester).toBeUndefined()
  })

  it('always includes the three required sections, even when empty', () => {
    const bundle = buildIpsBundle({ patient: PATIENT, data: emptyCollection() })
    const problems = sectionByLoinc(bundle, IPS_SECTION.problemList.loinc)
    const allergies = sectionByLoinc(bundle, IPS_SECTION.allergies.loinc)
    const meds = sectionByLoinc(bundle, IPS_SECTION.medications.loinc)

    expect(problems).toBeDefined()
    expect(allergies).toBeDefined()
    expect(meds).toBeDefined()

    // Empty required sections carry an emptyReason (IPS 2.0: list-empty-reason
    // `unavailable`) and no entry.
    const EMPTY_REASON_SYSTEM = 'http://terminology.hl7.org/CodeSystem/list-empty-reason'
    expect(problems?.entry).toBeUndefined()
    for (const section of [problems, allergies, meds]) {
      expect(section?.emptyReason?.coding?.[0]?.system).toBe(EMPTY_REASON_SYSTEM)
      expect(section?.emptyReason?.coding?.[0]?.code).toBe('unavailable')
    }
  })

  it('omits optional sections when there is no data', () => {
    const bundle = buildIpsBundle({ patient: PATIENT, data: emptyCollection() })
    expect(sectionByLoinc(bundle, IPS_SECTION.immunizations.loinc)).toBeUndefined()
    expect(sectionByLoinc(bundle, IPS_SECTION.results.loinc)).toBeUndefined()
    expect(sectionByLoinc(bundle, IPS_SECTION.vitalSigns.loinc)).toBeUndefined()
  })

  it('passes lite validation for an empty (required-only) document', () => {
    const bundle = buildIpsBundle({ patient: PATIENT, data: emptyCollection() })
    const result = validateIpsBundle(bundle)
    expect(result.ok).toBe(true)
  })
})

describe('buildIpsBundle — populated data', () => {
  function populated(): ClinicalDataCollection {
    return {
      ...emptyCollection(),
      conditions: [
        {
          id: 'c1',
          code: { text: '糖尿病', coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code: 'E11.9', display: 'Type 2 diabetes mellitus' }] },
          clinicalStatus: 'active',
          recordedDate: '2024-03-01',
        },
      ],
      allergies: [
        {
          id: 'a1',
          code: { text: 'Penicillin' },
          clinicalStatus: 'active',
          criticality: 'high',
          reaction: [{ manifestation: [{ text: 'Rash' }], severity: 'moderate' }],
        },
      ],
      medications: [
        {
          id: 'm1',
          medicationCodeableConcept: { text: 'Metformin 500mg' },
          status: 'active',
          authoredOn: '2024-03-01',
          dosageInstruction: [{ text: '1 tab BID' }],
        },
        // No authoredOn -> required effectiveDateTime should be data-absent.
        { id: 'm2', medicationCodeableConcept: { text: 'Aspirin' } },
      ],
      immunizations: [
        { id: 'i1', status: 'completed', vaccineCode: { text: 'Influenza' }, occurrenceDateTime: '2023-10-01' },
      ],
      procedures: [
        { id: 'p1', code: { coding: [{ display: 'Appendectomy' }] }, status: 'completed', performedDateTime: '2020-05-05' },
      ],
      vitalSigns: [
        {
          id: 'v1',
          code: { text: 'Blood pressure', coding: [{ system: 'http://loinc.org', code: '85354-9' }] },
          effectiveDateTime: '2024-03-01',
          component: [
            { code: { text: 'Systolic' }, valueQuantity: { value: 120, unit: 'mmHg' } },
            { code: { text: 'Diastolic' }, valueQuantity: { value: 80, unit: 'mmHg' } },
          ],
        },
      ],
      observations: [
        {
          id: 'o1',
          code: { text: 'Glucose', coding: [{ system: 'http://loinc.org', code: '2345-7' }] },
          valueQuantity: { value: 99, unit: 'mg/dL' },
          effectiveDateTime: '2024-03-01',
        },
      ],
      diagnosticReports: [
        {
          id: 'dr1',
          code: { text: 'Chest X-ray' },
          conclusion: 'No acute findings.',
          effectiveDateTime: '2024-02-20',
          _observations: [
            { id: 'dro1', code: { text: 'Impression' }, valueString: 'Normal', effectiveDateTime: '2024-02-20' },
          ],
        },
      ],
      devices: [
        { id: 'd1', status: 'active', type: { text: 'Pacemaker' }, manufacturer: 'Acme' },
      ],
      carePlans: [
        { id: 'cp1', status: 'active', title: 'Diabetes care', description: 'Quarterly review' },
      ],
      consents: [
        { id: 'cs1', status: 'active', provision: { type: 'deny' }, dateTime: '2022-01-01' },
      ],
    }
  }

  it('emits every section with the right entry counts and profiles', () => {
    const bundle = buildIpsBundle({ patient: PATIENT, data: populated() })

    const problems = sectionByLoinc(bundle, IPS_SECTION.problemList.loinc)
    expect(problems?.entry).toHaveLength(1)

    const meds = sectionByLoinc(bundle, IPS_SECTION.medications.loinc)
    expect(meds?.entry).toHaveLength(2)

    const results = sectionByLoinc(bundle, IPS_SECTION.results.loinc)
    // 1 lab observation + 1 diagnostic report = 2 section entries.
    expect(results?.entry).toHaveLength(2)

    expect(sectionByLoinc(bundle, IPS_SECTION.immunizations.loinc)?.entry).toHaveLength(1)
    expect(sectionByLoinc(bundle, IPS_SECTION.procedures.loinc)?.entry).toHaveLength(1)
    expect(sectionByLoinc(bundle, IPS_SECTION.vitalSigns.loinc)?.entry).toHaveLength(1)
    expect(sectionByLoinc(bundle, IPS_SECTION.medicalDevices.loinc)?.entry).toHaveLength(1)
    expect(sectionByLoinc(bundle, IPS_SECTION.planOfCare.loinc)?.entry).toHaveLength(1)
    expect(sectionByLoinc(bundle, IPS_SECTION.advanceDirectives.loinc)?.entry).toHaveLength(1)
  })

  it('keeps ICD-10 coding on conditions and invents no SNOMED CT code', () => {
    const bundle = buildIpsBundle({ patient: PATIENT, data: populated() })
    const condition = bundle.entry.find((e) => e.resource.resourceType === 'Condition')!.resource
    const coding = (condition.code as { coding?: Array<{ system?: string; code?: string }> }).coding ?? []
    expect(coding.some((c) => c.system === 'http://hl7.org/fhir/sid/icd-10' && c.code === 'E11.9')).toBe(true)
    // No SNOMED CT system should appear in Phase 1.
    expect(coding.some((c) => c.system === 'http://snomed.info/sct')).toBe(false)
  })

  it('uses a data-absent extension for a required dateTime that is missing', () => {
    const bundle = buildIpsBundle({ patient: PATIENT, data: populated() })
    const aspirin = bundle.entry
      .map((e) => e.resource)
      .find((r) => r.resourceType === 'MedicationStatement' && (r.medicationCodeableConcept as { text?: string })?.text === 'Aspirin')!
    expect(aspirin.effectiveDateTime).toBeUndefined()
    const absent = aspirin._effectiveDateTime as { extension?: Array<{ url?: string; valueCode?: string }> }
    expect(absent.extension?.[0]?.url).toBe('http://hl7.org/fhir/StructureDefinition/data-absent-reason')
    expect(absent.extension?.[0]?.valueCode).toBe('unknown')
  })

  it('does not export medication supply text as dosage directions', () => {
    const data = {
      ...emptyCollection(),
      medications: [
        {
          id: 'eye-drop',
          medicationCodeableConcept: { text: 'PATEAR EYE LOTIONS "PATRON"' },
          status: 'active',
          authoredOn: '2026-06-23',
          dosageInstruction: [{ text: '給藥總量 1，給藥日數 28 天（平均每日 0.04）' }],
        },
      ],
    }
    const bundle = buildIpsBundle({ patient: PATIENT, data })
    const medication = bundle.entry
      .map((e) => e.resource)
      .find((r) => r.resourceType === 'MedicationStatement' && (r.medicationCodeableConcept as { text?: string })?.text === 'PATEAR EYE LOTIONS "PATRON"')!

    expect(medication.dosage).toBeUndefined()
    expect(JSON.stringify(medication)).not.toContain('平均每日')
    expect(JSON.stringify(medication)).not.toContain('0.04')
  })

  it('links DiagnosticReport.result to observations that exist in the Bundle', () => {
    const bundle = buildIpsBundle({ patient: PATIENT, data: populated() })
    const fullUrls = new Set(bundle.entry.map((e) => e.fullUrl))
    const dr = bundle.entry.find((e) => e.resource.resourceType === 'DiagnosticReport')!.resource
    const results = (dr.result as Array<{ reference?: string }>) ?? []
    expect(results).toHaveLength(1)
    expect(fullUrls.has(results[0].reference!)).toBe(true)
  })

  it('every section.entry reference resolves and every resource has a profile', () => {
    const bundle = buildIpsBundle({ patient: PATIENT, data: populated() })
    const result = validateIpsBundle(bundle)
    if (!result.ok) {
      // Surface which checks failed for easier debugging.
       
      console.error(result.items.filter((i) => !i.ok))
    }
    expect(result.ok).toBe(true)

    // Belt-and-suspenders: assert profile presence directly too.
    for (const entry of bundle.entry) {
      expect(entry.resource.meta?.profile?.length).toBeGreaterThan(0)
    }
  })

  it('prefers the English coding[].display in the medication narrative (bridge contract)', () => {
    const data = emptyCollection()
    data.medications = [
      {
        id: 'm-en',
        // Bridge shape: text = zh-TW, coding[].display = canonical English.
        medicationCodeableConcept: {
          text: '“德國”昂特欣錠 50 微公克',
          coding: [{ system: 'http://www.nhi.gov.tw/drug', code: 'A012345', display: 'Entecavir 0.5mg tab' }],
        },
        status: 'active',
        authoredOn: '2024-05-10',
      },
    ]
    const bundle = buildIpsBundle({ patient: PATIENT, data })
    const meds = sectionByLoinc(bundle, IPS_SECTION.medications.loinc)
    const div = meds?.text?.div ?? ''
    expect(div).toContain('Entecavir 0.5mg tab')
    expect(div).not.toContain('德國')
  })

  it('faithfully carries over the source text when no English coding exists', () => {
    const data = emptyCollection()
    data.medications = [
      // Non-bridge source: only text, no English coding -> carry it over as-is.
      { id: 'm-zh', medicationCodeableConcept: { text: '息痛佳音錠' }, status: 'completed' },
    ]
    const bundle = buildIpsBundle({ patient: PATIENT, data })
    const meds = sectionByLoinc(bundle, IPS_SECTION.medications.loinc)
    expect(meds?.text?.div ?? '').toContain('息痛佳音錠')
  })

  it('does not emit a report-member observation twice (value row + count row)', () => {
    const data = emptyCollection()
    // A lab value that the data layer exposes BOTH flat in `observations`
    // (same id) and nested under its DiagnosticReport. Plus a vital sign that
    // also leaks into the flat list.
    const tsh = {
      id: 'obs-tsh',
      code: { text: 'TSH' },
      valueQuantity: { value: 3.15, unit: 'uIU/mL' },
      effectiveDateTime: '2026-01-15',
    }
    data.observations = [
      { ...tsh },
      {
        id: 'obs-bp',
        code: { text: 'Blood Pressure' },
        category: [{ coding: [{ code: 'vital-signs' }] }],
        valueQuantity: { value: 120, unit: 'mmHg' },
        effectiveDateTime: '2026-01-15',
      },
    ]
    data.diagnosticReports = [
      {
        id: 'dr-tsh',
        code: { text: 'TSH' },
        effectiveDateTime: '2026-01-15',
        _observations: [{ ...tsh }],
      },
    ]

    const bundle = buildIpsBundle({ patient: PATIENT, data })
    const results = sectionByLoinc(bundle, IPS_SECTION.results.loinc)
    // Only the report is a standalone Results entry — the flat copy is deduped
    // by id and the BP reading is routed away as a vital sign.
    expect(results?.entry).toHaveLength(1)

    const div = results?.text?.div ?? ''
    // The real value is surfaced, not an opaque "N observation(s)" count, and
    // the analyte name shows exactly once (no value-row + count-row pair).
    expect(div).toContain('3.15')
    expect(div).not.toContain('observation(s)')
    expect(div.match(/TSH/g)?.length).toBe(1)
  })

  it('keeps a genuinely standalone (orphan) lab observation in Results', () => {
    const data = emptyCollection()
    data.observations = [
      {
        id: 'orphan',
        code: { text: 'Free T4' },
        valueQuantity: { value: 1.21, unit: 'ng/dL' },
        effectiveDateTime: '2026-01-15',
      },
    ]
    const bundle = buildIpsBundle({ patient: PATIENT, data })
    const results = sectionByLoinc(bundle, IPS_SECTION.results.loinc)
    expect(results?.entry).toHaveLength(1)
    expect(results?.text?.div ?? '').toContain('1.21')
  })

  it('shows BOTH the conclusion and member values for a report that has both', () => {
    // Regression for the IPS Results narrative dropping lab values: the IPS
    // fasting-glucose / lipid reports carry a textual `conclusion` AND member
    // `_observations`. The narrative must surface both the summary sentence and
    // every member analyte+value (matching the left-panel report card), not let
    // the conclusion suppress the numbers.
    const data = emptyCollection()
    data.diagnosticReports = [
      {
        id: 'dr-glucose',
        code: { text: '空腹血糖報告' },
        conclusion: '血糖檢查已完成，建議配合症狀與用藥狀況判讀。',
        effectiveDateTime: '2026-06-01',
        _observations: [
          {
            id: 'obs-glucose',
            code: { text: 'Glucose', coding: [{ system: 'http://loinc.org', code: '777-3' }] },
            valueQuantity: { value: 0.06, unit: 'nanogram per milliliter' },
            effectiveDateTime: '2026-06-01',
          },
        ],
      },
    ]

    const bundle = buildIpsBundle({ patient: PATIENT, data })
    const results = sectionByLoinc(bundle, IPS_SECTION.results.loinc)
    const div = results?.text?.div ?? ''
    // Conclusion sentence is present...
    expect(div).toContain('血糖檢查已完成')
    // ...AND so is the actual member value (the previously-dropped number).
    expect(div).toContain('0.06')
    // The member observation is also a machine-readable Bundle entry linked back
    // via DiagnosticReport.result.
    const dr = bundle.entry.find((e) => e.resource.resourceType === 'DiagnosticReport')!.resource
    expect((dr.result as Array<{ reference?: string }>)?.length).toBe(1)
  })

  it('adds a group title before multi-row DiagnosticReport narratives', () => {
    const data = emptyCollection()
    data.diagnosticReports = [
      {
        id: 'chem-panel',
        code: { text: '生化檢查' },
        effectiveDateTime: '2026-06-15',
        _observations: [
          {
            id: 'bun',
            code: { text: 'BUN' },
            valueQuantity: { value: 23.7, unit: 'mg/dL' },
            effectiveDateTime: '2026-06-15',
          },
          {
            id: 'crea',
            code: { text: 'CREA' },
            valueQuantity: { value: 1.93, unit: 'mg/dL' },
            effectiveDateTime: '2026-06-15',
          },
        ],
      },
    ]

    const div = sectionByLoinc(buildIpsBundle({ patient: PATIENT, data }), IPS_SECTION.results.loinc)?.text?.div ?? ''
    expect(div).toContain('<p><strong>2026-06-15 - 生化檢查</strong></p>')
    expect(div.indexOf('2026-06-15 - 生化檢查')).toBeLessThan(div.indexOf('BUN'))
    expect(div).toContain('CREA')
  })

  // --- Diagnostic-results channel matrix -----------------------------------
  // Each test exercises ONE presentation channel so the total-function model is
  // locked per-channel; new bundles are just combinations of these.

  it('renders multi-component vitals (blood pressure) instead of a dash', () => {
    const data = emptyCollection()
    data.vitalSigns = [
      {
        id: 'bp',
        code: { text: 'Blood Pressure', coding: [{ system: 'http://loinc.org', code: '85354-9' }] },
        effectiveDateTime: '2026-06-01',
        component: [
          { code: { text: 'Systolic', coding: [{ system: 'http://loinc.org', code: '8480-6' }] }, valueQuantity: { value: 120, unit: 'mmHg' } },
          { code: { text: 'Diastolic', coding: [{ system: 'http://loinc.org', code: '8462-4' }] }, valueQuantity: { value: 80, unit: 'mmHg' } },
        ],
      },
    ]
    const div = sectionByLoinc(buildIpsBundle({ patient: PATIENT, data }), IPS_SECTION.vitalSigns.loinc)?.text?.div ?? ''
    expect(div).toContain('120')
    expect(div).toContain('80')
  })

  it('renders a coded result value (valueCodeableConcept)', () => {
    const data = emptyCollection()
    data.observations = [
      { id: 'bt', code: { text: 'Blood group' }, valueCodeableConcept: { text: 'O positive' }, effectiveDateTime: '2026-06-01' },
    ]
    const div = sectionByLoinc(buildIpsBundle({ patient: PATIENT, data }), IPS_SECTION.results.loinc)?.text?.div ?? ''
    expect(div).toContain('O positive')
  })

  it('omits text-less (image-only) reports but keeps text reports', () => {
    const data = emptyCollection()
    data.diagnosticReports = [
      {
        id: 'dr-img',
        code: { text: '胸部X光' }, // image-only — no conclusion/members
        effectiveDateTime: '2026-06-01',
        presentedForm: [{ title: 'Chest X-ray frame 1', contentType: 'image/jpeg', _imageRef: 'blob-1' }],
      },
      {
        id: 'dr-lab',
        code: { text: '血液報告' },
        effectiveDateTime: '2026-06-02',
        conclusion: 'Normal',
      },
    ]
    const div = sectionByLoinc(buildIpsBundle({ patient: PATIENT, data }), IPS_SECTION.results.loinc)?.text?.div ?? ''
    expect(div).toContain('血液報告') // text report kept
    expect(div).toContain('Normal')
    expect(div).not.toContain('胸部X光') // image-only report omitted entirely
    expect(div).not.toMatch(/attachment/i)
    expect(div).not.toContain('frame')
  })

  it('orders the results narrative newest-first', () => {
    const data = emptyCollection()
    data.diagnosticReports = [
      { id: 'old', code: { text: 'OlderReport' }, effectiveDateTime: '2026-02-18', conclusion: 'older' },
      { id: 'new', code: { text: 'NewerReport' }, effectiveDateTime: '2026-06-15', conclusion: 'newer' },
    ]
    const div = sectionByLoinc(buildIpsBundle({ patient: PATIENT, data }), IPS_SECTION.results.loinc)?.text?.div ?? ''
    expect(div.indexOf('NewerReport')).toBeLessThan(div.indexOf('OlderReport'))
  })

  it('renders a coded conclusion (conclusionCode) when there is no free-text conclusion', () => {
    const data = emptyCollection()
    data.diagnosticReports = [
      {
        id: 'dr-cc',
        code: { text: 'Culture' },
        effectiveDateTime: '2026-06-01',
        conclusionCode: [{ text: 'No growth', coding: [{ system: 'http://snomed.info/sct', code: '264868006' }] }],
      },
    ]
    const div = sectionByLoinc(buildIpsBundle({ patient: PATIENT, data }), IPS_SECTION.results.loinc)?.text?.div ?? ''
    expect(div).toContain('No growth')
  })

  it('falls back to an Unknown patient when none is provided', () => {
    const bundle = buildIpsBundle({ patient: null, data: emptyCollection() })
    const patient = bundle.entry[1].resource
    expect(patient.resourceType).toBe('Patient')
    expect(JSON.stringify(patient.name)).toContain('Unknown Patient')
    expect(validateIpsBundle(bundle).ok).toBe(true)
  })

  // Regression: a TW Core / IPS patient whose name lives only in `text`
  // (Chinese name, no given/family) must export with that text intact — not
  // collapse to "Unknown Patient" and bake the loss into the file on a
  // round-trip. See IPS_Unknown_Patient_*.json.
  it('preserves a text-only patient name (no given/family) through export', () => {
    const textOnly: PatientEntity = {
      id: 'pat-text',
      resourceType: 'Patient',
      name: [{ use: 'official', text: '楊雅霖' }],
      gender: 'female',
      birthDate: '1917-04-07',
    }
    const bundle = buildIpsBundle({ patient: textOnly, data: emptyCollection() })
    const patient = bundle.entry[1].resource as { name?: Array<{ text?: string }> }
    expect(patient.name?.[0]?.text).toBe('楊雅霖')
    expect(JSON.stringify(patient.name)).not.toContain('Unknown Patient')
  })

  it('keeps the Chinese text alongside Pinyin given/family on export', () => {
    const bilingual: PatientEntity = {
      id: 'pat-bi',
      resourceType: 'Patient',
      name: [{ text: '楊雅霖', given: ['Yalin'], family: 'Yang' }],
    }
    const bundle = buildIpsBundle({ patient: bilingual, data: emptyCollection() })
    const patient = bundle.entry[1].resource as {
      name?: Array<{ text?: string; given?: string[]; family?: string }>
    }
    expect(patient.name?.[0]?.text).toBe('楊雅霖')
    expect(patient.name?.[0]?.family).toBe('Yang')
    expect(patient.name?.[0]?.given).toEqual(['Yalin'])
  })
})

describe('buildIpsBundle — presentedForm image stripping (P1-1)', () => {
  function reportWithAttachments(): ClinicalDataCollection {
    const data = emptyCollection()
    data.diagnosticReports = [
      {
        id: 'dr-mixed',
        code: { text: '病理報告' },
        conclusion: 'Specimen adequate.',
        effectiveDateTime: '2026-06-01',
        presentedForm: [
          { title: 'Report text', contentType: 'text/plain', data: 'dGV4dA==' },
          { title: 'Scan page 1', contentType: 'image/jpeg', data: 'aW1n', size: 2_500_000 },
          // No inline data (blob moved to IndexedDB) → never exportable.
          { title: 'Scan page 2', contentType: 'image/jpeg', _imageRef: 'blob-key-2' },
        ],
      },
    ]
    return data
  }

  const findReport = (bundle: ReturnType<typeof buildIpsBundle>) =>
    bundle.entry.find((e) => e.resource.resourceType === 'DiagnosticReport')!.resource as {
      conclusion?: string
      presentedForm?: Array<{ contentType?: string; data?: string; _imageRef?: string }>
    }

  it('strips image/* attachments by default but keeps conclusion + text/* attachments', () => {
    const bundle = buildIpsBundle({ patient: PATIENT, data: reportWithAttachments() })
    const dr = findReport(bundle)
    expect(dr.conclusion).toBe('Specimen adequate.')
    expect(dr.presentedForm).toHaveLength(1)
    expect(dr.presentedForm?.[0]?.contentType).toBe('text/plain')
    expect(dr.presentedForm?.[0]?.data).toBe('dGV4dA==')
  })

  it('keeps image/* attachments (with inline data) when includeImageAttachments is opted in', () => {
    const bundle = buildIpsBundle({
      patient: PATIENT,
      data: reportWithAttachments(),
      includeImageAttachments: true,
    })
    const dr = findReport(bundle)
    expect(dr.presentedForm?.map((a) => a.contentType)).toEqual(['text/plain', 'image/jpeg'])
  })

  it('never emits the app-local _imageRef field or data-less attachments', () => {
    const bundle = buildIpsBundle({
      patient: PATIENT,
      data: reportWithAttachments(),
      includeImageAttachments: true,
    })
    expect(JSON.stringify(bundle)).not.toContain('_imageRef')
    expect(JSON.stringify(bundle)).not.toContain('blob-key-2')
  })

  it('omits presentedForm entirely when no attachment survives', () => {
    const data = emptyCollection()
    data.diagnosticReports = [
      {
        id: 'dr-img-only',
        code: { text: 'X-ray' },
        conclusion: 'ok',
        effectiveDateTime: '2026-06-01',
        presentedForm: [{ title: 'frame', contentType: 'image/jpeg', data: 'aW1n' }],
      },
    ]
    const bundle = buildIpsBundle({ patient: PATIENT, data })
    const dr = findReport(bundle)
    expect(dr.presentedForm).toBeUndefined()
  })
})

describe('buildIpsBundle — Problem List is text-only (no generated SNOMED CT)', () => {
  it('keeps the source ICD-10 coding and adds no SNOMED CT coding', () => {
    const data: ClinicalDataCollection = {
      ...emptyCollection(),
      conditions: [
        {
          id: 'dm',
          clinicalStatus: 'active',
          code: {
            text: '第二型糖尿病',
            coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code: 'E11.9', display: 'Type 2 diabetes mellitus' }],
          },
        },
      ],
    }
    const bundle = buildIpsBundle({ patient: PATIENT, data })
    const condition = bundle.entry.find((e) => e.resource.resourceType === 'Condition')!.resource
    const coding = (condition.code as { coding?: Array<{ system?: string; code?: string }> }).coding ?? []
    // Source ICD-10 preserved; NO SNOMED CT is ever prepended.
    expect(coding.some((c) => c.system === 'http://hl7.org/fhir/sid/icd-10' && c.code === 'E11.9')).toBe(true)
    expect(coding.some((c) => c.system === 'http://snomed.info/sct')).toBe(false)
  })

  it('leaves a text-only Condition.code with no coding when the source had none', () => {
    const data: ClinicalDataCollection = {
      ...emptyCollection(),
      conditions: [
        {
          id: 'plain',
          clinicalStatus: 'active',
          code: { text: 'Chronic kidney disease' },
        },
      ],
    }
    const bundle = buildIpsBundle({ patient: PATIENT, data })
    const condition = bundle.entry.find((e) => e.resource.resourceType === 'Condition')!.resource
    const code = condition.code as { text?: string; coding?: Array<{ system?: string }> }
    expect(code.text).toBe('Chronic kidney disease')
    expect(code.coding).toBeUndefined()
  })
})
