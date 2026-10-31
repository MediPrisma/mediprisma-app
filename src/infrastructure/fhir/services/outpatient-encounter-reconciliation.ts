// Operates on the canonicalised import graph, never on the stored source Bundle.
import { isVghtpeSource, isMedcloudSource } from '@/src/shared/utils/clinical-source-identity'
import { sharedEncounterIdentifier, conflictingSourceIdentifier, SOURCE_EVIDENCE_FIELDS } from '@/src/shared/utils/source-record-comparison'
import { medicationClinicalDay } from '@/src/shared/utils/medication-calendar'
import { isNhiDrugCodeSystem } from './nhi-drug-terminology-enrichment.service'
type Resource = Record<string, any>

function isVghFacility(reference: Resource | undefined): boolean {
  const display = String(reference?.display ?? '').replace(/台/g, '臺').replace(/\s/g, '')
  return /^(臺北榮總|臺北榮民總醫院)(?:[;；]|$)/.test(display)
    || reference?.identifier?.value === '0601160016'
}

function eligible(encounter: Resource): boolean {
  return encounter.resourceType === 'Encounter' && encounter.class?.code === 'AMB'
    && ['finished', 'in-progress', 'arrived', 'unknown'].includes(encounter.status)
    && !!encounter.subject?.reference && typeof encounter.period?.start === 'string' && !!medicationClinicalDay(encounter.period.start)
}

function primaryDiagnosis(encounter: Resource, conditions: Map<string, Resource>): Resource | undefined {
  const ranked = encounter.diagnosis?.find((diagnosis: Resource) => diagnosis.rank === 1)
  return conditions.get(ranked?.condition?.reference)?.code ?? encounter.reasonCode?.[0]
}

function icdKey(concept: Resource | undefined): string | undefined {
  const coding = concept?.coding?.find((item: Resource) => /(?:^|\/)icd-?10(?:-?cm)?\/?$/i.test(item.system ?? '') && item.code)
  if (!coding) return undefined
  const family = /icd-?10-?cm\/?$/i.test(coding.system) ? 'icd-10-cm' : 'icd-10'
  return `${family}|${String(coding.code).trim().toUpperCase().replace(/\./g, '')}`
}

function department(encounter: Resource): string | undefined {
  const concept = encounter.serviceType?.concept ?? encounter.serviceType
  return concept?.coding?.filter((coding: Resource) => coding.system && coding.code)
    .map((coding: Resource) => `${coding.system.toLowerCase().replace(/\/$/, '')}|${coding.code}`).sort().join(';')
    || concept?.text?.trim()
}

