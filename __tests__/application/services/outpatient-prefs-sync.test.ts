import {
  MAX_SYNCED_CHARS,
  mergeOutpatientPrefs,
  syncOutpatientPrefsForAccount,
} from '@/src/application/services/outpatient-prefs-sync'
import {
  EMPTY_OUTPATIENT_PREFS,
  useOutpatientPrefsStore,
  type EmrCustomFormat,
  type OutpatientPrefs,
} from '@/src/application/stores/outpatient-prefs.store'
import { doc, onSnapshot, runTransaction } from 'firebase/firestore'
import { BUILTIN_MED_COPY_FORMATS } from '@/features/clinical-summary/medications/utils/medication-copy-text'

jest.mock('@/src/shared/config/firebase.config', () => ({ db: {} }))
jest.mock('firebase/firestore', () => ({
  doc: jest.fn((_db, ...path) => path.join('/')),
  onSnapshot: jest.fn(),
  runTransaction: jest.fn(),
}))

const store = useOutpatientPrefsStore
const format = (id: string, name = id): EmrCustomFormat => ({
  id,
  name,
  tokens: [{ kind: 'text', text: name }],
  labRule: 'sameDay',
  missingText: '—',
  dateStyle: 'md',
  emptyLines: 'omit',
})
const prefs = (patch: Partial<OutpatientPrefs>): OutpatientPrefs => ({ ...EMPTY_OUTPATIENT_PREFS, ...patch })
const remoteField = (patch: Partial<OutpatientPrefs>, updatedAt: number) => ({ ...prefs(patch), updatedAt })
const snapshot = (field?: object, fromCache = false, hasPendingWrites = false) => ({
  metadata: { fromCache, hasPendingWrites },
  data: () => (field === undefined ? { email: 'doc@example.org' } : { email: 'doc@example.org', outpatientPrefs: field }),
})
const local = (key = 'a') => store.getState().byUser[key]
const meta = (key = 'a') => store.getState().syncMeta[key]
const status = (key = 'a') => store.getState().syncStatus[key]
const settle = async () => { await jest.advanceTimersByTimeAsync(1000) }

let emit: (value: ReturnType<typeof snapshot>) => void
let fail: (error: Error) => void
let unsubscribe: jest.Mock
let stop: (() => void) | undefined
/** What the account holds, as the transaction reads it. */
let account: object | undefined
let transaction: { get: jest.Mock; set: jest.Mock }

beforeEach(() => {
  jest.useFakeTimers()
  jest.clearAllMocks()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  localStorage.clear()
  store.setState({ byUser: {}, syncMeta: {}, syncStatus: {} })
  account = undefined
  unsubscribe = jest.fn()
  ;(onSnapshot as jest.Mock).mockImplementation((_ref, _options, next, error) => {
    emit = next
    fail = error
    return unsubscribe
  })
  transaction = {
    get: jest.fn(async () => snapshot(account)),
    set: jest.fn((_ref, data) => { account = data.outpatientPrefs }),
  }
  ;(runTransaction as jest.Mock).mockImplementation(async (_db, body) => body(transaction))
})
afterEach(() => {
  stop?.()
  stop = undefined
  jest.useRealTimers()
  jest.restoreAllMocks()
})

it('restores the account settings in a fresh browser without writing them back', async () => {
  stop = syncOutpatientPrefsForAccount('a')
  emit(snapshot(remoteField({ pinnedLabs: ['chem:CREA'], formats: [format('f1')] }, 100)))
  await settle()
  expect(local()?.pinnedLabs).toEqual(['chem:CREA'])
  expect(local()?.formats.map((f) => f.id)).toEqual(['f1'])
  expect(meta()).toMatchObject({ updatedAt: 100, dirty: false, baseUpdatedAt: 100 })
  expect(meta()?.base?.pinnedLabs).toEqual(['chem:CREA'])
  expect(runTransaction).not.toHaveBeenCalled()
  expect(doc).toHaveBeenCalledWith({}, 'users', 'a')
})

