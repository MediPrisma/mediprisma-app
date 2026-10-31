import fs from 'node:fs'
import path from 'node:path'
import { normalizeIngredient, splitIngredients } from '@/src/core/utils/ingredient-name.utils'
import { anticholinergicLineLabel, medicineProfile, showsAnticholinergic } from '@/src/core/utils/medicine-profile.utils'
import { DRUG_MECHANISM_SNAPSHOT_ID } from '@/src/shared/constants/drug-mechanism.generated'
import { buildSourceCatalog, formatSourceList } from '@/src/core/use-cases/medical-summary/generate-medical-summary.use-case'
import type { MedicationEntity } from '@/src/core/entities/clinical-data.entity'

describe('normalizeIngredient', () => {
  it('reads the drug master ingredient text as one spelling per ingredient', () => {
    expect(normalizeIngredient('CHLORPHENIRAMINE MALEATE 5 MG')).toBe('chlorpheniramine')
    expect(normalizeIngredient('BUTYLSCOPOLAMINE BROMIDE (=HYOSCINE BUTYLBROMIDE) 10 MG')).toBe('butylscopolamine')
    expect(normalizeIngredient('GRAMICIDIN .25 MG/GM')).toBe('gramicidin')
    expect(normalizeIngredient('METHYLEPHEDRINE DL- HCL 25 MG')).toBe('methylephedrine')
    expect(normalizeIngredient('L-ARGININE 10 MG/ML')).toBe('arginine')
    expect(normalizeIngredient('POTASSIUM CHLORIDE 600 MG')).toBe('potassium')
    expect(normalizeIngredient('OXYBUTYNIN CHLORIDE (=OXIBUTININA HCL=OXYBUTYNIN H 5 MG')).toBe('oxybutynin')
    expect(normalizeIngredient('LEVOCETIRIZINE DIHYDROCHLORIDE 5 MG')).toBe('levocetirizine')
    // Quaternary derivatives stay other medicines.
    expect(normalizeIngredient('SCOPOLAMINE BUTYLBROMIDE 10 MG')).toBe('scopolamine butylbromide')
    expect(normalizeIngredient('SCOPOLAMINE HBR .01 MG')).toBe('scopolamine')
    expect(splitIngredients('LOSARTAN POTASSIUM 50 MG+HYDROCHLOROTHIAZIDE 12.5 MG')).toEqual(['losartan', 'hydrochlorothiazide'])
  })
})

describe('medicineProfile', () => {
  it('tells a β3 agonist from the antimuscarinics in its ATC group', () => {
    expect(medicineProfile({ atcCode: 'G04BD12' })).toEqual({ mechanism: 'beta3-Adrenergic Agonist', complete: true })
    expect(medicineProfile({ atcCode: 'G04BD04' })).toEqual({
      mechanism: 'Cholinergic Muscarinic Antagonist', complete: true, anticholinergic: 'ACB 3',
    })
  })

  it('does not call a medicine anticholinergic on a class inferred from its ATC group', () => {
    // trimebutine (A03AA05) acts on opioid receptors; "g:" only says what its
    // group-mates are. The class is unknown, so its absence proves nothing.
    const trimebutine = medicineProfile({ atcCode: 'A03AA05' })
    expect(trimebutine.anticholinergic).toBeUndefined()
    expect(trimebutine.complete).toBe(false)
  })

  it('leaves peripheral quaternary antimuscarinics off the burden count unless a list names them', () => {
    for (const atcCode of ['A03AB02', 'A03BB03', 'A03AB06', 'A02BX03']) {
      expect(medicineProfile({ atcCode }).anticholinergic).toBeUndefined()
    }
    // Listed by name on the ACB scale: still counted.
    expect(medicineProfile({ atcCode: 'A03AB05' }).anticholinergic).toBe('ACB 3')
    expect(medicineProfile({ atcCode: 'A03AB20' }).anticholinergic).toBe('ACB 3')
  })

  it('marks an anticholinergic whose mechanism does not say so', () => {
    // imipramine: a tricyclic antidepressant, ACB 3.
    expect(medicineProfile({ atcCode: 'N06AA02' })).toMatchObject({ mechanism: 'Tricyclic Antidepressant', anticholinergic: 'ACB 3' })
  })

  it('reads a combination product ingredient by ingredient', () => {
    const profile = medicineProfile({ atcCode: 'R06AB54', ingredientText: 'ACETAMINOPHEN 500 MG+CHLORPHENIRAMINE MALEATE 2 MG' })
    expect(profile.complete).toBe(true)
    expect(profile.mechanism).toMatch(/^acetaminophen: .+; chlorpheniramine: Histamine-1 Receptor Antagonist$/)
    expect(profile.anticholinergic).toBe('ACB 3 (chlorpheniramine)')
    // The same ingredient in an eye drop acts where it is applied.
    expect(medicineProfile({
      atcCode: 'S01GX99',
      ingredientText: 'TAURINE 5 MG/ML+CHLORPHENIRAMINE MALEATE .2 MG/ML+PYRIDOXINE HCL 1 MG/ML',
    }).anticholinergic).toBeUndefined()
  })

  it('says unknown, not "none", for what the sources do not cover', () => {
    expect(medicineProfile({ atcCode: 'Z99ZZ99' })).toEqual({ complete: false })
    const partial = medicineProfile({ ingredientText: 'AMOXICILLIN 500 MG+SYNTHETIC-INGREDIENT 125 MG' })
    expect(partial.complete).toBe(false)
    expect(partial.mechanism).toMatch(/^amoxicillin: /)
  })

  it('counts an unscored antimuscarinic only when that is its main, systemic action', () => {
    expect(medicineProfile({ atcCode: 'N04AA02' }).anticholinergic).toBe('antimuscarinic') // biperiden
    expect(medicineProfile({ atcCode: 'N06AX11' }).anticholinergic).toBeUndefined() // mirtazapine
    expect(medicineProfile({ atcCode: 'R03BB04' }).anticholinergic).toBeUndefined() // inhaled tiotropium
  })

  it('follows the ACB scale and Beers 2023 as published', () => {
    expect(medicineProfile({ atcCode: 'N05AB04' }).anticholinergic).toBe('Beers strong') // prochlorperazine: Beers only
    expect(medicineProfile({ atcCode: 'R06AX02' }).anticholinergic).toBe('ACB 2 · Beers strong') // cyproheptadine: ACB 2, Beers strong
    expect(medicineProfile({ atcCode: 'A03BB01' }).anticholinergic).toBeUndefined() // butylscopolamine: on neither list
    // A butylscopolamine injection filed as scopolamine: no ACB score, though
    // its mechanism is antimuscarinic.
    expect(medicineProfile({ atcCode: 'A04AD01' }).anticholinergic).toBe('antimuscarinic')
    // Belladonna has no single-ingredient code; a combination reads it by name.
    expect(medicineProfile({ ingredientText: 'PHENOBARBITAL 16 MG+BELLADONNA EXTRACT 4 MG' }).anticholinergic)
      .toBe('ACB 2 (belladonna extract)')
    expect(medicineProfile({ ingredientText: 'CHLORDIAZEPOXIDE 5 MG+CLIDINIUM BROMIDE 2.5 MG' }).anticholinergic)
      .toBe('ACB 1 · Beers strong (clidinium)')
  })

  it('keeps ACB 1 alone off the line and words the rest plainly', () => {
    expect(showsAnticholinergic('ACB 1')).toBe(false)
    expect(showsAnticholinergic('ACB 1 (codeine)')).toBe(false)
    expect(showsAnticholinergic('ACB 1 · Beers strong (clidinium)')).toBe(true)
    expect(showsAnticholinergic('ACB 2')).toBe(true)
    expect(showsAnticholinergic('antimuscarinic')).toBe(true)
    expect(anticholinergicLineLabel('ACB 3')).toBe('anticholinergic ACB 3')
    expect(anticholinergicLineLabel('Beers strong')).toBe('anticholinergic Beers strong')
    expect(anticholinergicLineLabel('ACB 3 (chlorpheniramine)')).toBe('anticholinergic ACB 3 (chlorpheniramine)')
    expect(anticholinergicLineLabel('antimuscarinic')).toBe('anticholinergic')
  })
})

