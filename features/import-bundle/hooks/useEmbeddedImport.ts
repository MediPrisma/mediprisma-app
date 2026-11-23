"use client"

import { useEffect, useRef } from 'react'
import { useImportBundle } from './useImportBundle'
import { useAuth } from '@/src/application/providers/auth.provider'
import { useRightPanel } from '@/src/application/providers/right-panel.provider'
import {
  EMBED_READY,
  EMBED_SOURCE_APP,
  EMBED_VERSION,
  importedReply,
  isAllowedEmbedParent,
  isEmbedImportMessage,
  isEmbedNavigateMessage,
  isEmbedSignInMessage,
  isEmbedView,
  navigatedReply,
  signedInReply,
} from '../services/embedded-import'

/**
 * While this app is framed, signs in as the parent page's account when it asks
 * (services/embedded-import.ts), and takes a Bundle from an allowlisted parent page
 * (services/embedded-import.ts), imports it through the same path as the
 * import button, and answers with the Patient ids now loaded. Shows the view
 * the parent asks for (the record, or 自訂摘要). Does nothing when the app is
 * not framed.
 */
export function useEmbeddedImport() {
  const { importFile, loadedPatientIds } = useImportBundle()
  const { signInAsEmbeddingAccount } = useAuth()
  const { revealTab, revealRecord } = useRightPanel()
  const importRef = useRef({ importFile, loadedPatientIds, signInAsEmbeddingAccount, revealTab, revealRecord })
  useEffect(() => {
    importRef.current = { importFile, loadedPatientIds, signInAsEmbeddingAccount, revealTab, revealRecord }
  }, [importFile, loadedPatientIds, signInAsEmbeddingAccount, revealTab, revealRecord])

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
      if (isEmbedNavigateMessage(data)) {
        const { view } = data
        if (!isEmbedView(view)) {
          window.parent.postMessage(navigatedReply(data.requestId, { ok: false, error: `沒有「${view.slice(0, 40)}」這個畫面` }), event.origin)
          return
        }
        if (view === 'custom-summary') importRef.current.revealTab('medical-summary', { summaryView: 'custom' })
        else importRef.current.revealRecord()
        window.parent.postMessage(navigatedReply(data.requestId, { ok: true, view }), event.origin)
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
