'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { BUNDLE_CHANGED_EVENT } from '@/src/shared/utils/reset-on-bundle-change'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { shouldUseLocalBundle } from '@/src/infrastructure/fhir/client/fhir-client.service'
import { captureHfCallerAuth } from '@/src/infrastructure/hf-risk/caller-auth'
import { hfRecordSource, type HfRecordSource } from '@/src/core/hf-risk/record-source'
import { buildMedcloudHfInput, medcloudHfVisits, type HfVisit } from '@/src/core/hf-risk/medcloud-input'
import { HF_DRY_RUN_CLAIMS, type HfInput, type HfSelection, type HfDryRunResult, type HfDryRunClaim } from '@/src/core/hf-risk/contract'
import { emptyHfDiagnosisDraft, withPhysicianHfDiagnosis, type HfPhysicianDiagnosisDraft } from '@/src/core/hf-risk/physician-diagnosis'
import { hasHfDiagnosis } from '@/src/core/hf-risk/input-summary'
import type { HfPredictionResult } from '@/src/core/hf-risk/prediction-result'
import { hfAuthPolicy, hfGatewayUrl, requestHfDryRun, requestHfPrediction, type HfRequestOptions } from '@/src/infrastructure/hf-risk/dry-run-client'

function subscribeToRecordChange(onChange: () => void) {
  window.addEventListener(BUNDLE_CHANGED_EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(BUNDLE_CHANGED_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}
function recordSnapshot() {
  return JSON.stringify([shouldUseLocalBundle(), LocalBundleService.getActiveImportId()])
}
const serverRecordSnapshot = () => '[false,null]'
/** One horizon's outcome: its input check, then its prediction, or the error that stopped it. */
export interface HfClaimRun { check?: HfDryRunResult; prediction?: HfPredictionResult; error?: string }
export type HfClaimRuns = Partial<Record<HfDryRunClaim, HfClaimRun>>
interface Context {
  importId: string
  source: HfRecordSource
  bundle: object
  visits: HfVisit[]
  selection: HfSelection
  input: HfInput
  baseInput: HfInput
  diagnosisDraft: HfPhysicianDiagnosisDraft
}
export function useMedcloudHfDryRun() {
  const origin = process.env.NEXT_PUBLIC_HF_GATEWAY_ORIGIN ?? ''
  let configured = false
  const policySetting = process.env.NEXT_PUBLIC_HF_AUTH_POLICY
  try { configured = !!origin && !!hfGatewayUrl(origin) && !!hfAuthPolicy(policySetting) } catch { /* Render a configuration notice; no network fallback. */ }
  const snapshot = useSyncExternalStore(subscribeToRecordChange, recordSnapshot, serverRecordSnapshot)
  const [localMode, activeImportId] = JSON.parse(snapshot) as [boolean, string | null]
  const [context, setContext] = useState<Context | null>(null)
  const [run, setRun] = useState<{ importId: string; input: HfInput; claims: HfClaimRuns } | null>(null)
  const [message, setMessage] = useState<{ importId: string | null; code: string } | null>(null)
  const [busyImportId, setBusyImportId] = useState<string | null>(null)
  const busy = busyImportId !== null && busyImportId === activeImportId
  const controller = useRef<AbortController | null>(null)
  const unsubscribeAuth = useRef<(() => void) | null>(null)
  const preparation = useRef(0)
  const [observedSnapshot, setObservedSnapshot] = useState(snapshot)
  // Reset during a scope-changing render so old attestations cannot reappear on a return to the same import.
  if (observedSnapshot !== snapshot) {
    setObservedSnapshot(snapshot)
    setContext(null)
    setRun(null)
    setMessage(null)
    setBusyImportId(null)
  }
  const current = localMode && context?.importId === activeImportId ? context : null
  const visibleRuns = run?.importId === activeImportId && run.input === current?.input ? run.claims : null
  const visibleMessage = (localMode || message?.code === 'source-unsupported') && message && message.importId === activeImportId ? message.code : null
  useEffect(() => () => { controller.current?.abort(); controller.current = null; unsubscribeAuth.current?.(); unsubscribeAuth.current = null }, [activeImportId, localMode])

  function cancel() {
    controller.current?.abort()
    unsubscribeAuth.current?.()
    unsubscribeAuth.current = null
    setRun(null)
    setMessage(null)
  }
  async function prepare() {
    cancel()
    setBusyImportId(null)
    // Only the latest preparation may write; an older one finishing late must not clear a newer record.
    const generation = ++preparation.current
    const importId = LocalBundleService.getActiveImportId()
    try {
      if (!shouldUseLocalBundle() || !importId) throw new Error('source-unsupported')
      const bundle = await LocalBundleService.load()
      if (generation !== preparation.current) return
      if (LocalBundleService.getActiveImportId() !== importId || !shouldUseLocalBundle()) throw new Error('source-changed')
      const visits = medcloudHfVisits(bundle)
      if (!visits.length) throw new Error('no-visit')
      const selection: HfSelection = { provider: visits[0].provider, encounter: visits[0].reference, claim: HF_DRY_RUN_CLAIMS[0] }
      const input = buildMedcloudHfInput(bundle, selection)
      setContext({ importId, source: hfRecordSource(bundle!), bundle: bundle!, visits, selection, input, baseInput: input, diagnosisDraft: emptyHfDiagnosisDraft() })
    } catch (error) {
      if (generation !== preparation.current) return
      setContext(null)
      setMessage({ importId, code: error instanceof Error ? error.message : 'bundle-invalid' })
    }
  }
  function select(selection: HfSelection) {
    if (!current) return
    cancel()
    setBusyImportId(null)
    try {
      const input = buildMedcloudHfInput(current.bundle, selection)
      setContext({ ...current, selection, input, baseInput: input, diagnosisDraft: emptyHfDiagnosisDraft() })
    }
    catch { setMessage({ importId: current.importId, code: 'source-changed' }) }
  }
  function supplementDiagnosis(draft: HfPhysicianDiagnosisDraft) {
    if (!current || busy) return
    cancel()
    try {
      setContext({ ...current, diagnosisDraft: draft, input: withPhysicianHfDiagnosis(current.baseInput, draft) })
    } catch (error) {
      setContext({ ...current, diagnosisDraft: { ...draft, confirmed: false }, input: current.baseInput })
      setMessage({ importId: current.importId, code: error instanceof Error ? error.message : 'physician-diagnosis-invalid' })
    }
  }
  /** Checks, then scores, every outpatient horizon in parallel from the same prepared input. */
  async function submit(operation: 'dry-run' | 'predict') {
    if (!current || !configured || busy || current.input.gaps.some(gap => gap.code === 'index-diagnosis-missing') || !hasHfDiagnosis(current.input)) return
    const snapshot = current
    const abort = new AbortController()
    controller.current?.abort()
    unsubscribeAuth.current?.()
    unsubscribeAuth.current = null
    controller.current = abort
    setBusyImportId(snapshot.importId)
    setRun({ importId: snapshot.importId, input: snapshot.input, claims: {} })
    setMessage(null)
    const stillCurrent = () => !abort.signal.aborted && shouldUseLocalBundle() && LocalBundleService.getActiveImportId() === snapshot.importId
    const update = (claim: HfDryRunClaim, patch: HfClaimRun) => setRun(previous => previous && previous.input === snapshot.input && previous.importId === snapshot.importId
      ? { ...previous, claims: { ...previous.claims, [claim]: { ...previous.claims[claim], ...patch } } }
      : previous)
    const runClaim = async (claim: HfDryRunClaim, options: HfRequestOptions, checkAuthorization: () => Promise<void>) => {
      const input = { ...snapshot.input, claim }
      try {
        const validation = await requestHfDryRun(input, { ...options })
        await checkAuthorization()
        if (!stillCurrent()) return null
        update(claim, { check: validation })
        if (operation === 'dry-run' || validation.verdict !== 'accepted') return null
        const value = await requestHfPrediction(input, { ...options })
        await checkAuthorization()
        if (stillCurrent()) update(claim, { prediction: value })
        return null
      } catch (error) {
        const code = error instanceof Error ? error.message : 'gateway-unavailable'
        // Lost authorization stops every horizon at once, before the other can still score.
        if (code === 'gateway-unauthorized' && stillCurrent()) {
          abort.abort()
          setRun(null)
          setMessage({ importId: snapshot.importId, code })
        }
        return code
      }
    }
    const runAll = async (options: HfRequestOptions, checkAuthorization: () => Promise<void>) => {
      const errors = await Promise.all(HF_DRY_RUN_CLAIMS.map(claim => runClaim(claim, options, checkAuthorization)))
      if (!stillCurrent()) return
      // A failure shared by every horizon is one problem; show it once and keep any completed checks.
      if (errors.every(code => code && code === errors[0])) {
        setMessage({ importId: snapshot.importId, code: errors[0]! })
        return
      }
      HF_DRY_RUN_CLAIMS.forEach((claim, index) => { if (errors[index]) update(claim, { error: errors[index]! }) })
    }
    try {
      const authPolicy = hfAuthPolicy(policySetting)
      if (authPolicy === 'intranet') {
        await runAll({ origin, authPolicy, signal: abort.signal }, async () => {})
        return
      }
      const auth = await captureHfCallerAuth()
      const token = await auth?.getToken()
      if (!stillCurrent()) return
      if (!token || !auth) throw new Error('gateway-unauthorized')
      unsubscribeAuth.current = auth.onIdentityChanged(() => {
        abort.abort()
        setBusyImportId(null)
        setRun(null)
        setMessage({ importId: snapshot.importId, code: 'gateway-unauthorized' })
      })
      const options = { origin, token, signal: abort.signal }
      await runAll(options, async () => {
        // Check authorization between validation and prediction as well as after prediction.
        const refreshedToken = await auth.getToken()
        if (!refreshedToken) throw new Error('gateway-unauthorized')
        options.token = refreshedToken
      })
    } catch (error) {
      if (stillCurrent()) {
        setRun(null)
        setMessage({ importId: snapshot.importId, code: error instanceof Error ? error.message : 'gateway-unavailable' })
      }
    } finally {
      if (controller.current === abort) setBusyImportId(null)
    }
  }
  return {
    current, configured, intranet: policySetting === 'intranet', busy, runs: visibleRuns, message: visibleMessage,
    /** Changes whenever the active record or its source mode changes. */
    recordKey: snapshot,
    prepare, select, supplementDiagnosis, validate: () => submit('dry-run'), predict: () => submit('predict'),
  }
}
