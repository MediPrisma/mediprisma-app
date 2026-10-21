/**
 * A switch is a statement about one person's chart.
 *
 * Three properties are worth a test because getting any of them wrong reads
 * as a considered clinical judgement rather than as a bug, or leaves patient
 * data readable: the switches survive a reload of the tab, they never leak
 * from one patient into the next, and nothing about them is ever kept in the
 * clear — including what earlier builds left behind.
 */
import {
  evidenceOverridesStorageKey,
  getEvidenceOverrides,
  useEvidenceOverridesStore,
} from '@/features/clinical-decision-support/stores/evidence-overrides.store'
import {
  expectSealedEnvelope,
  sealAnswers,
  storedCiphertext,
  until,
  useRealWebCrypto,
} from './encrypted-answers.helper'

const PLAINTEXT_KEY_A = 'cdss-evidence-overrides:patient-a'
const PLAINTEXT_KEY_B = 'cdss-evidence-overrides:patient-b'

const hydrated = (patientId: string) => Boolean(useEvidenceOverridesStore.getState().hydratedPatientIds[patientId])

/** A reload of this tab: memory gone, storage and the session key kept. */
function reload(): void {
  useEvidenceOverridesStore.setState({ byPatientId: {}, hydratedPatientIds: {} })
}

/**
 * A write still encrypting when a test ends would land in the next test's
 * storage. Clearing cancels it — the same token a clear in the app uses.
 */
function cancelBackgroundWrites(): void {
  for (const patientId of ['patient-a', 'patient-b']) {
    useEvidenceOverridesStore.getState().clearOverrides(patientId)
  }
}

