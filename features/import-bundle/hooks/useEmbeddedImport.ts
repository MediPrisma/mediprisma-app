"use client"

import { useEffect, useRef } from 'react'
import { useImportBundle } from './useImportBundle'
import { useAuth } from '@/src/application/providers/auth.provider'
import {
  EMBED_READY,
  EMBED_SOURCE_APP,
  EMBED_VERSION,
  importedReply,
  isAllowedEmbedParent,
  isEmbedImportMessage,
  isEmbedSignInMessage,
  signedInReply,
} from '../services/embedded-import'

/**
 * While this app is framed, signs in as the parent page's account when it asks
 * (services/embedded-import.ts), and takes a Bundle from an allowlisted parent page
 * (services/embedded-import.ts), imports it through the same path as the
 * import button, and answers with the Patient ids now loaded. Does nothing
 * when the app is not framed.
 */
export function useEmbeddedImport() {
  const { importFile, loadedPatientIds } = useImportBundle()
  const { signInAsEmbeddingAccount } = useAuth()
  const importRef = useRef({ importFile, loadedPatientIds, signInAsEmbeddingAccount })
  useEffect(() => {
    importRef.current = { importFile, loadedPatientIds, signInAsEmbeddingAccount }
  }, [importFile, loadedPatientIds, signInAsEmbeddingAccount])

  useEffect(() => {
    if (typeof window === 'undefined' || window.parent === window) return
    const receive = async (event: MessageEvent) => {
      if (event.source !== window.parent || !isAllowedEmbedParent(event.origin, location.origin)) return
      const data: unknown = event.data
      if (isEmbedSignInMessage(data)) {
        const reply = (result: Parameters<typeof signedInReply>[1]) => window.parent.postMessage(signedInReply(data.requestId, result), event.origin)
        try {
          await importRef.current.signInAsEmbeddingAccount(data.uid, data.token)
          reply({ ok: true })
        } catch (error) {
          reply({ ok: false, error: error instanceof Error ? error.message : '登入失敗' })
        }
        return
      }
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
