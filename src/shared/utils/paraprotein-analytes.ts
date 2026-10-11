// 免疫 「電泳／輕鏈」 (paraprotein) subgroup: immunoelectrophoresis /
// immunofixation reports and immunoglobulin light chains (user decision
// 2026-10-11; research and GPT Astra review in
// immunology-iep-ife-flc-loinc-research-20261010.md).
//
// NHI orders, verified against the NHI fee schedule (醫療服務給付項目及支付標準,
// data.gov.tw 174450) and TW Core medical-service-payment-tw, 2026-10-10:
//   12103B 免疫電泳分析 — no specimen in its name; serum unless the row says
//          urine / CSF. Also the order serum IFE is billed under.
//   12157B 腦脊髓液免疫球蛋白免疫電泳 (CSF IEP)
//   12158B 尿液免疫球蛋白免疫電泳 (urine IEP)
//   12159B 尿液免疫固定電泳分析 (urine IFE)
//   12160B 免疫球蛋白κ/λ — neither free / total nor specimen in its name.
//   09065B 蛋白電泳分析 (SPEP) / 09100B 尿液蛋白電泳 (UPEP): only a row that
//          names the M-protein comes here. The protein fractions (albumin,
//          α1, α2, β, γ, A/G) are SPEP chemistry and stay where they were —
//          an M-protein is the one SPEP number that answers the paraprotein
//          question; moving the fractions would empty 生化 of a routine panel.
//   06010C 本周氏蛋白試驗 (Bence-Jones) stays in 尿液 (user decision).
//
// Every LOINC below was looked up on tx.fhir.org (LOINC 2.82) on 2026-10-11:
// all ACTIVE, names as quoted. The NHI–LOINC ConceptMap's 1759-0 (A/G ratio)
// and deprecated 40844-3 listed under 12160B are deliberately absent.
//
// Columns:
// - κ, λ, κ/λ ratio as FREE or TOTAL only when the row says so (free / FLC /
//   游離, total / 總) or its LOINC does; otherwise one neutral column per source
//   name, labelled with that name — never asserting free or total.
// - serum, urine (「尿」) and CSF never share a column.
// - M-protein amount.
// - one text column per report: serum IFE/IEP, urine IFE, urine IEP, CSF IEP.
//   Lane rows (IgG / IgA / IgM / κ / λ present or absent) fold into their
//   report's text column, never their own column — and never the
//   immunoglobulin columns.

import { isNhiOrderCodeSystem, nhiOrderCode } from '@/src/shared/utils/nhi-order-code'

export const PARAPROTEIN_PREFIX = 'PP:'

/** Orders whose every row is a paraprotein-subgroup row. */
export const PARAPROTEIN_NHI_ORDER_CODES = ['12103B', '12157B', '12158B', '12159B', '12160B']
/** SPEP / UPEP: only an explicitly named M-protein row. */
export const PROTEIN_ELECTROPHORESIS_NHI_ORDER_CODES = ['09065B', '09100B']

