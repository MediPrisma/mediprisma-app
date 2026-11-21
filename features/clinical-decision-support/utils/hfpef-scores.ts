import type { CalcResult as ScoreExplanationResult } from '@/features/medical-calculator/types'
/**
 * The HFA-PEFF and H₂FPEF scores, computed once by the host's own calculator
 * and handed to the pack as facts.
 *
 * Both scores used to be computed twice: once by the medical calculator, from
 * the echo report it parses, and once by the pack, from the handful of echo
 * facts the FHIR adapter had scanned. Two implementations of one published
 * score is one too many — they read different inputs, rounded differently, and
 * a clinician reading 「HFA-PEFF 3」 on one screen and 「4」 on the other has no
 * way to tell which is the guideline's. So the calculator is the only one that
 * scores, and what it scored travels as `facts.hfaPeffScore` and
 * `facts.h2fpefScore` for the pack to read and display.
 *
 * Nothing here is a clinical rule either. Every threshold, domain and point is
 * `features/medical-calculator`'s, which is the published definition with its
 * own citation and its own tests; this file resolves the inputs, records where
 * each came from, and states what was missing — because a score built on nine
 * of eleven parameters is a floor, and a card that printed it as a total would
 * talk a clinician out of a diagnosis the missing two might have supported.
 *
 * A value the clinician typed outranks one read off a report, and only the
 * typed ones become facts of their own: the record's own echo values are
 * already in the profile, and writing them back would state the same
 * measurement twice with two provenances.
 */
import { HFPEF } from '@/features/medical-calculator/calculators/hfpef'
import { resolveInput } from '@/features/medical-calculator/autofill-compute'
import type { Autofill } from '@/features/medical-calculator/hooks/use-lab-autofill.hook'
import type { CalcInput, CalcResult, CalcValues, CalculatorDef } from '@/features/medical-calculator/types'
import type { CdssFact, CdssFactSource, CdssPatientProfile } from '../types'
import { CLINIC_ENTRY_PATTERN } from './apply-clinic-vitals'
import type { HfpefInputs } from '../stores/hfpef-inputs.store'

/**
 * The version a card cites beside the score.
 *
 * The calculator definitions carry a citation but no version of their own, so
 * the host names one: it is what 「依計算機 v1」 on the card refers to, and what
 * the `calculator:` token in each fact carries, so a pack reading the fact can
 * say which implementation produced the number. Raise it when a threshold or a
 * point changes in `features/medical-calculator/calculators/hfpef.ts`.
 */
export const HFPEF_CALCULATOR_VERSION = 'v1'

export type HfpefScoreId = 'hfa-peff' | 'h2fpef'
export type HfpefSection = 'functional' | 'morphological' | 'biomarker' | 'clinical'

/** Where a resolved value came from. */
export type HfpefInputOrigin = 'physician' | 'autofill' | 'none'

interface InputMeta {
  /** The §1.3 fact key this input is published under, where it has one. */
  factKey?: string
  /** The id used in `missing:<token>`; the fact key without its `echo` prefix. */
  token: string
  section: HfpefSection
  zh: string
  en: string
  /** True for the echo numbers this dialog exists to complete. */
  editable?: boolean
  /** Other calculator keys the same measurement fills. */
  alsoFills?: readonly string[]
}

/**
 * What each calculator input is, in one table.
 *
 * The tokens are the contract with the pack: `missing:gls`, `missing:nt-probnp`
 * and the rest are read from here, so a key renamed in the calculator must be
 * renamed here rather than silently dropping a token.
 */
