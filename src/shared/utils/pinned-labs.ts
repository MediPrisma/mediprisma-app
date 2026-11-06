// 自訂檢驗 — the analytes a clinician pins for every patient, and how each
// one's latest result is read.
//
// Two separate questions live here, and they must never be answered by each
// other:
//  * Can the app recognise this analyte? — the catalog below. It is exactly the
//    canonical keys the lab taxonomy already places in a panel (LOINC first,
//    tested name aliases second). Anything outside it is "not supported yet";
//    the app does not build a match rule from free text the user typed.
//  * Does THIS patient have a result? — resolvePinnedLab. "No result in the
//    loaded data" is not "never tested", and it is not "unsupported".
//
// A pin is category-scoped (`chem:CREA`, not `CREA`): creatinine and WBC also
// exist as urine analytes, and a bare key would pull those in.

import { CANONICAL_DISPLAY, CANONICAL_KEYS } from '@voho0000/clinical-lab-normalization/canonical'
import {
  CANONICAL_TO_LAY_EN,
  CANONICAL_TO_LAY_ZH,
  getAnalyteDisplayLabel,
} from '@voho0000/clinical-lab-normalization/display'
import { categorizeObservation, LAB_CATEGORIES } from './lab-categories'
import {
  DIFFERENTIAL_COUNT_LABELS,
  getLabCompatibilityCanonicalDisplay,
  labKeyInCategory,
  primaryCellRecord,
  recordDisplayValue,
  resolveLabTextKey,
  type LabCell,
  type LabPivot,
} from './lab-pivot.utils'

export const PINNED_LAB_REMINDER_PREFIX = 'note:'

export interface PinnableLab {
  /** `${categoryId}:${testKey}` — the stored identity of a pin. */
  id: string
  categoryId: string
  testKey: string
  /** Short clinical label (CREA, HbA1c, NT-proBNP) — also the default 名稱
   *  a copy format prints. */
  short: string
  /** Long-form name in each language, when the shared vocabulary has one. */
  nameZh?: string
  nameEn?: string
  /** Lower-cased search haystack: key, labels and the category's own name
   *  aliases that resolve to this key. */
  haystack: string
}

export function pinnedLabId(categoryId: string, testKey: string): string {
  return `${categoryId}:${testKey}`
}

export function parsePinnedLabId(id: string): { categoryId: string; testKey: string } | null {
  if (id.startsWith(PINNED_LAB_REMINDER_PREFIX)) return null
  const at = id.indexOf(':')
  if (at <= 0 || at === id.length - 1) return null
  return { categoryId: id.slice(0, at), testKey: id.slice(at + 1) }
}

export function isPinnedLabReminder(id: string): boolean {
  return id.startsWith(PINNED_LAB_REMINDER_PREFIX) && id.length > PINNED_LAB_REMINDER_PREFIX.length
}

export function pinnedLabReminderLabel(id: string): string {
  return id.slice(PINNED_LAB_REMINDER_PREFIX.length)
}

export function makePinnedLabReminder(label: string): string {
  return `${PINNED_LAB_REMINDER_PREFIX}${label.trim()}`
}

/**
 * Names for analytes the pivot produces but the shared vocabulary has no
 * label for. Without them the picker showed raw keys such as "LP(A)".
 */