/** Verified LOINC → column. */
export const PARAPROTEIN_LOINC_TO_KEY: Readonly<Record<string, string>> = {
  // Serum / plasma free light chains
  '36916-5': 'PP:KAPPA-FREE',      // Kappa light chains.free [Mass/volume] in Serum
  '104544-2': 'PP:KAPPA-FREE',     // Kappa light chains.free [Mass/volume] in Serum or Plasma
  '80515-0': 'PP:KAPPA-FREE',      // Kappa light chains.free [Mass/volume] in Serum by Nephelometry
  '33944-0': 'PP:LAMBDA-FREE',     // Lambda light chains.free [Mass/volume] in Serum or Plasma
  '80516-8': 'PP:LAMBDA-FREE',     // Lambda light chains.free [Mass/volume] in Serum by Nephelometry
  '48378-4': 'PP:KL-RATIO-FREE',   // Kappa light chains.free/Lambda light chains.free [Mass Ratio] in Serum
  '104546-7': 'PP:KL-RATIO-FREE',  // … [Mass Ratio] in Serum or Plasma
  '80517-6': 'PP:KL-RATIO-FREE',   // … [Mass Ratio] in Serum by Nephelometry
  // Serum / plasma total light chains
  '11050-2': 'PP:KAPPA-TOTAL',     // Kappa light chains [Mass/volume] in Serum or Plasma
  '11051-0': 'PP:LAMBDA-TOTAL',    // Lambda light chains [Mass/volume] in Serum or Plasma
  '15189-4': 'PP:KL-RATIO-TOTAL',  // Kappa light chains/Lambda light chains [Mass Ratio] in Serum
  '6788-4': 'PP:KL-RATIO-TOTAL',   // … [Mass Ratio] in Serum by Immunoassay
  // Serum M-protein
  '33358-3': 'PP:M-PROTEIN',       // Protein.monoclonal [Mass/volume] in Serum or Plasma by Electrophoresis
  '104837-0': 'PP:M-PROTEIN',      // Protein.monoclonal [Mass/volume] in Serum or Plasma
  '51435-6': 'PP:M-PROTEIN',       // Protein.monoclonal band 1 [Mass/volume] in Serum or Plasma by Electrophoresis
  '99415-2': 'PP:M-PROTEIN',       // Protein.monoclonal band 1 [Mass/volume] in Serum or Plasma by Immunofixation
  // Serum IFE / IEP reports and their lanes → the serum text column
  '25700-6': 'PP:IFE',             // Immunofixation for Serum or Plasma
  '49275-1': 'PP:IFE',             // Immunofixation for Serum or Plasma Narrative
  '14895-7': 'PP:IFE',             // Protein Fractions [Interpretation] in Serum or Plasma by Immunofixation
  '49297-5': 'PP:IFE',             // … by Immunofixation Narrative
  '13169-8': 'PP:IFE',             // Immunoelectrophoresis for Serum or Plasma
  '49274-4': 'PP:IFE',             // Immunoelectrophoresis for Serum or Plasma Narrative
  '74665-1': 'PP:IFE',             // Monoclonal band observed [Identifier] in Serum or Plasma by Immunofixation
  '13348-8': 'PP:IFE',             // Monoclonal band observed [Identifier] in Serum or Plasma
  '94400-9': 'PP:IFE',             // Protein.monoclonal [Presence] in Serum or Plasma
  '44597-3': 'PP:IFE',             // IgG.monoclonal [Presence] in Serum by Immunofixation
  '44587-4': 'PP:IFE',             // IgA.monoclonal [Presence] in Serum by Immunofixation
  '44601-3': 'PP:IFE',             // IgM.monoclonal [Presence] in Serum by Immunofixation
  '55921-1': 'PP:IFE',             // IgG.monoclonal [Presence] in Serum by Immunoelectrophoresis
  '55901-3': 'PP:IFE',             // IgA.monoclonal [Presence] in Serum by Immunoelectrophoresis
  '55924-5': 'PP:IFE',             // IgM.monoclonal [Presence] in Serum by Immunoelectrophoresis
  '18301-2': 'PP:IFE',             // IgG [Presence] in Serum by Immunofixation
  '15184-5': 'PP:IFE',             // IgG [Presence] in Serum by Immunoelectrophoresis
  '40635-5': 'PP:IFE',             // Kappa light chains [Presence] in Serum by Immunofixation
  '40639-7': 'PP:IFE',             // Lambda light chains [Presence] in Serum by Immunofixation
  '25681-8': 'PP:IFE',             // Kappa light chains [Presence] in Serum by Immunoelectrophoresis
  '25683-4': 'PP:IFE',             // Lambda light chains [Presence] in Serum by Immunoelectrophoresis
  '44555-1': 'PP:IFE',             // Kappa light chains.free [Presence] in Serum by Immunofixation
  '50978-6': 'PP:IFE',             // Lambda light chains.free [Presence] in Serum by Immunofixation
  '55897-3': 'PP:IFE',             // Immunoglobulin light chains.free [Presence] in Serum by Immunoelectrophoresis
  // Urine light chains
  '38176-4': 'PP:U:KAPPA-FREE',    // Kappa light chains.free [Mass/volume] in Urine
  '38178-0': 'PP:U:LAMBDA-FREE',   // Lambda light chains.free [Mass/volume] in Urine
  '41759-2': 'PP:U:KL-RATIO-FREE', // Kappa light chains.free/Lambda light chains.free [Mass Ratio] in Urine
  '27365-6': 'PP:U:KAPPA-TOTAL',   // Kappa light chains [Mass/volume] in Urine
  '27394-6': 'PP:U:LAMBDA-TOTAL',  // Lambda light chains [Mass/volume] in Urine
  '33559-6': 'PP:U:KL-RATIO-TOTAL', // Kappa light chains/Lambda light chains [Mass Ratio] in Urine
  // Urine M-protein
  '87835-5': 'PP:U:M-PROTEIN',     // Protein.monoclonal [Mass/volume] in Urine by Immunofixation
  '40661-1': 'PP:U:M-PROTEIN',     // Protein.monoclonal [Mass/volume] in Urine by Electrophoresis
  '35560-2': 'PP:U:M-PROTEIN',     // Protein.monoclonal [Mass/volume] in Urine
  // Urine IFE report and lanes
  '14896-5': 'PP:U:IFE',           // Protein Fractions [Interpretation] in Urine by Immunofixation
  '49300-7': 'PP:U:IFE',           // … in Urine by Immunofixation Narrative
  '13440-3': 'PP:U:IFE',           // Immunofixation for Urine
  '49276-9': 'PP:U:IFE',           // Immunofixation for Urine Narrative
  '74666-9': 'PP:U:IFE',           // Monoclonal band observed [Identifier] in Urine by Immunofixation
  '44598-1': 'PP:U:IFE',           // IgG.monoclonal [Presence] in Urine by Immunofixation
  '44588-2': 'PP:U:IFE',           // IgA.monoclonal [Presence] in Urine by Immunofixation
  '44602-1': 'PP:U:IFE',           // IgM.monoclonal [Presence] in Urine by Immunofixation
  '40636-3': 'PP:U:IFE',           // Kappa light chains [Presence] in Urine by Immunofixation
  '40638-9': 'PP:U:IFE',           // Lambda light chains [Presence] in Urine by Immunofixation
  '44604-7': 'PP:U:IFE',           // Kappa light chains.free [Presence] in Urine by Immunofixation
  '56481-5': 'PP:U:IFE',           // Lambda light chains.free [Presence] in Urine by Immunofixation
  '55900-5': 'PP:U:IFE',           // Immunoglobulin light chains.free [Presence] in Urine by Immunofixation
  // Urine IEP report and lanes
  '34440-8': 'PP:U:IEP',           // Immunoelectrophoresis for Urine
  '49278-5': 'PP:U:IEP',           // Immunoelectrophoresis for Urine Narrative
  '25445-8': 'PP:U:IEP',           // IgG [Presence] in Urine by Immunoelectrophoresis
  '25444-1': 'PP:U:IEP',           // IgA [Presence] in Urine by Immunoelectrophoresis
  '25446-6': 'PP:U:IEP',           // IgM [Presence] in Urine by Immunoelectrophoresis
}