it('saves an edit to the account field only, leaving the profile alone', async () => {
  stop = syncOutpatientPrefsForAccount('a')
  emit(snapshot(remoteField({}, 100)))
  await settle()
  store.getState().update('a', { pinnedLabs: ['chem:K'] })
  expect(meta()?.dirty).toBe(true)
  await settle()
  expect(transaction.set).toHaveBeenCalledTimes(1)
  const [ref, data, options] = transaction.set.mock.calls[0]
  expect(ref).toBe('users/a')
  expect(options).toEqual({ mergeFields: ['outpatientPrefs'] })
  expect(data.outpatientPrefs.pinnedLabs).toEqual(['chem:K'])
  expect(Object.keys(data)).toEqual(['outpatientPrefs'])
  expect(meta()).toMatchObject({ dirty: false, baseUpdatedAt: data.outpatientPrefs.updatedAt })
  expect(status()).toBe('synced')
})

it('waits for a burst of edits and saves once', async () => {
  stop = syncOutpatientPrefsForAccount('a')
  emit(snapshot(remoteField({}, 100)))
  store.getState().update('a', { labMode: 'abnormal' })
  store.getState().update('a', { labMode: 'mine' })
  store.getState().update('a', { pinnedLabs: ['chem:CREA'] })
  await settle()
  expect(transaction.set).toHaveBeenCalledTimes(1)
  expect(account).toMatchObject({ labMode: 'mine', pinnedLabs: ['chem:CREA'] })
})

it('takes a change saved on another device while this one has nothing unsaved', async () => {
  stop = syncOutpatientPrefsForAccount('a')
  emit(snapshot(remoteField({ pinnedLabs: ['chem:CREA'] }, 100)))
  await settle()
  emit(snapshot(remoteField({ pinnedLabs: ['chem:CREA', 'chem:K'], formats: [format('f2')] }, 200)))
  await settle()
  expect(local()?.pinnedLabs).toEqual(['chem:CREA', 'chem:K'])
  expect(local()?.formats.map((f) => f.id)).toEqual(['f2'])
  expect(runTransaction).not.toHaveBeenCalled()
})

it('ignores cached and not-yet-committed snapshots', async () => {
  stop = syncOutpatientPrefsForAccount('a')
  emit(snapshot(remoteField({ pinnedLabs: ['chem:CREA'] }, 100), true))
  emit(snapshot(remoteField({ pinnedLabs: ['chem:K'] }, 100), false, true))
  await settle()
  expect(local()).toBeUndefined()
})

it('carries this account’s own settings from before sync into an empty account', async () => {
  // Saved by the previous build: settings, no sync bookkeeping.
  store.setState({ byUser: { a: prefs({ pinnedLabs: ['chem:CREA'], formats: [format('f1')] }) }, syncMeta: {} })
  stop = syncOutpatientPrefsForAccount('a')
  emit(snapshot())
  await settle()
  expect(account).toMatchObject({ pinnedLabs: ['chem:CREA'] })
  expect((account as { formats: EmrCustomFormat[] }).formats.map((f) => f.id)).toEqual(['f1'])
  expect(meta()?.dirty).toBe(false)
})

it('never carries guest, anonymous or another account’s settings into an account', async () => {
  store.getState().update('guest', { formats: [format('guest-format')] })
  store.getState().update('anon-uid', { pinnedLabs: ['chem:K'] })
  store.getState().update('b', { pinnedLabs: ['chem:ALT'] })
  stop = syncOutpatientPrefsForAccount('a')
  emit(snapshot())
  await settle()
  expect(runTransaction).not.toHaveBeenCalled()
  expect(local()).toBeUndefined()
  expect(local('guest')?.formats.map((f) => f.id)).toEqual(['guest-format'])
})

it('on the first sync here, keeps the account’s choices and adds formats made here', async () => {
  store.setState({
    byUser: { a: prefs({ pinnedLabs: ['chem:ALT'], formats: [format('here')], labMode: 'all' }) },
    syncMeta: {},
  })
  account = remoteField({ pinnedLabs: ['chem:CREA'], formats: [format('there')], labMode: 'mine' }, 100)
  stop = syncOutpatientPrefsForAccount('a')
  emit(snapshot(account))
  await settle()
  expect(local()?.pinnedLabs).toEqual(['chem:CREA'])
  expect(local()?.labMode).toBe('mine')
  expect(local()?.formats.map((f) => f.id)).toEqual(['there', 'here'])
  expect((account as { formats: EmrCustomFormat[] }).formats.map((f) => f.id)).toEqual(['there', 'here'])
  expect(meta()?.dirty).toBe(false)
})

