// The 初診快覽 headline is written in its own request, before the problem
// list. A small model filled one with problems the record does not hold
// ("70F with CKD stage 3a, hyperkalemia, anemia" for a heart-failure patient
// with a normal eGFR and potassium), and headlines carry medicines and lab
// values the rules leave out. The app compares the headline with the problem
// list and labels what does not match 待核對 — it never rewrites or hides it
// (owner, 2026-10-05).

export interface HeadlineReview {
  /** Headline items no problem in the list names. */
  unlisted: string[]
  /** Items that name a medicine. */
  medicines: string[]
  /** Items that carry a lab value or a unit. */
  values: string[]
}

// Chart abbreviations whose letters are not the initials of the name.
const ABBREVIATIONS: Record<string, string> = {
  htn: 'hypertension',
  hbv: 'hepatitis b',
  hcv: 'hepatitis c',
  dm: 'diabetes mellitus',
  hfref: 'heart failure reduced ejection fraction',
  hfpef: 'heart failure preserved ejection fraction',
  hld: 'hyperlipidemia',
  dlp: 'dyslipidemia',
  ckd: 'chronic kidney disease',
  esrd: 'end stage renal disease',
  aki: 'acute kidney injury',
  bph: 'benign prostatic hyperplasia',
  luts: 'lower urinary tract symptoms',
  ca: 'cancer',
  hx: 'history',
}

// Words that name the same organ or condition.
const SYNONYMS: Record<string, string> = {
  renal: 'kidney', nephropathy: 'kidney', egfr: 'kidney', creatinine: 'kidney',
  cardiac: 'heart', hepatic: 'liver', hepatitis: 'liver', pulmonary: 'lung',
  // What heart failure is measured by: "reduced ejection fraction", "LVEF",
  // "elevated NT-proBNP" restate the heart failure the list holds.
  ejection: 'heart', ventricular: 'heart', lvef: 'heart', bnp: 'heart', 'nt-probnp': 'heart', ntprobnp: 'heart',
  // Mood disorders by their kinds; tumour markers as the cancer they follow.
  bipolar: 'mood', depression: 'mood', depressive: 'mood', manic: 'mood', mania: 'mood',
  cea: 'cancer', afp: 'cancer', 'ca-125': 'cancer', 'ca19-9': 'cancer', 'ca-19-9': 'cancer',
  adenocarcinoma: 'cancer', lymphoma: 'cancer', leukemia: 'cancer', metastasis: 'cancer', metastatic: 'cancer',
  cerebral: 'brain', cerebrovascular: 'brain', stroke: 'brain',
  anaemia: 'anemia', haemoglobin: 'anemia', hemoglobin: 'anemia',
  tumour: 'tumor', carcinoma: 'cancer', malignancy: 'cancer', neoplasm: 'cancer',
  cognitive: 'dementia', alzheimer: 'dementia',
  dyslipidemia: 'lipid', hyperlipidemia: 'lipid', hypercholesterolemia: 'lipid',
  potassium: 'hyperkalemia', glucose: 'diabetes', hyperglycemia: 'diabetes',
  prostate: 'prostatic', prostatic: 'prostatic',
}

// Words too general to tie a headline item to a problem.
const GENERIC = new Set([
  'with', 'and', 'the', 'for', 'history', 'chronic', 'acute', 'stage', 'mild', 'moderate', 'severe', 'suspected',
  'possible', 'probable', 'status', 'post', 'recent', 'recently', 'known', 'newly', 'diagnosed', 'type', 'left',
  'right', 'bilateral', 'primary', 'secondary', 'disease', 'disorder', 'syndrome', 'condition', 'failure',
  'insufficiency', 'dysfunction', 'impairment', 'deficiency', 'multiple', 'recurrent', 'controlled', 'uncontrolled',
  'stable', 'unstable', 'care', 'shared', 'across', 'follow', 'followed', 'under', 'treatment', 'treated', 'from',
  'without', 'unspecified', 'other', 'reduced', 'elevated', 'abnormal', 'finding', 'findings', 'level', 'levels',
])