/** Fixed columns, in reading order: serum κ/λ (free, then total), M-protein,
 *  serum report; then urine, then CSF. Neutral source-name columns follow. */
export const PARAPROTEIN_COLUMN_ORDER = [
  'PP:KAPPA-FREE', 'PP:LAMBDA-FREE', 'PP:KL-RATIO-FREE',
  'PP:KAPPA-TOTAL', 'PP:LAMBDA-TOTAL', 'PP:KL-RATIO-TOTAL',
  'PP:M-PROTEIN', 'PP:IFE',
  'PP:U:KAPPA-FREE', 'PP:U:LAMBDA-FREE', 'PP:U:KL-RATIO-FREE',
  'PP:U:KAPPA-TOTAL', 'PP:U:LAMBDA-TOTAL', 'PP:U:KL-RATIO-TOTAL',
  'PP:U:M-PROTEIN', 'PP:U:IFE', 'PP:U:IEP',
  'PP:CSF:IEP',
]

/** The report (text) columns. */
export const PARAPROTEIN_TEXT_KEYS = new Set(['PP:IFE', 'PP:U:IFE', 'PP:U:IEP', 'PP:CSF:IEP'])

type Lang = 'zh-TW' | 'en'
const SPECIMEN_LABEL: Record<'S' | 'U' | 'CSF', Record<Lang, string>> = {
  S: { 'zh-TW': '', en: '' },
  U: { 'zh-TW': '尿 ', en: 'Urine ' },
  CSF: { 'zh-TW': 'CSF ', en: 'CSF ' },
}
const BASE_DISPLAY: Record<string, Record<Lang, string>> = {
  'KAPPA-FREE': { 'zh-TW': '游離 κ', en: 'Free κ' },
  'LAMBDA-FREE': { 'zh-TW': '游離 λ', en: 'Free λ' },
  'KL-RATIO-FREE': { 'zh-TW': '游離 κ/λ', en: 'Free κ/λ ratio' },
  'KAPPA-TOTAL': { 'zh-TW': '總 κ', en: 'Total κ' },
  'LAMBDA-TOTAL': { 'zh-TW': '總 λ', en: 'Total λ' },
  'KL-RATIO-TOTAL': { 'zh-TW': '總 κ/λ', en: 'Total κ/λ ratio' },
  'M-PROTEIN': { 'zh-TW': 'M 蛋白', en: 'M-protein' },
  IFE: { 'zh-TW': 'IFE', en: 'IFE' },
  IEP: { 'zh-TW': 'IEP', en: 'IEP' },
}

