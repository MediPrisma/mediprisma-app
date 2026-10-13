import { isObservationAbnormal } from '@voho0000/clinical-lab-normalization/interpretation'
import type { Row } from '../types'

/**
 * 只看異常: each lab row narrowed to its abnormal analytes (a panel keeps only
 * its flagged members); rows with none drop out. "Abnormal" is the shared
 * rule — the source interpretation, else the audited reference range — so the
 * filter agrees with the red values on screen.
 */
export function keepAbnormalLabRows(rows: Row[]): Row[] {
  const out: Row[] = []
  for (const row of rows) {
    const obs = row.obs.filter((o) => isObservationAbnormal(o) || !!o.component?.some((c) => isObservationAbnormal(c)))
    if (obs.length === 0) continue
    out.push(obs.length === row.obs.length ? row : { ...row, obs })
  }
  return out
}
