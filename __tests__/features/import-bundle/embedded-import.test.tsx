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
const lend = jest.fn()
jest.mock('@/src/application/providers/auth.provider', () => ({
  useAuth: () => ({ signInAsEmbeddingAccount: (uid: string, token: string) => signIn(uid, token), lendSignIn: () => lend() }),
}))

const revealTab = jest.fn()
const revealRecord = jest.fn()
jest.mock('@/src/application/providers/right-panel.provider', () => ({
  useRightPanel: () => ({ revealTab: (...args: unknown[]) => revealTab(...args), revealRecord: () => revealRecord(), summaryView: 'standard' }),
}))
jest.mock('@/src/application/hooks/patient/use-patient-query.hook', () => ({
  usePatient: () => ({ patient: { id: 'sim-v01' } }),
}))

import { isAllowedEmbedParent, isEmbedImportMessage, isEmbedNavigateMessage, patientIdsOf, shownView } from '@/features/import-bundle/services/embedded-import'
import { useEmbeddedImport } from '@/features/import-bundle/hooks/useEmbeddedImport'
import { useEmbedViewStore } from '@/src/application/stores/embed-view.store'

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
    useEmbedViewStore.setState({ compact: false, leftRequest: null, leftTab: null, listedLeftTabs: [], rightTab: null, listedRightTabs: [], panel: 'left' })
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
    expect(parent.postMessage).toHaveBeenCalledWith(
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

  const lendMessage = (requestId = 'l1') => ({ source: 'mediprisma-ai-assistant', type: 'mediprisma:embed-lend-sign-in', version: 1, requestId })

  it("lends this browser's sign-in to the assistant alone, and nothing for a guest", async () => {
    renderHook(() => useEmbeddedImport())
    lend.mockResolvedValue('id-token-synthetic')
    await send(lendMessage(), 'https://example.com')
    expect(lend).not.toHaveBeenCalled()
    await send(lendMessage('l2'), ASSISTANT)
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      { source: 'mediprisma', type: 'mediprisma:embed-lent-sign-in', version: 1, requestId: 'l2', ok: true, idToken: 'id-token-synthetic' }, ASSISTANT)
    lend.mockResolvedValue(null)
    await send(lendMessage('l3'), ASSISTANT)
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      { source: 'mediprisma', type: 'mediprisma:embed-lent-sign-in', version: 1, requestId: 'l3', ok: false }, ASSISTANT)
  })

  const navigateMessage = (view: string, requestId = 'n1') => ({
    source: 'mediprisma-ai-assistant', type: 'mediprisma:embed-navigate', version: 1, requestId, view,
  })

  it('shows 自訂摘要 or the record when the assistant asks, and answers which', async () => {
    renderHook(() => useEmbeddedImport())
    await send(navigateMessage('custom-summary', 'n2'), ASSISTANT)
    expect(revealTab).toHaveBeenCalledWith('medical-summary', { summaryView: 'custom' })
    expect(parent.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'mediprisma:embed-navigated', requestId: 'n2', ok: true, view: 'custom-summary' }), ASSISTANT)
    await send(navigateMessage('record', 'n3'), ASSISTANT)
    expect(revealRecord).toHaveBeenCalledTimes(1)
    expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'n3', ok: true, view: 'record' }), ASSISTANT)
  })

  it('answers a view it does not have as not shown, and moves nothing for another origin', async () => {
    renderHook(() => useEmbeddedImport())
    await send(navigateMessage('custom-summary'), 'https://example.com')
    await send(navigateMessage('timeline', 'n4'), ASSISTANT)
    expect(revealTab).not.toHaveBeenCalled()
    expect(revealRecord).not.toHaveBeenCalled()
    expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ requestId: 'n4', ok: false }), ASSISTANT)
  })

  it('opens any clinical tab, or 標準摘要, and answers with the view, the mode and the patient', async () => {
    useEmbedViewStore.setState({ listedLeftTabs: ['overview', 'patient', 'visits', 'reports', 'meds', 'documents'], leftTab: 'overview' })
    renderHook(() => useEmbeddedImport())
    await send({ ...navigateMessage('meds', 'n5'), compact: true }, ASSISTANT)
    expect(useEmbedViewStore.getState().leftRequest?.tab).toBe('meds')
    expect(useEmbedViewStore.getState().compact).toBe(true)
    expect(revealRecord).toHaveBeenCalledTimes(1)
    expect(parent.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'mediprisma:embed-navigated', requestId: 'n5', ok: true, view: 'meds', compact: true, patientIds: ['sim-v01'] }), ASSISTANT)
    await send(navigateMessage('standard-summary', 'n6'), ASSISTANT)
    expect(revealTab).toHaveBeenCalledWith('medical-summary', { summaryView: 'standard' })
    // A message that does not name the mode leaves it as it is.
    expect(useEmbedViewStore.getState().compact).toBe(true)
    await send({ ...navigateMessage('record', 'n7'), compact: false }, ASSISTANT)
    expect(useEmbedViewStore.getState().compact).toBe(false)
  })

  it('opens 安全 only where this browser has it', async () => {
    renderHook(() => useEmbeddedImport())
    await send(navigateMessage('safety', 'n9'), ASSISTANT)
    expect(revealTab).not.toHaveBeenCalled()
    expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ requestId: 'n9', ok: false }), ASSISTANT)
    useEmbedViewStore.setState({ listedRightTabs: ['medical-summary', 'medication-safety'] })
    await send(navigateMessage('safety', 'n10'), ASSISTANT)
    expect(revealTab).toHaveBeenCalledWith('medication-safety')
    expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'n10', ok: true, view: 'safety' }), ASSISTANT)
  })

  it('answers a tab this patient does not have as not shown, and moves nothing', async () => {
    useEmbedViewStore.setState({ listedLeftTabs: ['overview', 'patient'] })
    renderHook(() => useEmbeddedImport())
    await send(navigateMessage('last-outpatient', 'n8'), ASSISTANT)
    expect(revealRecord).not.toHaveBeenCalled()
    expect(useEmbedViewStore.getState().leftRequest).toBeNull()
    expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ requestId: 'n8', ok: false }), ASSISTANT)
  })

  it('takes the 精簡 mode from the assistant only, and only as a yes or no', async () => {
    expect(isEmbedNavigateMessage({ ...navigateMessage('overview'), compact: 'yes' })).toBe(false)
    renderHook(() => useEmbeddedImport())
    await send({ ...navigateMessage('overview'), compact: true }, 'https://example.com')
    expect(useEmbedViewStore.getState().compact).toBe(false)
  })

  it('reports the patient and view it shows to the assistant once it has spoken, and to nobody before', async () => {
    useEmbedViewStore.setState({ leftTab: 'overview', listedLeftTabs: ['overview', 'meds'] })
    renderHook(() => useEmbeddedImport())
    await send(message('r1'), 'https://example.com')
    expect(parent.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'mediprisma:embed-shown' }), expect.anything())
    await send(message('r2'), ASSISTANT)
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      { source: 'mediprisma', type: 'mediprisma:embed-shown', version: 1, view: 'overview', patientIds: ['sim-v01'] }, ASSISTANT)
    await act(async () => {
      useEmbedViewStore.setState({ leftTab: 'meds' })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'mediprisma:embed-shown', view: 'meds' }), ASSISTANT)
  })

  it('does nothing when the app is not framed', async () => {
    Object.defineProperty(window, 'parent', original)
    renderHook(() => useEmbeddedImport())
    await send(message(), ASSISTANT, window)
    expect(importFile).not.toHaveBeenCalled()
  })
})

describe('shownView', () => {
  it('names the panel on screen: a clinical tab, a 醫療摘要 view, or another feature', () => {
    expect(shownView({ panel: 'left', leftTab: 'reports', rightTab: 'medical-summary', summaryView: 'standard' })).toBe('reports')
    expect(shownView({ panel: 'right', leftTab: 'reports', rightTab: 'medical-summary', summaryView: 'custom' })).toBe('custom-summary')
    expect(shownView({ panel: 'right', leftTab: 'reports', rightTab: 'medical-summary', summaryView: 'standard' })).toBe('standard-summary')
    expect(shownView({ panel: 'right', leftTab: 'reports', rightTab: 'ips-export', summaryView: 'standard' })).toBe('features')
    expect(shownView({ panel: 'right', leftTab: 'reports', rightTab: 'medication-safety', summaryView: 'standard' })).toBe('safety')
    expect(shownView({ panel: 'left', leftTab: null, rightTab: 'medical-summary', summaryView: 'standard' })).toBeNull()
  })
})
