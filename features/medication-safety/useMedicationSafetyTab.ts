'use client'

import { useMemo } from 'react'
import { detectSite } from '@/src/application/telemetry/launch-context'
import { useInteractionCheck } from '@/features/clinical-summary/medications/hooks/useInteractionCheck'
import { attentionFindings } from '@/features/clinical-summary/medications/utils/interaction-check'

export const MEDICATION_SAFETY_FEATURE_ID = 'medication-safety'

export interface MedicationSafetyTab {
  /** The tab exists: the build has the hospital service and this is a
   *  hospital workstation (see below). */
  visible: boolean
  /** On a hospital workstation but the service could not be reached: the tab
   *  stays, greyed, and explains why. */
  unreachable: boolean
  /** Pairs needing attention; null while there is nothing to count yet. */
  count: number | null
  avoid: number
  /** Current rows the service could not check. */
  unchecked: number
  /** Fewer than two ingredients could be sent, so nothing was checked: 0 here
   *  is not "none found". */
  notRun: boolean
}

const HIDDEN: MedicationSafetyTab = { visible: false, unreachable: false, count: null, avoid: 0, unchecked: 0, notRun: false }

/**
 * The service is on the hospital network only, and from a public page the
 * browser cannot tell "outside the hospital" from "inside, but Chrome blocked
 * the request". So the hospital is recognised from what the app already knows
 * — the 北榮 launcher's `?site=vghtpe`, or 院內 medication rows — and from the
 * service answering, which covers cloud-only patients and lists too short to
 * check. Away from the hospital the tab does not appear at all.
 */
export function useMedicationSafetyTab(): MedicationSafetyTab {
  const { state, rows } = useInteractionCheck()
  return useMemo(() => {
    if (state.status === 'off') return HIDDEN
    const answered = state.status === 'ok' || (state.status === 'too-few' && state.reachable === true)
    const atHospital = answered
      || detectSite() === 'vghtpe'
      || rows.some(row => row.dataOrigin === 'hospital' || row.dataOrigin === 'integrated')
    if (!atHospital) return HIDDEN
    if (state.status === 'blocked' || state.status === 'unreachable') {
      return { visible: true, unreachable: true, count: null, avoid: 0, unchecked: 0, notRun: false }
    }
    if (state.status === 'loading') return { ...HIDDEN, visible: true }
    if (state.status === 'too-few') {
      const local = new Set(state.localRowIds)
      return { visible: true, unreachable: false, count: 0, avoid: 0,
        unchecked: rows.filter(row => !row.isInactive && !local.has(row.id)).length, notRun: true }
    }
    const attention = attentionFindings(state.review)
    return {
      visible: true,
      unreachable: false,
      count: attention.length,
      avoid: attention.filter(f => f.tier === 'avoid').length,
      unchecked: state.review.uncheckedRowIds.length,
      notRun: false,
    }
  }, [rows, state])
}