describe('evidence override store', () => {
  useRealWebCrypto()

  beforeEach(() => {
    window.localStorage.clear()
    reload()
  })
  afterEach(cancelBackgroundWrites)

  it('records a switch per patient and keeps patients apart', () => {
    const { hydrate, setOverride } = useEvidenceOverridesStore.getState()
    hydrate('patient-a')
    hydrate('patient-b')

    setOverride('patient-a', 'congestion:cxr', false)
    setOverride('patient-b', 'congestion:jvp', true)

    expect(getEvidenceOverrides('patient-a')).toEqual({ 'congestion:cxr': false })
    expect(getEvidenceOverrides('patient-b')).toEqual({ 'congestion:jvp': true })
  })

  it('seals the switches under a key namespaced by patient id, never in the clear', async () => {
    useEvidenceOverridesStore.getState().hydrate('patient-a')
    useEvidenceOverridesStore.getState().setOverride('patient-a', 'congestion:cxr', false)

    expect(evidenceOverridesStorageKey('patient-a')).toBe('cdss-evidence-row-overrides:patient-a')
    expectSealedEnvelope(await storedCiphertext(evidenceOverridesStorageKey('patient-a')), ['congestion'])
    expect(window.localStorage.getItem(evidenceOverridesStorageKey('patient-b'))).toBeNull()
    expect(window.localStorage.getItem(PLAINTEXT_KEY_A)).toBeNull()
  })

  it('hydrates a chart with nothing stored in the same tick', () => {
    useEvidenceOverridesStore.getState().hydrate('patient-a')
    expect(hydrated('patient-a')).toBe(true)
    expect(getEvidenceOverrides('patient-a')).toEqual({})
  })

  it('reads the sealed switches back after a reload of the tab', async () => {
    useEvidenceOverridesStore.getState().hydrate('patient-a')
    useEvidenceOverridesStore.getState().setOverride('patient-a', 'congestion:cxr', false)
    await storedCiphertext(evidenceOverridesStorageKey('patient-a'))

    reload()
    useEvidenceOverridesStore.getState().hydrate('patient-a')
    expect(hydrated('patient-a')).toBe(false)
    await until(() => hydrated('patient-a'), 'patient-a to hydrate')

    expect(getEvidenceOverrides('patient-a')).toEqual({ 'congestion:cxr': false })
  })

  it('keeps a switch flipped while the read is in flight, and the stored ones beside it', async () => {
    useEvidenceOverridesStore.getState().hydrate('patient-a')
    useEvidenceOverridesStore.getState().setOverride('patient-a', 'congestion:cxr', false)
    const first = await storedCiphertext(evidenceOverridesStorageKey('patient-a'))

    reload()
    useEvidenceOverridesStore.getState().hydrate('patient-a')
    useEvidenceOverridesStore.getState().setOverride('patient-a', 'congestion:jvp', true)
    await until(() => hydrated('patient-a'), 'patient-a to hydrate')
    expect(getEvidenceOverrides('patient-a')).toEqual({ 'congestion:cxr': false, 'congestion:jvp': true })
    // The merged switches are written back once the read lands, in the background.
    await until(
      () => window.localStorage.getItem(evidenceOverridesStorageKey('patient-a')) !== first,
      'the merged switches to be written',
    )

    reload()
    useEvidenceOverridesStore.getState().hydrate('patient-a')
    await until(() => hydrated('patient-a'), 'patient-a to hydrate again')
    expect(getEvidenceOverrides('patient-a')).toEqual({ 'congestion:cxr': false, 'congestion:jvp': true })
  })

  it('hydrates only once, so a stored value never overwrites a newer switch', async () => {
    await sealAnswers(evidenceOverridesStorageKey('patient-a'), { 'congestion:cxr': false })
    const { hydrate, setOverride } = useEvidenceOverridesStore.getState()

    hydrate('patient-a')
    await until(() => hydrated('patient-a'), 'patient-a to hydrate')
    setOverride('patient-a', 'congestion:cxr', true)
    hydrate('patient-a')

    expect(getEvidenceOverrides('patient-a')).toEqual({ 'congestion:cxr': true })
  })

  it('drops a read that lands after the chart moved on, and reads it again on return', async () => {
    await sealAnswers(evidenceOverridesStorageKey('patient-a'), { 'congestion:cxr': false })
    await sealAnswers(evidenceOverridesStorageKey('patient-b'), { 'congestion:jvp': true })

    useEvidenceOverridesStore.getState().hydrate('patient-a')
    useEvidenceOverridesStore.getState().hydrate('patient-b')
    await until(() => hydrated('patient-b'), 'patient-b to hydrate')
    await new Promise((resolve) => { setTimeout(resolve, 100) })
    expect(hydrated('patient-a')).toBe(false)
    expect(getEvidenceOverrides('patient-a')).toEqual({})

    useEvidenceOverridesStore.getState().hydrate('patient-a')
    await until(() => hydrated('patient-a'), 'patient-a to hydrate on return')
    expect(getEvidenceOverrides('patient-a')).toEqual({ 'congestion:cxr': false })
  })

  it('clears one patient and its sealed copy without touching another', async () => {
    const { clearOverrides, hydrate, setOverride } = useEvidenceOverridesStore.getState()
    hydrate('patient-a')
    hydrate('patient-b')
    setOverride('patient-a', 'congestion:cxr', false)
    setOverride('patient-b', 'congestion:jvp', true)
    await storedCiphertext(evidenceOverridesStorageKey('patient-a'))
    await storedCiphertext(evidenceOverridesStorageKey('patient-b'))

    clearOverrides('patient-a')

    expect(getEvidenceOverrides('patient-a')).toEqual({})
    expect(window.localStorage.getItem(evidenceOverridesStorageKey('patient-a'))).toBeNull()
    expect(getEvidenceOverrides('patient-b')).toEqual({ 'congestion:jvp': true })
    expect(window.localStorage.getItem(evidenceOverridesStorageKey('patient-b'))).not.toBeNull()
  })

  it('drops a read still in flight when the chart is cleared, rather than bringing the switches back', async () => {
    await sealAnswers(evidenceOverridesStorageKey('patient-a'), { 'congestion:cxr': false })

    useEvidenceOverridesStore.getState().hydrate('patient-a')
    expect(hydrated('patient-a')).toBe(false)
    useEvidenceOverridesStore.getState().clearOverrides('patient-a')
    await new Promise((resolve) => { setTimeout(resolve, 100) })

    expect(getEvidenceOverrides('patient-a')).toEqual({})
    expect(hydrated('patient-a')).toBe(true)
  })

  it('removes the sealed copy when the last switch is taken back to nothing', async () => {
    useEvidenceOverridesStore.getState().hydrate('patient-a')
    useEvidenceOverridesStore.getState().setOverride('patient-a', 'congestion:cxr', false)
    await storedCiphertext(evidenceOverridesStorageKey('patient-a'))

    useEvidenceOverridesStore.getState().clearOverrides('patient-a')
    expect(window.localStorage.getItem(evidenceOverridesStorageKey('patient-a'))).toBeNull()
  })

  it('degrades to no overrides when storage holds something unusable', async () => {
    window.localStorage.setItem(evidenceOverridesStorageKey('patient-a'), 'not json')
    useEvidenceOverridesStore.getState().hydrate('patient-a')
    await until(() => hydrated('patient-a'), 'patient-a to hydrate')
    expect(getEvidenceOverrides('patient-a')).toEqual({})
    // What cannot be read is purged rather than left to linger.
    expect(window.localStorage.getItem(evidenceOverridesStorageKey('patient-a'))).toBeNull()

    reload()
    await sealAnswers(evidenceOverridesStorageKey('patient-a'), { 'congestion:cxr': 'no', 'congestion:jvp': true })
    useEvidenceOverridesStore.getState().hydrate('patient-a')
    await until(() => hydrated('patient-a'), 'patient-a to hydrate again')
    expect(getEvidenceOverrides('patient-a')).toEqual({ 'congestion:jvp': true })
  })

  it('keeps a switch for the session when storage refuses the write', async () => {
    const storage = window.localStorage
    const original = storage.setItem
    storage.setItem = () => {
      throw new Error('QuotaExceededError')
    }

    try {
      useEvidenceOverridesStore.getState().hydrate('patient-a')
      useEvidenceOverridesStore.getState().setOverride('patient-a', 'congestion:cxr', false)
      await new Promise((resolve) => { setTimeout(resolve, 50) })
      expect(getEvidenceOverrides('patient-a')).toEqual({ 'congestion:cxr': false })
    } finally {
      storage.setItem = original
    }
  })
})