const INPUT_META: Readonly<Record<string, InputMeta>> = {
  averageEe: { factKey: 'echoEOverEPrime', token: 'e-over-e-prime', section: 'functional', zh: 'E/e′（平均）', en: 'Average E/e′', editable: true, alsoFills: ['ee'] },
  ee: { factKey: 'echoEOverEPrime', token: 'e-over-e-prime', section: 'functional', zh: 'E/e′', en: 'E/e′' },
  e: { token: 'mitral-e', section: 'functional', zh: '二尖瓣 E 波速度', en: 'Mitral E velocity', editable: true },
  septalE: { factKey: 'echoSeptalEPrime', token: 'septal-e-prime', section: 'functional', zh: 'septal e′', en: 'Septal e′', editable: true },
  lateralE: { factKey: 'echoLateralEPrime', token: 'lateral-e-prime', section: 'functional', zh: 'lateral e′', en: 'Lateral e′', editable: true },
  trv: { factKey: 'echoTrVmax', token: 'tr-vmax', section: 'functional', zh: 'TR velocity', en: 'TR peak velocity', editable: true },
  pasp: { factKey: 'echoRvsp', token: 'rvsp', section: 'functional', zh: 'PASP／RVSP', en: 'PASP / RVSP', editable: true },
  gls: { factKey: 'echoGls', token: 'gls', section: 'functional', zh: 'GLS', en: 'GLS', editable: true },
  lavi: { factKey: 'echoLavi', token: 'lavi', section: 'morphological', zh: 'LAVI', en: 'LAVI', editable: true },
  lvmi: { factKey: 'echoLvmi', token: 'lvmi', section: 'morphological', zh: 'LVMI', en: 'LVMI', editable: true },
  rwt: { factKey: 'echoRwt', token: 'rwt', section: 'morphological', zh: 'RWT', en: 'RWT', editable: true },
  wall: { factKey: 'echoLvWallThickness', token: 'lv-wall-thickness', section: 'morphological', zh: 'LV 壁厚（IVSd／LVPWd）', en: 'LV wall thickness', editable: true },
  ntprobnp: { factKey: 'NTproBNP', token: 'nt-probnp', section: 'biomarker', zh: 'NT-proBNP', en: 'NT-proBNP' },
  bnp: { token: 'bnp', section: 'biomarker', zh: 'BNP', en: 'BNP' },
  rhythm: { factKey: 'physicianRhythm', token: 'rhythm', section: 'biomarker', zh: '心律', en: 'Rhythm' },
  bmi: { factKey: 'bodyMassIndex', token: 'bmi', section: 'clinical', zh: 'BMI', en: 'BMI' },
  age: { token: 'age', section: 'clinical', zh: '年齡', en: 'Age' },
  sex: { token: 'sex', section: 'clinical', zh: '性別', en: 'Sex' },
  af: { token: 'af', section: 'clinical', zh: '陣發性或持續性心房顫動', en: 'Paroxysmal or persistent AF' },
  antihypertensives: { token: 'antihypertensives', section: 'clinical', zh: '使用 ≥2 種降血壓藥', en: '≥2 antihypertensives' },
}

/** The term each rhythm is written as on `physicianRhythm`. */
export const RHYTHM_TERMS: Readonly<Record<string, string>> = {
  sr: 'sinus',
  af: 'atrial-fibrillation',
}

/** The six H₂FPEF items, in the order the calculator lists them. */
const H2FPEF_ITEMS: readonly { token: string; max: number; zh: string; en: string }[] = [
  { token: 'bmi', max: 2, zh: 'BMI >30', en: 'BMI >30' },
  { token: 'antihypertensives', max: 1, zh: '≥2 種降血壓藥', en: '≥2 antihypertensives' },
  { token: 'af', max: 3, zh: '心房顫動', en: 'Atrial fibrillation' },
  { token: 'pasp', max: 1, zh: 'PASP >35 mmHg', en: 'PASP >35 mmHg' },
  { token: 'age', max: 1, zh: '年齡 >60', en: 'Age >60' },
  { token: 'e-over-e-prime', max: 1, zh: 'E/e′ >9', en: 'E/e′ >9' },
]

export interface HfpefInputReading {
  /** The calculator's own input key. */
  key: string
  section: HfpefSection
  zh: string
  en: string
  unit?: string
  token: string
  factKey?: string
  editable: boolean
  /** The value handed to `compute`, as the calculator's own string. */
  value?: string
  numericValue?: number
  origin: HfpefInputOrigin
  /** The day the value was measured, as YYYY-MM-DD. */
  date?: string
  /** 「心超 2026-07-14」, 「EKG 2026-05-25」, 「你輸入 2026-09-12」. */
  sourceZh?: string
  sourceEn?: string
  /** Provenance of an auto-filled value, where the chart carried one. */
  source?: CdssFactSource
  /** The profile already states this value: no host fact is written for it. */
  inRecord: boolean
}

export interface HfpefScoreReading {
  scoreRanges?: ScoreExplanationResult['scoreRanges']
  notes?: ScoreExplanationResult['notes']
  id: HfpefScoreId
  name: string
  score: number
  /** What the score could still reach if every missing input supported it. */
  upper: number
  maximum: number
  bandZh: string
  bandEn: string
  /** The domains or items, as the calculator wrote them. */
  components: readonly { zh: string; en: string; detail: string }[]
  /** The `missing:<token>` ids, for the fact and for 「報告未提供」. */
  missing: readonly string[]
  missingZh: readonly string[]
  missingEn: readonly string[]
  /** The most recent measurement day among the inputs used. */
  date?: string
  matchedTerms: readonly string[]
}

