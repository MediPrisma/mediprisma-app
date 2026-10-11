// Specimen evidence for analytes measured in both serum and urine — total
// protein, albumin, calcium, creatinine — and for the immunology non-blood
// check (user decision 2026-10-11). Strongest evidence first; the first
// decisive level wins:
//   1. explicit: the row's own name (尿 / urine / (U) / spot / 24h, or serum /
//      血清 / plasma / blood) or a structured specimen;
//   2. the unit class: mg/g, g/g, mg/mg, mg/mmol → urine ratio; mg/24h, g/day
//      → 24-h urine; g/dL, g/L → blood; mg/dL (or anything else) decides
//      nothing;
//   3. the MediCloud inspect mode, which is batch-level and can be wrong
//      (a serum "Ca 9.6 mg/dL [8.6~10.0]" arrived under URINE(SPOT)): it
//      counts only when the row's reference range agrees with it;
//   4. conflict or nothing → null, and the caller keeps today's behaviour.

import { isNhiOrderCodeSystem, nhiOrderCode } from '@/src/shared/utils/nhi-order-code'

export type SpecimenClass = 'urine' | 'blood'
export type DualSpecimenAnalyte = 'TP' | 'ALB' | 'CA' | 'CREA'

const URINE_NAME_RE = /尿|URINE|\(U\)|^U[-\s.]|\bSPOT\b|\b24\s*-?\s*H(?:R|RS|OUR)?\b|24小時/i
const BLOOD_NAME_RE = /SERUM|血清|PLASMA|血漿|\bBLOOD\b|\(S\)|\(B\)|\(P\)/i
const URINE_SPECIMEN_RE = /URINE|URINALY|尿/i
const BLOOD_SPECIMEN_RE = /BLOOD|SERUM|PLASMA|血/i

const INSPECT_MODE_URL_RE = /\/medcloud-source-inspect-mode$/
const URINE_INSPECT_RE = /URINE|尿/i
// The bridge's own definition of a stated blood sample (isBloodFamilyInspectMode).
const BLOOD_INSPECT_RE = /^(?:(?:SERUM|PLASMA|BLOOD)\$?_[A-Z0-9.$]+|blood|血|血液)$/i

/** The analyte, when it is one measured in both serum and urine. */
export function dualSpecimenAnalyte(obs: any): DualSpecimenAnalyte | null {
  const name = ownName(obs).normalize('NFKC').toUpperCase()
    .replace(/\b(?:SERUM|URINE|SPOT|PLASMA|BLOOD)\b|血清|血漿|尿液?|\(.*?\)/g, ' ').trim()
  if (/KINASE|激酶/.test(name)) return null
  // A ratio (Prot/Cr, Alb/Cr, 微白蛋白/肌酸酐) is its own urine analyte, not
  // total protein / albumin / creatinine.
  if (/\/|RATIO|比值/.test(ownName(obs))) return null
  if (/TOTAL\s*PROTEIN|^T\.?P\.?$|^PROT(?:EIN)?\b|全蛋白|總蛋白/.test(name)) return 'TP'
  if (/^(?:ALB(?:UMIN)?)\b|^白蛋白/.test(name)) return 'ALB'
  // Ca, Calcium, 鈣 — never the CA 19-9 / CA-125 tumour markers.
  if (/^(?:CA|CAL|CALCIUM)$|^CALCIUM\b|鈣/.test(name)) return 'CA'
  if (/CREA(?:T(?:ININE)?)?\b|^CRE\b|肌酸酐|肌酐/.test(name)) return 'CREA'
  const order = nhiOrderCode(obs)
  if (!name) {
    if (order === '09040C') return 'TP'
    if (order === '09038C') return 'ALB'
    if (order === '09011C') return 'CA'
    if (order === '09015C' || order === '09016C') return 'CREA'
  }
  return null
}

function ownName(obs: any): string {
  const codings: any[] = Array.isArray(obs?.code?.coding) ? obs.code.coding : []
  const own = codings.filter((c: any) => !isNhiOrderCodeSystem(c?.system) && !/loinc/i.test(c?.system || ''))
  return String(obs?.code?.text || own.find((c: any) => c?.display)?.display || '')
}

function unitOf(obs: any): string {
  const q = obs?.valueQuantity
  return String(q?.unit ?? q?.code ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '').replace(/μ/g, 'u')
}