it('merges when both devices changed: every format kept, the newer choice wins', async () => {
  stop = syncOutpatientPrefsForAccount('a')
  emit(snapshot(remoteField({ pinnedLabs: ['chem:CREA'], formats: [format('f1')] }, 100)))
  await settle()
  // Another device adds a format while this one edits the pinned list.
  account = remoteField({ pinnedLabs: ['chem:CREA'], formats: [format('f1'), format('other-device')] }, 150)
  jest.setSystemTime(10_000)
  store.getState().update('a', { pinnedLabs: ['chem:K'], formats: [format('f1'), format('this-device')] })
  await settle()
  const saved = account as OutpatientPrefs & { updatedAt: number }
  expect(saved.pinnedLabs).toEqual(['chem:K'])
  expect(saved.formats.map((f) => f.id)).toEqual(['f1', 'this-device', 'other-device'])
  expect(local()?.formats.map((f) => f.id)).toEqual(['f1', 'this-device', 'other-device'])
  expect(meta()).toMatchObject({ dirty: false, baseUpdatedAt: saved.updatedAt })
})

it('sends an edit left unsaved by a closed tab or an outage when the account is next read', async () => {
  store.getState().update('a', { pinnedLabs: ['chem:ALT'] })
  store.getState().setSyncMeta('a', { ...meta()!, baseUpdatedAt: 100, base: prefs({ pinnedLabs: ['chem:CREA'] }) })
  account = remoteField({ pinnedLabs: ['chem:CREA'] }, 100)
  stop = syncOutpatientPrefsForAccount('a')
  emit(snapshot(account))
  await settle()
  expect(account).toMatchObject({ pinnedLabs: ['chem:ALT'] })
  expect(meta()?.dirty).toBe(false)
})

it('keeps the settings here, still unsaved, when the account refuses; clears on the next success', async () => {
  stop = syncOutpatientPrefsForAccount('a')
  emit(snapshot(remoteField({}, 100)))
  await settle()
  ;(runTransaction as jest.Mock).mockRejectedValueOnce(new Error('permission-denied'))
  store.getState().update('a', { pinnedLabs: ['chem:K'] })
  await settle()
  expect(status()).toBe('error')
  expect(local()?.pinnedLabs).toEqual(['chem:K'])
  expect(meta()?.dirty).toBe(true)
  expect(JSON.parse(localStorage.getItem('mediprisma-outpatient-prefs')!).state.syncStatus).toBeUndefined()
  // Reconnect: the next account read retries the unsaved edit.
  emit(snapshot(remoteField({}, 100)))
  await settle()
  expect(account).toMatchObject({ pinnedLabs: ['chem:K'] })
  expect(status()).toBe('synced')
  expect(meta()?.dirty).toBe(false)
})

it('reports an account it cannot read without touching the settings', async () => {
  store.getState().update('a', { pinnedLabs: ['chem:K'] })
  stop = syncOutpatientPrefsForAccount('a')
  fail(new Error('unavailable'))
  expect(status()).toBe('error')
  expect(local()?.pinnedLabs).toEqual(['chem:K'])
})

it('keeps an edit made while a save is on its way and sends it next', async () => {
  stop = syncOutpatientPrefsForAccount('a')
  emit(snapshot(remoteField({}, 100)))
  await settle()
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  transaction.get.mockImplementationOnce(async () => { await gate; return snapshot(account) })
  store.getState().update('a', { pinnedLabs: ['chem:K'] })
  await jest.advanceTimersByTimeAsync(700)
  store.getState().update('a', { pinnedLabs: ['chem:K', 'chem:ALT'] })
  release()
  await settle()
  await settle()
  expect(local()?.pinnedLabs).toEqual(['chem:K', 'chem:ALT'])
  expect(account).toMatchObject({ pinnedLabs: ['chem:K', 'chem:ALT'] })
  expect(meta()?.dirty).toBe(false)
})

it('refuses to write settings past the size limit and says so', async () => {
  stop = syncOutpatientPrefsForAccount('a')
  emit(snapshot(remoteField({}, 100)))
  await settle()
  const big = Array.from({ length: 20 }, (_, i) => ({
    ...format(`f${i}`),
    tokens: Array.from({ length: 30 }, () => ({ kind: 'text' as const, text: 'x'.repeat(500) })),
  }))
  expect(JSON.stringify(big).length).toBeGreaterThan(MAX_SYNCED_CHARS)
  store.getState().update('a', { formats: big })
  await settle()
  expect(transaction.set).not.toHaveBeenCalled()
  expect(status()).toBe('error')
  expect(local()?.formats).toHaveLength(20)
})