const APP_ANALYTE_NAMES: Readonly<Record<string, { zh: string; en: string }>> = {
  'LP(A)': { zh: '脂蛋白(a)', en: 'Lipoprotein(a)' },
  'APO-B': { zh: '載脂蛋白 B', en: 'Apolipoprotein B' },
  'APO-A1': { zh: '載脂蛋白 A1', en: 'Apolipoprotein A1' },
  'NON-HDL': { zh: '非高密度脂蛋白膽固醇', en: 'Non-HDL cholesterol' },
  VLDL: { zh: '極低密度脂蛋白膽固醇', en: 'VLDL cholesterol' },
  'HS-TROPONIN I': { zh: '高敏感度心肌旋轉蛋白 I', en: 'High-sensitivity troponin I' },
  'HS-TROPONIN T': { zh: '高敏感度心肌旋轉蛋白 T', en: 'High-sensitivity troponin T' },
  AMMONIA: { zh: '血氨', en: 'Ammonia' },
  'WBC/HPF': { zh: '尿沉渣白血球', en: 'Urine WBC (sediment)' },
  'RBC/HPF': { zh: '尿沉渣紅血球', en: 'Urine RBC (sediment)' },
  EPITH: { zh: '尿沉渣上皮細胞', en: 'Urine epithelial cells' },
  CASTS: { zh: '尿沉渣圓柱體', en: 'Urine casts' },
  CRYSTAL: { zh: '尿沉渣結晶', en: 'Urine crystals' },
  BACTERIA: { zh: '尿沉渣細菌', en: 'Urine bacteria' },
  MUCUS: { zh: '尿沉渣黏液', en: 'Urine mucus' },
  'SQUAMOUS EPI': { zh: '尿沉渣扁平上皮細胞', en: 'Urine squamous epithelial cells' },
  'UROTHELIUM EPI': { zh: '尿沉渣移行上皮細胞', en: 'Urine urothelial cells' },
  'RTE-RENAL TUBE': { zh: '尿沉渣腎小管上皮細胞', en: 'Urine renal tubular epithelial cells' },
  'PROT/CR RATIO': { zh: '尿蛋白/肌酸酐比值', en: 'Urine protein/creatinine ratio' },
  'TC/HDL RATIO': { zh: '總膽固醇/HDL 比值', en: 'Total cholesterol/HDL ratio' },
  // Hormones and tumour markers the pivot carries under their source key.
  IPTH: { zh: '副甲狀腺素 (intact)', en: 'Intact parathyroid hormone' },
  PTH: { zh: '副甲狀腺素', en: 'Parathyroid hormone' },
  '25-OH-D': { zh: '25-羥基維生素 D', en: '25-hydroxyvitamin D' },
  ACTH: { zh: '促腎上腺皮質素', en: 'ACTH' },
  ALDOSTERONE: { zh: '醛固酮', en: 'Aldosterone' },
  RENIN: { zh: '腎素濃度', en: 'Renin concentration' },
  PRA: { zh: '血漿腎素活性', en: 'Plasma renin activity' },
  'DHEA-S': { zh: '硫酸脫氫表雄固酮', en: 'DHEA sulfate' },
  AMH: { zh: '抗穆勒氏管荷爾蒙', en: 'Anti-Müllerian hormone' },
  SHBG: { zh: '性荷爾蒙結合球蛋白', en: 'Sex hormone-binding globulin' },
  GH: { zh: '生長激素', en: 'Growth hormone' },
  'IGF-1': { zh: '類胰島素生長因子-1', en: 'IGF-1' },
  'ANTI-TPO': { zh: '甲狀腺過氧化酶抗體', en: 'Anti-TPO antibody' },
  'ANTI-TG': { zh: '甲狀腺球蛋白抗體', en: 'Anti-thyroglobulin antibody' },
  THYROGLOBULIN: { zh: '甲狀腺球蛋白', en: 'Thyroglobulin' },
  TRAB: { zh: '促甲狀腺素受體抗體', en: 'TSH receptor antibody' },
  CALCITONIN: { zh: '降鈣素', en: 'Calcitonin' },
  SCC: { zh: '鱗狀細胞癌抗原', en: 'SCC antigen' },
  'CA72-4': { zh: '醣蛋白 72-4 (CA 72-4)', en: 'CA 72-4' },
  'CYFRA21-1': { zh: '細胞角蛋白 19 片段', en: 'CYFRA 21-1' },
  NSE: { zh: '神經元特異性烯醇化酶', en: 'Neuron-specific enolase' },
  'PIVKA-II': { zh: '異常凝血酶原 (PIVKA-II)', en: 'PIVKA-II' },
  B2M: { zh: 'β2-微球蛋白', en: 'Beta-2 microglobulin' },
  // Differential absolute counts (ALC, AMC, …), kept apart from the percentages.
  ...Object.fromEntries(
    Object.entries(DIFFERENTIAL_COUNT_LABELS).map(([key, { zh, en }]) => [key, { zh, en }]),
  ),
}

