import fs from 'node:fs'
import path from 'node:path'
import index from '@/src/infrastructure/fhir/data/vghtpe-medication-index.generated.json'
import { buildVghtpeMedicationIndex, hospitalNameContradictsIdentity, INDEX_SCHEMA_VERSION } from '@/scripts/lib/vghtpe-medication-index'
import { hospitalMedicationNameKey } from '@/src/shared/utils/hospital-medication-index'

const MASTER_PATH = path.join(process.cwd(), 'vendor/nhi-fhir-bridge-nhi-drug-terminology/data/nhi-drug-terminology-20260728.json')
const master = JSON.parse(fs.readFileSync(MASTER_PATH, 'utf8'))
const rows = new Map<string, string[]>(master.rows.map((row: string[]) => [row[0], row]))
const SNAPSHOT = master.manifest.snapshotId
const lookup = (name: string) => (index.items as any[]).find(item => item.names.some((n: string) => hospitalMedicationNameKey(n) === hospitalMedicationNameKey(name)))

describe('hospitalMedicationNameKey', () => {
  it('folds typography only', () => {
    expect(hospitalMedicationNameKey('Pariet  EC tab 20mg')).toBe(hospitalMedicationNameKey('PARIET EC TAB 20 MG'))
    expect(hospitalMedicationNameKey('PAXLOVID tab (eGFR&gt;59,30 tabs)')).toBe(hospitalMedicationNameKey('PAXLOVID tab (eGFR>59,30 tabs)'))
    expect(hospitalMedicationNameKey('Pariet EC tab 20 mg*')).not.toBe(hospitalMedicationNameKey('Pariet EC tab 20 mg'))
    expect(hospitalMedicationNameKey('Clindamycin "YSP" * cap 150 mg')).not.toBe(hospitalMedicationNameKey('Clindamycin * cap 150 mg'))
  })
})

