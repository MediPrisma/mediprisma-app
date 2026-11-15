'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { localNetworkPermission } from '@/src/shared/utils/local-network-permission'
import type { MedicationRow } from '../types'
import {
  interactionCheckBody,
  interpretInteractionCheck,
  planInteractionCheck,
  type InteractionReview,
} from '../utils/interaction-check'

const TIMEOUT_MS = 8000
// While Chrome is still asking whether this page may reach the hospital
// network, the request waits on the clinician's answer, not on the service.
const PERMISSION_PROMPT_TIMEOUT_MS = 60_000

/**
 * Where the hospital interaction check stands for the current medication list.
 * Every state is distinct on purpose: "nothing found" must never be drawn for
 * a list that was not checked.
 */
export type InteractionCheckState =
  /** No service in this build, or not the medical view. */
  | { status: 'off' }
  /** Medication list not loaded yet, or the request is in flight. */
  | { status: 'loading' }
  /** Fewer than two ingredient names to send. */
  | { status: 'too-few' }
  /** Chrome refused this page access to the hospital network. */
  | { status: 'blocked' }
  | { status: 'unreachable'; reason: 'timeout' | 'network' | 'http' }
  | { status: 'ok'; review: InteractionReview }

type Outcome =
  | { kind: 'answer'; response: unknown }
  | { kind: 'blocked' }
  | { kind: 'unreachable'; reason: 'timeout' | 'network' | 'http' }

/**
 * Checks the current medication rows against the hospital interaction
 * service. Only ingredient names leave the browser — no patient identifier,
 * dose or date. Mount it once (InteractionCheckRunner); readers use
 * useInteractionCheck so the list is sent once however many places show it.
 */
export function useRunInteractionCheck(rows: MedicationRow[], options: { enabled: boolean; ready: boolean }) {
  const { enabled, ready } = options
  const origin = process.env.NEXT_PUBLIC_DDI_SERVICE_ORIGIN ?? ''
  const plan = useMemo(() => planInteractionCheck(rows), [rows])
  // Re-ask whenever the plan changes, not on every re-render of the same
  // list. The answer is indexed by request position and read back against row
  // ids, so a reordered or regrouped plan must never reuse an older answer.
  const key = JSON.stringify(plan.items)
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ key: string; attempt: number; outcome: Outcome } | null>(null)
  const active = enabled && !!origin && ready && plan.items.length >= 2
  const retry = useCallback(() => setAttempt(n => n + 1), [])

  useEffect(() => {
    if (!active) return
    let live = true
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let permission: PermissionStatus | null = null
    // Granting access later (from the prompt or site settings) asks again
    // without a reload.
    const onPermissionChange = () => { if (permission?.state === 'granted') retry() }
    const settle = (outcome: Outcome) => { if (live) setResult({ key, attempt, outcome }) }
    // Read live: a prompt answered with "block" fails the request in flight.
    const denied = () => permission?.state === 'denied'

    void (async () => {
      permission = await localNetworkPermission(origin)
      if (!live) return
      permission?.addEventListener('change', onPermissionChange)
      if (denied()) return settle({ kind: 'blocked' })
      timer = setTimeout(() => controller.abort(), permission?.state === 'prompt' ? PERMISSION_PROMPT_TIMEOUT_MS : TIMEOUT_MS)
      try {
        const response = await fetch(`${origin}/api/ddi-check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(interactionCheckBody(plan)),
          signal: controller.signal,
        })
        if (!response.ok) return settle({ kind: 'unreachable', reason: 'http' })
        settle({ kind: 'answer', response: await response.json() })
      } catch {
        if (denied()) return settle({ kind: 'blocked' })
        settle({ kind: 'unreachable', reason: controller.signal.aborted ? 'timeout' : 'network' })
      } finally {
        clearTimeout(timer)
      }
    })()
    return () => {
      live = false
      controller.abort()
      clearTimeout(timer)
      permission?.removeEventListener('change', onPermissionChange)
    }
    // `plan` is derived from `rows`; `key` is its identity for this purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key, origin, attempt, retry])

  const state = useMemo<InteractionCheckState>(() => {
    if (!enabled || !origin) return { status: 'off' }
    if (!ready) return { status: 'loading' }
    if (plan.items.length < 2) return { status: 'too-few' }
    if (!result || result.key !== key || result.attempt !== attempt) return { status: 'loading' }
    const { outcome } = result
    if (outcome.kind === 'blocked') return { status: 'blocked' }
    if (outcome.kind === 'unreachable') return { status: 'unreachable', reason: outcome.reason }
    return { status: 'ok', review: interpretInteractionCheck(plan, rows, outcome.response) }
  }, [attempt, enabled, key, origin, plan, ready, result, rows])

  return { state, retry }
}

interface InteractionCheckSnapshot {
  state: InteractionCheckState
  /** The rows the state was computed from; read names and origins from these. */
  rows: MedicationRow[]
  retry: () => void
}

const OFF: InteractionCheckSnapshot = { state: { status: 'off' }, rows: [], retry: () => {} }

export const useInteractionCheckStore = create<InteractionCheckSnapshot & {
  publish: (snapshot: InteractionCheckSnapshot) => void
}>()((set) => ({
  ...OFF,
  publish: (snapshot) => set(snapshot),
}))

/** The current interaction check, as published by InteractionCheckRunner. */
export function useInteractionCheck(): InteractionCheckSnapshot {
  const state = useInteractionCheckStore(s => s.state)
  const rows = useInteractionCheckStore(s => s.rows)
  const retry = useInteractionCheckStore(s => s.retry)
  return { state, rows, retry }
}
