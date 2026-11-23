/**
 * Embedded import (features/import-bundle/services/embedded-import.ts and
 * hooks/useEmbeddedImport.ts): MediPrisma framed by the 門診 AI 助理 takes the
 * patient's Bundle only from an allowlisted parent and answers with the
 * Patient it now shows. Synthetic data only.
 */
import { renderHook, act } from '@testing-library/react'

const importFile = jest.fn()
const load = jest.fn()
jest.mock('@/features/import-bundle/hooks/useImportBundle', () => ({
  useImportBundle: () => ({ importFile, loadedPatientIds: () => load() }),
}))
const signIn = jest.fn()
jest.mock('@/src/application/providers/auth.provider', () => ({
  useAuth: () => ({ signInAsEmbeddingAccount: (uid: string, token: string) => signIn(uid, token) }),
}))

const revealTab = jest.fn()
const revealRecord = jest.fn()
jest.mock('@/src/application/providers/right-panel.provider', () => ({
  useRightPanel: () => ({ revealTab: (...args: unknown[]) => revealTab(...args), revealRecord: () => revealRecord() }),
}))

import { isAllowedEmbedParent, isEmbedImportMessage, patientIdsOf } from '@/features/import-bundle/services/embedded-import'
import { useEmbeddedImport } from '@/features/import-bundle/hooks/useEmbeddedImport'

const ASSISTANT = 'https://opd-ai-agent.mediprisma.tw'
const bundle = (id: string) => ({ resourceType: 'Bundle', type: 'collection', entry: [{ resource: { resourceType: 'Patient', id } }] })
const message = (requestId = 'r1') => ({
  source: 'mediprisma-ai-assistant', type: 'mediprisma:embed-import', version: 1, requestId, bundle: JSON.stringify(bundle('sim-v01')),
})

describe('embedded import: who may hand a record', () => {
  it('accepts the assistant, and a local page only while MediPrisma itself runs locally', () => {
    expect(isAllowedEmbedParent(ASSISTANT, 'https://mediprisma.tw')).toBe(true)
    expect(isAllowedEmbedParent('http://localhost:5201', 'https://mediprisma.tw')).toBe(false)
    expect(isAllowedEmbedParent('http://localhost:5201', 'http://localhost:3001')).toBe(true)
    expect(isAllowedEmbedParent('https://opd-ai-agent.mediprisma.tw.evil.example', 'https://mediprisma.tw')).toBe(false)
    expect(isAllowedEmbedParent('https://mediprisma.tw', 'https://mediprisma.tw')).toBe(false)
  })

  it('reads only a well-formed message', () => {
    expect(isEmbedImportMessage(message())).toBe(true)
    expect(isEmbedImportMessage({ ...message(), version: 2 })).toBe(false)
    expect(isEmbedImportMessage({ ...message(), bundle: '' })).toBe(false)
    expect(isEmbedImportMessage(null)).toBe(false)
  })

  it('names the Patient ids of a Bundle', () => {
    expect(patientIdsOf(bundle('sim-v01'))).toEqual(['sim-v01'])
    expect(patientIdsOf(null)).toEqual([])
  })
})