describe('buildVghtpeMedicationIndex', () => {
  const masterRows = [['BC22782100'], ['B022782100'], ['A000000001'], ['A000000002'], ['A000000003']]
  const unique = (name: string, codes: string[], ingredient = 'RABEPRAZOLE SODIUM 20 MG') => ({ name, status: 'unique', ingredientText: ingredient, nhiCodes: codes,
    identity: { ingredients: [{ name: 'RABEPRAZOLE', amount: '20MG' }], packageQuantity: null, doseFormFamily: 'TABLET', releaseType: 'delayed' } })
  const table = (items: any[], extra: any = {}) => ({ schemaVersion: 'hospital-identity-v2-local', snapshotId: SNAPSHOT, items, ...extra })
  const hospital = { hospitalCode: '3622', hospitalDrugNumber: '02775', verifiedHospitalNhiCode: null }
  const build = (identity: any) => buildVghtpeMedicationIndex({ identity, identityBytes: '{}', masterRows, terminologySnapshotId: SNAPSHOT })

  it('takes identity per hospital name, keeps only unique ones and copies no hospital item code', () => {
    const { index: built, report } = build(table([
      // The item is ambiguous only because its generic alias is unresolved; its brand name is unique.
      { ...hospital, names: ['Pariet EC tab 20 mg', 'Rabeprazole EC tab 20 mg'], status: 'ambiguous',
        aliasResults: [unique('Pariet EC tab 20 mg', ['BC22782100', 'B022782100']), { name: 'Rabeprazole EC tab 20 mg', status: 'none', nhiCodes: [] }] },
      { ...hospital, names: ['Ambiguous tab 5 mg'], status: 'ambiguous', aliasResults: [{ name: 'Ambiguous tab 5 mg', status: 'ambiguous', nhiCodes: [] }] },
    ]))
    expect(built.items).toEqual([{ names: ['Pariet EC tab 20 mg'], basis: 'dictionary-identity', ingredientText: 'RABEPRAZOLE SODIUM 20 MG',
      nhiCodes: ['B022782100', 'BC22782100'], identity: { ingredients: [{ name: 'RABEPRAZOLE', amount: '20MG' }], doseFormFamily: 'TABLET', releaseType: 'delayed' } }])
    expect(report.excluded.notUnique).toBe(2)
    expect(JSON.stringify(built)).not.toMatch(/hospitalCode|hospitalDrugNumber|verifiedHospital|aliasResults/)
  })

  it('lists names of one identity together and drops a name two identities claim', () => {
    const { index: built, report } = build(table([
      { names: ['Alpha tab 5 mg'], aliasResults: [unique('Alpha tab 5 mg', ['A000000001'])] },
      { names: ['Alpha generic tab 5 mg'], aliasResults: [unique('Alpha generic tab 5 mg', ['A000000001'])] },
      { names: ['Same name tab 5 mg'], aliasResults: [unique('Same name tab 5 mg', ['A000000002'])] },
      { names: ['Same  name tab 5mg'], aliasResults: [unique('Same  name tab 5mg', ['A000000003'])] },
    ]))
    expect(built.items.map(item => item.names)).toEqual([['Alpha generic tab 5 mg', 'Alpha tab 5 mg']])
    expect(report.excluded.nameCollision).toBe(2)
  })

  it('drops a name whose stated ingredients, release or form the identity denies', () => {
    const doxazosin = { ingredients: [{ name: 'DOXAZOSIN', amount: '4MG' }], doseFormFamily: 'TABLET', releaseType: 'immediate' }
    const resolved = (name: string, codes: string[], identity: any) => ({ names: [name], aliasResults: [{ name, status: 'unique', ingredientText: '', nhiCodes: codes, identity }] })
    const { index: built, report } = buildVghtpeMedicationIndex({
      identity: table([
        resolved('Doxaben XL * tab 4 mg', ['A031966100'], doxazosin),
        resolved('Doxaben XL tab 4 mg', ['BC23711100'], { ...doxazosin, releaseType: 'extended' }),
        resolved('Ezetimibe+Atorvastatin tab 10/20', ['B024058100'], { ingredients: [{ name: 'EZETIMIBE', amount: '10MG' }], doseFormFamily: 'TABLET', releaseType: 'immediate' }),
      ]),
      identityBytes: '{}', terminologySnapshotId: SNAPSHOT,
      masterRows: ['A031966100', 'BC23711100', 'B024058100'].map(code => rows.get(code)!),
    })
    expect(built.items.map(item => item.names)).toEqual([['Doxaben XL tab 4 mg']])
    expect(report.excluded.nameContradicted).toBe(2)
    expect(report.contradictedNames).toEqual(['Doxaben XL * tab 4 mg', 'Ezetimibe+Atorvastatin tab 10/20'])
  })

  it('refuses another schema, another drug master or a code the master lacks', () => {
    expect(() => build(table([], { schemaVersion: 'other' }))).toThrow(/schema/)
    expect(() => build(table([], { snapshotId: 'nhi-drug-terminology-20250101' }))).toThrow(/snapshot/)
    expect(() => build(table([{ names: ['X tab 1 mg'], aliasResults: [unique('X tab 1 mg', ['Z999999999'])] }]))).toThrow(/not in the vendored drug master/)
  })
})