const UNIT = /\d\s*(%|mg\b|mcg\b|µg|\bg\/|mmol|meq|mg\/dl|ml\/min|pg\/ml|ng\/ml|iu\b|u\/l|mmhg|bpm|\/min\b|cm\b|mm\b)/i
const LAB_VALUE = /\b(egfr|hba1c|a1c|ldl|hdl|tsh|lvef|ef|bnp|nt-?probnp|hb|hgb|cr|creatinine|potassium|k\+?|sodium|na|alt|ast|psa|inr|bp|spo2)\s*[:=]?\s*\d/i
// "70F", "94-year-old man", "68M" open a headline; they are not problems.
const DEMOGRAPHIC = /^\s*(\d{1,3}\s*(?:y\/?o|yo|-year-old|year-old|years? old)?\s*(?:[mf]|male|female|man|woman)?\b)\s*(?:with|w\/|who has|presenting with|,)?\s*/i

const words = (text: string): string[] => text
  .toLowerCase()
  .replace(/s\/p|h\/o|r\/o/g, ' ')
  .split(/[^a-z0-9+-]+/)
  .filter(Boolean)

/** The item's words with abbreviations spelled out and synonyms folded. */
function expand(text: string): string[] {
  return words(text)
    .flatMap((word) => (ABBREVIATIONS[word] ? words(ABBREVIATIONS[word]) : [word]))
    .map((word) => SYNONYMS[word] ?? word)
}

const contentWords = (text: string) => expand(text).filter((word) => word.length >= 3 && !GENERIC.has(word) && !/^\d/.test(word))

/** "POAG" against "primary open-angle glaucoma": the letters are the initials
 *  of consecutive words. */
function acronymMatches(acronym: string, label: string): boolean {
  const initials = label.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map((word) => word[0]).join('')
  return acronym.length >= 2 && initials.includes(acronym.toLowerCase())
}

/** Headline items, without the age and sex that open it. */
export function headlineItems(headline: string): string[] {
  return headline
    .replace(DEMOGRAPHIC, '')
    .replace(/[.;]\s*$/, '')
    // Not on "with": "heart failure with reduced ejection fraction" is one item.
    .split(/\s*[,;]\s*|\s+and\s+/i)
    // ", and sinus bradycardia": the conjunction is not part of the item.
    .map((item) => item.trim().replace(/^(and|with|plus)\s+/i, ''))
    .filter((item) => item.length > 1)
}

export function reviewHeadline(
  headline: string,
  problemLabels: readonly string[],
  medicineNames: readonly string[],
): HeadlineReview | undefined {
  if (!headline.trim() || problemLabels.length === 0) return undefined
  const problemWords = new Set(problemLabels.flatMap(contentWords))
  // Five letters and up: "iron" is also a word in "iron deficiency anemia".
  const medicines = medicineNames.map((name) => name.trim().toLowerCase()).filter((name) => name.length >= 5)
  const review: HeadlineReview = { unlisted: [], medicines: [], values: [] }
  for (const item of headlineItems(headline)) {
    const lower = item.toLowerCase()
    if (UNIT.test(item) || LAB_VALUE.test(item)) { review.values.push(item); continue }
    if (/^on\s/i.test(item) || medicines.some((name) => new RegExp(`(^|[^a-z])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(lower))) {
      review.medicines.push(item)
      continue
    }
    const content = contentWords(item)
    if (content.length === 0) continue
    const named = content.some((word) => problemWords.has(word))
    const acronyms = item.match(/\b[A-Z][A-Z0-9]{1,5}\b/g) ?? []
    const byAcronym = acronyms.some((acronym) => problemLabels.some((label) => acronymMatches(acronym, label)))
    if (!named && !byAcronym) review.unlisted.push(item)
  }
  return review.unlisted.length || review.medicines.length || review.values.length ? review : undefined
}