function union(left: any[] = [], right: any[] = []): any[] {
  const seen = new Set<string>()
  return [...left, ...right].filter((item) => {
    const key = JSON.stringify(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function physician(encounter: Resource): string | undefined {
  const names = (encounter.participant ?? []).map((participant: Resource) =>
    participant.individual?.reference || participant.individual?.display || participant.actor?.display,
  ).filter(Boolean).sort()
  return names.length ? names.join('|') : undefined
}

function nhiCodes(concept: Resource | undefined): string[] {
  return [...new Set<string>((concept?.coding ?? []).filter((coding: Resource) => isNhiDrugCodeSystem(coding.system) && coding.code)
    .map((coding: Resource) => String(coding.code).trim().toUpperCase()))]
}

// Concentration denominators a strength may be stated per; any other
// written denominator makes the label's strengths unusable as evidence.
const PER_UNITS: Record<string, string> = { ml: 'ml', g: 'g', dose: 'dose', doses: 'dose', puff: 'dose', puffs: 'dose',
  p: 'dose', actuation: 'dose', actuations: 'dose' }
const NUMBER = '(?<![\\d.,])(\\d*\\.?\\d+)'
// Counts and volumes that describe the pack, not the strength.
const PACK_UNITS = new Set(['ml', 'g', 'dose', 'doses', 'p', 'puffs', 'tab', 'tabs', 'tablet', 'tablets', 'cap', 'caps',
  'capsule', 'capsules', 's', 'x', 'pcs', 'vial', 'vials', 'amp', 'amps', 'ampoule', 'ampoules', 'bottle', 'bottles',
  'tube', 'tubes', 'sachet', 'sachets', 'pack', 'packs', 'bag', 'bags'])

/** Every strength in a label, in order, with its unit and concentration
 *  denominator (a missing denominator count read as 1). Thousands separators
 *  are read as one number (1,000,000 IU). A combination written '25/5 mg'
 *  reads as 25 mg + 5 mg, and '5/160/12.5 mg' as all three in order. Units are never converted: 5 mg/2 ml, 5 mcg and
 *  5 mg/ml all differ; only spellings (UG, GM, puff for dose) are unified. A
 *  denominator outside ml, g and dose, or any other amount left unread,
 *  makes the strength unusable: undefined,
 *  unlike [] for a label that states none, so nothing may fill it in. */
function strengths(text: unknown): string[] | undefined {
  const normalized = String(text ?? '').normalize('NFKC').toLowerCase()
    .replace(/(?<![\d.,])\d{1,3}(?:,\d{3})+(?![\d,])/g, (number) => number.replace(/,/g, ''))
    .replace(/(?<![a-z])(?:i\.\s?u\.?|u\.\s?i\.?)(?![a-z])/g, 'iu')
    .replace(/(?:[μµ]|u)g(?![a-z])/g, 'mcg').replace(/(?<![a-z])gm(?![a-z])/g, 'g')
    // Every number before a shared unit, in order: '5/160/12.5 mg' is three.
    .replace(new RegExp(`(?<![\\d.,/])\\d*\\.?\\d+(?:\\s*\\/\\s*\\d*\\.?\\d+)+\\s*(mcg|mg|g|iu)(?![a-z])`, 'g'),
      (run, unit: string) => run.slice(0, run.length - unit.length).split('/').map((amount) => `${amount.trim()} ${unit}`).join(' + '))
  const found = [...normalized.matchAll(new RegExp(
    `${NUMBER}\\s*(mcg|mg|g|iu|%)(?![a-z])(?:\\s*\\/\\s*(\\d*\\.?\\d+)?\\s*(?!(?:mcg|mg|iu)(?![a-z]))([a-z]+))?`, 'g'))]
  if (found.some(([, , , , perUnit]) => perUnit && !PER_UNITS[perUnit])) return undefined
  // Whatever is left must hold no amount this reader skipped: only pack sizes
  // (3 ml, 60p, 10 tabs) may remain. '3MIU', '1.75 mmol/L', '10 HM' or a
  // denominator cut off from its amount ('100UG(3MIU)/0.5ML') make the
  // strength unusable rather than partial.
  let rest = normalized
  for (const match of found) rest = rest.slice(0, match.index) + ' '.repeat(match[0].length) + rest.slice(match.index! + match[0].length)
  const leftovers = [...rest.matchAll(/(?<![\d.,a-z])\d*\.?\d+\s*([a-z%]+)/g)].map(([, unit]) => unit)
  if (leftovers.some((unit) => !PACK_UNITS.has(unit)) || /\/\s*\d*\.?\d*\s*(?:ml|g|dose)(?![a-z])/.test(rest)) return undefined
  return found.map(([, amount, unit, per, perUnit]) =>
    `${Number(amount)}${unit}${perUnit ? `/${Number(per ?? 1)}${PER_UNITS[perUnit]}` : ''}`)
}

// Coating, packaging and route words that name no different preparation.
const QUALIFIERS = new Set(['sc', 'fc', 'tm', 'film', 'coated', 'sugar', 'release', 'hard', 'soft', 'for', 'oral',
  'sterile', 'eye', 'oph', 'ophthalmic', 'ear', 'otic'])
// Release forms are part of the preparation: SR and plain tablets differ.
const RELEASE: Record<string, string> = Object.fromEntries([
  ...['sr', 'pr', 'er', 'xr', 'xl', 'cr', 'la', 'mr', 'prolonged', 'extended', 'modified', 'controlled', 'sustained', 'retard']
    .map((word) => [word, 'modified']),
  ['od', 'orodispersible'], ['orodispersible', 'orodispersible'], ['ec', 'enteric'], ['enteric', 'enteric'], ['delayed', 'enteric'],
])
// Dosage-form words, normalised to one family per form.
const FORMS: Array<[RegExp, string]> = [
  [/^(?:inj|injection|injectable)/, 'injection'], [/^(?:ih|inh|inhal|inhalation|aerosol|rapihaler|turbuhaler)/, 'inhalation'],
  [/^chew/, 'chewable'], [/^effervescent/, 'effervescent'], [/^tab/, 'tablet'], [/^cap/, 'capsule'],
  [/^susp/, 'suspension'], [/^(?:soln?|solution)$/, 'solution'], [/^cream/, 'cream'], [/^oint/, 'ointment'], [/^gel$/, 'gel'],
  [/^drops?$/, 'drops'], [/^patch/, 'patch'], [/^granules?$/, 'granules'], [/^syrup/, 'syrup'], [/^powder/, 'powder'], [/^spray/, 'spray'],
]
const formOf = (token: string) => FORMS.find(([pattern]) => pattern.test(token))?.[1]
// The official dose-form text the NHI master gives in Chinese.
// The master writes eye suspensions and solutions alike as 點眼液劑.
const OFFICIAL_FORMS: Array<[RegExp, string]> = [
  [/注射/, 'injection'], [/(?:點眼|眼用|眼耳).*膏/, 'eye ointment'], [/(?:點眼|眼用|眼耳).*凝膠/, 'eye gel'],
  [/點眼|眼用|眼耳/, 'eye liquid'], [/點耳|耳用/, 'ear liquid'], [/吸入|噴霧/, 'inhalation'], [/咀嚼/, 'chewable'], [/發泡/, 'effervescent'], [/錠/, 'tablet'],
  [/膠囊/, 'capsule'], [/懸/, 'suspension'], [/軟膏/, 'ointment'], [/乳膏/, 'cream'], [/凝膠/, 'gel'], [/貼/, 'patch'],
  [/顆粒/, 'granules'], [/糖漿/, 'syrup'], [/滴/, 'drops'], [/液/, 'solution'],
]
const OFFICIAL_RELEASE: Array<[RegExp, string]> = [[/持續|緩釋|長效|控釋/, 'modified'], [/口溶|口腔崩散/, 'orodispersible'], [/腸溶/, 'enteric']]

interface Preparation { name: string; strengths: string; release: string; forms: string[] }

/** A product label read as name, strengths, release form and dosage forms.
 *  The name is every word before the form or strength, without
 *  quoted or bracketed text (still read for release and form) or coating words (dotted abbreviations
 *  read as words: F.C. as fc, S.R. as sr): 'Vitamin B1 tab 50 mg' keeps 'vitamin b1', unlike 'VITAMIN
 *  B6 TABLETS 50MG'. An injection or inhalation word outranks the vehicle it
 *  names ('solution for injection'). */
function preparation(label: unknown, amounts = strengths(label)): Preparation | undefined {
  if (!amounts?.length) return undefined
  const words: string[] = [], forms: string[] = []
  let release = 'immediate', named = false, eye = false, ear = false
  const asides: string[] = []
  const text = String(label ?? '').normalize('NFKC').toLowerCase()
    .replace(/"[^"]*"?|\([^)]*\)?/g, (aside) => { asides.push(aside); return ' ' })
  const tokenize = (value: string) => value
    .replace(/\b(?:[a-z]\.){2,}/g, (abbreviation) => ` ${abbreviation.replace(/\./g, '')} `).split(/[^a-z0-9.]+/)
    .map((item) => item.replace(/^\.+|\.+$/g, '')).filter(Boolean)
  const read = (token: string) => {
    const form = formOf(token)
    if (form) forms.push(form)
    if (RELEASE[token]) release = RELEASE[token]
    if (['eye', 'oph', 'ophthalmic'].includes(token)) eye = true
    if (['ear', 'otic'].includes(token)) ear = true
    return form
  }
  // A bare number ends the name only when it is this label's own strength
  // ('CONCOR 1.25', 'Nebilet 5 mg'); otherwise it names the product
  // ('Mixtard 10 HM' is not 'Mixtard 50 HM').
  const amountNumbers = new Set(amounts.flatMap((amount) => (amount.match(/\d*\.?\d+/g) ?? []).map(Number)))
  for (const token of tokenize(text)) {
    const form = read(token)
    const bare = /^\d*\.?\d+$/.test(token)
    if (form || (/^\d/.test(token) && !bare) || (bare && amountNumbers.has(Number(token)))) named = true
    if (!named && !RELEASE[token] && !QUALIFIERS.has(token)) words.push(token)
  }
  // Quoted and bracketed text names no product, but a release or dosage form
  // written there ('(SR)', '(EXTENDED RELEASE)') still describes it.
  const statedForms = forms.length
  for (const token of tokenize(asides.join(' '))) read(token)
  // A form in brackets only fills one the name itself omits.
  if (statedForms) forms.splice(statedForms)
  if (!words.length || words[0].length < 3) return undefined
  let primary = forms.find((form) => form === 'injection') ?? forms.find((form) => form === 'inhalation') ?? forms[0]
  // The route is part of the preparation: an eye ointment is not a skin one.
  if (eye && ['solution', 'suspension', 'drops'].includes(primary)) primary = 'eye liquid'
  else if (eye && ['ointment', 'gel'].includes(primary)) primary = `eye ${primary}`
  else if (ear && ['solution', 'suspension', 'drops'].includes(primary)) primary = 'ear liquid'
  return { name: words.join(' '), strengths: amounts.join('+'), release, forms: primary ? [primary] : [] }
}

function productLabel(concept: Resource | undefined): string | undefined {
  return (concept?.coding ?? []).map((coding: Resource) => coding.display || coding.code)
    .concat(concept?.text).find((value: unknown) => typeof value === 'string' && /^[^a-z]*[a-z]/i.test(value))
}

/** A cloud order read from its NHI product name, with the linked official
 *  record filling what that name omits: the strength from the ingredient text
 *  ('CORDARONE TABLETS' → 'AMIODARONE HCL 200 MG') and the dosage and release
 *  form from the official dose form ('膠囊劑', '持續性藥效錠'). */
function cloudPreparations(concept: Resource | undefined, knowledge: Resource[]): Preparation[] {
  const labels = [productLabel(concept), ...knowledge.map((item) => productLabel(item.code))].filter(Boolean)
  // An ingredient amount stated per ml or per dose that the parser cannot keep
  // as a concentration is no strength at all.
  const ingredients = knowledge.flatMap((item) => (item.ingredient ?? []).map((ingredient: Resource) => {
    const text = String(ingredient.itemCodeableConcept?.text ?? '')
    const amounts = strengths(text)
    if (!amounts) return undefined
    const perUnit = /(?:\/|\b(?:each|per)\b)\s*(?:\d*\.?\d+\s*)?(?:ml|g|gm|dose|actuation|puff)\b/i.test(text)
    return perUnit && amounts.some((amount) => !amount.includes('/')) ? undefined : amounts
  })).filter((amounts): amounts is string[] => !!amounts?.length)
  const official = knowledge.map((item) => String(item.doseForm?.text ?? '')).find(Boolean) ?? ''
  const officialForm = OFFICIAL_FORMS.find(([pattern]) => pattern.test(official))?.[1]
  const officialRelease = OFFICIAL_RELEASE.find(([pattern]) => pattern.test(official))?.[1]
  return labels.flatMap((label) => {
    const named = strengths(label)
    // The ingredient text fills a strength the name omits; it never stands in
    // for one the name states, nor for one the name states unusably (5MG/HR).
    if (!named) return []
    return (named.length ? [named] : ingredients.length === 1 ? ingredients : []).map((amounts) => preparation(label, amounts))
  }).filter((item): item is Preparation => !!item)
    .map((item) => ({ ...item,
      release: item.release === 'immediate' && officialRelease ? officialRelease : item.release,
      forms: officialForm ? [officialForm] : item.forms }))
}

/** Same name, strengths and release form; the dosage forms must agree when
 *  both sides state one. */
function samePreparation(hospital: Preparation, cloud: Preparation): boolean {
  return hospital.name === cloud.name && hospital.strengths === cloud.strengths && hospital.release === cloud.release
    && (!hospital.forms.length || !cloud.forms.length || hospital.forms.some((form) => cloud.forms.includes(form)))
}

/** How many of the hospital visit's orders have a like order on the cloud
 *  visit: the same preparation (a coded hospital row must share the NHI code). A
 *  tie-breaker between same-day candidates only; it never confirms a visit or
 *  an order. */
function prescriptionOverlap(hospital: Resource[], cloud: Resource[], resources: Map<string, Resource>): number {
  const concept = (order: Resource) => order.medicationCodeableConcept ?? resources.get(order.medicationReference?.reference)?.code
  return hospital.filter((order) => cloud.some((other) => {
    const left = nhiCodes(concept(order)), right = nhiCodes(concept(other))
    if (right.length !== 1) return false
    if (left.length) return left.length === 1 && left[0] === right[0]
    const linked = (other.supportingInformation ?? []).map((reference: Resource) => resources.get(reference.reference))
      .filter((item: Resource | undefined) => item?.resourceType === 'MedicationKnowledge')
    // Every name-only hospital order goes through the same preparation check:
    // no product-match shortcut may skip the official form or release form.
    const recorded = preparation(productLabel(concept(order)))
    return !!recorded && cloudPreparations(concept(other), linked).some((item) => samePreparation(recorded, item))
  })).length
}

/** Pair same-day candidates whose prescriptions point to one another and to
 *  nobody else: each side's overlap must be strictly higher than with any other
 *  candidate still open. Ties and zero overlap stay unpaired. */
function pairByPrescriptions(edges: Array<[Resource, Resource, number]>): Array<[Resource, Resource]> {
  const pairs: Array<[Resource, Resource]> = []
  let open = edges.filter(([, , score]) => score > 0)
  for (;;) {
    const decisive = open.filter(([hospital, cloud, score]) => open.every(([otherHospital, otherCloud, otherScore]) =>
      (otherHospital === hospital && otherCloud === cloud) || (otherHospital !== hospital && otherCloud !== cloud) || otherScore < score))
    if (!decisive.length) return pairs
    for (const [hospital, cloud] of decisive) pairs.push([hospital, cloud])
    open = open.filter(([hospital, cloud]) => !decisive.some(([h, c]) => h === hospital || c === cloud))
  }
}

/** Reconcile only unique cross-source pairs: same patient, VGH facility,
 * outpatient day and coded primary ICD-10 diagnosis. Language is irrelevant.
 * Multiple same-day physicians/candidates remain separate rather than guessed.
 * The cloud id and bilingual label survive; every supplement link is retargeted.
 */
export function reconcileOutpatientEncounters(resources: Resource[]): Resource[] {
  // Both paired supplements and standalone North VGH downloads identify their
  // source explicitly, even when qemr omitted Encounter.serviceProvider.
  for (const resource of resources) {
    if (resource.resourceType === 'Encounter' && resource.class?.code === 'AMB'
      && isVghtpeSource(resource) && !resource.serviceProvider?.display?.trim()) {
      resource.serviceProvider = { ...resource.serviceProvider, display: '臺北榮總' }
    }
  }
  const conditions = new Map(resources.filter((resource) => resource.resourceType === 'Condition')
    .map((resource) => [`Condition/${resource.id}`, resource]))
  const visits = resources.filter(eligible)
  const hospital = visits.filter(isVghtpeSource)
  for (const visit of hospital) {
    if (!visit.reasonCode?.length) visit.reasonCode = (visit.diagnosis ?? [])
      .map((diagnosis: Resource) => conditions.get(diagnosis.condition?.reference)?.code).filter(Boolean)
  }
  const cloud = visits.filter((visit) => !isVghtpeSource(visit)
    && isMedcloudSource(visit)
    && isVghFacility(visit.serviceProvider))
  const candidates = new Map<Resource, Resource[]>()
  const reverse = new Map<Resource, number>()
  for (const visit of hospital) {
    // The explicit supplement tag proves this otherwise unnamed facility.
    // Do not override a contradictory, explicitly supplied facility.
    if (visit.serviceProvider && !isVghFacility(visit.serviceProvider)) continue
    const key = icdKey(primaryDiagnosis(visit, conditions))
    if (!key) continue
    const matches = cloud.filter((other) => {
      const leftPhysician = physician(visit)
      const rightPhysician = physician(other)
      const leftDepartment = department(visit), rightDepartment = department(other)
      return visit.subject.reference === other.subject.reference
        && medicationClinicalDay(visit.period.start) === medicationClinicalDay(other.period.start)
        // An exact token in WHO/CM can suggest a source comparison only.
        // It is never evidence that the two coding systems mean the same thing.
        && key.split('|')[1] === icdKey(primaryDiagnosis(other, conditions))?.split('|')[1]
        && !(leftPhysician && rightPhysician && leftPhysician !== rightPhysician)
        && !(leftDepartment && rightDepartment && leftDepartment !== rightDepartment)
        && !conflictingSourceIdentifier(visit, other)
    })
    candidates.set(visit, matches)
    for (const match of matches) reverse.set(match, (reverse.get(match) ?? 0) + 1)
  }

  const aliases = new Map<string, string>()
  const removed = new Set<Resource>()
  const ambiguousHandled = new Set<Resource>()
  const resourcesByReference = new Map(resources.filter((resource) => resource.id)
    .map((resource) => [`${resource.resourceType}/${resource.id}`, resource]))
  const ordersByVisit = new Map<string, Resource[]>()
  for (const resource of resources) {
    const reference = resource.resourceType === 'MedicationRequest' ? resource.encounter?.reference : undefined
    if (reference) ordersByVisit.set(reference, [...(ordersByVisit.get(reference) ?? []), resource])
  }
  const pair = (visit: Resource, target: Resource, warnings: string[] = []) => {
    const codingSystemsDiffer = icdKey(primaryDiagnosis(visit, conditions)) !== icdKey(primaryDiagnosis(target, conditions))
    const allWarnings = [...warnings, ...(codingSystemsDiffer ? ['diagnosis-coding-systems-differ'] : [])]
    const comparison = { status: codingSystemsDiffer ? 'ambiguous' : sharedEncounterIdentifier(visit, target) ? 'confirmed' : 'candidate',
      references: [`Encounter/${visit.id}`, `Encounter/${target.id}`],
      ...(allWarnings.length ? { warnings: allWarnings } : {}),
    }
    visit._sourceRecordComparison = comparison
    target._sourceRecordComparison = comparison
    // Same-day facility/diagnosis agreement is useful for a comparison card,
    // but cannot establish that two source visits are one clinical event.
    if (comparison.status !== 'confirmed') return
    target._sourceEncounterRecords = [visit, target].map((source) => {
      const { _sourceRecordComparison, _sourceEncounterRecords, ...record } = source
      return JSON.parse(JSON.stringify(record))
    })
    aliases.set(`Encounter/${visit.id}`, `Encounter/${target.id}`)
    removed.add(visit)
    for (const field of ['diagnosis', 'participant', 'location', 'identifier', 'extension', 'reasonReference']) {
      if (visit[field]?.length) target[field] = union(target[field], visit[field])
    }
    if (visit.serviceType) target.serviceType = visit.serviceType
    const reasons = [...(visit.reasonCode ?? []), ...(visit.diagnosis ?? []).map((diagnosis: Resource) =>
      conditions.get(diagnosis.condition?.reference)?.code,
    ).filter(Boolean)]
    // Keep cloud Chinese text and English coding displays for shared codes.
    // Add all remaining SOAP diagnoses without comparing their descriptions.
    target.reasonCode = [...(target.reasonCode ?? [])]
    const codes = new Set(target.reasonCode.map((reason: Resource) => icdKey(reason)).filter(Boolean))
    for (const reason of reasons) {
      const key = icdKey(reason)
      if (!key) continue
      if (codes.has(key)) {
        const existing = target.reasonCode.find((item: Resource) => icdKey(item) === key)
        const display = reason.coding?.find((coding: Resource) => coding.display)?.display
        if (display) for (const coding of existing?.coding ?? []) {
          if (!coding.display && icdKey({ coding: [coding] }) === key) coding.display = display
        }
        continue
      }
      codes.add(key)
      target.reasonCode.push(reason)
    }
    target.meta = { ...target.meta, tag: union(target.meta?.tag, [{
      system: 'urn:wildcatch:reconciliation', code: 'cloud-vghtpe-outpatient',
    }]) }
  }
  for (const [visit, matches] of candidates) {
    if (matches.length !== 1 || reverse.get(matches[0]) !== 1) {
      if (!matches.length || ambiguousHandled.has(visit)) continue
      const hospitals = new Set<Resource>([visit]), clouds = new Set<Resource>(), queue = [visit]
      for (let index = 0; index < queue.length; index++) for (const possible of candidates.get(queue[index]) ?? []) {
        clouds.add(possible)
        for (const [other, otherMatches] of candidates) if (!hospitals.has(other) && otherMatches.includes(possible)) {
          hospitals.add(other); queue.push(other)
        }
      }
      ;[...hospitals, ...clouds].forEach(source => ambiguousHandled.add(source))
      // Two same-day clinics with one primary code: the prescriptions decide
      // which cloud claim belongs to which hospital visit, when they can.
      const paired = pairByPrescriptions([...hospitals].flatMap((hospital) => (candidates.get(hospital) ?? [])
        .map((cloud): [Resource, Resource, number] => [hospital, cloud, prescriptionOverlap(
          ordersByVisit.get(`Encounter/${hospital.id}`) ?? [], ordersByVisit.get(`Encounter/${cloud.id}`) ?? [], resourcesByReference)])))
      for (const [hospital, cloud] of paired) {
        pair(hospital, cloud, ['paired-by-prescriptions'])
        hospitals.delete(hospital); clouds.delete(cloud)
      }
      // Whatever the prescriptions could not separate stays one comparison.
      const linked = (hospital: Resource) => (candidates.get(hospital) ?? []).some((cloud) => clouds.has(cloud))
      const sources = [...[...hospitals].filter(linked), ...[...clouds].filter((cloud) => [...hospitals].some((hospital) =>
        candidates.get(hospital)?.includes(cloud)))]
      if (sources.length < 2) continue
      // Once the prescriptions separated one pair, a single pair left over
      // has no rival either.
      if (paired.length && sources.length === 2) {
        pair(sources[0], sources[1], ['paired-by-prescriptions'])
        continue
      }
      const comparison = { status: 'ambiguous', references: sources.map(source => `Encounter/${source.id}`) }
      sources.forEach(source => { source._sourceRecordComparison = comparison })
      continue
    }
    pair(visit, matches[0])
  }
  if (!removed.size) return resources
  const rewrite = (value: any): void => {
    if (!value || typeof value !== 'object') return
    if (typeof value.reference === 'string' && aliases.has(value.reference)) {
      value.reference = aliases.get(value.reference)
    }
    for (const [key, child] of Object.entries(value)) if (!SOURCE_EVIDENCE_FIELDS.has(key)) rewrite(child)
  }
  const result = resources.filter((resource) => !removed.has(resource))
  result.filter(resource => resource.resourceType !== 'Provenance').forEach(rewrite)
  return result
}
