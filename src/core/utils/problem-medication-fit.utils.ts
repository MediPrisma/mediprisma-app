// Does a medicine's ATC class fit the problem row it sits on? Only for
// conditions whose treatment classes are narrow enough to judge; every other
// problem gets no opinion. A mismatch tags the medicine 待核對 on the row — it
// is never removed (owner, 2026-10-05). On 2026-10-05 VGHBrain runs a model
// copied whole dispensing batches onto a row: bladder antispasmodics under
// CKD and hypertension, donepezil and artificial tears under glaucoma.

interface FitRule {
  problem: RegExp
  /** ATC prefixes of the classes that treat it. */
  atc: readonly string[]
}

const FIT_RULES: readonly FitRule[] = [
  { problem: /glaucoma|ocular hypertension|青光眼|高眼壓/i, atc: ['S01E'] },
  { problem: /diabet|糖尿病/i, atc: ['A10'] },
  { problem: /hypothyroid|甲狀腺(功能|機能)?低下/i, atc: ['H03A'] },
  { problem: /hyperthyroid|graves|甲狀腺(功能|機能)?亢進/i, atc: ['H03B', 'C07'] },
  { problem: /gout|hyperuric|痛風|高尿酸/i, atc: ['M04'] },
  { problem: /(?<!(pulmonary|ocular|portal|intracranial) )hypertension|高血壓/i, atc: ['C02', 'C03', 'C07', 'C08', 'C09'] },
  { problem: /hyperlipid|dyslipid|cholesterol|高血脂|膽固醇/i, atc: ['C10'] },
  {
    problem: /prostatic hyperplasia|\bBPH\b|overactive bladder|lower urinary tract|攝護腺(肥大|增生)|前列腺增生|膀胱過動|下泌尿道症狀/i,
    atc: ['G04B', 'G04C'],
  },
  { problem: /dementia|cognitive|alzheimer|失智|認知/i, atc: ['N06D'] },
  { problem: /constipation|便祕|便秘/i, atc: ['A06'] },
  { problem: /osteopor|骨質疏鬆/i, atc: ['M05B', 'H05A', 'A12A', 'A11CC', 'G03XC'] },
  {
    problem: /reflux|GERD|peptic|ulcer|gastritis|dyspepsia|胃食道逆流|消化性潰瘍|胃潰瘍|十二指腸潰瘍|胃炎|消化不良/i,
    atc: ['A02', 'A03'],
  },
  { problem: /anemi|貧血/i, atc: ['B03'] },
  // A loop diuretic sat on a hypokalemia row as its treatment (2026-10-05);
  // it is a cause. Potassium and potassium-sparing agents treat it.
  { problem: /hypokal|低血鉀/i, atc: ['A12B', 'C03D', 'C03E'] },
]

// Classes with several established uses: a problem inferred from one of them
// alone is doubtful when another listed problem is one of those uses (a
// model listed diabetes from an SGLT2 inhibitor given for CKD, 2026-10-05).
// The table holds the common multi-indication classes, not one patient's.
const USE = {
  kidney: 'chronic kidney|\\bCKD\\b|kidney disease|nephropathy|proteinuria|慢性腎|腎臟病|腎病變|蛋白尿',
  heartFailure: 'heart failure|\\bHF(r|p|mr)?EF\\b|cardiomyopathy|心衰竭|心肌病',
  hypertension: '(?<!(pulmonary|ocular|portal|intracranial) )hypertension|\\bHTN\\b|高血壓',
  coronary: 'angina|coronary|myocardial infarction|\\bCAD\\b|心絞痛|冠狀動脈|心肌梗塞',
  arrhythmia: 'atrial fibrillation|atrial flutter|\\bAF\\b|tachycardia|arrhythmia|心房顫動|心律不整|心搏過速',
  edema: 'edema|ascites|cirrhosis|水腫|腹水|肝硬化',
  diabetes: 'diabet|糖尿病',
  obesity: 'obesity|overweight|肥胖',
  tremorMigraine: 'tremor|migraine|顫抖|偏頭痛',
}
const uses = (...names: Array<keyof typeof USE>) => new RegExp(names.map((name) => USE[name]).join('|'), 'i')

const OTHER_USES: ReadonlyArray<{ atc: string; uses: RegExp }> = [
  { atc: 'A10BK', uses: uses('diabetes', 'kidney', 'heartFailure') }, // SGLT2 inhibitors
  { atc: 'A10BJ', uses: uses('diabetes', 'obesity', 'coronary') }, // GLP-1 agonists
  { atc: 'C09', uses: uses('hypertension', 'heartFailure', 'kidney', 'coronary') }, // ACE inhibitors, ARBs, ARNI
  { atc: 'C07', uses: uses('hypertension', 'heartFailure', 'coronary', 'arrhythmia', 'tremorMigraine') }, // beta-blockers
  { atc: 'C08', uses: uses('hypertension', 'coronary', 'arrhythmia') }, // calcium-channel blockers
  { atc: 'C03C', uses: uses('heartFailure', 'edema', 'kidney', 'hypertension') }, // loop diuretics
  { atc: 'C03A', uses: uses('hypertension', 'edema', 'heartFailure') }, // thiazides
  { atc: 'C03DA', uses: uses('heartFailure', 'hypertension', 'edema') }, // mineralocorticoid antagonists
  { atc: 'C01AA', uses: uses('heartFailure', 'arrhythmia') }, // digitalis glycosides
]

/**
 * For a problem inferred from medicines alone: the other listed problem its
 * medicines are also given for, when every one of them is such a medicine.
 */
export function otherListedUse(
  atcCodes: readonly (string | undefined)[],
  otherProblemLabels: readonly string[],
): string | undefined {
  const codes = atcCodes.map((code) => code?.trim().toUpperCase() ?? '')
  if (codes.length === 0) return undefined
  const rules = codes.map((code) => OTHER_USES.find((rule) => code.startsWith(rule.atc)))
  if (rules.some((rule) => !rule)) return undefined
  return otherProblemLabels.find((label) => rules.every((rule) => rule!.uses.test(label)))
}

/**
 * true: the class treats the problem; false: it clearly does not; undefined:
 * the problem (or the medicine's class) is not one this can judge.
 */
export function medicationFitsProblem(problemLabel: string, atcCode: string | undefined): boolean | undefined {
  const atc = atcCode?.trim().toUpperCase()
  if (!atc) return undefined
  const rules = FIT_RULES.filter((rule) => rule.problem.test(problemLabel))
  if (rules.length === 0) return undefined
  return rules.some((rule) => rule.atc.some((prefix) => atc.startsWith(prefix)))
}
