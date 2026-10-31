// LOINCs the VGH hospital bridge emits since vghtpe-fhir-bridge v0.14.21
// (each verified 2026-10-29 against the NLM Clinical Table Search Service)
// reach their category by code, whatever the bridge put in code.text.
import { categorizeObservationWithReason } from '@/src/shared/utils/lab-categories'

const obs = (code: string, text: string, unit = 'mmol/L') => ({
  resourceType: 'Observation',
  status: 'final',
  category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
  code: { text, coding: [{ system: 'http://loinc.org', code }] },
  valueQuantity: { value: 1, unit },
  effectiveDateTime: '2026-10-09T09:40:00+08:00',
})

describe('VGH bridge LOINC categories', () => {
  it.each([
    ['98979-8', 'eGFR(EPI)', 'chem'],
    ['2027-1', 'TCO2 (venous)', 'chem'],
    ['1994-3', 'Ca++, free', 'chem'],
    ['53061-8', 'Ketone body', 'glucose'],
    ['10835-7', 'Lipoprotein a', 'lipid'],
    ['19232-8', 'Standard bicarbonate (venous)', 'bloodgas'],
    ['19230-2', 'cHCO3st', 'bloodgas'],
  ])('%s (%s) → %s', (code, text, category) => {
    expect(categorizeObservationWithReason(obs(code, text)).category?.id).toBe(category)
  })

  it('keeps the urine dipstick ketone in urine', () => {
    expect(categorizeObservationWithReason(obs('5797-6', 'Ketone', '')).category?.id).toBe('urine')
  })
})
