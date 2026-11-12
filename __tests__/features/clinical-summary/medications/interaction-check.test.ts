import {
  interactionCheckBody,
  interpretInteractionCheck,
  planInteractionCheck,
} from '@/features/clinical-summary/medications/utils/interaction-check'
import type { MedicationRow } from '@/features/clinical-summary/medications/types'

function row(id: string, patch: Partial<MedicationRow>): MedicationRow {
  return { id, title: id, status: 'active', isInactive: false, isChronic: false, refillCount: 1, searchHaystack: '', ...patch }
}
const cloud = (id: string, ingredientText: string, patch: Partial<MedicationRow> = {}) =>
  row(id, { dataOrigin: 'medcloud', drugTerminology: { source: 'nhi-official-drug-master', snapshotId: 's', ingredientText }, ...patch })
const hospital = (id: string, ingredientName: string, patch: Partial<MedicationRow> = {}) =>
  row(id, { dataOrigin: 'hospital', hospitalMedicationName: { status: 'normalized', ingredientName, version: 'v', reviewedAt: 'd' }, ...patch })

// Response shapes below are trimmed from the service's real answers to
// synthetic drug lists (2026-11-13).
const resolved = (inputIndex: number, udCode: string, genericName: string, englishName = '') =>
  ({ inputIndex, udCode, genericName, englishName })
const alert = (a: string, b: string, severity: string, nursingAction: string, type = 'DRUG_INTERACTION') => ({
  alertId: `db50::${a}::${b}`, type, severity, drugA: { udCode: a }, drugB: { udCode: b },
  mechanism: '機轉', nursingAction, source: '北榮藥劑部交互作用資料庫',
})

describe('planInteractionCheck', () => {
  it('sends ingredient names without strength, one entry per ingredient', () => {
    const plan = planInteractionCheck([
      cloud('c1', 'TRAMADOL HCL 37.5 MG+ACETAMINOPHEN (=PARACETAMOL) 325 MG'),
      cloud('c2', 'TAURINE 5 MG/ML'),
      hospital('h1', 'Netupitant / Palonosetron'),
    ])
    expect(plan.items.map(item => item.query)).toEqual(['TRAMADOL HCL', 'ACETAMINOPHEN', 'TAURINE', 'Netupitant', 'Palonosetron'])
    expect(interactionCheckBody(plan).medications[0]).toEqual({ drugName: 'TRAMADOL HCL' })
  })

  it('sends one entry for the same ingredient on two rows and skips ended rows', () => {
    const plan = planInteractionCheck([
      cloud('c1', 'WARFARIN SODIUM 1 MG'),
      cloud('c2', 'Warfarin sodium 5 MG'),
      cloud('c3', 'AMIODARONE HCL 200 MG', { isInactive: true }),
    ])
    expect(plan.items).toEqual([{ query: 'WARFARIN SODIUM', rowIds: ['c1', 'c2'] }])
  })

  it('lists a current row with no ingredient name as unnamed', () => {
    const plan = planInteractionCheck([
      row('x', { dataOrigin: 'hospital', hospitalMedicationName: { status: 'unresolved', version: 'v', reviewedAt: 'd' } }),
    ])
    expect(plan).toEqual({ items: [], unnamedRowIds: ['x'] })
  })
})