function splitKey(key: string): { specimen: 'S' | 'U' | 'CSF'; base: string } | null {
  if (!key.startsWith(PARAPROTEIN_PREFIX)) return null
  const rest = key.slice(PARAPROTEIN_PREFIX.length)
  if (rest.startsWith('U:')) return { specimen: 'U', base: rest.slice(2) }
  if (rest.startsWith('CSF:')) return { specimen: 'CSF', base: rest.slice(4) }
  return { specimen: 'S', base: rest }
}

/** Column header of a fixed paraprotein column, or undefined (neutral source
 *  -name columns keep their source name). */
export function paraproteinDisplay(key: string, language: Lang): string | undefined {
  if (key === 'PP:IFE') return language === 'zh-TW' ? '血清 IFE/IEP' : 'Serum IFE/IEP'
  const parts = splitKey(key)
  if (!parts) return undefined
  const base = BASE_DISPLAY[parts.base]
  if (!base) return undefined
  return `${SPECIMEN_LABEL[parts.specimen][language]}${base[language]}`
}

export function isParaproteinTextKey(key: string | undefined): boolean {
  return !!key && PARAPROTEIN_TEXT_KEYS.has(key)
}

// ── identity ──────────────────────────────────────────────────────────────

const ORDER_SET = new Set(PARAPROTEIN_NHI_ORDER_CODES)
const SPEP_SET = new Set(PROTEIN_ELECTROPHORESIS_NHI_ORDER_CODES)

