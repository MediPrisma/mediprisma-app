// Free-text PII scrub for OUTBOUND AI payloads.
//
// The structured scrub (_scrub-pii.ts) strips id / identifier / birthDate /
// provider display fields, but NHI discharge summaries and report conclusions
// routinely embed the patient's name, chart number and 身分證字號 inside free
// text — the highest-density PHI channel. This module masks those before any
// text is sent to a cloud LLM.
//
// Scope rules:
// - OUTBOUND ONLY. Never use this for display — the UI must keep showing the
//   source data verbatim (bridge bugs must stay visible).
// - Conservative patterns: mask only what is positively identifying — a TW
//   national/resident ID shape, an email address, or values directly labeled
//   as patient identity/contact fields — plus caller-provided literals from
//   the loaded Patient. Clinical content must survive untouched.

// 身分證字號 / 居留證統一證號: 1 uppercase letter + gender/type digit (1/2
// legacy national, 8/9 new-format resident) + 8 digits, word-bounded.
const TW_NATIONAL_ID = /\b[A-Z][1289]\d{8}\b/gi

// Email syntax is distinctive enough to mask without requiring a label.
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}\b/gi

// Values explicitly labeled as chart numbers — masking only labeled values
// keeps bare numbers (lab values, order ids) intact.
const LABELED_CHART_NO = /(病歷號碼?|病歷號|Chart\s*(?:No\.?|Number)|MRN)(\s*[:：]?\s*)[A-Za-z0-9-]{3,}/gi

// Direct identifiers that are not always valid TW national-ID shapes (e.g.
// passport, NHI card, resident certificate, source-system Patient ID). These
// remain label-gated so clinical accession/order codes are not mass-masked.
const LABELED_PERSON_ID = /((?:國民身分證統一編號|身分證統一編號|身分證字號|身份證字號|身分證號|身份證號|身分證|身份證|居留證統一證號|居留證號|護照號碼?|健保卡號碼?|Patient\s*ID)\s*[:：]?\s*)[A-Za-z0-9*＊-]{4,}/giu