describe('useEmbeddedImport', () => {
  const parent = { postMessage: jest.fn() }
  const original = Object.getOwnPropertyDescriptor(window, 'parent')!

  beforeEach(() => {
    importFile.mockReset().mockResolvedValue(undefined)
    signIn.mockReset().mockResolvedValue(undefined)
    revealTab.mockReset()
    revealRecord.mockReset()
    load.mockReset().mockResolvedValue(['sim-v01'])
    parent.postMessage.mockReset()
    Object.defineProperty(window, 'parent', { configurable: true, value: parent })
  })
  afterEach(() => Object.defineProperty(window, 'parent', original))

  const send = async (data: unknown, origin: string, source: unknown = parent) => {
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { data, origin, source: source as MessageEventSource }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  it('imports a record from the assistant and answers with the Patient now shown, to that origin only', async () => {
    renderHook(() => useEmbeddedImport())
    expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'mediprisma:embed-ready' }), '*')
    await send(message('r7'), ASSISTANT)
    expect(importFile).toHaveBeenCalledTimes(1)
    const file = importFile.mock.calls[0][0] as File
    const text = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(file) })
    expect(text).toBe(JSON.stringify(bundle('sim-v01')))
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'mediprisma:embed-imported', requestId: 'r7', ok: true, patientIds: ['sim-v01'] }), ASSISTANT)
  })

  it('takes nothing from another origin or from a window that is not its parent', async () => {
    renderHook(() => useEmbeddedImport())
    await send(message(), 'https://example.com')
    await send(message(), ASSISTANT, window)
    expect(importFile).not.toHaveBeenCalled()
  })

  it('answers a failed import with the error and no patient', async () => {
    importFile.mockRejectedValue(new Error('格式錯誤'))
    renderHook(() => useEmbeddedImport())
    await send(message('r9'), ASSISTANT)
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestId: 'r9', ok: false, error: '格式錯誤' }), ASSISTANT)
    expect(load).not.toHaveBeenCalled()
  })

  const signInMessage = (requestId = 's1') => ({
    source: 'mediprisma-ai-assistant', type: 'mediprisma:embed-sign-in', version: 1, requestId, uid: 'uid-synthetic', token: 'custom-token',
  })

  it("signs in as the assistant's account and answers that origin only", async () => {
    renderHook(() => useEmbeddedImport())
    await send(signInMessage('s2'), ASSISTANT)
    expect(signIn).toHaveBeenCalledWith('uid-synthetic', 'custom-token')
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'mediprisma:embed-signed-in', requestId: 's2', ok: true }), ASSISTANT)
    expect(importFile).not.toHaveBeenCalled()
  })

  it('takes no sign-in from another origin, and answers a failed one with the error', async () => {
    renderHook(() => useEmbeddedImport())
    await send(signInMessage(), 'https://example.com')
    expect(signIn).not.toHaveBeenCalled()
    signIn.mockRejectedValue(new Error('auth/invalid-custom-token'))
    await send(signInMessage('s3'), ASSISTANT)
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestId: 's3', ok: false, error: 'auth/invalid-custom-token' }), ASSISTANT)
  })

  const navigateMessage = (view: string, requestId = 'n1') => ({
    source: 'mediprisma-ai-assistant', type: 'mediprisma:embed-navigate', version: 1, requestId, view,
  })

  it('shows 自訂摘要 or the record when the assistant asks, and answers which', async () => {
    renderHook(() => useEmbeddedImport())
    await send(navigateMessage('custom-summary', 'n2'), ASSISTANT)
    expect(revealTab).toHaveBeenCalledWith('medical-summary', { summaryView: 'custom' })
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'mediprisma:embed-navigated', requestId: 'n2', ok: true, view: 'custom-summary' }), ASSISTANT)
    await send(navigateMessage('record', 'n3'), ASSISTANT)
    expect(revealRecord).toHaveBeenCalledTimes(1)
    expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ requestId: 'n3', ok: true, view: 'record' }), ASSISTANT)
  })

  it('answers a view it does not have as not shown, and moves nothing for another origin', async () => {
    renderHook(() => useEmbeddedImport())
    await send(navigateMessage('custom-summary'), 'https://example.com')
    await send(navigateMessage('last-visit', 'n4'), ASSISTANT)
    expect(revealTab).not.toHaveBeenCalled()
    expect(revealRecord).not.toHaveBeenCalled()
    expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ requestId: 'n4', ok: false }), ASSISTANT)
  })

  it('does nothing when the app is not framed', async () => {
    Object.defineProperty(window, 'parent', original)
    renderHook(() => useEmbeddedImport())
    await send(message(), ASSISTANT, window)
    expect(importFile).not.toHaveBeenCalled()
  })
})
