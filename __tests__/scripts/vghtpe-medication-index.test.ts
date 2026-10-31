import fs from 'node:fs'
import path from 'node:path'
import index from '@/src/infrastructure/fhir/data/vghtpe-medication-index.generated.json'
import { buildVghtpeMedicationIndex, INDEX_SCHEMA_VERSION } from '@/scripts/lib/vghtpe-medication-index'
import { hospitalMedicationNameKey, ingredientIdentityKey } from '@/src/shared/utils/hospital-medication-index'

const MASTER_PATH = path.join(process.cwd(), 'vendor/nhi-fhir-bridge-nhi-drug-terminology/data/nhi-drug-terminology-20260728.json')
const SNAPSHOT = 'nhi-drug-terminology-20260728'

describe('ingredientIdentityKey', () => {
  it('ignores salt and hydrate spellings but never the amount', () => {
    expect(ingredientIdentityKey('CLINDAMYCIN HCL 150 MG')).toBe(ingredientIdentityKey('CLINDAMYCIN (HCL HYDRATE) 150 MG'))
    expect(ingredientIdentityKey('PHENYTOIN (SODIUM) 100 MG')).toBe(ingredientIdentityKey('PHENYTOIN 100 MG'))
    expect(ingredientIdentityKey('ROSUVASTATIN CALCIUM 10 MG')).not.toBe(ingredientIdentityKey('ROSUVASTATIN CALCIUM 20 MG'))
  })
  it('compares amounts in one unit and keeps concentrations and combinations whole', () => {
    expect(ingredientIdentityKey('FENTANYL CITRATE 100 MCG')).toBe(ingredientIdentityKey('FENTANYL 0.1 MG'))
    expect(ingredientIdentityKey('METHYLEPHEDRINE HCL .25 MG/ML')).not.toBe(ingredientIdentityKey('METHYLEPHEDRINE HCL .25 MG'))
    expect(ingredientIdentityKey('AMLODIPINE 5 MG+VALSARTAN 80 MG')).toBe(ingredientIdentityKey('VALSARTAN 80 MG+AMLODIPINE (BESYLATE) 5 MG'))
    expect(ingredientIdentityKey('AMLODIPINE 5 MG+VALSARTAN 80 MG')).not.toBe(ingredientIdentityKey('AMLODIPINE 5 MG'))
  })
  it('has no identity without a name or an amount', () => {
    expect(ingredientIdentityKey('ROSUVASTATIN CALCIUM')).toBeUndefined()
    expect(ingredientIdentityKey('20 MG')).toBeUndefined()
  })
})

describe('hospitalMedicationNameKey', () => {
  it('folds typography only', () => {
    expect(hospitalMedicationNameKey('Pariet  EC tab 20mg')).toBe(hospitalMedicationNameKey('PARIET EC TAB 20 MG'))
    expect(hospitalMedicationNameKey('PAXLOVID tab (eGFR&gt;59,30 tabs)')).toBe(hospitalMedicationNameKey('PAXLOVID tab (eGFR>59,30 tabs)'))
    expect(hospitalMedicationNameKey('Pariet EC tab 20 mg*')).not.toBe(hospitalMedicationNameKey('Pariet EC tab 20 mg'))
    expect(hospitalMedicationNameKey('Clindamycin "YSP" * cap 150 mg')).not.toBe(hospitalMedicationNameKey('Clindamycin * cap 150 mg'))
  })
})

