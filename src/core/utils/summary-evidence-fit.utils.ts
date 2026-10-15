import type { ReportOrgan } from '@/src/core/entities/medical-summary.entity'

// Only narrow biochemical claims: an unrelated value cannot establish these
// conditions. This is an evidence check, not a diagnostic threshold engine.
const LAB_CLAIMS: ReadonlyArray<{ claim: RegExp; evidence: RegExp }> = [
  { claim: /hyperuric|高尿酸/i, evidence: /uric|urate|尿酸|\bUA\b/i },
  { claim: /hypokal|hyperkal|[高低]血鉀/i, evidence: /potassium|血鉀|\bK\b/i },
  { claim: /hyponatr|hypernatr|[高低]血鈉/i, evidence: /sodium|血鈉|\bNa\b/i },
  { claim: /hypercalc|hypocalc|[高低]血鈣/i, evidence: /calcium|血鈣|\bCa\b/i },
  { claim: /anemi|貧血/i, evidence: /hemoglobin|haemoglobin|血紅素|\bH[bg]b?\b|hematocrit|\bHct\b/i },
  { claim: /hyperglyc|hypoglyc|[高低]血糖/i, evidence: /glucose|Glu-AC|血糖|HbA1c/i },
]

export function labClaimConflicts(label: string, originalTestNames: readonly string[]): boolean {
  const rule = LAB_CLAIMS.find(rule => rule.claim.test(label))
  return Boolean(rule && originalTestNames.length && !originalTestNames.some(name => rule.evidence.test(name)))
}

// Use the verified finding's anatomy, never patient sex, modality or the
// whole report (which can mention many unrelated organs). Ambiguity stays
// in Other; no keyword decides a diagnosis or removes a finding.
const ANATOMY: ReadonlyArray<[ReportOrgan, RegExp]> = [
  ['brain', /\b(?:brain|cerebr\w*|cerebell\w*|basal gangli\w*)\b|腦/iu],
  ['head-neck', /\b(?:thyroid|pharyn\w*|laryn\w*|parotid)\b|甲狀腺|咽|喉|腮腺/iu],
  ['chest-lung', /\b(?:lungs?|mediastin\w*|pleur\w*|bronch\w*|atelectasis)\b|肺|胸膜/iu],
  ['heart', /\b(?:heart|cardiac|ventric\w*|mitral|tricuspid|pericardi\w*)\b|心臟|心室|二尖瓣|三尖瓣/iu],
  ['breast', /\b(?:breast|mammary)\b|乳房|乳腺/iu],
  ['abdomen-liver-biliary', /\b(?:liver|hepatic|gallbladder|biliary|bile duct)\b|肝臟|膽囊|膽管/iu],
  ['abdomen-other', /\b(?:stomach|gastric|bowel|colon|pancrea\w*|spleen|splenic|hiatal)\b|胃|腸|胰|脾/iu],
  ['kidney-urinary', /\b(?:kidney|renal|ureter\w*|bladder)\b|腎|輸尿管|膀胱/iu],
  ['gynecologic', /\b(?:uter\w*|endometr\w*|ovary|ovarian|adnexa\w*|vagina\w*)\b|子宮|卵巢|陰道/iu],
  ['prostate', /\bprostat\w*\b|攝護腺|前列腺/iu],
  ['musculoskeletal', /\b(?:bone|fem\w*|tibia\w*|humer\w*|vertebr\w*|spine|spinal|knee|hip|joint|osteoarthr\w*)\b|骨|關節/iu],
  ['vascular', /\b(?:aorta|arter\w*|venous|vein|vascular)\b|動脈|靜脈|血管/iu],
  ['hematologic-lymph', /\b(?:lymph\w*|marrow)\b|淋巴|骨髓/iu],
]

export function reportOrganFromQuotes(proposed: ReportOrgan, quotes: readonly string[]): ReportOrgan {
  const matches = new Set(ANATOMY.filter(([, pattern]) => quotes.some(quote => pattern.test(quote))).map(([organ]) => organ))
  if (matches.size === 1) return [...matches][0]
  if (matches.size > 1 && !matches.has(proposed)) return 'other'
  return proposed
}