it('stops reading and writing an account after sign-out or a switch', async () => {
  stop = syncOutpatientPrefsForAccount('a')
  const oldEmit = emit
  emit(snapshot(remoteField({}, 100)))
  await settle()
  store.getState().update('a', { pinnedLabs: ['chem:K'] })
  stop()
  stop = undefined
  expect(unsubscribe).toHaveBeenCalled()
  await settle()
  oldEmit(snapshot(remoteField({ pinnedLabs: ['chem:CREA'] }, 300)))
  await settle()
  expect(runTransaction).not.toHaveBeenCalled()
  expect(local()?.pinnedLabs).toEqual(['chem:K'])
  // Still unsaved: it goes up the next time this account signs in here.
  expect(meta()?.dirty).toBe(true)
})

// ── PR #173 review ─────────────────────────────────────────────────────
// Who wins is decided per format and per choice, against the copy both sides
// started from — never by whichever whole copy was saved last.

const savedFormats = () => (account as { formats: EmrCustomFormat[] }).formats
const savedNames = () => savedFormats().map((f) => `${f.id}:${f.name}`)

it('keeps an unsaved format edit here when another device later changed something else', async () => {
  stop = syncOutpatientPrefsForAccount('a')
  emit(snapshot(remoteField({ formats: [format('f1', 'old')] }, 100)))
  await settle()
  // Edited here while the account could not be reached.
  ;(runTransaction as jest.Mock).mockRejectedValueOnce(new Error('unavailable'))
  jest.setSystemTime(1_000)
  store.getState().update('a', { formats: [format('f1', 'edited here')] })
  await settle()
  expect(meta()?.dirty).toBe(true)
  // Later, another device only switched the lab filter.
  account = remoteField({ formats: [format('f1', 'old')], labMode: 'abnormal' }, 5_000)
  emit(snapshot(account))
  await settle()
  expect(savedNames()).toEqual(['f1:edited here'])
  expect(account).toMatchObject({ labMode: 'abnormal' })
  expect(local()?.formats.map((f) => f.name)).toEqual(['edited here'])
  expect(local()?.labMode).toBe('abnormal')
})

it('keeps a format edited on another device when this one later changed something else', async () => {
  stop = syncOutpatientPrefsForAccount('a')
  emit(snapshot(remoteField({ formats: [format('g', 'old')] }, 100)))
  await settle()
  // Another device edits the format; this one has not seen it yet.
  account = remoteField({ formats: [format('g', 'edited there')] }, 5_000)
  jest.setSystemTime(9_000)
  store.getState().update('a', { pinnedLabs: ['chem:K'] })
  await settle()
  expect(savedNames()).toEqual(['g:edited there'])
  expect(account).toMatchObject({ pinnedLabs: ['chem:K'] })
  expect(local()?.formats.map((f) => f.name)).toEqual(['edited there'])
})

it('does not bring back a format deleted while a save was on its way', async () => {
  stop = syncOutpatientPrefsForAccount('a')
  emit(snapshot(remoteField({ formats: [format('f1'), format('f2')] }, 100)))
  await settle()
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  transaction.get.mockImplementationOnce(async () => { await gate; return snapshot(account) })
  store.getState().update('a', { pinnedLabs: ['chem:K'] })
  await jest.advanceTimersByTimeAsync(700)
  // Deleted while the pinned-list save waits on the account.
  store.getState().update('a', { formats: [format('f1')] })
  release()
  await settle()
  await settle()
  expect(local()?.formats.map((f) => f.id)).toEqual(['f1'])
  expect(savedFormats().map((f) => f.id)).toEqual(['f1'])
  expect(account).toMatchObject({ pinnedLabs: ['chem:K'] })
  expect(meta()?.dirty).toBe(false)
})