// Birth dates are masked only when explicitly identified as such. Ordinary
// clinical dates must stay available for chronology and citation.
const LABELED_BIRTH_DATE = /((?:出生日期|出生年月日|出生年月|生日|Date\s+of\s+Birth|DOB)\s*[:：]?\s*)((?:民國\s*)?\d{2,4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日?|\d{2,4}\s*[/\.\-／]\s*\d{1,2}\s*[/\.\-／]\s*\d{1,2}|\d{7,8}|\d{2,4})/giu

// Require at least seven digits before treating a labeled value as a phone;
// this avoids masking short extensions or clinically meaningful small counts.
const LABELED_PHONE = /((?:聯絡電話|連絡電話|行動電話(?:號碼)?|手機(?:號碼)?|電話(?:號碼)?|Phone|Mobile|Tel(?:ephone)?)\s*[:：]?\s*)([+＋]?(?:[（(]?[0-9０-９][0-9０-９ \t()（）.．\-－–—/／]{4,40}[0-9０-９])(?:[ \t]*(?:#|＃|分機|ext\.?)\s*[0-9０-９]{1,8})?)/giu

// Address values vary too much for a format-only detector, so keep this
// label-gated and stop at the next common field label / line boundary.
const LABELED_ADDRESS = /((?:戶籍地址|通訊地址|聯絡地址|現住地址|居住地址|住址|地址|Address)\s*[:：]?\s*)([^\n\r<]{2,160}?)(?=\s*(?:(?:病患姓名|病人姓名|患者姓名|姓名|身分證|身份證|居留證|護照|健保卡號|出生日期|出生年月日|生日|病歷號碼|病歷號|病歷編號|聯絡電話|連絡電話|行動電話|手機|電話|電子郵件|Email|病理診斷|臨床診斷|診斷|主訴|處方|檢驗結果|Report|Diagnosis)\s*[:：]|[\n\r<]|$))/giu

// Values explicitly labeled as the patient's name. Han and Latin names use
// separate boundaries: whitespace safely ends a Han name, but is commonly
// inside a Latin name. Both stop before an adjacent known field label so a
// flattened table such as `姓名：王小明診斷：肺炎` keeps the diagnosis intact.
const LABELED_HAN_NAME = /(姓\s*名|病患姓名|病人姓名|患者姓名)(\s*[:：]?\s*)([\p{Script=Han}○〇Ｏ*＊Xx·•．.]{2,8}?)(?=\s|[,，;；\n\r<]|\d{1,3}\s*歲|(?:身分證|身份證|居留證|護照|健保卡號|出生日期|出生年月日|生日|病歷號碼|病歷號|病歷編號|聯絡電話|連絡電話|行動電話|手機|電話|地址|病理診斷|臨床診斷|診斷|主訴|處方|檢驗結果)\s*[:：]|$)/gu
const LABELED_LATIN_NAME = /(Patient(?:'s)?\s*Name)(\s*[:：]?\s*)([A-Za-z](?:[A-Za-z .'-]{0,37}?[A-Za-z])?)(?=\s*(?:(?:Patient\s*ID|Date\s+of\s+Birth|DOB|Chart\s*(?:No\.?|Number)|MRN|Phone|Mobile|Tel(?:ephone)?|Address|Report|Diagnosis)\s*[:：]|[,，;；\n\r<]|\d{1,3}\s*(?:y|yo|years?\s*old)|$))/giu

const MASK = '[已遮蔽]'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Collect the loaded patient's own name / identifier literals so they can be
 * masked wherever they appear in free text. Accepts a raw FHIR Patient or a
 * PatientEntity-shaped object; returns [] for anything else.
 */
export function buildPatientTextLiterals(patient: unknown): string[] {
  if (!patient || typeof patient !== 'object') return []
  const p = patient as Record<string, any>
  const literals: string[] = []

  const names = Array.isArray(p.name) ? p.name : []
  for (const n of names) {
    if (typeof n?.text === 'string') literals.push(n.text)
    const given = Array.isArray(n?.given) ? n.given.filter((g: unknown) => typeof g === 'string') : []
    if (typeof n?.family === 'string') {
      literals.push(n.family + given.join(''))       // CJK: 王小明
      if (given.length) literals.push(`${given.join(' ')} ${n.family}`) // Western order
    }
  }
  if (typeof p.name === 'string') literals.push(p.name) // entity shape: plain string

  const identifiers = Array.isArray(p.identifier) ? p.identifier : []
  for (const id of identifiers) {
    if (typeof id?.value === 'string') literals.push(id.value)
  }
  if (typeof p.id === 'string') literals.push(p.id)

  // These fields may be copied verbatim into a report header or document
  // narrative. Exact-value matching is safer and more complete than trying to
  // infer every international phone/address/date format from free text.
  if (typeof p.birthDate === 'string') literals.push(p.birthDate)
  const telecom = Array.isArray(p.telecom) ? p.telecom : []
  for (const point of telecom) {
    if (typeof point?.value === 'string') literals.push(point.value)
  }
  const addresses = Array.isArray(p.address) ? p.address : []
  for (const address of addresses) {
    if (typeof address?.text === 'string') literals.push(address.text)
    if (Array.isArray(address?.line)) {
      const joined = address.line.filter((line: unknown) => typeof line === 'string').join('')
      if (joined) literals.push(joined)
    }
  }

  // Too-short literals (1 char, or 1–2 digit ids) would mass-mask clinical
  // text; require ≥2 chars and skip pure 1–3 digit strings.
  return [...new Set(literals
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && !/^\d{1,3}$/.test(s)))]
    .sort((a, b) => b.length - a.length)
}

/**
 * For outbound CDSS text, mask a source name's unknown character even when
 * another report contains its actual glyph. Never use these patterns as keys.
 */
export function buildPatientNamePatterns(patient: unknown): RegExp[] {
  if (!patient || typeof patient !== 'object') return []
  const p = patient as Record<string, unknown>
  const names = Array.isArray(p.name)
    ? p.name.map(name => name?.text).filter((name): name is string => typeof name === 'string')
    : typeof p.name === 'string' ? [p.name] : []
  return names.filter(name => /[*＊]/u.test(name) && (name.match(/\p{L}/gu)?.length ?? 0) >= 2)
    .map(name => {
      const body = Array.from(name.trim()).map(char => /[*＊]/u.test(char)
        ? '[^\\s][\\u{FE00}-\\u{FE0F}\\u{E0100}-\\u{E01EF}]?'
        : escapeRegExp(char)).join('')
      const latin = /\p{Script=Latin}/u.test(name) && !/\p{Script=Han}/u.test(name)
      return new RegExp(latin ? `(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])` : body, 'giu')
    })
}

/** Mask identifying free text using labels, literals and optional patient-name patterns. */
export function scrubFreeText(text: string, literals: string[] = [], namePatterns: RegExp[] = []): string {
  if (!text) return text
  let out = text
  for (const literal of literals) {
    if (!literal) continue
    out = out.replace(new RegExp(escapeRegExp(literal), 'giu'), MASK)
  }
  // Only patient-name placeholders are wildcards. IDs and other literals
  // retain exact matching so masked identifiers cannot erase clinical values.
  for (const pattern of namePatterns) out = out.replace(pattern, MASK)
  out = out.replace(EMAIL, MASK)
  out = out.replace(TW_NATIONAL_ID, MASK)
  out = out.replace(LABELED_PERSON_ID, (_m, label: string) => `${label}${MASK}`)
  out = out.replace(LABELED_BIRTH_DATE, (_m, label: string) => `${label}${MASK}`)
  out = out.replace(LABELED_CHART_NO, (_m, label: string, sep: string) => `${label}${sep}${MASK}`)
  out = out.replace(LABELED_PHONE, (match, label: string, value: string) =>
    (value.match(/[0-9０-９]/g)?.length ?? 0) >= 7 ? `${label}${MASK}` : match)
  out = out.replace(LABELED_ADDRESS, (_m, label: string) => `${label}${MASK}`)
  out = out.replace(LABELED_HAN_NAME, (_m, label: string, sep: string) => `${label}${sep}${MASK}`)
  out = out.replace(LABELED_LATIN_NAME, (_m, label: string, sep: string) => `${label}${sep}${MASK}`)
  return out
}
