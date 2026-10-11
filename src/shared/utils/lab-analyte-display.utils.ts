import { CANONICAL_KEYS } from '@voho0000/clinical-lab-normalization/canonical'
import {
  getAnalyteDisplayForMode as packageDisplayForMode,
  getAnalyteDisplayParts,
  type AnalyteNameMode,
  type AudienceMode,
  type DisplayLang,
} from '@voho0000/clinical-lab-normalization/display'
import { categorizeObservation } from './lab-categories'
import { paraproteinDisplay } from './paraprotein-analytes'
import {
  getLabCompatibilityCanonicalDisplay,
  getLabPivotTestIdentity,
  type LabRow,
} from './lab-pivot.utils'

type DisplayRow = Pick<LabRow, 'testKey' | 'displayName' | 'displaySource'>

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
  if (mode === 'original') return { name: row.displayName, abbr: null }
  const paraprotein = paraproteinDisplay(row.testKey, language === 'zh-TW' ? 'zh-TW' : 'en')
  if (paraprotein) return { name: paraprotein, abbr: null }
  const compatibilityDisplay = getLabCompatibilityCanonicalDisplay(row.testKey)
  if (compatibilityDisplay) return { name: compatibilityDisplay, abbr: null }
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
  const { name, abbr } = getLabRowDisplayParts(
    { ...identity, displaySource: observation }, audience, language, mode,
  )
  return abbr ? `${name} (${abbr})` : name
}