it('keeps an edit made here before this browser first read the account', async () => {
  // Signed in, edited, and the account not read yet (slow or no network).
  jest.setSystemTime(9_000)
  store.getState().update('a', { pinnedLabs: ['chem:ALT'] })
  expect(meta()).toMatchObject({ dirty: true, baseUpdatedAt: null })
  account = remoteField({ pinnedLabs: ['chem:CREA'], formats: [format('f1')] }, 100)
  stop = syncOutpatientPrefsForAccount('a')
  emit(snapshot(account))
  await settle()
  expect(local()?.pinnedLabs).toEqual(['chem:ALT'])
  expect(local()?.formats.map((f) => f.id)).toEqual(['f1'])
  expect(account).toMatchObject({ pinnedLabs: ['chem:ALT'] })
  expect(meta()?.dirty).toBe(false)
})

it('keeps a format one device edited when the other deleted it', async () => {
  stop = syncOutpatientPrefsForAccount('a')
  emit(snapshot(remoteField({ formats: [format('f1', 'old'), format('f2')] }, 100)))
  await settle()
  account = remoteField({ formats: [format('f1', 'edited there'), format('f2')] }, 5_000)
  jest.setSystemTime(9_000)
  store.getState().update('a', { formats: [format('f2')] })
  await settle()
  expect(savedNames()).toEqual(['f2:f2', 'f1:edited there'])
})

// ── PR #173 review, round 2 ────────────────────────────────────────────
// An account update that arrives while a save of ours is pending is kept and
// read once the save settles — never dropped.

const stampOf = () => (account as { updatedAt: number }).updatedAt

it('takes another device’s change that arrives between back-to-back saves', async () => {
  stop = syncOutpatientPrefsForAccount('a')
  emit(snapshot(remoteField({ pinnedLabs: ['chem:CREA'] }, 100)))
  await settle()
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  transaction.get.mockImplementationOnce(async () => { await gate; return snapshot(account) })
  store.getState().update('a', { pinnedLabs: ['chem:K'] })
  await jest.advanceTimersByTimeAsync(700)
  // A second edit while the first save waits: it schedules its own save.
  store.getState().update('a', { pinnedLabs: ['chem:K', 'chem:ALT'] })
  release()
  // Both edits go up (the second right after the first) before that
  // scheduled save comes due.
  await jest.advanceTimersByTimeAsync(10)
  expect(account).toMatchObject({ pinnedLabs: ['chem:K', 'chem:ALT'] })
  // Another device now switches the filter.
  account = { ...(account as object), labMode: 'abnormal', updatedAt: stampOf() + 1_000 }
  emit(snapshot(account))
  await settle()
  expect(local()?.labMode).toBe('abnormal')
  expect(local()?.pinnedLabs).toEqual(['chem:K', 'chem:ALT'])
  expect(meta()).toMatchObject({ dirty: false, baseUpdatedAt: stampOf() })
})

it('takes another device’s change whose update arrives while a save is on its way', async () => {
  stop = syncOutpatientPrefsForAccount('a')
  emit(snapshot(remoteField({ pinnedLabs: ['chem:CREA'] }, 100)))
  await settle()
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  transaction.get.mockImplementationOnce(async () => { await gate; return snapshot(account) })
  store.getState().update('a', { pinnedLabs: ['chem:K'] })
  await jest.advanceTimersByTimeAsync(700)
  // The other device saves right after ours lands (so it holds our list),
  // and its update reaches this browser before our save reports back.
  const other = remoteField({ pinnedLabs: ['chem:K'], labMode: 'abnormal' }, Date.now() + 60_000)
  emit(snapshot(other))
  release()
  await settle()
  expect(local()?.labMode).toBe('abnormal')
  expect(local()?.pinnedLabs).toEqual(['chem:K'])
  expect(meta()).toMatchObject({ dirty: false, baseUpdatedAt: other.updatedAt })
})

it('does not roll back to an older account copy delivered after a save', async () => {
  stop = syncOutpatientPrefsForAccount('a')
  emit(snapshot(remoteField({ pinnedLabs: ['chem:CREA'] }, 100)))
  await settle()
  store.getState().update('a', { pinnedLabs: ['chem:K'] })
  await settle()
  expect(account).toMatchObject({ pinnedLabs: ['chem:K'] })
  emit(snapshot(remoteField({ pinnedLabs: ['chem:CREA'] }, 100)))
  await settle()
  expect(local()?.pinnedLabs).toEqual(['chem:K'])
  expect(meta()?.dirty).toBe(false)
})

