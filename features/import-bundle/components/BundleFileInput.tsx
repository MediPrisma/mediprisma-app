// Shared hidden <input type="file"> for local FHIR-bundle import.
//
// There are two entry points that let a user pick a bundle off their device —
// the header CTA (ImportBundleButton) and the welcome-screen card
// (WelcomeOnboarding). They used to each carry their own <input>, `accept`
// string and change handler, so every import-file change (e.g. accepting .txt)
// had to be made twice. This component is the single source of truth: it owns
// the accepted file types, the input element, and the change → importFile
// behaviour. Both entry points render it and trigger it via the imperative
// `open()` on its ref.
'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { ImportBundleOptions } from '../hooks/useImportBundle'
import { completeProgressiveImport, parseProgressiveImportRequest, PROGRESSIVE_IMPORT_EVENT, PROGRESSIVE_REQUEST_ATTRIBUTE, isProgressiveFailureReason, stopProgressiveImport, useProgressiveImportStore } from '@/src/application/stores/progressive-import.store'

/** File types the local-import picker offers. FHIR Bundles and Health Bank SDK
 *  exports are JSON; some sources ship the same JSON with a `.txt` extension,
 *  so we accept both. Import detects and validates by content. */
export const BUNDLE_FILE_ACCEPT = '.json,.txt,application/json,text/plain'
const HANDOFF_INPUT_STABILITY_DELAY_MS = 1_000

export interface BundleFileInputHandle {
  /** Open the OS file picker. */
  open: () => void
}

interface BundleFileInputProps {
  /** Optional test id forwarded to the underlying <input> (e2e hooks). */
  testId?: string
  /** Import callback from the parent hook instance so loading/errors remain in
   * sync with the visible button or welcome screen. */
  importFile: (file: File, options?: ImportBundleOptions) => Promise<void>
}

export const BundleFileInput = forwardRef<BundleFileInputHandle, BundleFileInputProps>(
  function BundleFileInput({ testId, importFile }, ref) {
    const inputRef = useRef<HTMLInputElement>(null)
    const [handoffReady, setHandoffReady] = useState(false)

    // The Medcloud extension waits for this input before handing the Bundle to
    // the app. Exposing its selector in the server HTML lets the extension find
    // a non-hydrated node; exposing it immediately after mount is still too
    // early on the static /app deployment, whose hydration recovery can replace
    // the node just after first paint. Insert the extension-facing input only
    // after a short stable-client window; the extension observes added nodes.
    // Inputs without a test id are manual-only and can mount immediately.
    useEffect(() => {
      if (!testId) return
      const timer = window.setTimeout(
        () => setHandoffReady(true),
        HANDOFF_INPUT_STABILITY_DELAY_MS,
      )
      return () => window.clearTimeout(timer)
    }, [testId])

    useImperativeHandle(ref, () => ({ open: () => inputRef.current?.click() }), [])

    const onChange = useCallback(
      async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        const rawRequest = e.currentTarget.getAttribute(PROGRESSIVE_REQUEST_ATTRIBUTE)
        e.currentTarget.removeAttribute(PROGRESSIVE_REQUEST_ATTRIBUTE)
        const request = parseProgressiveImportRequest(rawRequest)
        const cancellation = new AbortController()
        if (request) useProgressiveImportStore.setState({ pendingRunId: request.runId })
        const onCancel = (event: Event) => {
          const detail = (event as CustomEvent).detail
          if (request && detail?.runId === request.runId && detail.requestId === request.requestId) {
            const phase = isProgressiveFailureReason(detail.phase) ? detail.phase : 'cancelled'
            stopProgressiveImport(request.runId, phase)
            cancellation.abort(phase)
          }
        }
        window.addEventListener('medcloud:progressive-import-cancelled', onCancel)
        try {
          if (rawRequest && !request) throw new Error('Invalid progressive import request')
          if (file && request) {
            let importId: string | undefined
            await importFile(file, { signal: cancellation.signal, expectedImportId: request.expectedImportId, requireEmpty: request.stage === 'cloud', onCommitted: id => { importId = id } })
            if (!importId) throw new Error('Import did not commit')
            completeProgressiveImport(request, importId)
            window.dispatchEvent(new CustomEvent(PROGRESSIVE_IMPORT_EVENT, { detail: {
              version: 1, requestId: request.requestId, runId: request.runId, stage: request.stage, ok: true, importId, stopped: cancellation.signal.aborted,
            } }))
          } else if (file) await importFile(file)
        } catch {
          if (request) window.dispatchEvent(new CustomEvent(PROGRESSIVE_IMPORT_EVENT, { detail: {
            version: 1, requestId: request.requestId, runId: request.runId, ok: false,
          } }))
          // Error surfaces through the parent hook instance.
        } finally {
          window.removeEventListener('medcloud:progressive-import-cancelled', onCancel)
          if (request && useProgressiveImportStore.getState().pendingRunId === request.runId) useProgressiveImportStore.setState({ pendingRunId: null })
          // Reset so re-picking the SAME file still fires onChange.
          if (inputRef.current) inputRef.current.value = ''
        }
      },
      [importFile],
    )

    if (testId && !handoffReady) return null

    return (
      <input
        ref={inputRef}
        data-testid={testId}
        data-medcloud-progressive={testId ? '1' : undefined}
        type="file"
        accept={BUNDLE_FILE_ACCEPT}
        className="hidden"
        onChange={onChange}
      />
    )
  },
)
