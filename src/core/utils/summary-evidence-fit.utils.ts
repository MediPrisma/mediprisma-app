import type { ReportOrgan } from '@/src/core/entities/medical-summary.entity'
import type { ObservationEntity } from '@/src/core/entities/clinical-data.entity'
import { getAnalyteCanonicalKey } from '@voho0000/clinical-lab-normalization/canonical'
import { getOriginalAnalyteDisplayForObs } from '@voho0000/clinical-lab-normalization/display'

// Narrow biochemical identities, not diagnostic thresholds. Unknown tests
// receive no opinion; broad syndromes (such as anemia) have many valid tests.
const LAB_CLAIMS: ReadonlyArray<{ claim: RegExp; keys: readonly string[]; fallback: RegExp }> = [
  { claim: /hyperuric|高尿酸/i, keys: ['UA'], fallback: /uric|urate|尿酸/i },
  { claim: /hypokal|hyperkal|[高低]血鉀/i, keys: ['K'], fallback: /potassium|鉀/i },
  { claim: /hyponatr|hypernatr|[高低]血鈉/i, keys: ['NA'], fallback: /sodium|鈉/i },
  { claim: /hypercalc|hypocalc|[高低]血鈣/i, keys: ['CA', 'ICA'], fallback: /calcium|鈣|^iCa$/i },
  { claim: /hyperglyc|hypoglyc|[高低]血糖/i, keys: ['GLUCOSE', 'GLUCOSE-AC', 'GLUCOSE-FS', 'HBA1C'], fallback: /glucose|Glu-(?:AC|PC)|血糖|糖化血色素/i },
]

export function labClaimConflicts(label: string, observations: readonly ObservationEntity[]): boolean {
  const rule = LAB_CLAIMS.find(rule => rule.claim.test(label))
  if (!rule || !observations.length) return false
  const tests = observations.map(obs => ({ key: getAnalyteCanonicalKey(obs), name: getOriginalAnalyteDisplayForObs(obs) }))
  if (tests.some(test => test.key ? rule.keys.includes(test.key) : rule.fallback.test(test.name))) return false
  return tests.every(test => Boolean(test.key))
}

// Use the verified finding's anatomy, never patient sex, modality or the
// clinical history. Fallback receives only the quote's own diagnosis section. Ambiguity stays
// in Other; no keyword decides a diagnosis or removes a finding.
const ANATOMY: ReadonlyArray<[ReportOrgan, RegExp]> = [
  ['brain', /\b(?:brain|cerebr\w*|cerebell\w*|basal gangli\w*)\b|腦/iu],
  ['head-neck', /\b(?:thyroid|pharyn\w*|laryn\w*|parotid|maxillary sinus|paranasal sinus\w*)\b|甲狀腺|咽|喉|腮腺|鼻竇/iu],
  ['chest-lung', /\b(?:lungs?|mediastin\w*|pleur\w*|bronch\w*|atelectasis)\b|肺|胸膜/iu],
  ['heart', /\b(?:heart|cardiac|coronary|(?:left|right) ventric\w*|cardiomegaly|mitral|tricuspid|pericardi\w*)\b|心臟|心室|二尖瓣|三尖瓣|冠狀動脈/iu],
  ['breast', /\b(?:breast|mammary)\b|乳房|乳腺/iu],
  ['abdomen-liver-biliary', /\b(?:liver|hepatic|gall ?bladder|biliary|bile duct)\b|肝|膽囊|膽管/iu],
  ['abdomen-other', /\b(?:stomach|gastric|bowel|colon|pancrea\w*|spleen|splenic|hiatal)\b|胃|腸|胰|脾/iu],
  ['kidney-urinary', /\b(?:kidney|renal|ureter\w*|(?<!gall )bladder)\b|腎|輸尿管|膀胱/iu],
  ['gynecologic', /\b(?:uter\w*|endometr\w*|ovary|ovarian|adnexa\w*|vagina\w*)\b|子宮|卵巢|陰道/iu],
  ['prostate', /\bprostat\w*\b|攝護腺|前列腺/iu],
  ['musculoskeletal', /\b(?:bone|femur|femoral|tibia\w*|humer\w*|vertebr\w*|spine|spinal|spondylosis|knee|hip|joint|osteoarthr\w*)\b|股骨|肱骨|脛骨|脊椎|骨折|骨骼|關節/iu],
  ['vascular', /\b(?:aorta|artery|arteries|veins?)\b|動脈(?!期)|靜脈(?!期)/iu],
  ['hematologic-lymph', /\b(?:lymph\w*|marrow)\b|淋巴|骨髓/iu],
]

export function reportOrganFromQuotes(proposed: ReportOrgan, quotes: readonly string[], sourceNarratives: readonly string[] = []): ReportOrgan {
  const matches = new Set(ANATOMY.filter(([, pattern]) => quotes.some(quote => pattern.test(quote))).map(([organ]) => organ))
  if (matches.size === 1) return [...matches][0]
  if (matches.size > 1 && !matches.has(proposed)) return 'other'
  // A short verified quote (e.g. "Fracture") need not repeat the specimen.
  // A single-organ source can disambiguate it; a multi-organ report cannot.
  if (matches.size === 0) {
    const sourceMatches = new Set(ANATOMY.filter(([, pattern]) => sourceNarratives.some(text => pattern.test(text))).map(([organ]) => organ))
    if (sourceMatches.size === 1) return [...sourceMatches][0]
  }
  return proposed
}