describe('buildVghtpeMedicationIndex', () => {
  const linkage = (items: any[], extra: any = {}) => ({ schemaVersion: 'hospital-cloud-drug-linkage-v1', snapshotId: SNAPSHOT,
    verifiedProducts: [{ productKey: 'p1', evidenceStatus: 'verified_product_identity', licenseId: '02022782', ingredientText: 'RABEPRAZOLE SODIUM 20 MG',
      doseForm: '腸溶膜衣錠', officialProductUrl: 'https://lmspiq.fda.gov.tw/web/DRPIQ/DRPIQ1000Result?licId=02022782', nhiCodes: ['BC22782100', 'B022782100'],
      evidence: 'local-file.local.json' }], items, ...extra })
  const hospital = { hospitalCode: '0001', hospitalDrugNumber: '00001', hospitalBillingNhiCode: null, broadCandidateCodes: ['A1'], reviewCandidateCodes: ['A1'] }

  it('keeps verified products and single-ingredient candidates without any hospital code or local evidence', () => {
    const { index: built, report } = buildVghtpeMedicationIndex(linkage([
      { ...hospital, names: ['Pariet EC tab 20 mg', 'Rabeprazole EC tab 20 mg'], status: 'verified_product_identity', verifiedProductKey: 'p1' },
      { ...hospital, names: ['Clindamycin "YSP" * cap 150 mg'], status: 'review_required', reviewCandidateIngredients: ['CLINDAMYCIN HCL 150 MG', 'CLINDAMYCIN (HCL HYDRATE) 150 MG'] },
      { ...hospital, names: ['Pure sodium benzoate cap 250 mg'], status: 'review_required', reviewCandidateIngredients: ['(PURE) SODIUM BENZOATE 250 MG', 'CLOXACILLIN (SODIUM) 250 MG'] },
      { ...hospital, names: ['Privigen * inj 10% 50 ml'], status: 'insufficient_compatible_evidence', reviewCandidateIngredients: [] },
    ]), '{}', SNAPSHOT)
    expect(built.items).toEqual([
      { names: ['Clindamycin "YSP" * cap 150 mg'], basis: 'single-candidate-ingredient', ingredientText: 'CLINDAMYCIN HCL 150 MG' },
      { names: ['Pariet EC tab 20 mg', 'Rabeprazole EC tab 20 mg'], basis: 'verified-product', ingredientText: 'RABEPRAZOLE SODIUM 20 MG',
        product: { licenseId: '02022782', officialProductUrl: 'https://lmspiq.fda.gov.tw/web/DRPIQ/DRPIQ1000Result?licId=02022782', doseForm: '腸溶膜衣錠',
          nhiCodes: ['B022782100', 'BC22782100'] } },
    ])
    expect(report.excluded).toMatchObject({ disagreeingCandidates: 1, insufficient: 1 })
    expect(JSON.stringify(built)).not.toMatch(/hospitalCode|hospitalDrugNumber|Billing|Candidate|evidence|local/)
  })

  it('drops a name that items of different identity both claim, and refuses another schema or drug master', () => {
    const { index: built, report } = buildVghtpeMedicationIndex(linkage([
      { ...hospital, names: ['Same name tab 10 mg', 'Alpha tab 10 mg'], status: 'review_required', reviewCandidateIngredients: ['ALPHA 10 MG'] },
      { ...hospital, names: ['Same  name tab 10mg'], status: 'review_required', reviewCandidateIngredients: ['BETA 10 MG'] },
    ]), '{}', SNAPSHOT)
    expect(built.items).toEqual([{ names: ['Alpha tab 10 mg'], basis: 'single-candidate-ingredient', ingredientText: 'ALPHA 10 MG' }])
    expect(report.excluded.nameCollision).toBe(1)
    expect(() => buildVghtpeMedicationIndex(linkage([], { schemaVersion: 'other' }), '{}', SNAPSHOT)).toThrow(/schema/)
    expect(() => buildVghtpeMedicationIndex(linkage([]), '{}', 'nhi-drug-terminology-20250101')).toThrow(/snapshot/)
  })
})

describe('the committed index', () => {
  const master = JSON.parse(fs.readFileSync(MASTER_PATH, 'utf8'))
  const rows: any[][] = master.rows

  it('matches the vendored drug master and holds each hospital name once', () => {
    expect(index.schemaVersion).toBe(INDEX_SCHEMA_VERSION)
    expect(index.terminologySnapshotId).toBe(master.manifest.snapshotId)
    const ingredientTexts = new Set(rows.map(row => String(row[5]).trim()))
    const keys = new Set<string>()
    for (const item of index.items as any[]) {
      expect(ingredientTexts.has(item.ingredientText)).toBe(true)
      expect(ingredientIdentityKey(item.ingredientText)).toBeDefined()
      for (const name of item.names) {
        const key = hospitalMedicationNameKey(name)
        expect(keys.has(key)).toBe(false)
        keys.add(key)
      }
      if (item.product) {
        for (const code of item.product.nhiCodes) {
          const row = rows.find(candidate => candidate[0] === code)
          expect(row?.[12]).toBe(item.product.officialProductUrl)
          expect(ingredientIdentityKey(String(row?.[5]))).toBe(ingredientIdentityKey(item.ingredientText))
        }
      }
    }
  })

  it('holds no hospital item code, candidate list or local evidence', () => {
    expect(JSON.stringify(index)).not.toMatch(/hospitalCode|hospitalDrugNumber|Billing|Candidate|evidence|\.local/)
  })
})