describe('mergeOutpatientPrefs (three-way)', () => {
  const base = prefs({ pinnedLabs: ['chem:CREA'], labMode: 'pinned', formats: [format('f1'), format('f2')] })
  const names = (merged: OutpatientPrefs) => merged.formats.map((f) => `${f.id}:${f.name}`)

  it('takes each change from the side that made it, whichever copy is newer', () => {
    const mine = prefs({ ...base, formats: [format('f1', 'mine'), format('f2')] })
    const theirs = prefs({ ...base, labMode: 'abnormal' })
    for (const mineIsNewer of [true, false]) {
      const merged = mergeOutpatientPrefs(base, mine, theirs, mineIsNewer)
      expect(names(merged)).toEqual(['f1:mine', 'f2:f2'])
      expect(merged.labMode).toBe('abnormal')
    }
  })

  it('gives a format or choice both sides changed to the newer side', () => {
    const mine = prefs({ ...base, labMode: 'mine', formats: [format('f1', 'mine'), format('f2')] })
    const theirs = prefs({ ...base, labMode: 'all', formats: [format('f1', 'theirs'), format('f2')] })
    expect(mergeOutpatientPrefs(base, mine, theirs, true)).toMatchObject({ labMode: 'mine' })
    expect(names(mergeOutpatientPrefs(base, mine, theirs, true))).toEqual(['f1:mine', 'f2:f2'])
    expect(mergeOutpatientPrefs(base, mine, theirs, false)).toMatchObject({ labMode: 'all' })
    expect(names(mergeOutpatientPrefs(base, mine, theirs, false))).toEqual(['f1:theirs', 'f2:f2'])
  })

  it('honours a deletion the other side did not touch, and keeps additions from both', () => {
    const mine = prefs({ ...base, formats: [format('f1'), format('mine-new')] })
    const theirs = prefs({ ...base, formats: [format('f1'), format('f2'), format('their-new')] })
    expect(names(mergeOutpatientPrefs(base, mine, theirs, false))).toEqual(['f1:f1', 'mine-new:mine-new', 'their-new:their-new'])
  })

  it('never lets a deletion beat an edit', () => {
    const mine = prefs({ ...base, formats: [format('f1')] })
    const theirs = prefs({ ...base, formats: [format('f1'), format('f2', 'edited')] })
    expect(names(mergeOutpatientPrefs(base, mine, theirs, true))).toEqual(['f1:f1', 'f2:edited'])
    expect(names(mergeOutpatientPrefs(base, theirs, mine, true))).toEqual(['f1:f1', 'f2:edited'])
  })
})

describe('mergeOutpatientPrefs — 用藥複製格式', () => {
  const medFormat = (numbering: 'dot' | 'dash') => ({
    ...BUILTIN_MED_COPY_FORMATS['builtin:standard'],
    id: 'mine',
    numbering,
  })

  it('is one choice: the side that changed it wins, apart from the lab formats', () => {
    const base = prefs({ medFormat: medFormat('dot') })
    const mine = prefs({ ...base, formats: [format('f-mine')] })
    const theirs = prefs({ ...base, medFormat: medFormat('dash') })
    const merged = mergeOutpatientPrefs(base, mine, theirs, true)
    expect(merged.medFormat?.numbering).toBe('dash')
    expect(merged.formats.map((f) => f.id)).toEqual(['f-mine'])
  })

  it('when both changed it, the newer side wins', () => {
    const base = prefs({ medFormat: null })
    const mine = prefs({ medFormat: medFormat('dot') })
    const theirs = prefs({ medFormat: medFormat('dash') })
    expect(mergeOutpatientPrefs(base, mine, theirs, true).medFormat?.numbering).toBe('dot')
    expect(mergeOutpatientPrefs(base, mine, theirs, false).medFormat?.numbering).toBe('dash')
  })

  it('sends the med format to the account field', async () => {
    stop = syncOutpatientPrefsForAccount('a')
    emit(snapshot(remoteField({}, 100)))
    await settle()
    jest.setSystemTime(20_000)
    store.getState().update('a', { medFormat: medFormat('dash') })
    await settle()
    const saved = account as OutpatientPrefs & { updatedAt: number }
    expect(saved.medFormat?.numbering).toBe('dash')
  })
})