/** Short labels where the key itself is not what a clinician writes. */
const APP_SHORT_LABELS: Readonly<Record<string, string>> = {
  AMMONIA: 'NH3',
  '25-OH-D': '25-OH Vit D',
}

/** Urinalysis shorthand as clinicians write it (urine panel only). */
const URINE_SHORT_LABELS: Readonly<Record<string, string>> = {
  COLOR: 'Color',
  TURBIDITY: 'Turbidity',
  GRAVIT: 'SG',
  PROT: 'PRO',
  KETONE: 'KET',
  UROBI: 'URO',
  NITRITE: 'NIT',
  LE: 'LEU',
  OCCULT: 'OB',
  EPITH: 'Epi',
  CRYSTAL: 'Crystal',
  BACTERIA: 'Bacteria',
  MUCUS: 'Mucus',
}

/**
 * The same key in the urine panel and a blood panel is a different test; the
 * shared label is the blood one ("Glucose 血糖"). A urine pin gets its own
 * name so a pinned list can never be read as the serum value.
 */
const URINE_NAMES: Readonly<Record<string, { short: string; zh: string; en: string }>> = {
  GLUCOSE: { short: 'Glucose(U)', zh: '尿糖', en: 'Urine glucose' },
  CREA: { short: 'CREA(U)', zh: '尿肌酸酐', en: 'Urine creatinine' },
  PH: { short: 'pH(U)', zh: '尿液酸鹼值', en: 'Urine pH' },
  ALB: { short: 'ALB(U)', zh: '尿白蛋白', en: 'Urine albumin' },
  BILI: { short: 'BIL(U)', zh: '尿膽紅素', en: 'Urine bilirubin' },
  WBC: { short: 'WBC(U)', zh: '尿中白血球', en: 'Urine WBC' },
  RBC: { short: 'RBC(U)', zh: '尿中紅血球', en: 'Urine RBC' },
}

/** Panels that hold values a clinician tracks. Cultures and the 其他 bucket
 *  are read as reports, not pinned numbers. */
const EXCLUDED_CATEGORIES = new Set(['microbio', 'other'])

/** A key the pivot produces that we can also NAME — canonical, app-labelled,
 *  or named by the shared vocabulary. A raw spelling with no name is not an
 *  option; it folds into the key it resolves to. */
function isNamedPivotKey(testKey: string): boolean {
  return CANONICAL_KEYS.has(testKey)
    || !!getLabCompatibilityCanonicalDisplay(testKey)
    || !!APP_ANALYTE_NAMES[testKey]
    || !!CANONICAL_TO_LAY_ZH[testKey]
    || !!CANONICAL_TO_LAY_EN[testKey]
}

function isRecognisedPivotKey(testKey: string): boolean {
  return CANONICAL_KEYS.has(testKey) || !!getLabCompatibilityCanonicalDisplay(testKey)
}

/**
 * Several panels list the same key for sorting (C-PEPTIDE under 血糖 and
 * 內分泌, CALCITONIN under 內分泌 and 癌症), but a result lands in exactly one
 * panel. Offer the key only where the pivot's own categoriser puts a result
 * carrying that name, so a pin can never point at a panel that stays empty.
 * The urine panel is routed by specimen (LOINC, qualitative results), not by
 * name, so its keys are always its own.
 */
function landsInCategory(testKey: string, categoryId: string): boolean {
  if (categoryId === 'urine') return true
  const listedIn = LAB_CATEGORIES.filter((category) => category.id !== 'urine' && (
    (category.preferredOrder ?? []).includes(testKey)
    || (category.subgroups ?? []).some((group) => group.members.includes(testKey))
  ))
  if (listedIn.length < 2) return true
  const landed = categorizeObservation({ resourceType: 'Observation', code: { text: testKey } })?.id
  return landed ? landed === categoryId : listedIn[0].id === categoryId
}

