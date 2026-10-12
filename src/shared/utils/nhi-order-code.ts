import { FHIR_SYSTEM_FRAGMENTS } from '@/src/shared/constants/fhir-systems.constants'

// NHI 醫令 codes arrive under more than one system URI. NHI-FHIR-Bridge (健保
// 存摺) writes `…/CodeSystem/nhi-medical-order-code`; the 雲端病歷 (MediCloud)
// bridge rewrites the same code to TW Core's `…/medical-service-payment-tw`;
// older cached bundles use `urn:oid:nhi.lab.code` or `…/nhi-lab-code`. Every
// reader of the order code goes through this one list so a new bridge system
// cannot again be recognised in one place and silently ignored in another.
export const NHI_ORDER_SYSTEM_FRAGMENTS = [
  FHIR_SYSTEM_FRAGMENTS.NHI_MEDICAL_ORDER_CODE,
  'medical-service-payment-tw',
  'nhi-lab-code',
  'nhi.lab.code',
] as const

/** True when `system` is an NHI 醫令 code system, whichever bridge wrote it. */
export function isNhiOrderCodeSystem(system: unknown): boolean {
  if (typeof system !== 'string') return false
  const normalized = system.trim().toLowerCase()
  return NHI_ORDER_SYSTEM_FRAGMENTS.some((fragment) => normalized.includes(fragment))
}

/** The first coding (with a code) whose system is an NHI 醫令 code system. */
export function findNhiOrderCoding<T extends { system?: unknown; code?: unknown }>(
  codings: readonly T[] | null | undefined,
): T | undefined {
  if (!Array.isArray(codings)) return undefined
  return codings.find((c) => isNhiOrderCodeSystem(c?.system) && typeof c?.code === 'string' && !!c.code.trim())
}

/** The observation's NHI 醫令 code (trimmed, upper case), whichever bridge wrote it. */
export function nhiOrderCode(obs: any): string | null {
  const coding = findNhiOrderCoding<any>(obs?.code?.coding)
  return coding ? String(coding.code).trim().toUpperCase() : null
}

// A local item code is the row's analyte ("WBC", "HGB", "PL12") unless it is
// an opaque identifier: a numeric id ("0042", "72-001"), a GUID, a hex hash,
// a letter prefix on a long serial ("L0001", "A12345", "LB-20031"), or a
// hash-like code that keeps switching between letters and digits
// ("X7F3K9Q2"; never "PMSCL100" or "HBA1C").
const OPAQUE_LOCAL_CODE_RES: readonly RegExp[] = [
  /^\d[\d\-._/:]*$/,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^(?=.*\d)[0-9a-f]{12,}$/i,
  /^[A-Z]\d{3,}$/i,
  /^[A-Z]{1,3}[-_.]?\d{4,}$/i,
]

// Letter/digit boundaries in a code: "X7F3K9Q2" has 7, "PMSCL100" has 1.
const LETTER_DIGIT_SWITCH = /(?<=\d)[A-Z]|(?<=[A-Z])\d/gi

/** True when a local item code is an identifier, not an analyte name. */
export function isOpaqueLocalCode(code: unknown): boolean {
  if (typeof code !== 'string') return true
  const trimmed = code.trim()
  if (!trimmed) return true
  if (OPAQUE_LOCAL_CODE_RES.some((re) => re.test(trimmed))) return true
  // Hash-like: eight or more letters and digits that keep switching.
  return trimmed.length >= 8 && /^[A-Z0-9]+$/i.test(trimmed)
    && (trimmed.match(LETTER_DIGIT_SWITCH)?.length ?? 0) >= 4
}

/**
 * The first non-NHI, non-LOINC coding code that names the analyte: one the
 * caller recognises, or one that is not an opaque identifier. Undefined when
 * every local code is opaque, so only then may the order display name the row.
 */
export function meaningfulLocalCode(
  codings: readonly any[] | null | undefined,
  isRecognised: (code: string) => boolean = () => false,
): string | undefined {
  if (!Array.isArray(codings)) return undefined
  for (const c of codings) {
    if (isNhiOrderCodeSystem(c?.system)) continue
    if (typeof c?.system === 'string' && /loinc/i.test(c.system)) continue
    const code = typeof c?.code === 'string' ? c.code.trim() : ''
    if (!code) continue
    if (isRecognised(code) || !isOpaqueLocalCode(code)) return code
  }
  return undefined
}