describe('SOURCE LIST medicine lines', () => {
  const medication = (id: string, atcCode: string, atcNameEn: string): MedicationEntity => ({
    id,
    status: 'active',
    authoredOn: '2026-09-15',
    medicationCodeableConcept: { text: `SYNTHETIC ${atcNameEn.toUpperCase()} TABLETS` },
    drugTerminology: {
      source: 'nhi-official-drug-master', snapshotId: 'synthetic', atcCode, atcNameEn,
      atcLevel3Code: 'G04B', atcLevel3NameEn: 'UROLOGICALS',
    },
  } as unknown as MedicationEntity)

  it('prints each medicine\'s mechanism, and anticholinergic only where it applies', () => {
    const catalog = buildSourceCatalog({
      medications: [medication('m1', 'G04BD12', 'mirabegron'), medication('m2', 'G04BD04', 'oxybutynin')],
    }, 'en')
    const text = formatSourceList(catalog)
    expect(text).toMatch(/mirabegron · G04B UROLOGICALS · beta3-Adrenergic Agonist(?! · anticholinergic)/)
    expect(text).toMatch(/oxybutynin · G04B UROLOGICALS · Cholinergic Muscarinic Antagonist · anticholinergic ACB 3/)
  })

  it('prints the anticholinergic label only for a medicine supplied in the 90 days before the reference date', () => {
    const catalog = buildSourceCatalog({ medications: [medication('m2', 'G04BD04', 'oxybutynin')] }, 'en')
    expect(catalog[0].medicationClass).toBe('oxybutynin · G04B UROLOGICALS · Cholinergic Muscarinic Antagonist')
    expect(formatSourceList(catalog, '2026-12-01')).toMatch(/Cholinergic Muscarinic Antagonist · anticholinergic ACB 3/)
    // Filled in September, nothing since: by February the label is gone, the mechanism stays.
    expect(formatSourceList(catalog, '2027-02-01')).toMatch(/oxybutynin · G04B UROLOGICALS · Cholinergic Muscarinic Antagonist(?! · anticholinergic)/)
  })
})

it('was built from the vendored drug master snapshot (regenerate it when the snapshot moves)', () => {
  const dir = path.join(process.cwd(), 'vendor/nhi-fhir-bridge-nhi-drug-terminology/data')
  const snapshot = fs.readdirSync(dir).find((name) => /^nhi-drug-terminology-\d+\.json$/.test(name))?.replace(/\.json$/, '')
  expect(DRUG_MECHANISM_SNAPSHOT_ID).toBe(snapshot)
})