export interface HfpefReading {
  inputs: readonly HfpefInputReading[]
  hfaPeff?: HfpefScoreReading
  h2fpef?: HfpefScoreReading
}

const HFA_PEFF: CalculatorDef = HFPEF.find((calc) => calc.id === 'hfa-peff')!
const H2FPEF: CalculatorDef = HFPEF.find((calc) => calc.id === 'h2fpef')!

function unitOf(input: CalcInput): string | undefined {
  return input.type === 'number' && input.unit ? input.unit : undefined
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function numberFrom(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

/** 「心超 2026-07-14」 — the kind of report a value came off, and its day. */
function sourceLabels(
  input: CalcInput,
  date: string | undefined,
): { zh?: string; en?: string } {
  if (!date) return {}
  const day = date.slice(0, 10)
  const kind = input.source?.kind
  if (kind === 'echo') return { zh: `心超 ${day}`, en: `Echo ${day}` }
  if (kind === 'hfpefClinical') return { zh: `紀錄 ${day}`, en: `Record ${day}` }
  if (kind === 'natriuretic') return { zh: `檢驗 ${day}`, en: `Lab ${day}` }
  return { zh: day, en: day }
}

/**
 * One input, resolved: what the clinician typed, else what the report said,
 * else what the profile already holds.
 *
 * The profile is the last resort rather than the first because it is the one
 * source with no measurement provenance to show — the adapter's own scan of
 * the same report — and a value with a date and a report name behind it is
 * worth more on screen than the same number with neither.
 */
function readInput(
  input: CalcInput,
  autofill: Autofill,
  overrides: HfpefInputs | undefined,
  profile: CdssPatientProfile,
): HfpefInputReading {
  const meta = INPUT_META[input.key]
  const base: HfpefInputReading = {
    key: input.key,
    section: meta?.section ?? 'clinical',
    zh: meta?.zh ?? input.label.zh,
    en: meta?.en ?? input.label.en,
    ...(unitOf(input) ? { unit: unitOf(input) } : {}),
    token: meta?.token ?? input.key,
    ...(meta?.factKey ? { factKey: meta.factKey } : {}),
    editable: true,
    origin: 'none',
    inRecord: false,
  }

  const override = overrides?.entries?.[input.key]
  if (override?.value?.trim()) {
    const numeric = numberFrom(override.value)
    return {
      ...base,
      value: override.value,
      ...(numeric === undefined ? {} : { numericValue: numeric }),
      origin: 'physician',
      ...(override.measuredOn ? { date: override.measuredOn } : {}),
      zh: base.zh,
      sourceZh: `你輸入 ${override.measuredOn ?? ''}`.trim(),
      sourceEn: `Entered by you ${override.measuredOn ?? ''}`.trim(),
      inRecord: false,
    }
  }

  const clinicFact = meta?.factKey ? profile.facts[meta.factKey] : undefined
  if (clinicFact && CLINIC_ENTRY_PATTERN.test(clinicFact.zh) && isFiniteNumber(clinicFact.numericValue) && input.type === 'number') {
    return { ...base, value: String(clinicFact.numericValue), numericValue: clinicFact.numericValue,
      origin: 'physician', date: clinicFact.date?.slice(0, 10), inRecord: true,
      sourceZh: `你輸入 ${clinicFact.date ?? ''}`.trim(), sourceEn: `Entered by you ${clinicFact.date ?? ''}`.trim() }
  }
  const hit = resolveInput(input, autofill)
  if (hit.filled && hit.value.trim()) {
    const numeric = numberFrom(hit.value)
    const labels = sourceLabels(input, hit.date)
    const fact = meta?.factKey ? profile.facts[meta.factKey] : undefined
    return {
      ...base,
      value: hit.value,
      ...(numeric === undefined ? {} : { numericValue: numeric }),
      origin: 'autofill',
      ...(hit.date ? { date: hit.date.slice(0, 10) } : {}),
      ...(labels.zh ? { sourceZh: labels.zh } : {}),
      ...(labels.en ? { sourceEn: labels.en } : {}),
      ...(hit.source?.obsId && hit.source.resourceType
        ? {
          source: {
            resourceType: hit.source.resourceType,
            resourceId: hit.source.obsId,
            ...(hit.date ? { date: hit.date.slice(0, 10) } : {}),
            ...(numeric === undefined ? {} : { value: numeric }),
            ...(unitOf(input) ? { unit: unitOf(input) } : {}),
            ...(hit.source.facility ? { facility: hit.source.facility } : {}),
          } as CdssFactSource,
        }
        : {}),
      // The adapter scanned the same report. Where it published a value for
      // this key, that value stands: the two scanners read the same study and
      // can round or prefer differently, and the host replacing the record's
      // own number with a second reading of it — labelled 「自動帶入」 either
      // way — would change what criterion (iii) reads with nobody deciding to.
      // A number the clinician types is the one case that does outrank it.
      inRecord: Boolean(fact),
    }
  }

  // Nothing in the report, but the adapter put the measurement on the profile.
  const fact = meta?.factKey ? profile.facts[meta.factKey] : undefined
  if (fact && isFiniteNumber(fact.numericValue) && input.type === 'number') {
    const entered = CLINIC_ENTRY_PATTERN.test(fact.zh)
    return {
      ...base,
      value: String(fact.numericValue),
      numericValue: fact.numericValue,
      origin: entered ? 'physician' : 'autofill',
      ...(fact.date ? { date: fact.date.slice(0, 10) } : {}),
      sourceZh: entered
        ? `你輸入 ${fact.date ?? ''}`.trim()
        : `紀錄 ${fact.date ?? ''}`.trim(),
      sourceEn: entered
        ? `Entered by you ${fact.date ?? ''}`.trim()
        : `Record ${fact.date ?? ''}`.trim(),
      inRecord: true,
    }
  }

  return base
}

function parseDomain(value: string): { score: number; upper: number } | undefined {
  const match = /^(\d+)(?:–(\d+))?\s*\/\s*2$/.exec(value.trim())
  if (!match) return undefined
  const score = Number(match[1])
  return { score, upper: match[2] ? Number(match[2]) : score }
}

const DOMAIN_TOKENS: readonly string[] = ['functional', 'morphological', 'biomarker']

/** The measurement days of the inputs a score actually used. */
function latestDate(inputs: readonly HfpefInputReading[]): string | undefined {
  return inputs
    .map((item) => item.date)
    .filter((date): date is string => Boolean(date))
    .sort()
    .at(-1)
}

function hfaPeffReading(
  result: CalcResult,
  used: readonly HfpefInputReading[],
): HfpefScoreReading | undefined {
  const domains = (result.extra ?? []).slice(0, 3).map((row) => parseDomain(row.value))
  if (domains.length !== 3 || domains.some((domain) => !domain)) return undefined
  const parsed = domains as { score: number; upper: number }[]
  const score = parsed.reduce((sum, domain) => sum + domain.score, 0)
  const upper = parsed.reduce((sum, domain) => sum + domain.upper, 0)
  // 「報告未提供」 is the list of parameters the calculator had no value for.
  // Age, sex and the rhythm are not report parameters, BNP is the alternative
  // assay rather than a second missing one, and a mitral E is only asked for to
  // derive an average E/e′ the report may have printed outright. Height,
  // weight, LA volume and LV mass only derive LAVI and LVMI, which stay listed.
  const skip = new Set(['sex', 'age', 'rhythm', 'bnp', 'height', 'weight', 'laVolume', 'lvMass'])
  if (used.find((item) => item.key === 'averageEe')?.value !== undefined) skip.add('e')
  const missingInputs = used.filter((item) => (
    item.value === undefined && !skip.has(item.key)
  ))
  return {
    id: 'hfa-peff',
    name: 'HFA-PEFF',
    score,
    upper,
    maximum: 6,
    scoreRanges: result.scoreRanges,
    notes: result.notes,
    bandZh: result.interpretation?.zh ?? '',
    bandEn: result.interpretation?.en ?? '',
    components: (result.extra ?? []).slice(0, 3).map((row, index) => ({
      zh: row.label.zh,
      en: row.label.en,
      detail: (result.extra ?? [])[index].value,
    })),
    missing: missingInputs.map((item) => item.token),
    missingZh: missingInputs.map((item) => item.zh),
    missingEn: missingInputs.map((item) => item.en),
    ...(latestDate(used.filter((item) => item.value !== undefined))
      ? { date: latestDate(used.filter((item) => item.value !== undefined)) }
      : {}),
    matchedTerms: [
      ...parsed.map((domain, index) => `${DOMAIN_TOKENS[index]}:${domain.score}`),
      `upper:${upper}`,
      ...missingInputs.map((item) => `missing:${item.token}`),
      `calculator:hfa-peff@${HFPEF_CALCULATOR_VERSION}`,
    ],
  }
}

function h2fpefReading(
  result: CalcResult,
  used: readonly HfpefInputReading[],
): HfpefScoreReading | undefined {
  const rows = (result.extra ?? []).slice(-H2FPEF_ITEMS.length)
  if (rows.length !== H2FPEF_ITEMS.length) return undefined
  const items = H2FPEF_ITEMS.map((item, index) => {
    const raw = rows[index].value.trim()
    const points = /^\d+$/.test(raw) ? Number(raw) : undefined
    return { ...item, points }
  })
  const score = items.reduce((sum, item) => sum + (item.points ?? 0), 0)
  const missing = items.filter((item) => item.points === undefined)
  const upper = score + missing.reduce((sum, item) => sum + item.max, 0)
  return {
    id: 'h2fpef',
    name: 'H₂FPEF',
    score,
    upper,
    maximum: 9,
    scoreRanges: result.scoreRanges,
    notes: result.notes,
    bandZh: result.interpretation?.zh ?? '',
    bandEn: result.interpretation?.en ?? '',
    components: items.map((item) => ({
      zh: item.zh,
      en: item.en,
      detail: item.points === undefined ? '—' : `${item.points} / ${item.max}`,
    })),
    missing: missing.map((item) => item.token),
    missingZh: missing.map((item) => item.zh),
    missingEn: missing.map((item) => item.en),
    ...(latestDate(used.filter((item) => item.value !== undefined))
      ? { date: latestDate(used.filter((item) => item.value !== undefined)) }
      : {}),
    matchedTerms: [
      ...items.map((item) => `item:${item.token}:${item.points ?? 0}`),
      `upper:${upper}`,
      ...missing.map((item) => `missing:${item.token}`),
      `calculator:h2fpef@${HFPEF_CALCULATOR_VERSION}`,
    ],
  }
}

export interface HfpefReadingInput {
  profile: CdssPatientProfile
  autofill: Autofill
  inputs?: HfpefInputs
}

/**
 * Both scores, and every input behind them.
 *
 * A score is absent rather than zero when the calculator declines to compute:
 * HFA-PEFF needs an age, a sex and a rhythm before any domain means anything,
 * and 「0 / 6」 printed for a patient whose echo nobody has read would be a
 * reading of the record rather than of the patient.
 */
export function buildHfpefReading(input: HfpefReadingInput): HfpefReading {
  const { profile, autofill, inputs } = input
  const readings = new Map<string, HfpefInputReading>()
  const readFor = (def: CalculatorDef): { values: CalcValues; used: HfpefInputReading[] } => {
    const values: CalcValues = {}
    const used: HfpefInputReading[] = []
    for (const field of def.inputs) {
      const existing = readings.get(field.key)
      const reading = existing ?? readInput(field, autofill, inputs, profile)
      if (!existing) readings.set(field.key, reading)
      values[field.key] = reading.value ?? ''
      used.push(reading)
    }
    return { values, used }
  }

  // One measurement can fill two keys: the average E/e′ the clinician typed is
  // the same ratio H₂FPEF reads, and asking for it twice would invite two
  // different numbers for one echo.
  const withAliases = (values: CalcValues): CalcValues => {
    const next = { ...values }
    for (const [key, meta] of Object.entries(INPUT_META)) {
      const reading = readings.get(key)
      if (!reading?.value || !meta.alsoFills) continue
      for (const alias of meta.alsoFills) {
        if (alias in next && !next[alias]?.trim()) next[alias] = reading.value
      }
    }
    return next
  }

  const hfa = readFor(HFA_PEFF)
  const h2 = readFor(H2FPEF)
  const hfaResult = HFA_PEFF.compute(withAliases(hfa.values))
  const h2Result = H2FPEF.compute(withAliases(h2.values))

  return {
    inputs: [...readings.values()],
    ...(hfaResult ? { hfaPeff: hfaPeffReading(hfaResult, hfa.used) } : {}),
    ...(h2Result ? { h2fpef: h2fpefReading(h2Result, h2.used) } : {}),
  }
}

/* ------------------------------------------------------------------ facts */

function noteZh(reading: HfpefInputReading): string {
  const where = reading.origin === 'physician'
    ? `${reading.date ?? ''} 你輸入`.trim()
    : `${reading.sourceZh ?? ''} 自動帶入`.trim()
  return where ? `（${where}）` : ''
}

function noteEn(reading: HfpefInputReading): string {
  const where = reading.origin === 'physician'
    ? `${reading.date ?? ''}, entered by you`.trim()
    : `${reading.sourceEn ?? ''}, auto-filled`.trim()
  return where ? ` (${where})` : ''
}

function factSource(reading: HfpefInputReading): CdssFactSource {
  if (reading.source) {
    return { ...reading.source, sourceSystem: '自動帶入' }
  }
  return {
    // A measurement the clinician read off a report and typed in the room is a
    // statement about the patient, not a resource in the chart.
    resourceType: 'Patient',
    resourceId: `hfpef-input:${reading.key}`,
    ...(reading.date ? { date: reading.date } : {}),
    ...(reading.numericValue === undefined ? {} : { value: reading.numericValue }),
    ...(reading.unit ? { unit: reading.unit } : {}),
    sourceSystem: reading.origin === 'physician' ? '你輸入' : '自動帶入',
  }
}

function scoreFact(
  score: HfpefScoreReading,
  inputs: readonly HfpefInputReading[],
): CdssFact {
  const components = score.components
  const zhParts = components.map((part) => `${part.zh} ${part.detail}`).join(' · ')
  const enParts = components.map((part) => `${part.en} ${part.detail}`).join(', ')
  const sources = inputs
    .filter((item) => item.value !== undefined)
    .map(factSource)
  return {
    zh: `${score.name} ${score.score}／${score.maximum}（${zhParts}）`,
    en: `${score.name} ${score.score}/${score.maximum} (${enParts})`,
    numericValue: score.score,
    unit: 'points',
    ...(score.date ? { date: score.date } : {}),
    textEvidence: {
      // Neither for nor against: the score is a reading the pack presents, and
      // which band supports a diagnosis is the pack's to say.
      direction: 'unknown',
      matchedTerms: score.matchedTerms,
    },
    ...(sources.length > 0 ? { sources } : {}),
  }
}

/**
 * The facts the calculator produces: the two scores, and the measurements
 * behind them that the profile does not already carry.
 *
 * Nothing is written for a patient whose ejection fraction is known to be
 * below 50%: HFA-PEFF and H₂FPEF are read for a preserved ejection fraction,
 * and a score printed on an HFrEF chart answers a question nobody asked.
 */
export function applyHfpefReading(
  profile: CdssPatientProfile,
  reading: HfpefReading | undefined,
): CdssPatientProfile {
  if (!reading) return profile
  const lvef = profile.facts.LVEF?.numericValue
  if (isFiniteNumber(lvef) && lvef < 50) return profile

  const facts: Record<string, CdssFact> = {}

  for (const input of reading.inputs) {
    if (!input.factKey || input.value === undefined) continue
    // An auto-filled value the profile already states is the same measurement
    // read twice; the record's own fact keeps its provenance.
    if (input.origin !== 'physician' && input.inRecord) continue
    if (input.key === 'rhythm') {
      const term = RHYTHM_TERMS[input.value]
      if (!term) continue
      facts.physicianRhythm = {
        zh: `${input.value === 'af' ? '心房顫動' : '竇性心律'}${noteZh(input)}`,
        en: `${input.value === 'af' ? 'Atrial fibrillation' : 'Sinus rhythm'}${noteEn(input)}`,
        ...(input.date ? { date: input.date } : {}),
        textEvidence: { direction: 'supports', matchedTerms: [term] },
        sources: [factSource(input)],
      }
      continue
    }
    if (input.numericValue === undefined) continue
    // `ee` and `averageEe` are the same ratio; the averaged one is the reading
    // HFA-PEFF is written for, so it wins where both resolved.
    if (input.key === 'ee' && facts[input.factKey]) continue
    facts[input.factKey] = {
      zh: `${input.numericValue}${input.unit ? ` ${input.unit}` : ''}${noteZh(input)}`,
      en: `${input.numericValue}${input.unit ? ` ${input.unit}` : ''}${noteEn(input)}`,
      numericValue: input.numericValue,
      ...(input.unit ? { unit: input.unit } : {}),
      ...(input.date ? { date: input.date } : {}),
      sources: [factSource(input)],
    }
  }

  if (reading.hfaPeff) facts.hfaPeffScore = scoreFact(reading.hfaPeff, reading.inputs)
  if (reading.h2fpef) facts.h2fpefScore = scoreFact(reading.h2fpef, reading.inputs)

  if (Object.keys(facts).length === 0) return profile
  return { ...profile, facts: { ...profile.facts, ...facts } }
}