describe('evidence override store · plaintext left by earlier builds', () => {
  useRealWebCrypto()

  beforeEach(() => {
    window.localStorage.clear()
    reload()
  })
  afterEach(cancelBackgroundWrites)

  it('removes every patient\'s plaintext copy the first time a chart is read, and reads none of it', () => {
    window.localStorage.setItem(PLAINTEXT_KEY_A, JSON.stringify({ 'congestion:cxr': false }))
    window.localStorage.setItem(PLAINTEXT_KEY_B, JSON.stringify({ 'congestion:jvp': true }))
    window.localStorage.setItem('cdss-af-answers:patient-a', 'kept')

    useEvidenceOverridesStore.getState().hydrate('patient-a')

    expect(window.localStorage.getItem(PLAINTEXT_KEY_A)).toBeNull()
    expect(window.localStorage.getItem(PLAINTEXT_KEY_B)).toBeNull()
    // Only the old prefix is swept: another store's key is not this store's to remove.
    expect(window.localStorage.getItem('cdss-af-answers:patient-a')).toBe('kept')
    // The chart reads as a first visit — the plaintext switch is not carried over.
    expect(hydrated('patient-a')).toBe(true)
    expect(getEvidenceOverrides('patient-a')).toEqual({})
  })

  it('leaves this session\'s sealed copy alone when it sweeps again after a reload', async () => {
    useEvidenceOverridesStore.getState().hydrate('patient-a')
    useEvidenceOverridesStore.getState().setOverride('patient-a', 'congestion:cxr', false)
    await storedCiphertext(evidenceOverridesStorageKey('patient-a'))

    reload()
    useEvidenceOverridesStore.getState().hydrate('patient-a')
    await until(() => hydrated('patient-a'), 'patient-a to hydrate')

    expect(getEvidenceOverrides('patient-a')).toEqual({ 'congestion:cxr': false })
    expect(window.localStorage.getItem(evidenceOverridesStorageKey('patient-a'))).not.toBeNull()
  })
})
