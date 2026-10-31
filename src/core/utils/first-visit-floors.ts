// 初診快覽 floors — the deterministic "latest known" guarantees the AI scope
// keeps for a first-visit overview, whatever time window the user saved. A
// patient whose last six months are quiet must not reach the model as an
// empty chart, and a tumour marker or platelet count from eight months ago is
// still the latest known value. Everything here is measured against the newest
// date IN THE DATA, never the wall clock, so an archived chart keeps its floors.
import { getAnalyteCanonicalKey } from '@voho0000/clinical-lab-normalization/canonical'

/** How far back a floor may reach (admissions, latest labs, latest reports). */
export const FIRST_VISIT_FLOOR_DAYS = 730

/**
 * Analytes that change a prescription written today. Expressed as canonical
 * analyte keys resolved by the app's own alias/LOINC table
 * (`getAnalyteCanonicalKey`) — there is no second alias table here.
 */
export const PRESCRIBING_RELEVANT_ANALYTES: ReadonlySet<string> = new Set([
  // renal
  'CREA', 'EGFR(EPI)', 'EGFR(M)', 'BUN', 'K', 'NA', 'CA',
  // haematology / coagulation
  'HB', 'PLT', 'WBC', 'ANC', 'INR', 'PT',
  // liver — GGT and LDH complete the panel every other liver enzyme here comes
  // from. Leaving them out meant a normal LDH drawn beside an abnormal AST was
  // admitted by neither rule (allowlist nor source-flagged abnormal) and the
  // analyte vanished from the fast lane entirely; both also change what may be
  // prescribed (cholestasis / hepatotoxicity, haemolysis and tumour burden).
  'ALT', 'AST', 'ALK-P', 'GGT', 'LDH', 'T.BILI', 'D.BILI', 'BILI', 'ALB',
  // metabolic / endocrine
  'HBA1C', 'GLUCOSE', 'GLUCOSE-AC', 'GLUCOSE-FS', 'TSH', 'FREE T4',
  'LDL', 'TG', 'UA',
  // cardiac
  'NT-PROBNP', 'BNP', 'NATRIURETIC-PEPTIDE', 'TROP',
  // tumour markers (listed only when the chart actually carries them)
  'AFP', 'CEA', 'PSA', 'F-PSA', 'CA-125', 'CA-153', 'CA-199',
])


/** Canonical analyte key when the observation is one a prescriber checks. */
export function prescribingAnalyteKey(observation: unknown): string | null {
  const key = getAnalyteCanonicalKey(observation as never)
  return key && PRESCRIBING_RELEVANT_ANALYTES.has(key) ? key : null
}

// The report modality class lives in report-narrative.utils.ts, beside the
// other report helpers every first-visit consumer shares.

export function floorStartDay(newestDay: string | undefined, days = FIRST_VISIT_FLOOR_DAYS): string | undefined {
  if (!newestDay) return undefined
  const ms = Date.parse(newestDay)
  if (!Number.isFinite(ms)) return undefined
  return new Date(ms - days * 86_400_000).toISOString().slice(0, 10)
}