function shortLabel(categoryId: string, testKey: string): string {
  if (categoryId === 'urine' && URINE_NAMES[testKey]) return URINE_NAMES[testKey].short
  if (categoryId === 'urine' && URINE_SHORT_LABELS[testKey]) return URINE_SHORT_LABELS[testKey]
  return APP_SHORT_LABELS[testKey]
    ?? getLabCompatibilityCanonicalDisplay(testKey)
    ?? CANONICAL_DISPLAY[testKey]
    ?? (CANONICAL_KEYS.has(testKey) ? getAnalyteDisplayLabel(testKey, 'medical', 'en') : testKey)
}

function analyteNames(categoryId: string, testKey: string): { zh?: string; en?: string } {
  if (categoryId === 'urine' && URINE_NAMES[testKey]) {
    return { zh: URINE_NAMES[testKey].zh, en: URINE_NAMES[testKey].en }
  }
  return {
    zh: CANONICAL_TO_LAY_ZH[testKey] ?? APP_ANALYTE_NAMES[testKey]?.zh,
    en: CANONICAL_TO_LAY_EN[testKey] ?? APP_ANALYTE_NAMES[testKey]?.en,
  }
}

function canonicalOf(code: string, categoryId?: string): string | null {
  try {
    return labKeyInCategory(resolveLabTextKey(code), categoryId) ?? null
  } catch {
    return null
  }
}

/** Keys the taxonomy lists but real data never lands on. Bare EGFR resolves
 *  to EGFR(M) (see the chem pinnedColumns note in lab-categories), so a pin on
 *  it would sit empty forever beside the populated one. */
const NEVER_POPULATED = new Set(['chem:EGFR'])

let cachedCatalog: PinnableLab[] | null = null

/**
 * Every analyte the app can pin, in LAB_CATEGORIES order and each category's
 * preferred reading order.
 *
 * The category lists (preferredOrder, subgroup members) are SORT lists: they
 * also carry each hospital's spellings ("GRAVIT", "GRAVITY", "SP.GRAVITY") so
 * the cumulative report can order whatever arrives. Only keys the pivot
 * actually produces AND that have a human name become options; spellings are
 * folded into the search aliases of the key they resolve to.
 */
export function getPinnableLabCatalog(): PinnableLab[] {
  if (cachedCatalog) return cachedCatalog
  const out: PinnableLab[] = []
  const seen = new Set<string>()
  for (const category of LAB_CATEGORIES) {
    if (EXCLUDED_CATEGORIES.has(category.id)) continue
    const keys: string[] = []
    const push = (key: string) => {
      if (!keys.includes(key)) keys.push(key)
    }
    for (const key of category.preferredOrder ?? []) push(key)
    for (const key of category.pinnedColumns ?? []) push(key)
    for (const group of category.subgroups ?? []) for (const key of group.members) push(key)

    // A listed spelling that resolves to ANOTHER listed key is that key —
    // unless it is a recognised pivot key itself: the eGFR formulas and
    // Glu-AC are distinct columns even where their text resolves to a sibling.
    const named = keys.filter(isNamedPivotKey)
    const namedSet = new Set(named)
    const options = named.filter((key) => {
      if (isRecognisedPivotKey(key)) return true
      const target = canonicalOf(key, category.id)
      return !(target && target !== key && namedSet.has(target))
    }).filter((key) => landsInCategory(key, category.id))
    const optionSet = new Set(options)
    const aliasesByKey = new Map<string, string[]>()
    const addAlias = (target: string, alias: string) => {
      const list = aliasesByKey.get(target) ?? []
      list.push(alias)
      aliasesByKey.set(target, list)
    }
    for (const code of [...category.codes, ...keys]) {
      if (optionSet.has(code)) continue
      const canonical = canonicalOf(code, category.id)
      if (canonical && optionSet.has(canonical)) addAlias(canonical, code)
    }

    for (const key of options) {
      const id = pinnedLabId(category.id, key)
      if (seen.has(id) || NEVER_POPULATED.has(id)) continue
      const names = analyteNames(category.id, key)
      if (!names.zh && !names.en) continue
      seen.add(id)
      const short = shortLabel(category.id, key)
      const haystack = [key, short, names.zh, names.en, ...(aliasesByKey.get(key) ?? [])]
        .filter((part): part is string => typeof part === 'string' && part.length > 0)
        .join(' ')
        .normalize('NFKC')
        .toLowerCase()
      out.push({ id, categoryId: category.id, testKey: key, short, nameZh: names.zh, nameEn: names.en, haystack })
    }
  }
  cachedCatalog = out
  return out
}

