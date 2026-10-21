// What a medicine IS, as facts the model reads instead of recalling: its
// mechanism (FDA Established Pharmacologic Class, MED-RT, ChEMBL or SNOMED CT,
// keyed by WHO ATC) and whether it is anticholinergic (ACB scale / Beers, or an
// antimuscarinic mechanism). An ATC group is not a mechanism — G04BD holds both
// antimuscarinics and the β3 agonist mirabegron, which a run called
// "anticholinergic" (owner, 2026-10-05). A combination product is read
// ingredient by ingredient: one ATC combination code covers products with
// different ingredients (R05FA02 is dextromethorphan in some, codeine in
// others). Built by scripts/build-drug-mechanism-table.ts.

import {
  ANTICHOLINERGIC_BY_ATC,
  ANTICHOLINERGIC_BY_INGREDIENT,
  ATC_BY_INGREDIENT,
  MECHANISM_BY_ATC,
} from '@/src/shared/constants/drug-mechanism.generated'
import { splitIngredients } from './ingredient-name.utils'

const ANTIMUSCARINIC_MECHANISM = /muscarinic[^;]*antagonist|anticholinergic/i

/** Stored with a source prefix ("e:", "m:", "c:", "s:", "g:"). */
const mechanismOf = (atc?: string): string | undefined => (atc ? MECHANISM_BY_ATC[atc]?.slice(2) : undefined)
/** "g:" is the class shared by the other members of the ATC group, inferred
 *  rather than stated for this medicine: trimebutine inherits "Cholinergic
 *  Muscarinic Antagonists" from A03AA though it acts on opioid receptors. */
const mechanismIsInferred = (atc?: string): boolean => !!atc && MECHANISM_BY_ATC[atc]?.startsWith('g:') === true

export interface MedicineProfile {
  /** "beta3-Adrenergic Agonist"; for a combination, each ingredient the
   *  sources know ("losartan: Angiotensin 2 Receptor Blocker; hydrochlorothiazide:
   *  Thiazide Diuretic"). */
  mechanism?: string
  /** True when every ingredient has a mechanism. Only then does a missing
   *  `anticholinergic` mean "not anticholinergic" rather than "unknown". */
  complete: boolean
  /** "ACB 3" / "ACB 2" / "ACB 1" (ACB scale 2012), "Beers strong" (AGS Beers
   *  2023 Table 7, no ACB score of 2–3), "ACB 1 · Beers strong", or
   *  "antimuscarinic" when the medicine's main action is one neither list
   *  names; for a combination, followed by the ingredient
   *  ("ACB 3 (chlorpheniramine)"). */
  anticholinergic?: string
}

interface Component { name: string; atc?: string; mechanism?: string; inferred?: boolean; listed?: string }

// Eye, ear, skin, nose and mouth preparations and inhaled antimuscarinics act
// where they are applied; burden scales do not count them.
const LOCAL_USE = /^(S|D|R01|A01|R03BB)/
// Quaternary-ammonium antispasmodics (glycopyrrolate, methscopolamine,
// otilonium, butylscopolamine) and pirenzepine barely cross the blood–brain
// barrier; the burden scales and Beers count them only where they list them
// by name, which the ACB / Beers path above already reads.
const PERIPHERAL_ANTIMUSCARINIC = /^(A03AB|A03BB|A02BX03)/

function anticholinergicOf(c: Component): string | undefined {
  if (c.listed) return c.listed
  // Only when antimuscarinic is the medicine's first listed mechanism:
  // mirtazapine lists it after its serotonin and α2 actions and is not a
  // burden drug.
  if (c.inferred || PERIPHERAL_ANTIMUSCARINIC.test(c.atc ?? '')) return undefined
  const primary = c.mechanism?.split(';')[0] ?? ''
  return ANTIMUSCARINIC_MECHANISM.test(primary) && !LOCAL_USE.test(c.atc ?? '') ? 'antimuscarinic' : undefined
}

const strength = (label: string) => (/ACB 3|Beers/.test(label) ? 3 : /ACB 2|antimuscarinic/.test(label) ? 2 : 1)

const component = (name: string, atc?: string, listedByName = false): Component => ({
  name,
  atc,
  mechanism: mechanismOf(atc),
  inferred: mechanismIsInferred(atc),
  // An ingredient of a combination is also read by name: belladonna never
  // has a single-ingredient code of its own.
  listed: (atc ? ANTICHOLINERGIC_BY_ATC[atc] : undefined) ?? (listedByName ? ANTICHOLINERGIC_BY_INGREDIENT[name] : undefined),
})

export function medicineProfile(input: { atcCode?: string; ingredientText?: string }): MedicineProfile {
  const ingredients = input.ingredientText ? splitIngredients(input.ingredientText) : []
  if (ingredients.length > 1) {
    const components = ingredients.map((name) => component(name, ATC_BY_INGREDIENT[name], true))
    const known = components.filter((c) => c.mechanism)
    // Ingredients resolve through their systemic codes; the product's own
    // code says where it acts. An eye-drop combination (pheniramine in a
    // decongestant drop) carries no systemic burden.
    const strongest = LOCAL_USE.test(input.atcCode ?? '') ? undefined : components
      .map((c) => ({ c, label: anticholinergicOf(c) }))
      .filter((x): x is { c: Component; label: string } => !!x.label)
      .sort((a, b) => strength(b.label) - strength(a.label))[0]
    return {
      ...(known.length ? { mechanism: known.slice(0, 3).map((c) => `${c.name}: ${c.mechanism}`).join('; ') } : {}),
      complete: known.length === components.length && !components.some((c) => c.inferred),
      ...(strongest ? { anticholinergic: `${strongest.label} (${strongest.c.name})` } : {}),
    }
  }
  const single = component('', input.atcCode)
  const anticholinergic = anticholinergicOf(single)
  return {
    ...(single.mechanism ? { mechanism: single.mechanism } : {}),
    complete: !!single.mechanism && !single.inferred,
    ...(anticholinergic ? { anticholinergic } : {}),
  }
}

/** Whether a SOURCE LIST line says "anticholinergic": ACB 2–3, Beers strong,
 *  or an antimuscarinic mechanism. ACB 1 alone ("possible") stays off the line
 *  but still counts as anticholinergic when an alert says so. */
export const showsAnticholinergic = (label?: string): boolean => !!label && !/^ACB 1(?! · Beers)/.test(label)

/** The words a SOURCE LIST line prints: "anticholinergic ACB 3",
 *  "anticholinergic Beers strong", "anticholinergic ACB 3 (chlorpheniramine)",
 *  or "anticholinergic" for an antimuscarinic neither list names. */
export const anticholinergicLineLabel = (label: string): string =>
  label.startsWith('antimuscarinic') ? `anticholinergic${label.slice('antimuscarinic'.length)}` : `anticholinergic ${label}`