describe('the committed index', () => {
  it('matches the vendored drug master and holds each hospital name once', () => {
    expect(index.schemaVersion).toBe(INDEX_SCHEMA_VERSION)
    expect(index.terminologySnapshotId).toBe(SNAPSHOT)
    const keys = new Set<string>()
    for (const item of index.items as any[]) {
      expect(item.nhiCodes.length).toBeGreaterThan(0)
      for (const code of item.nhiCodes) expect(rows.has(code)).toBe(true)
      // Every code of one identity has the same package quantity where the package is part of it.
      if (item.identity.packageQuantity) {
        expect(new Set(item.nhiCodes.map((code: string) => `${rows.get(code)![6]}${rows.get(code)![7]}`.replace(/\s+/g, '').toUpperCase().replace(/GM$/, 'G'))).size).toBe(1)
      }
      for (const name of item.names) {
        const key = hospitalMedicationNameKey(name)
        expect(keys.has(key)).toBe(false)
        keys.add(key)
      }
    }
  })

  it('keeps a different package or strength a different drug', () => {
    // Granisetron 1 mg/mL in a 3 mL ampoule is not the 1 mL ampoule.
    const granisetron = lookup('Granisetron (Setron)*inj 3mg/3ml')
    expect(granisetron.identity.packageQuantity).toBe('3ML')
    expect(granisetron.nhiCodes).toContain('BC19955216')
    expect(granisetron.nhiCodes).not.toContain('BC19955209')
    // Rosuvastatin 10 mg never shares codes with 20 mg.
    const crestor = lookup('Crestor FC * tab 10 mg')
    expect(crestor.nhiCodes).toContain('BC24131100')
    expect(crestor.nhiCodes).not.toContain('BC24129100')
  })

  it('gives no name an identity its own words deny', () => {
    for (const item of index.items as any[]) {
      for (const name of item.names) {
        expect([name, hospitalNameContradictsIdentity(name, item.identity, item.nhiCodes.map((code: string) => rows.get(code)!))]).toEqual([name, false])
      }
    }
    // Combination products are not their single-ingredient parts; a release or form the name states is kept.
    for (const name of ['Brimonidine+Timolol eye drop 5ml', 'Alendronate 70/Vit D3 5600 * tab', 'Ezetimibe+Atorvastatin tab 10/20',
      'Latanoprost+Timolol eye sol2.5ml']) expect(lookup(name)).toBeUndefined()
    expect(lookup('Doxaben XL * tab 4 mg')?.identity.releaseType ?? 'absent').not.toBe('immediate')
    expect(lookup('Domperidone "Kojar" * supp 10 mg')?.identity.doseFormFamily ?? 'absent').not.toBe('TABLET')
    expect(lookup('Ezetrol * tab 10 mg').nhiCodes).toContain('B024058100')
    expect(lookup('Atozet FC tab 10/20 mg').identity.ingredients).toHaveLength(2)
    expect(lookup('Lomexin vaginal supp 200 mg')).toBeDefined()
  })

  it('keeps clinically different formulations, forms and releases apart', () => {
    // A plain quetiapine tablet is not the extended-release one.
    expect(lookup('QUETIAPINE "Union" FC *TAB 200MG').identity.releaseType).toBe('immediate')
    // Conventional amphotericin B is not a liposomal or lipid-complex product.
    const fungizone = lookup('Fungizone * inj 50 mg'), ambisome = lookup('Ambisome for #* inj 50 mg')
    expect(ambisome.identity.formulation).toBe('lipid')
    expect(fungizone.identity.formulation).toBeUndefined()
    expect(fungizone.nhiCodes.some((code: string) => ambisome.nhiCodes.includes(code))).toBe(false)
    // Ampicillin alone is not UNASYN (ampicillin + sulbactam), whose dictionary rows omit sulbactam.
    expect(lookup('Ampolin "YF" inj 500 mg').nhiCodes).not.toEqual(expect.arrayContaining(['B020144289']))
    expect(lookup('Ampolin "YF" inj 500 mg').nhiCodes).not.toEqual(expect.arrayContaining(['BC20144289']))
    // A cream is not an ointment.
    const cream = lookup('Elomet cream 5g 0.1%')
    expect(cream.identity.doseFormFamily).toBe('CREAM')
    expect(cream.nhiCodes.map((code: string) => rows.get(code)![8]).every((form: string) => form.includes('乳膏'))).toBe(true)
    expect(lookup('Bisacodyl EFC * tab 5 mg/PTP VPP').identity.releaseType).toBe('enteric')
    // A sustained release written SRFC, or stated only in the dictionary's Chinese name (持續性).
    expect(lookup('Nifedipine "CYH" SRFC *tab 30 mg').identity.releaseType).toBe('modified')
    // A dictionary row whose ingredient field names another ingredient is corrected before use.
    expect(lookup('Aldioxa tab 100 mg').ingredientText).toMatch(/ALDIOXA/)
  })

  it('holds no hospital item code, candidate list or local evidence', () => {
    expect(JSON.stringify(index)).not.toMatch(/hospitalCode|hospitalDrugNumber|verifiedHospital|aliasResults|evidence|\.local|Candidate/)
  })
})