export function findPinnableLab(id: string): PinnableLab | undefined {
  return getPinnableLabCatalog().find((entry) => entry.id === id)
}

function squash(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\s\-_.()（）/]+/g, '')
}

/** Catalog entries matching every whitespace-separated term of the query.
 *  Punctuation and spacing are ignored ("nt pro bnp" finds NT-proBNP). */
export function searchPinnableLabs(query: string, catalog = getPinnableLabCatalog()): PinnableLab[] {
  const terms = query.trim().split(/\s+/).map(squash).filter(Boolean)
  if (!terms.length) return []
  const joined = squash(query)
  return catalog.filter((entry) => {
    const hay = squash(entry.haystack)
    return hay.includes(joined) || terms.every((term) => hay.includes(term))
  })
}

// ---------------------------------------------------------------------------
// Resolving one pinned analyte for the current patient
// ---------------------------------------------------------------------------

export interface PinnedLabPoint {
  /** Collection day, "YYYY-MM-DD". */
  date: string
  /** The ONE record this point prints — its unit, comparator and flag are
   *  that record's own, never merged from another record of the same day. */
  cell: LabCell
  /** The value printed for this day: the first valid source record, with its
   *  comparator. When the day holds several, `sameDayCount` says so. */
  value: string
  /** Valid (not entered-in-error / cancelled) records on this day. */
  sameDayCount: number
}

export interface ResolvedPinnedLab {
  id: string
  latest?: PinnedLabPoint
  previous?: PinnedLabPoint
  /** Every usable collection day, newest first — copy formats that pin a
   *  line to one day look the value up here. */
  points: PinnedLabPoint[]
}

/**
 * The record one pinned value is read from, for one collection day — the
 * same record the overview cell shows (see primaryCellRecord): invalid
 * records dropped first, the value with its own unit, comparator and flag.
 */
function pickRecord(cell: LabCell): { cell: LabCell; value: string; count: number } | null {
  const primary = primaryCellRecord(cell)
  if (!primary) return null
  const { record, valid } = primary
  return {
    cell: {
      value: record.value,
      unit: record.unit,
      comparator: record.comparator,
      isAbnormal: record.isAbnormal,
      interpretationCode: record.interpretationCode,
      status: record.status,
      effectiveDateTime: cell.effectiveDateTime,
    },
    value: recordDisplayValue(record).trim(),
    count: valid.length,
  }
}

/**
 * Latest and previous result for one pin, from pivots built over ALL loaded
 * observations (not the overview's date window — a six-month-old NT-proBNP
 * is still the latest one, and it must show with its real date).
 */
export function resolvePinnedLab(pivots: Record<string, LabPivot>, id: string): ResolvedPinnedLab {
  const parsed = parsePinnedLabId(id)
  if (!parsed) return { id, points: [] }
  const pivot = pivots[parsed.categoryId]
  if (!pivot) return { id, points: [] }
  const byDay = new Map<string, PinnedLabPoint>()
  for (const row of pivot.rows) {
    if (row.testKey !== parsed.testKey) continue
    for (const [date, cell] of row.values) {
      const picked = pickRecord(cell)
      if (!picked) continue
      const existing = byDay.get(date)
      if (existing) {
        existing.sameDayCount += picked.count
        continue
      }
      byDay.set(date, { date, cell: picked.cell, value: picked.value, sameDayCount: picked.count })
    }
  }
  const points = [...byDay.values()].sort((a, b) => b.date.localeCompare(a.date))
  return { id, latest: points[0], previous: points[1], points }
}