/** Unit-class evidence. */
export function specimenFromUnit(unit: string): SpecimenClass | null {
  if (!unit) return null
  if (/^(?:mg|g|ug|mcg)\/(?:g|mg|mmol)(?:\.?(?:cr|cre|crea|creat|creatinine))?$/.test(unit)) return 'urine'
  if (/^(?:mg|g|ug|mcg|mmol)\/(?:24h|24hr|24hrs|24hours|day|d)$/.test(unit)) return 'urine'
  if (unit === 'g/dl' || unit === 'g/l') return 'blood'
  return null
}

function inspectMode(obs: any): string | null {
  const extensions: any[] = Array.isArray(obs?.extension) ? obs.extension : []
  const mode = extensions.find((e: any) => typeof e?.url === 'string' && INSPECT_MODE_URL_RE.test(e.url))?.valueString
  return typeof mode === 'string' && mode.trim() ? mode.trim() : null
}

/** Serum reference windows (mg/dL) a serum reference range falls inside. */
const SERUM_WINDOW_MG_DL: Record<DualSpecimenAnalyte, [number, number]> = {
  CA: [6, 12],
  CREA: [0.2, 2.0],
  TP: [5000, 9000],
  ALB: [3000, 5500],
}

function referenceBounds(obs: any): { low?: number; high?: number } | null {
  const range = Array.isArray(obs?.referenceRange) ? obs.referenceRange[0] : undefined
  if (!range) return null
  const low = typeof range.low?.value === 'number' ? range.low.value : undefined
  const high = typeof range.high?.value === 'number' ? range.high.value : undefined
  if (low !== undefined || high !== undefined) return { low, high }
  const text = typeof range.text === 'string' ? range.text.normalize('NFKC') : ''
  const between = text.match(/(-?\d+(?:\.\d+)?)\s*[~\-–～]\s*(\d+(?:\.\d+)?)/)
  if (between) return { low: Number(between[1]), high: Number(between[2]) }
  const upper = text.match(/[<≤≦]=?\s*(\d+(?:\.\d+)?)/)
  if (upper) return { high: Number(upper[1]) }
  const lower = text.match(/[>≥≧]=?\s*(\d+(?:\.\d+)?)/)
  if (lower) return { low: Number(lower[1]) }
  return null
}

/** Does the reference range read as serum or as urine for this analyte? */
function specimenFromReferenceRange(obs: any, analyte: DualSpecimenAnalyte): SpecimenClass | null {
  if (unitOf(obs) !== 'mg/dl') return null
  const bounds = referenceBounds(obs)
  if (!bounds) return null
  const [w0, w1] = SERUM_WINDOW_MG_DL[analyte]
  const values = [bounds.low, bounds.high].filter((v): v is number => v !== undefined)
  if (values.length === 0) return null
  return values.every((v) => v >= w0 && v <= w1) ? 'blood' : 'urine'
}

/**
 * The specimen the row's own evidence states, or null. `analyte` enables the
 * inspect-mode level (it needs an analyte-specific reference range); without
 * it only the name, structured specimen and unit levels apply.
 */
export function specimenEvidence(obs: any, analyte: DualSpecimenAnalyte | null): SpecimenClass | null {
  // 1. explicit
  const name = ownName(obs).normalize('NFKC')
  const nameUrine = URINE_NAME_RE.test(name)
  const nameBlood = BLOOD_NAME_RE.test(name)
  if (nameUrine !== nameBlood) return nameUrine ? 'urine' : 'blood'
  const specimenText = [obs?.specimen?.display, obs?.specimen?.type?.text].filter(Boolean).join(' ')
  if (specimenText) {
    if (URINE_SPECIMEN_RE.test(specimenText)) return 'urine'
    if (BLOOD_SPECIMEN_RE.test(specimenText)) return 'blood'
  }
  // 2. unit class
  const byUnit = specimenFromUnit(unitOf(obs))
  if (byUnit) return byUnit
  // 3. inspect mode, only with an agreeing reference range
  if (!analyte) return null
  const mode = inspectMode(obs)
  if (!mode) return null
  const modeSays: SpecimenClass | null = URINE_INSPECT_RE.test(mode) ? 'urine' : BLOOD_INSPECT_RE.test(mode) ? 'blood' : null
  if (!modeSays) return null
  const rangeSays = specimenFromReferenceRange(obs, analyte)
  // 4. conflict or insufficient → null
  return rangeSays === modeSays ? modeSays : null
}
