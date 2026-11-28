"use client"

import { useEffect, useRef, useState } from 'react'
import { useImportBundle } from './useImportBundle'
import { useAuth } from '@/src/application/providers/auth.provider'
import { useRightPanel } from '@/src/application/providers/right-panel.provider'
import { usePatient } from '@/src/application/hooks/patient/use-patient-query.hook'
import { useEmbedViewStore } from '@/src/application/stores/embed-view.store'
import {
  EMBED_READY,
  EMBED_SAFETY_TAB,
  EMBED_SOURCE_APP,
  EMBED_VERSION,
  importedReply,
  isAllowedEmbedParent,
  isEmbedImportMessage,
  isEmbedLeftView,
  isEmbedLendSignInMessage,
  isEmbedNavigateMessage,
  isEmbedSignInMessage,
  isEmbedView,
  lentSignInReply,
  navigatedReply,
  shownMessage,
  shownView,
  signedInReply,
} from '../services/embedded-import'

/**
 * While this app is framed, signs in as the parent page's account when it asks
 * (services/embedded-import.ts), lends the parent this browser's own sign-in
 * when it asks for that instead, and takes a Bundle from an allowlisted parent page
 * (services/embedded-import.ts), imports it through the same path as the
 * import button, and answers with the Patient ids now loaded. Shows the view
 * the parent asks for (the record or one of its tabs, 標準摘要 or 自訂摘要), in
 * the 精簡 mode when it asks for that, and tells it which patient and view are
 * shown whenever either changes. Does nothing when the app is not framed.
 */
export function useEmbeddedImport() {
  const { importFile, loadedPatientIds } = useImportBundle()
  const { signInAsEmbeddingAccount, lendSignIn } = useAuth()
  const { revealTab, revealRecord, summaryView } = useRightPanel()
  // The allowlisted parent that handed a record or asked for a view: the only
  // place the frame reports what it shows. Unset, it reports nothing.
  const [parentOrigin, setParentOrigin] = useState<string | null>(null)
  const importRef = useRef({ importFile, loadedPatientIds, signInAsEmbeddingAccount, lendSignIn, revealTab, revealRecord })
  useEffect(() => {
    importRef.current = { importFile, loadedPatientIds, signInAsEmbeddingAccount, lendSignIn, revealTab, revealRecord }
  }, [importFile, loadedPatientIds, signInAsEmbeddingAccount, lendSignIn, revealTab, revealRecord])

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
      if (isEmbedLendSignInMessage(data)) {
        const idToken = await importRef.current.lendSignIn().catch(() => null)
        window.parent.postMessage(lentSignInReply(data.requestId, idToken), event.origin)
        return
      }
      if (isEmbedNavigateMessage(data)) {
        const { view } = data
        if (!isEmbedView(view)) {
          window.parent.postMessage(navigatedReply(data.requestId, { ok: false, error: `沒有「${view.slice(0, 40)}」這個畫面` }), event.origin)
          return
        }
        const embed = useEmbedViewStore.getState()
        if (data.compact !== undefined) embed.setCompact(data.compact)
        // A tab this patient does not have (上次門診 without a hospital visit).
        // Before the record panel is drawn nothing is listed yet; the panel
        // opens the asked tab when it mounts, if it has it.
        const listed = embed.listedLeftTabs
        const missing = isEmbedLeftView(view)
          ? (listed.length > 0 ? !listed.includes(view) : view === 'last-outpatient')
          : view === 'safety' && !embed.listedRightTabs.includes(EMBED_SAFETY_TAB)
        if (missing) {
          window.parent.postMessage(navigatedReply(data.requestId, { ok: false, error: `這位病人沒有「${view}」這個畫面` }), event.origin)
          return
        }
        if (view === 'safety') {
          importRef.current.revealTab(EMBED_SAFETY_TAB)
        } else if (view === 'custom-summary' || view === 'standard-summary') {
          importRef.current.revealTab('medical-summary', { summaryView: view === 'custom-summary' ? 'custom' : 'standard' })
        } else {
          if (isEmbedLeftView(view)) embed.requestLeftTab(view)
          importRef.current.revealRecord()
        }
        setParentOrigin(event.origin)
        const patientIds = await importRef.current.loadedPatientIds().catch(() => [])
        window.parent.postMessage(navigatedReply(data.requestId, { ok: true, view, compact: useEmbedViewStore.getState().compact, patientIds }), event.origin)
        return
      }
      if (!isEmbedImportMessage(data)) return
      const answer = (reply: ReturnType<typeof importedReply>) => window.parent.postMessage(reply, event.origin)
      try {
        const file = new File([data.bundle], data.filename || 'assistant-record.json', { type: 'application/fhir+json' })
        await importRef.current.importFile(file)
        const patientIds = await importRef.current.loadedPatientIds()
        setParentOrigin(event.origin)
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

  useReportShown(parentOrigin, summaryView, loadedPatientIds)
}

/**
 * Tells the parent which patient and which view the frame shows, each time
 * either changes, so it can check both against its own tab and patient.
 */
function useReportShown(parentOrigin: string | null, summaryView: 'standard' | 'custom', loadedPatientIds: () => Promise<string[]>) {
  const panel = useEmbedViewStore((state) => state.panel)
  const rightTab = useEmbedViewStore((state) => state.rightTab)
  const leftTab = useEmbedViewStore((state) => state.leftTab)
  const { patient } = usePatient()
  const view = shownView({ panel, leftTab, rightTab, summaryView })
  const patientKey = patient?.id ?? null
  useEffect(() => {
    if (!parentOrigin || typeof window === 'undefined' || window.parent === window) return
    let cancelled = false
    void loadedPatientIds().catch(() => []).then((patientIds) => {
      if (!cancelled) window.parent.postMessage(shownMessage(view, patientIds), parentOrigin)
    })
    return () => { cancelled = true }
  }, [parentOrigin, view, patientKey, loadedPatientIds])
}

/** Mounts the embedded import once for the whole app; renders nothing. */
export function EmbeddedImportBridge() {
  useEmbeddedImport()
  return null
}
