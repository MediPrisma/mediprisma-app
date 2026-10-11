// The four serum-or-urine analytes (total protein, albumin, calcium,
// creatinine) are recognised by EXACT name, after only specimen decorations
// are stripped — never by prefix. Look-alikes (Protein C, ionized calcium,
// creatinine clearance, prealbumin …) never take a TP / ALB / CA / CREA
// identity and never move with unit or inspect mode.
import { categorizeObservation } from '@/src/shared/utils/lab-categories'
import { getLabPivotTestIdentity } from '@/src/shared/utils/lab-pivot.utils'
import { dualSpecimenAnalyte } from '@/src/shared/utils/specimen-evidence'
import { LOOK_ALIKES } from '../../helpers/lab-lookalikes'

const NHI = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medical-service-payment-tw'
const INSPECT = 'https://cloud-wildcatch.invalid/fhir/StructureDefinition/medcloud-source-inspect-mode'

function row(item: string, nhi: string | undefined, unit: string, mode?: string) {
  return {
    resourceType: 'Observation', status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
    code: { text: item, coding: nhi ? [{ system: NHI, code: nhi }] : [] },
    valueQuantity: { value: 5, ...(unit ? { unit } : {}) },
    ...(mode ? { extension: [{ url: INSPECT, valueString: mode }] } : {}),
    effectiveDateTime: '2026-01-01T08:00:00+08:00',
  }
}

const DUAL_KEYS = new Set(['TP', 'ALB', 'CA', 'CREA'])

describe('look-alikes never take a serum-or-urine analyte identity', () => {
  it.each(LOOK_ALIKES)('%s', (item) => {
    const variants = [undefined, '09040C', '09038C', '09011C', '09015C'].flatMap((nhi) =>
      ['g/dL', 'mg/g', ''].flatMap((unit) => ['URINE(SPOT)', 'SERUM_YL', undefined].map((mode) => row(item, nhi, unit, mode))))
    for (const o of variants) expect(dualSpecimenAnalyte(o)).toBeNull()
    // Base behaviour: neither the unit nor the inspect mode moves it.
    for (const nhi of [undefined, '09040C', '09011C']) {
      const placements = new Set(['g/dL', 'mg/g', ''].flatMap((unit) => ['URINE(SPOT)', 'SERUM_YL', undefined].map((mode) => {
        const o = row(item, nhi, unit, mode)
        const category = categorizeObservation(o)?.id
        return `${category}/${category ? getLabPivotTestIdentity(o, category).testKey : ''}`
      })))
      expect({ item, nhi, placements: [...placements] }).toEqual({ item, nhi, placements: [[...placements][0]] })
      for (const placement of placements) {
        const key = placement.split('/')[1]
        if (DUAL_KEYS.has(key)) {
          // Only if the name itself already resolves there without the
          // specimen logic — never through it.
          expect(dualSpecimenAnalyte(row(item, nhi, 'g/dL'))).toBeNull()
        }
      }
    }
  })
})

describe('exact names with specimen decorations still resolve', () => {
  it.each([
    ['TP', 'TP'], ['Total protein', 'TP'], ['Protein', 'TP'], ['PROT', 'TP'], ['Protein, total', 'TP'], ['全蛋白', 'TP'], ['總蛋白', 'TP'],
    ['Serum total protein', 'TP'], ['Urine protein', 'TP'], ['Protein (urine)', 'TP'], ['TP(spot)', 'TP'],
    ['ALB', 'ALB'], ['Albumin', 'ALB'], ['白蛋白', 'ALB'], ['Serum albumin', 'ALB'], ['Albumin (urine)', 'ALB'],
    ['Ca', 'CA'], ['Calcium', 'CA'], ['鈣', 'CA'], ['血清鈣', 'CA'], ['Ca(spot urine)', 'CA'], ['Calcium, total', 'CA'], ['Total calcium', 'CA'],
    ['Creatinine', 'CREA'], ['CREA', 'CREA'], ['Cre', 'CREA'], ['肌酸酐', 'CREA'], ['肌酐', 'CREA'], ['肌酸酐、血', 'CREA'], ['肌酐、尿', 'CREA'],
    ['Creatinine, serum', 'CREA'], ['Urine creatinine', 'CREA'], ['Creatinine (urine)', 'CREA'], ['U-Creatinine', 'CREA'],
  ])('%s → %s', (item, want) => {
    expect(dualSpecimenAnalyte(row(item, undefined, 'g/dL'))).toBe(want)
  })
})
