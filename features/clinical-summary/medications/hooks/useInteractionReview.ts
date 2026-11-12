'use client'

import { useEffect, useMemo, useState } from 'react'
import type { MedicationRow } from '../types'
import {
  interactionCheckBody,
  interpretInteractionCheck,
  planInteractionCheck,
  type InteractionReview,
} from '../utils/interaction-check'

const TIMEOUT_MS = 8000

/**
 * Checks the current medication rows against the hospital interaction
 * service. Only ingredient names leave the browser — no patient identifier,
 * dose or date. Returns null while loading, when the build has no service
 * origin, when fewer than two ingredients are on the list, and when the
 * service cannot be reached (any network outside the hospital).
 */
export function useInteractionReview(rows: MedicationRow[], enabled: boolean): InteractionReview | null {
  const origin = process.env.NEXT_PUBLIC_DDI_SERVICE_ORIGIN ?? ''
  const plan = useMemo(() => planInteractionCheck(rows), [rows])
  // Re-ask only when the set of ingredients changes, not on every re-render
  // of the same list.
  const key = plan.items.map(item => item.query.toLowerCase()).sort().join('|')
  const [result, setResult] = useState<{ key: string; response: unknown } | null>(null)

  useEffect(() => {
    if (!enabled || !origin || plan.items.length < 2) return
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
    let active = true
    fetch(`${origin}/api/ddi-check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(interactionCheckBody(plan)),
      signal: controller.signal,
    })
      .then(response => response.ok ? response.json() : Promise.reject(new Error(String(response.status))))
      .then(response => { if (active) setResult({ key, response }) })
      .catch(() => { if (active) setResult(null) })
      .finally(() => clearTimeout(timeout))
    return () => { active = false; controller.abort(); clearTimeout(timeout) }
    // `plan` is derived from `rows`; `key` is its identity for this purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, origin])

  return useMemo(
    () => enabled && result?.key === key ? interpretInteractionCheck(plan, rows, result.response) : null,
    [enabled, key, plan, result, rows],
  )
}