describe('interpretInteractionCheck', () => {
  const rows = [
    hospital('h-isdn', 'Isosorbide dinitrate', { encounterReference: 'Encounter/1' }),
    cloud('c-sild', 'SILDENAFIL CITRATE 100 MG', { encounterReference: 'Encounter/9' }),
  ]
  const plan = planInteractionCheck(rows)

  it('raises a pair to "avoid" when the action says so, whatever the grade', () => {
    const review = interpretInteractionCheck(plan, rows, {
      resolvedMedications: [
        resolved(0, '01669', 'isosorbide dinitrate', 'Isordil tab 10 mg'),
        resolved(1, '02602', 'Sildenafil citrate (sildenafil)', 'VIAGRA FC * TAB 100 MG'),
      ],
      alerts: [alert('02602', '01669', 'low', '絕對不可併用。')],
    })
    expect(review.findings).toEqual([expect.objectContaining({
      tier: 'avoid', rowIdsA: ['c-sild'], rowIdsB: ['h-isdn'], action: '絕對不可併用。', samePrescription: false,
    })])
    expect(review.checkedRowIds.sort()).toEqual(['c-sild', 'h-isdn'])
    expect(review.uncheckedRowIds).toEqual([])
  })

  it('reports a drug the service could not place as unchecked', () => {
    const review = interpretInteractionCheck(plan, rows, {
      resolvedMedications: [
        resolved(0, '01669', 'isosorbide dinitrate'),
        { inputIndex: 1, udCode: 'RAW-1', matchedBy: 'rawName', genericName: 'SILDENAFIL CITRATE' },
      ],
      alerts: [],
    })
    expect(review.findings).toEqual([])
    expect(review.uncheckedRowIds).toEqual(['c-sild'])
    expect(review.checkedRowIds).toEqual(['h-isdn'])
  })

  it('rejects a fuzzy match to a different drug and drops its alerts', () => {
    // The service answered "tramadol and paracetamol" with Augmentin syrup.
    const review = interpretInteractionCheck(plan, rows, {
      resolvedMedications: [
        resolved(0, '01669', 'isosorbide dinitrate'),
        resolved(1, '03101', 'amoxicillin and enzyme inhibitor (Amoxycilin/Clav.)', 'Augmentin *syrup 457 mg/5ml 35ml'),
      ],
      alerts: [alert('03101', '01669', 'high', '監測')],
    })
    expect(review.findings).toEqual([])
    expect(review.uncheckedRowIds).toEqual(['c-sild'])
  })

  it('does not accept a different salt that shares only the anion', () => {
    const salts = [cloud('nacl', 'SODIUM CHLORIDE 9 MG/ML')]
    const review = interpretInteractionCheck(planInteractionCheck(salts), salts, {
      resolvedMedications: [resolved(0, '01725', 'potassium chloride (Pot. chloride-SR)', 'Slow-K tab 600 mg')],
    })
    expect(review.uncheckedRowIds).toEqual(['nacl'])
  })

  it('treats everything as unchecked when the response is unusable', () => {
    expect(interpretInteractionCheck(plan, rows, null).uncheckedRowIds.sort()).toEqual(['c-sild', 'h-isdn'])
  })

  it('grades, orders and marks same-visit pairs; ignores non-interaction alerts', () => {
    const list = [
      hospital('spiro', 'Spironolactone', { encounterReference: 'Encounter/1' }),
      hospital('enal', 'Enalapril maleate', { encounterReference: 'Encounter/1' }),
      cloud('warf', 'WARFARIN SODIUM 1 MG', { encounterReference: 'Encounter/7' }),
      hospital('amio', 'Amiodarone', { encounterReference: 'Encounter/1' }),
      cloud('para', 'ACETAMINOPHEN 500 MG'),
    ]
    const review = interpretInteractionCheck(planInteractionCheck(list), list, {
      resolvedMedications: [
        resolved(0, '00050', 'Spironolactone'),
        resolved(1, '01675', 'Enalapril maleate (enalapril)'),
        resolved(2, '03951', 'Warfarin'),
        resolved(3, '01363', 'Amiodarone HCl (amiodarone)'),
        resolved(4, '01833', 'Acetaminophen (paracetamol)'),
      ],
      alerts: [
        alert('01833', '03951', 'low', '觀察'),
        alert('00050', '01675', 'moderate', '監測血鉀'),
        alert('03951', '01363', 'high', '監測 INR'),
        alert('03951', '01363', 'high', '監測 INR'),
        alert('00050', '01675', 'high', '分開管路', 'IV_INCOMPATIBILITY'),
      ],
    })
    expect(review.findings.map(f => [f.tier, f.samePrescription, f.rowIdsA[0], f.rowIdsB[0]])).toEqual([
      ['act', false, 'warf', 'amio'],
      ['act', true, 'spiro', 'enal'],
      ['note', false, 'para', 'warf'],
    ])
  })

  it('does not report the two ingredients of one combination product', () => {
    const combo = [cloud('combo', 'TRAMADOL HCL 37.5 MG+ACETAMINOPHEN 325 MG')]
    const review = interpretInteractionCheck(planInteractionCheck(combo), combo, {
      resolvedMedications: [resolved(0, '01970', 'Tramadol HCl (tramadol)'), resolved(1, '01833', 'Acetaminophen (paracetamol)')],
      alerts: [alert('01970', '01833', 'moderate', '監測')],
    })
    expect(review.findings).toEqual([])
    expect(review.checkedRowIds).toEqual(['combo'])
  })
})
