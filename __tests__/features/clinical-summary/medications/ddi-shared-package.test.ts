import {
  attentionFindings,
  interactionCheckBody,
  interpretInteractionCheck,
  planInteractionCheck,
} from '@mediprisma/vghtpe-ddi-check'
import type { MedicationRow } from '@/features/clinical-summary/medications/types'

// The app's own MedicationRow goes through the shared check package as is.
// A public clone without the package (CI public-deployment) builds against the
// stand-in in src/optional/, where the check is off and nothing reads as checked.
const missingDdi = process.env.TEST_OPTIONAL_DDI === 'missing'

function row(id: string, patch: Partial<MedicationRow>): MedicationRow {
  return { id, title: id, status: 'active', isInactive: false, isChronic: false, refillCount: 1, searchHaystack: '', ...patch }
}
const rows: MedicationRow[] = [
  row('h-isdn', {
    dataOrigin: 'hospital', encounterReference: 'Encounter/1',
    hospitalMedicationName: { status: 'normalized', ingredientName: 'Isosorbide dinitrate', version: 'v', reviewedAt: 'd' },
  }),
  row('c-sild', {
    dataOrigin: 'medcloud', encounterReference: 'Encounter/9',
    drugTerminology: { source: 'nhi-official-drug-master', snapshotId: 's', ingredientText: 'SILDENAFIL CITRATE 100 MG' },
  }),
]
// Trimmed from the service's real answer to a synthetic list (2026-11-13).
const response = {
  resolvedMedications: [
    { inputIndex: 0, udCode: '01669', genericName: 'isosorbide dinitrate', englishName: 'Isordil tab 10 mg' },
    { inputIndex: 1, udCode: '02602', genericName: 'Sildenafil citrate (sildenafil)', englishName: 'VIAGRA FC * TAB 100 MG' },
  ],
  alerts: [{
    alertId: 'db50::02602::01669', type: 'DRUG_INTERACTION', severity: 'low', drugA: { udCode: '02602' }, drugB: { udCode: '01669' },
    mechanism: '機轉', nursingAction: '絕對不可併用。', source: '北榮藥劑部交互作用資料庫',
  }],
}

;(missingDdi ? it.skip : it)('plans, sends and grades MedicationRow through the package', () => {
  const plan = planInteractionCheck(rows)
  expect(interactionCheckBody(plan).medications.map(m => m.drugName)).toEqual(['Isosorbide dinitrate', 'SILDENAFIL CITRATE'])
  const review = interpretInteractionCheck(plan, rows, response)
  expect(review.findings).toEqual([expect.objectContaining({
    tier: 'avoid', severity: 'low', rowIdsA: ['c-sild'], rowIdsB: ['h-isdn'], action: '絕對不可併用。', samePrescription: false,
  })])
  expect(attentionFindings(review)).toHaveLength(1)
  expect([...review.checkedRowIds].sort()).toEqual(['c-sild', 'h-isdn'])
  expect(review.uncheckedRowIds).toEqual([])
})

;(missingDdi ? it : it.skip)('without the package, sends nothing and checks nothing', () => {
  const plan = planInteractionCheck(rows)
  expect(interactionCheckBody(plan).medications).toEqual([])
  const review = interpretInteractionCheck(plan, rows, response)
  expect(review.findings).toEqual([])
  expect(review.checkedRowIds).toEqual([])
  expect(review.uncheckedRowIds).toEqual(['h-isdn', 'c-sild'])
})

;(missingDdi ? it : it.skip)('without the package, the 安全 tab is off even with a service configured', () => {
  process.env.NEXT_PUBLIC_DDI_SERVICE_ORIGIN = 'https://ddi.example.test'
  process.env.NEXT_PUBLIC_DDI_CHECK_AVAILABLE = 'false'
  try {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { MEDICATION_SAFETY_MODULE } = require('@/features/medication-safety/module')
      expect(MEDICATION_SAFETY_MODULE.rightPanel.enabled).toBe(false)
    })
  } finally {
    delete process.env.NEXT_PUBLIC_DDI_SERVICE_ORIGIN
    delete process.env.NEXT_PUBLIC_DDI_CHECK_AVAILABLE
  }
})
