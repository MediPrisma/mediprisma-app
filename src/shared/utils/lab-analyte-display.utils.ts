import { CANONICAL_KEYS } from '@voho0000/clinical-lab-normalization/canonical'
import {
  getAnalyteDisplayForMode as packageDisplayForMode,
  getAnalyteDisplayParts,
  type AnalyteNameMode,
  type AudienceMode,
  type DisplayLang,
} from '@voho0000/clinical-lab-normalization/display'
import { categorizeObservation, getTestDisplayName } from './lab-categories'
import { isParaproteinTextKey, neutralParaproteinDisplay, paraproteinDisplay } from './paraprotein-analytes'
import {
  freeTotalOfKey,
  DIFFERENTIAL_COUNT_LABELS,
  getLabCompatibilityCanonicalDisplay,
  getLabPivotTestIdentity,
  specimenOfKey,
  type LabRow,
} from './lab-pivot.utils'

type DisplayRow = Pick<LabRow, 'testKey' | 'displayName' | 'displaySource'>
  & Partial<Pick<LabRow, 'originalHintKind' | 'unit'>>

const SPECIMEN_HINT: Record<string, { zh: string; en: string }> = {
  urine: { zh: '尿', en: 'Urine' },
  csf: { zh: 'CSF', en: 'CSF' },
  serum: { zh: '血清', en: 'Serum' },
}
const FREE_TOTAL_HINT: Record<string, { zh: string; en: string }> = {
  free: { zh: '游離', en: 'free' },
  total: { zh: '總', en: 'total' },
}

/** The short hint an original-mode column that shares its source label
 *  with another column of the table carries (see assignOriginalHints). */
function originalHint(row: DisplayRow, audience: AudienceMode, language: DisplayLang): string | undefined {
  const zh = language === 'zh-TW'
  switch (row.originalHintKind) {
    case 'specimen': {
      const hint = SPECIMEN_HINT[specimenOfKey(row.testKey) ?? '']
      return hint && (zh ? hint.zh : hint.en)
    }
    case 'unit':
      return row.unit === '%' ? '%' : '#'
    case 'freeTotal': {
      const hint = FREE_TOTAL_HINT[freeTotalOfKey(row.testKey) ?? '']
      return hint && (zh ? hint.zh : hint.en)
    }
    case 'standard':
      return getLabRowDisplayParts({ testKey: row.testKey, displayName: row.displayName, displaySource: row.displaySource }, audience, language, 'standardized').name
    default:
      return undefined
  }
}

/** Shared label contract for cumulative headers, report results and search.
 * Identity (including glucose subtype and local magnesium compatibility) comes
 * from the pivot resolver; unknown analytes retain the full source name and
 * the package's language-aware fallback, without stripping qualifiers.
 */
export function getLabRowDisplayParts(
  row: DisplayRow,
  audience: AudienceMode,
  language: DisplayLang,
  mode: AnalyteNameMode = 'standardized',
): { name: string; abbr: string | null } {
  if (mode === 'original') {
    // The source label; a hint only where another column shares it.
    const hint = originalHint(row, audience, language)
    return { name: hint ? `${row.displayName} (${hint})` : row.displayName, abbr: null }
  }
  const paraprotein = paraproteinDisplay(row.testKey, language === 'zh-TW' ? 'zh-TW' : 'en')
  if (paraprotein) return { name: paraprotein, abbr: null }
  // A neutral κ/λ column is named after its source; a urine or CSF one says so.
  const neutral = neutralParaproteinDisplay(row.testKey, row.displayName, language === 'zh-TW' ? 'zh-TW' : 'en')
  if (neutral) return { name: neutral, abbr: null }
  const compatibilityDisplay = getLabCompatibilityCanonicalDisplay(row.testKey)
  if (compatibilityDisplay) {
    // Absolute-count columns the app adds (ALC, AMC, …) get the same lay
    // treatment the package gives ANC: a plain name, the code kept beside it.
    const lay = audience === 'patient' ? DIFFERENTIAL_COUNT_LABELS[row.testKey] : undefined
    if (lay) {
      return language === 'zh-TW'
        ? { name: lay.zh, abbr: compatibilityDisplay }
        : { name: lay.en, abbr: null }
    }
    return { name: compatibilityDisplay, abbr: null }
  }
  if (CANONICAL_KEYS.has(row.testKey)) {
    return getAnalyteDisplayParts(row.testKey, audience, language)
  }
  return {
    name: row.displaySource
      ? packageDisplayForMode(row.displaySource, audience, language, mode)
      : row.displayName,
    abbr: null,
  }
}

export function getAnalyteDisplayForMode(
  observation: any,
  audience: AudienceMode,
  language: DisplayLang,
  mode: AnalyteNameMode = 'standardized',
): string {
  const category = categorizeObservation(observation)
  // Non-laboratory observations (e.g. blood pressure) keep their own display.
  if (!category || mode === 'original') {
    return packageDisplayForMode(observation, audience, language, mode)
  }
  const identity = getLabPivotTestIdentity(observation, category.id, mode)
  // An IEP / IFE report column ("Serum IFE/IEP") gathers a report and its
  // lanes; one observation shown on its own keeps its own name (IgG, Kappa …)
  // so the lanes stay distinguishable outside the cumulative table.
  if (isParaproteinTextKey(identity.testKey)) return getTestDisplayName(observation)
  const { name, abbr } = getLabRowDisplayParts(
    { ...identity, displaySource: observation }, audience, language, mode,
  )
  return abbr ? `${name} (${abbr})` : name
}
