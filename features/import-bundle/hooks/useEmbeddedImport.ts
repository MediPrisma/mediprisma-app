"use client"

import { useEffect, useRef } from 'react'
import { useImportBundle } from './useImportBundle'
import {
  EMBED_READY,
  EMBED_SOURCE_APP,
  EMBED_VERSION,
  importedReply,
  isAllowedEmbedParent,
  isEmbedImportMessage,
} from '../services/embedded-import'

/**
 * While this app is framed, takes a Bundle from an allowlisted parent page
 * (services/embedded-import.ts), imports it through the same path as the
 * import button, and answers with the Patient ids now loaded. Does nothing
 * when the app is not framed.
 */
export function useEmbeddedImport() {
  const { importFile, loadedPatientIds } = useImportBundle()
  const importRef = useRef({ importFile, loadedPatientIds })
  useEffect(() => { importRef.current = { importFile, loadedPatientIds } }, [importFile, loadedPatientIds])

  useEffect(() => {
    if (typeof window === 'undefined' || window.parent === window) return
    const receive = async (event: MessageEvent) => {
      if (event.source !== window.parent || !isAllowedEmbedParent(event.origin, location.origin)) return
      const data: unknown = event.data
      if (!isEmbedImportMessage(data)) return
      const answer = (reply: ReturnType<typeof importedReply>) => window.parent.postMessage(reply, event.origin)
      try {
        const file = new File([data.bundle], data.filename || 'assistant-record.json', { type: 'application/fhir+json' })
        await importRef.current.importFile(file)
        const patientIds = await importRef.current.loadedPatientIds()
        answer(importedReply(data.requestId, { ok: true, patientIds }))
      } catch (error) {
        answer(importedReply(data.requestId, { ok: false, error: error instanceof Error ? error.message : '匯入失敗' }))
      }
    }
    window.addEventListener('message', receive)
    // Tells the parent the listener is in place; carries nothing of any patient.
    window.parent.postMessage({ source: EMBED_SOURCE_APP, type: EMBED_READY, version: EMBED_VERSION }, '*')
    return () => window.removeEventListener('message', receive)
  }, [])
}

/** Mounts the embedded import once for the whole app; renders nothing. */
export function EmbeddedImportBridge() {
  useEmbeddedImport()
  return null
}