const M_PROTEIN_RE = /M[-\s]?(?:PROTEIN|SPIKE|蛋白|帶)|PARAPROTEIN|單株(?:球)?蛋白(?:定量|量)?|MONOCLONAL\s*PROTEIN/i
const URINE_RE = /尿|URINE|\bUFLC\b|^U[-\s.]|\(U\)/i
const CSF_RE = /\bCSF\b|腦脊髓/i
const RATIO_RE = /RATIO|比值|[ΚK]\s*\/\s*[ΛL]\b|KAPPA\s*\/\s*LAMBDA/i
const KAPPA_RE = /KAPPA|Κ|\bK\b/i
const LAMBDA_RE = /LAMBDA|Λ|\bL\b/i
const FREE_RE = /FREE|\bS?FLC\b|\bUFLC\b|游離/i
const TOTAL_RE = /TOTAL|總/i
const IEP_ONLY_RE = /\bIEP\b|IMMUNOELECTRO|免疫電泳/i
const IFE_RE = /\bIFE\b|IMMUNOFIX|免疫固定/i

const loincOf = (obs: any): string | undefined =>
  (obs?.code?.coding ?? []).find((c: any) => /loinc/i.test(c?.system || ''))?.code

/** The row's own name: code.text, else a non-NHI (item) coding. */
function ownName(obs: any): string {
  const codings: any[] = Array.isArray(obs?.code?.coding) ? obs.code.coding : []
  const own = codings.filter((c: any) => !isNhiOrderCodeSystem(c?.system) && !/loinc/i.test(c?.system || ''))
  return String(obs?.code?.text || own.find((c: any) => c?.display)?.display || own.find((c: any) => c?.code)?.code || '')
}

function specimenText(obs: any): string {
  const specimen = obs?.specimen
  const orderDisplays = (obs?.code?.coding ?? [])
    .filter((c: any) => isNhiOrderCodeSystem(c?.system))
    .map((c: any) => c?.display)
  return [specimen?.display, specimen?.type?.text, ...(specimen?.type?.coding ?? []).map((c: any) => c?.display), ...orderDisplays]
    .filter((t): t is string => typeof t === 'string')
    .join(' ')
}

function specimenOf(obs: any, order: string | null, name: string): 'S' | 'U' | 'CSF' {
  if (order === '12159B' || order === '12158B' || order === '09100B') return 'U'
  if (order === '12157B') return 'CSF'
  const evidence = `${name} ${specimenText(obs)}`.normalize('NFKC')
  if (CSF_RE.test(evidence)) return 'CSF'
  if (URINE_RE.test(evidence)) return 'U'
  return 'S'
}

const prefixFor = (specimen: 'S' | 'U' | 'CSF') =>
  specimen === 'U' ? 'PP:U:' : specimen === 'CSF' ? 'PP:CSF:' : PARAPROTEIN_PREFIX

const isNumericValue = (obs: any) => typeof obs?.valueQuantity?.value === 'number'

/**
 * The paraprotein column of one observation, or null when it is not a
 * paraprotein-subgroup row. `display` is set for neutral source-name columns.
 */
