// Thin React wrapper over the pure lab-pivot builder. The transform itself
// lives in src/shared/utils/lab-pivot.utils.ts (moved 2026-07-12 so the
// AI-context lab section in core can reuse it); everything is re-exported here
// so existing feature/test imports keep working unchanged.
import { useMemo } from 'react'
import { buildLabPivots, type LabPivot } from '@/src/shared/utils/lab-pivot.utils'
import type { AnalyteNameMode } from '@voho0000/clinical-lab-normalization/display'

export {
  buildLabPivots,
  cellDisplayValue,
  formatValue,
  type LabCell,
  type LabRow,
  type LabPivot,
} from '@/src/shared/utils/lab-pivot.utils'

export function useLabPivot(
  observations: any[],
  nameMode: AnalyteNameMode = 'standardized',
): Record<string, LabPivot> {
  return useMemo(() => buildLabPivots(observations, { nameMode, preferInstitutionEgfr: true }), [observations, nameMode])
}
