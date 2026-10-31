// Unit Tests: FHIR Mapper
import { FhirMapper } from '@/src/infrastructure/fhir/mappers/fhir.mapper'

describe('FhirMapper', () => {
  it('preserves outpatient order links and source metadata on reports and analytes', () => {
    const basedOn = [{ reference: 'ServiceRequest/synthetic-order' }]
    const meta = { source: 'https://web9.vghtpe.gov.tw/emr/qemr/', tag: [{ system: 'urn:wildcatch:source', code: 'vghtpe-outpatient-supplement' }] }
    const observation = FhirMapper.toObservation({ id: 'result', basedOn, meta, valueQuantity: { value: 7 } })
    const report = FhirMapper.toDiagnosticReport({ id: 'report', basedOn, meta, result: [{ reference: 'Observation/result' }] }, [observation])
    expect(observation.basedOn).toEqual(basedOn)
    expect(report.basedOn).toEqual(basedOn)
    expect(report._observations?.[0]?.basedOn).toEqual(basedOn)
    expect(observation.meta).toEqual(meta)
    expect(report.meta).toEqual(meta)
  })
  describe('toCondition', () => {
    it('should map FHIR Condition to domain entity', () => {
      const fhirCondition = {
        id: 'condition-123',
        code: {
          coding: [{ system: 'http://snomed.info/sct', code: '73211009', display: 'Diabetes mellitus' }],
          text: 'Diabetes'
        },
        clinicalStatus: {
          coding: [{ code: 'active' }]
        },
        verificationStatus: {
          coding: [{ code: 'confirmed' }]
        },
        recordedDate: '2024-01-15'
      }

      const result = FhirMapper.toCondition(fhirCondition)

      expect(result.id).toBe('condition-123')
      expect(result.code).toEqual(fhirCondition.code)
      expect(result.clinicalStatus).toBe('active')
      expect(result.verificationStatus).toBe('confirmed')
      expect(result.recordedDate).toBe('2024-01-15')
    })

    it('should handle missing id with empty string', () => {
      const fhirCondition = {
        code: { text: 'Hypertension' }
      }

      const result = FhirMapper.toCondition(fhirCondition)

      expect(result.id).toBe('')
    })

    it('should handle dateRecorded fallback', () => {
      const fhirCondition = {
        id: 'cond-456',
        code: { text: 'Asthma' },
        dateRecorded: '2023-06-20'
      }

      const result = FhirMapper.toCondition(fhirCondition)

      expect(result.recordedDate).toBe('2023-06-20')
    })

    it('should handle missing status fields', () => {
      const fhirCondition = {
        id: 'cond-789',
        code: { text: 'Condition' }
      }

      const result = FhirMapper.toCondition(fhirCondition)

      expect(result.clinicalStatus).toBeUndefined()
      expect(result.verificationStatus).toBeUndefined()
    })
  })

  describe('toMedication', () => {
    it('should map FHIR MedicationRequest to domain entity', () => {
      const fhirMedication = {
        id: 'med-123',
        medicationCodeableConcept: {
          coding: [{ code: '123456', display: 'Aspirin' }],
          text: 'Aspirin 100mg'
        },
        status: 'active',
        intent: 'order',
        authoredOn: '2024-01-10',
        dosageInstruction: [
          {
            text: 'Take 1 tablet daily',
            timing: { repeat: { frequency: 1, period: 1, periodUnit: 'd' } }
          }
        ]
      }

      const result = FhirMapper.toMedication(fhirMedication)

      expect(result.id).toBe('med-123')
      expect(result.medicationCodeableConcept).toEqual(fhirMedication.medicationCodeableConcept)
      expect(result.status).toBe('active')
      expect(result.intent).toBe('order')
      expect(result.authoredOn).toBe('2024-01-10')
      expect(result.dosageInstruction).toHaveLength(1)
    })

    it('should handle missing optional fields', () => {
      const fhirMedication = {
        id: 'med-minimal'
      }

      const result = FhirMapper.toMedication(fhirMedication)

      expect(result.id).toBe('med-minimal')
      expect(result.medicationCodeableConcept).toBeUndefined()
      expect(result.status).toBeUndefined()
    })

    it('preserves source metadata and remaining-supply context', () => {
      const fhirMedication = {
        resourceType: 'MedicationRequest',
        id: 'remaining-1',
        meta: {
          tag: [{
            system: 'https://nhi-fhir-bridge.github.io/CodeSystem/source-module',
            code: 'imue0120',
          }],
        },
        extension: [{
          url: 'https://nhi-fhir-bridge.github.io/StructureDefinition/medcloud-prescription-remaining-days',
          valueQuantity: { value: 12, code: 'd' },
        }],
        note: [{ text: '門診藥品餘藥日數：12 天' }],
        reportedBoolean: true,
      }

      const result = FhirMapper.toMedication(fhirMedication)

      expect(result.meta).toEqual(fhirMedication.meta)
      expect(result.extension).toEqual(fhirMedication.extension)
      expect(result.note).toEqual(fhirMedication.note)
      expect(result.reportedBoolean).toBe(true)
    })

    it('maps MedicationStatement fields and preserves its source type', () => {
      const statement = {
        resourceType: 'MedicationStatement',
        id: 'statement-1',
        status: 'active',
        medicationReference: { reference: 'Medication/aspirin', display: 'Aspirin' },
        effectivePeriod: { start: '2024-02-01' },
        context: { reference: 'Encounter/1' },
        dosage: [{ text: 'Take daily' }],
      }

      const result = FhirMapper.toMedication(statement)

      expect(result.medicationReference).toEqual(statement.medicationReference)
      expect(result.authoredOn).toBe('2024-02-01')
      expect(result.encounter).toEqual(statement.context)
      expect(result.dosageInstruction).toEqual(statement.dosage)
      expect(result._sourceResourceType).toBe('MedicationStatement')
    })
  })

  describe('toMedicationRemainingSummary', () => {
    it('maps the canonical IMUE0120 Basic complex extension', () => {
      const basic = {
        resourceType: 'Basic',
        id: 'summary-1',
        identifier: [{
          system: 'https://cloud-wildcatch.invalid/fhir/IdentifierSystem/medcloud-drug-group',
          value: 'group-thyroxine',
        }],
        code: {
          coding: [{
            system: 'https://cloud-wildcatch.invalid/fhir/CodeSystem/medcloud-basic-resource-type',
            code: 'medication-remaining-summary',
          }],
          text: 'THYROXINE，一般錠劑膠囊劑',
        },
        extension: [{
          url: 'https://cloud-wildcatch.invalid/fhir/StructureDefinition/medcloud-medication-remaining-summary',
          extension: [
            { url: 'adherenceExpectedRemainingDays', valueQuantity: { value: 0, code: 'd' } },
            { url: 'sameIngredientDosageFormEndDate', valueDate: '2026-09-10' },
            { url: 'medicationGroupName', valueString: 'THYROXINE，一般錠劑膠囊劑' },
            { url: 'atc5Name', valueString: 'THYROXINE' },
            { url: 'calculatedAt', valueInstant: '2026-08-28T10:00:00+08:00' },
            { url: 'relatedMedicationRequest', valueReference: { reference: 'MedicationRequest/med-1' } },
            { url: 'relatedMedicationRequest', valueReference: { reference: 'MedicationRequest/med-1' } },
            { url: 'anchorMedicationRequest', valueReference: { reference: 'MedicationRequest/med-1' } },
            { url: 'sourceModule', valueCode: 'imue0120' },
            { url: 'futureField', valueString: 'ignored' },
          ],
        }],
      }

      const result = FhirMapper.toMedicationRemainingSummary(basic)

      expect(result).toEqual(expect.objectContaining({
        id: 'summary-1',
        groupIdentifier: 'group-thyroxine',
        groupName: 'THYROXINE，一般錠劑膠囊劑',
        atc5Name: 'THYROXINE',
        adherenceExpectedRemainingDays: 0,
        sameIngredientDosageFormEndDate: '2026-09-10',
        calculatedAt: '2026-08-28T10:00:00+08:00',
        relatedMedicationRequestReferences: ['MedicationRequest/med-1'],
        anchorMedicationRequestReference: 'MedicationRequest/med-1',
        sourceModule: 'imue0120',
      }))
    })

    it('keeps a summary when optional fields and references are absent', () => {
      const result = FhirMapper.toMedicationRemainingSummary({
        resourceType: 'Basic',
        id: 'summary-minimal',
        code: { text: 'Minimal group' },
      }, '2026-08-28T02:00:00Z')

      expect(result.id).toBe('summary-minimal')
      expect(result.groupName).toBe('Minimal group')
      expect(result.calculatedAt).toBe('2026-08-28T02:00:00Z')
      expect(result.relatedMedicationRequestReferences).toEqual([])
    })
  })

  describe('toAllergy', () => {
    it('should map FHIR AllergyIntolerance to domain entity', () => {
      const fhirAllergy = {
        id: 'allergy-123',
        type: 'allergy',
        category: ['medication'],
        code: {
          coding: [{ code: '227493005', display: 'Cashew nut' }],
          text: 'Cashew nuts'
        },
        clinicalStatus: {
          coding: [{ code: 'active' }]
        },
        verificationStatus: {
          coding: [{ code: 'confirmed' }]
        },
        criticality: 'high',
        reaction: [
          {
            manifestation: [{ text: 'Anaphylaxis' }],
            severity: 'severe'
          }
        ],
        recordedDate: '2023-05-15'
      }

      const result = FhirMapper.toAllergy(fhirAllergy)

      expect(result.id).toBe('allergy-123')
      expect(result.code).toEqual(fhirAllergy.code)
      expect(result.type).toBe('allergy')
      expect(result.category).toEqual(['medication'])
      expect(result.clinicalStatus).toBe('active')
      expect(result.verificationStatus).toBe('confirmed')
      expect(result.criticality).toBe('high')
      expect(result.reaction).toHaveLength(1)
      expect(result.recordedDate).toBe('2023-05-15')
    })

    it('preserves allergy context and reaction details used by the viewer', () => {
      const fhirAllergy = {
        id: 'allergy-context',
        encounter: { reference: 'Encounter/1' },
        onsetDateTime: '2022-01-01',
        recorder: { reference: 'Practitioner/1' },
        asserter: { reference: 'Patient/1' },
        lastOccurrence: '2024-01-01',
        note: [{ text: 'Patient confirmed' }],
        reaction: [{
          manifestation: [{ text: 'Rash' }],
          description: 'Diffuse rash',
          onset: '2024-01-01',
        }],
      }

      const result = FhirMapper.toAllergy(fhirAllergy)

      expect(result.encounter).toEqual(fhirAllergy.encounter)
      expect(result.onsetDateTime).toBe('2022-01-01')
      expect(result.recorder).toEqual(fhirAllergy.recorder)
      expect(result.asserter).toEqual(fhirAllergy.asserter)
      expect(result.lastOccurrence).toBe('2024-01-01')
      expect(result.note).toEqual(fhirAllergy.note)
      expect(result.reaction?.[0].description).toBe('Diffuse rash')
    })

    it('should handle recorded fallback', () => {
      const fhirAllergy = {
        id: 'allergy-456',
        code: { text: 'Peanuts' },
        recorded: '2022-03-10'
      }

      const result = FhirMapper.toAllergy(fhirAllergy)

      expect(result.recordedDate).toBe('2022-03-10')
    })
  })

  describe('toObservation', () => {
    it('preserves effectivePeriod and issued date fallbacks used by AI tools', () => {
      const result = FhirMapper.toObservation({
        resourceType: 'Observation',
        id: 'obs-period',
        status: 'final',
        code: { text: 'Period-dated observation' },
        effectivePeriod: {
          start: '2025-01-01T08:00:00+08:00',
          end: '2025-01-01T09:00:00+08:00',
        },
        issued: '2025-01-02T08:00:00+08:00',
      })

      expect(result.effectivePeriod?.start).toBe('2025-01-01T08:00:00+08:00')
      expect(result.issued).toBe('2025-01-02T08:00:00+08:00')
    })

    it('preserves SDK unit-inference provenance tags and notes', () => {
      const fhirObservation = {
        id: 'sdk-inferred-unit',
        meta: {
          tag: [{
            system: 'https://nhi-fhir-bridge.github.io/CodeSystem/sdk-unit-origin',
            code: 'bridge-inferred',
          }],
        },
        code: { text: 'Glucose' },
        valueQuantity: { value: 98, unit: 'mg/dL' },
        note: [{ text: 'Unit inferred under sdk-unit-policy-v1.' }],
      }

      const result = FhirMapper.toObservation(fhirObservation)

      expect(result.meta).toEqual(fhirObservation.meta)
      expect(result.note).toEqual(fhirObservation.note)
    })

    it('should map FHIR Observation with valueQuantity', () => {
      const fhirObservation = {
        id: 'obs-123',
        code: {
          coding: [{ code: '8867-4', display: 'Heart rate' }],
          text: 'Heart rate'
        },
        valueQuantity: {
          value: 72,
          unit: 'beats/minute',
          system: 'http://unitsofmeasure.org',
          code: '/min'
        },
        effectiveDateTime: '2024-01-15T10:30:00Z',
        status: 'final',
        category: [
          {
            coding: [{ code: 'vital-signs' }]
          }
        ]
      }

      const result = FhirMapper.toObservation(fhirObservation)

      expect(result.id).toBe('obs-123')
      expect(result.code).toEqual(fhirObservation.code)
      expect(result.valueQuantity).toEqual(fhirObservation.valueQuantity)
      expect(result.effectiveDateTime).toBe('2024-01-15T10:30:00Z')
      expect(result.status).toBe('final')
      expect(result.category).toHaveLength(1)
    })

    it('should map FHIR Observation with valueString', () => {
      const fhirObservation = {
        id: 'obs-456',
        code: { text: 'Blood type' },
        valueString: 'A+',
        effectiveDateTime: '2024-01-10',
        status: 'final'
      }

      const result = FhirMapper.toObservation(fhirObservation)

      expect(result.valueString).toBe('A+')
      expect(result.valueQuantity).toBeUndefined()
    })

    it('preserves a top-level valueRange without collapsing it to one number', () => {
      const valueRange = {
        low: {
          value: 0,
          unit: '/HPF',
          system: 'http://unitsofmeasure.org',
          code: '/[HPF]',
        },
        high: {
          value: 5,
          unit: '/HPF',
          system: 'http://unitsofmeasure.org',
          code: '/[HPF]',
        },
      }

      const result = FhirMapper.toObservation({
        resourceType: 'Observation',
        id: 'urine-wbc-range',
        status: 'final',
        code: { coding: [{ system: 'http://loinc.org', code: '5821-4' }] },
        valueRange,
      })

      expect(result.valueRange).toEqual(valueRange)
      expect(result.valueQuantity).toBeUndefined()
    })

    it('preserves component valueRange content', () => {
      const valueRange = {
        low: { value: 30, unit: '/HPF', system: 'http://unitsofmeasure.org', code: '/[HPF]' },
        high: { value: 49, unit: '/HPF', system: 'http://unitsofmeasure.org', code: '/[HPF]' },
      }
      const result = FhirMapper.toObservation({
        resourceType: 'Observation',
        id: 'urine-panel',
        status: 'final',
        code: { text: 'Urinalysis' },
        component: [{
          code: { coding: [{ system: 'http://loinc.org', code: '5808-1' }] },
          valueRange,
        }],
      })

      expect(result.component?.[0].valueRange).toEqual(valueRange)
    })

    it('should map FHIR Observation with components', () => {
      const fhirObservation = {
        id: 'obs-bp',
        code: { text: 'Blood Pressure' },
        component: [
          {
            code: { text: 'Systolic' },
            valueQuantity: { value: 120, unit: 'mmHg' }
          },
          {
            code: { text: 'Diastolic' },
            valueQuantity: { value: 80, unit: 'mmHg' }
          }
        ],
        effectiveDateTime: '2024-01-15',
        status: 'final'
      }

      const result = FhirMapper.toObservation(fhirObservation)

      expect(result.component).toBeDefined()
      expect(result.component).toHaveLength(2)
      if (result.component) {
        expect(result.component[0].code?.text).toBe('Systolic')
        expect(result.component[1].code?.text).toBe('Diastolic')
      }
    })
  })

  describe('toComposition', () => {
    it('preserves the top-level narrative and ordered sections from Bridge', () => {
      const fhirComposition = {
        id: 'preventive-1',
        type: { coding: [{ system: 'http://loinc.org', code: '75484-6' }] },
        text: { status: 'generated', div: '<div>文件總覽</div>' },
        section: [
          { title: '一般檢查', text: { div: '<div>一般檢查內容</div>' } },
          { title: '血壓', text: { div: '<div>血壓內容</div>' } },
        ],
      }

      const result = FhirMapper.toComposition(fhirComposition)

      expect(result.text).toEqual(fhirComposition.text)
      expect(result.section).toEqual(fhirComposition.section)
      expect(result.section?.map((section) => section.title)).toEqual(['一般檢查', '血壓'])
    })
  })

  describe('toDiagnosticReport', () => {
    it('preserves effectivePeriod for report date filtering', () => {
      const result = FhirMapper.toDiagnosticReport({
        resourceType: 'DiagnosticReport',
        id: 'dr-period',
        status: 'final',
        code: { text: 'Period-dated report' },
        effectivePeriod: {
          start: '2025-03-01T08:00:00+08:00',
          end: '2025-03-01T09:00:00+08:00',
        },
      }, [])

      expect(result.effectivePeriod?.start).toBe('2025-03-01T08:00:00+08:00')
    })

    it('preserves subject and explicit-vs-inferred encounter provenance', () => {
      const result = FhirMapper.toDiagnosticReport({
        resourceType: 'DiagnosticReport',
        id: 'dr-provenance',
        status: 'final',
        subject: { reference: 'Patient/example' },
        encounter: { reference: 'Encounter/visit-1' },
        _encounterInferred: true,
      }, [])

      expect(result.subject).toEqual({ reference: 'Patient/example' })
      expect(result.encounter).toEqual({ reference: 'Encounter/visit-1' })
      expect(result._encounterInferred).toBe(true)
    })

    it('should map FHIR DiagnosticReport without observations', () => {
      const fhirReport = {
        id: 'report-123',
        meta: {
          tag: [{
            system: 'https://nhi-fhir-bridge.github.io/CodeSystem/health-bank-sdk-section',
            code: 'r8',
          }],
        },
        code: {
          coding: [{ code: 'LAB', display: 'Laboratory' }],
          text: 'Lab Report'
        },
        status: 'final',
        effectiveDateTime: '2024-01-15',
        issued: '2024-01-15T14:30:00Z',
        conclusion: 'All values within normal range',
        category: [{ coding: [{ code: 'LAB' }] }]
      }

      const result = FhirMapper.toDiagnosticReport(fhirReport, [])

      expect(result.id).toBe('report-123')
      expect(result.meta).toEqual(fhirReport.meta)
      expect(result.code).toEqual(fhirReport.code)
      expect(result.status).toBe('final')
      expect(result.conclusion).toBe('All values within normal range')
      expect(result._observations).toBeUndefined()
    })

    it('should map DiagnosticReport with linked observations', () => {
      const observations = [
        {
          id: 'obs-1',
          code: { text: 'Glucose' },
          valueQuantity: { value: 95, unit: 'mg/dL' },
          status: 'final'
        },
        {
          id: 'obs-2',
          code: { text: 'Cholesterol' },
          valueQuantity: { value: 180, unit: 'mg/dL' },
          status: 'final'
        }
      ]

      const fhirReport = {
        id: 'report-456',
        code: { text: 'Metabolic Panel' },
        status: 'final',
        result: [
          { reference: 'Observation/obs-1' },
          { reference: 'Observation/obs-2' }
        ],
        effectiveDateTime: '2024-01-15'
      }

      const result = FhirMapper.toDiagnosticReport(fhirReport, observations)

      expect(result._observations).toHaveLength(2)
      expect(result._observations?.[0].id).toBe('obs-1')
      expect(result._observations?.[1].id).toBe('obs-2')
    })

    it('should expand observations with hasMember', () => {
      const observations = [
        {
          id: 'obs-panel',
          code: { text: 'Blood Pressure Panel' },
          status: 'final',
          hasMember: [
            { reference: 'Observation/obs-systolic' },
            { reference: 'Observation/obs-diastolic' }
          ]
        },
        {
          id: 'obs-systolic',
          code: { text: 'Systolic BP' },
          valueQuantity: { value: 120, unit: 'mmHg' },
          status: 'final'
        },
        {
          id: 'obs-diastolic',
          code: { text: 'Diastolic BP' },
          valueQuantity: { value: 80, unit: 'mmHg' },
          status: 'final'
        }
      ]

      const fhirReport = {
        id: 'report-bp',
        code: { text: 'BP Report' },
        status: 'final',
        result: [{ reference: 'Observation/obs-panel' }],
        effectiveDateTime: '2024-01-15'
      }

      const result = FhirMapper.toDiagnosticReport(fhirReport, observations)

      expect(result._observations).toHaveLength(3)
      expect(result._observations?.[0].id).toBe('obs-panel')
      expect(result._observations?.[1].id).toBe('obs-systolic')
      expect(result._observations?.[2].id).toBe('obs-diastolic')
    })

    it('should handle missing result references', () => {
      const fhirReport = {
        id: 'report-no-results',
        code: { text: 'Empty Report' },
        status: 'final',
        effectiveDateTime: '2024-01-15'
      }

      const result = FhirMapper.toDiagnosticReport(fhirReport, [])

      expect(result._observations).toBeUndefined()
    })

    it('preserves ImagingStudy references and identifiers', () => {
      const result = FhirMapper.toDiagnosticReport({
        id: 'dr-imaging',
        identifier: [{ system: 'urn:accession', value: 'ACC-123' }],
        status: 'final',
        code: { text: 'Chest CT' },
        imagingStudy: [{ reference: 'ImagingStudy/study-1' }],
      }, [])

      expect(result.identifier?.[0].value).toBe('ACC-123')
      expect(result.imagingStudy).toEqual([{ reference: 'ImagingStudy/study-1' }])
    })

    it('preserves the live NHI Viewer request extension without resolving a URL', () => {
      const extension = [{
        url: 'https://cloud-wildcatch.invalid/fhir/StructureDefinition/medcloud-nhi-viewer-request',
        extension: [
          { url: 'version', valueInteger: 1 },
          { url: 'proc-id', valueCode: 'IMUE0130' },
          { url: 'patient-context-hash', valueString: 'a'.repeat(64) },
          { url: 'ipl-case-seq-no', valueString: 'CASE-123' },
        ],
      }]
      const result = FhirMapper.toDiagnosticReport({
        resourceType: 'DiagnosticReport',
        id: 'dr-live-viewer',
        status: 'final',
        code: { text: 'Chest CT' },
        extension,
      }, [])

      expect(result.extension).toEqual(extension)
      expect(JSON.stringify(result)).not.toContain('nhi.gov.tw')
    })
  })

  describe('toImagingStudy', () => {
    it('preserves study, series, instance, and human-readable metadata', () => {
      const result = FhirMapper.toImagingStudy({
        id: 'study-1',
        identifier: [{ system: 'urn:accession', value: 'ACC-123' }],
        status: 'available',
        started: '2026-06-01T09:30:00+08:00',
        description: 'CT chest without contrast',
        modality: [{ system: 'http://dicom.nema.org/resources/ontology/DCM', code: 'CT', display: 'Computed Tomography' }],
        location: { reference: 'Location/rad', display: 'Radiology Department' },
        reasonCode: [{ text: 'Persistent cough' }],
        note: [{ text: 'Metadata only; no DICOM retrieval required.' }],
        numberOfSeries: 1,
        numberOfInstances: 2,
        series: [{
          uid: '1.2.3',
          number: 1,
          description: 'Axial lung series',
          modality: { code: 'CT', display: 'Computed Tomography' },
          bodySite: { code: 'CHEST', display: 'Chest' },
          instance: [
            { uid: '1.2.3.1', title: 'Scout view' },
            { uid: '1.2.3.2', title: 'Axial image' },
          ],
        }],
      })

      expect(result.id).toBe('study-1')
      expect(result.description).toBe('CT chest without contrast')
      expect(result.location?.display).toBe('Radiology Department')
      expect(result.reasonCode?.[0].text).toBe('Persistent cough')
      expect(result.series?.[0].description).toBe('Axial lung series')
      expect(result.series?.[0].instance?.map((instance) => instance.title)).toEqual([
        'Scout view',
        'Axial image',
      ])
    })
  })

  describe('toProcedure', () => {
    it('should map FHIR Procedure with performedDateTime', () => {
      const fhirProcedure = {
        id: 'proc-123',
        category: {
          coding: [{
            system: 'https://nhi-fhir-bridge.github.io/CodeSystem/procedure-classification',
            code: 'surgical-procedure',
            display: 'Surgical procedure',
          }],
          text: '手術',
        },
        code: {
          coding: [{ code: '80146002', display: 'Appendectomy' }],
          text: 'Appendectomy'
        },
        status: 'completed',
        performedDateTime: '2024-01-10T09:00:00Z'
      }

      const result = FhirMapper.toProcedure(fhirProcedure)

      expect(result.id).toBe('proc-123')
      expect(result.category).toEqual(fhirProcedure.category)
      expect(result.code).toEqual(fhirProcedure.code)
      expect(result.status).toBe('completed')
      expect(result.performedDateTime).toBe('2024-01-10T09:00:00Z')
      expect(result.performedPeriod).toBeUndefined()
    })

    it('should map FHIR Procedure with performedPeriod', () => {
      const fhirProcedure = {
        id: 'proc-456',
        code: { text: 'Surgery' },
        status: 'in-progress',
        performedPeriod: {
          start: '2024-01-15T08:00:00Z',
          end: '2024-01-15T12:00:00Z'
        }
      }

      const result = FhirMapper.toProcedure(fhirProcedure)

      expect(result.performedPeriod).toEqual(fhirProcedure.performedPeriod)
      expect(result.performedDateTime).toBeUndefined()
    })
  })

  describe('toEncounter', () => {
    it('should map FHIR Encounter', () => {
      const fhirEncounter = {
        id: 'enc-123',
        status: 'finished',
        class: {
          system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
          code: 'IMP',
          display: 'inpatient encounter'
        },
        type: [
          {
            coding: [{ code: 'emergency', display: 'Emergency' }]
          }
        ],
        period: {
          start: '2024-01-10T08:00:00Z',
          end: '2024-01-12T16:00:00Z'
        },
        reasonCode: [
          {
            coding: [{ code: '386661006', display: 'Fever' }]
          }
        ]
      }

      const result = FhirMapper.toEncounter(fhirEncounter)

      expect(result.id).toBe('enc-123')
      expect(result.status).toBe('finished')
      expect(result.class).toEqual(fhirEncounter.class)
      expect(result.type).toHaveLength(1)
      expect(result.period).toEqual(fhirEncounter.period)
      expect(result.reasonCode).toHaveLength(1)
    })

    it('should handle minimal Encounter', () => {
      const fhirEncounter = {
        id: 'enc-minimal',
        status: 'planned'
      }

      const result = FhirMapper.toEncounter(fhirEncounter)

      expect(result.id).toBe('enc-minimal')
      expect(result.status).toBe('planned')
      expect(result.class).toBeUndefined()
      expect(result.type).toBeUndefined()
    })
  })
})

describe('report observation reference scope', () => {
  it('does not resolve cross-base absolute references by their final id', () => {
    const report = FhirMapper.toDiagnosticReport({ resourceType: 'DiagnosticReport', id: 'report', result: [{ reference: 'https://other.example/fhir/Observation/collision' }] } as any, [{ id: 'collision' }] as any)
    expect(report._observations).toEqual([])
  })

  it('does not choose an arbitrary observation when a logical id is ambiguous', () => {
    const report = FhirMapper.toDiagnosticReport({ resourceType: 'DiagnosticReport', id: 'report', result: [{ reference: 'Observation/collision' }] } as any, [{ id: 'collision', valueString: 'a' }, { id: 'collision', valueString: 'b' }] as any)
    expect(report._observations).toEqual([])
  })
})