export function paraproteinIdentity(obs: any): { key: string; display?: string } | null {
  const loinc = loincOf(obs)
  if (loinc && PARAPROTEIN_LOINC_TO_KEY[loinc]) return { key: PARAPROTEIN_LOINC_TO_KEY[loinc] }

  const order = nhiOrderCode(obs)
  const name = ownName(obs)
  const upper = name.normalize('NFKC').toUpperCase()

  if (order && SPEP_SET.has(order)) {
    if (!M_PROTEIN_RE.test(upper)) return null
    return { key: `${prefixFor(specimenOf(obs, order, name))}M-PROTEIN` }
  }
  if (!order || !ORDER_SET.has(order)) return null

  const specimen = specimenOf(obs, order, name)
  const prefix = prefixFor(specimen)

  if (order === '12160B') {
    const analyte = RATIO_RE.test(upper) ? 'KL-RATIO'
      : KAPPA_RE.test(upper) && !LAMBDA_RE.test(upper) ? 'KAPPA'
        : LAMBDA_RE.test(upper) && !KAPPA_RE.test(upper) ? 'LAMBDA'
          : null
    const marker = FREE_RE.test(upper) ? 'FREE' : TOTAL_RE.test(upper) ? 'TOTAL' : null
    if (analyte && marker) return { key: `${prefix}${analyte}-${marker}` }
    // Neutral: the source name is the column; free / total is never asserted.
    const neutral = name.normalize('NFKC').trim() || '12160B'
    return { key: `${prefix}KL:${neutral.toUpperCase()}`, display: neutral }
  }

  // Report orders: an M-protein amount, else the report's text column (lane
  // rows included).
  if (M_PROTEIN_RE.test(upper) && isNumericValue(obs)) return { key: `${prefix}M-PROTEIN` }
  if (specimen === 'CSF') return { key: 'PP:CSF:IEP' }
  if (order === '12159B') return { key: 'PP:U:IFE' }
  if (order === '12158B') return { key: 'PP:U:IEP' }
  if (order === '12157B') return { key: 'PP:CSF:IEP' }
  // 12103B
  if (specimen === 'U') return { key: IEP_ONLY_RE.test(upper) && !IFE_RE.test(upper) ? 'PP:U:IEP' : 'PP:U:IFE' }
  return { key: 'PP:IFE' }
}

export function isParaproteinObservation(obs: any): boolean {
  return paraproteinIdentity(obs) !== null
}

// ── text badge ────────────────────────────────────────────────────────────

const HEAVY = '(IG[GAMDE])'
const LIGHT = '(Κ|Λ|KAPPA|LAMBDA)'
const ISOTYPE_RE = new RegExp(`${HEAVY}\\s*[-‐_/ ]?\\s*${LIGHT}`, 'gi')
const FREE_LIGHT_RE = new RegExp(`FREE\\s*${LIGHT}|游離\\s*${LIGHT}`, 'gi')
const NEGATIVE_RE = /NO\s+(?:MONOCLONAL|M[-\s]?PROTEIN|PARAPROTEIN|M[-\s]?SPIKE|BENCE)|NEGATIVE|NOT\s+DETECTED|ABSENT|\(-\)|陰性|未見|無單株|未發現|正常(?:型態|圖譜)?$/i

const lightSymbol = (light: string) => (/Κ|KAPPA/i.test(light) ? 'κ' : 'λ')

/**
 * A short badge for one paraprotein text cell (every folded record of the
 * day): the monoclonal isotype(s) when stated ("IgG-κ"), a free light chain
 * ("free λ") when that is all, 「陰性」 when every record is negative, else
 * 「見報告」. Never a judgement the text does not make.
 */
export function paraproteinTextBadge(values: readonly string[], language: Lang): string {
  const isotypes: string[] = []
  const freeLights: string[] = []
  let allNegative = values.length > 0
  for (const raw of values) {
    const text = String(raw ?? '').normalize('NFKC').toUpperCase()
    let found = false
    for (const match of text.matchAll(ISOTYPE_RE)) {
      const heavy = `Ig${match[1].slice(2).toUpperCase()}`
      isotypes.push(`${heavy}-${lightSymbol(match[2])}`)
      found = true
    }
    for (const match of text.matchAll(FREE_LIGHT_RE)) {
      freeLights.push(`free ${lightSymbol(match[1] ?? match[2])}`)
      found = true
    }
    if (found || !NEGATIVE_RE.test(text.trim())) allNegative = false
  }
  const unique = (list: string[]) => [...new Set(list)]
  if (isotypes.length > 0) return unique(isotypes).join(' + ')
  if (freeLights.length > 0) return unique(freeLights).join(' + ')
  if (allNegative) return language === 'zh-TW' ? '陰性' : 'Negative'
  return language === 'zh-TW' ? '見報告' : 'See report'
}
