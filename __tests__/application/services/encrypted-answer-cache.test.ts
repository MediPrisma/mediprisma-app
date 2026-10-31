/**
 * A write that a newer write overtakes never reaches storage, so it must not
 * tell the clinician 「已存入」 on its own: the newer write carries its answers
 * and decides whether they were kept.
 */
import {
  discardEncryptedAnswers,
  persistEncryptedAnswers,
} from '@/src/application/services/encrypted-answer-cache.service'
import { saveEncryptedCache } from '@/src/infrastructure/cache/encrypted-session-cache'

jest.mock('@/src/infrastructure/cache/encrypted-session-cache', () => ({
  saveEncryptedCache: jest.fn(),
  loadEncryptedCache: jest.fn(),
  removeEncryptedCache: jest.fn(),
}))

/** One pending encryption: `finish` stands for storage accepting or refusing it. */
interface PendingWrite { finish: (storageAccepts: boolean) => void }

const pending: PendingWrite[] = []
beforeEach(() => {
  pending.length = 0
  jest.mocked(saveEncryptedCache).mockImplementation((_key, _value, shouldCommit = () => true) => (
    new Promise<boolean>((resolve) => {
      pending.push({
        // Same contract as the real cache: an overtaken write skips storage and resolves true.
        finish: (storageAccepts) => resolve(!shouldCommit() ? true : storageAccepts),
      })
    })
  ))
})

describe('persistEncryptedAnswers', () => {
  it('reports an overtaken write as lost when the write that replaced it fails', async () => {
    const first = persistEncryptedAnswers('vitals:a', { bodyWeight: 60 })
    const second = persistEncryptedAnswers('vitals:a', { bodyWeight: 60, pulse: 80 })
    pending[0].finish(true)
    pending[1].finish(false)
    await expect(second).resolves.toBe(false)
    await expect(first).resolves.toBe(false)
  })

  it('reports an overtaken write as kept once the write that replaced it is stored', async () => {
    const first = persistEncryptedAnswers('vitals:b', { bodyWeight: 60 })
    const second = persistEncryptedAnswers('vitals:b', { bodyWeight: 60, pulse: 80 })
    pending[1].finish(true)
    pending[0].finish(true)
    await expect(first).resolves.toBe(true)
    await expect(second).resolves.toBe(true)
  })

  it('follows a chain of replacements to the newest write', async () => {
    const first = persistEncryptedAnswers('vitals:c', { bodyWeight: 60 })
    persistEncryptedAnswers('vitals:c', { bodyWeight: 60, pulse: 80 })
    persistEncryptedAnswers('vitals:c', { bodyWeight: 60, pulse: 80, sbp: 130 })
    pending[0].finish(true)
    pending[1].finish(true)
    pending[2].finish(false)
    await expect(first).resolves.toBe(false)
  })

  it('treats a write that a clear overtook as settled', async () => {
    const first = persistEncryptedAnswers('vitals:d', { bodyWeight: 60 })
    discardEncryptedAnswers('vitals:d')
    pending[0].finish(true)
    await expect(first).resolves.toBe(true)
  })

  it('reports a write nobody overtook as it went', async () => {
    const kept = persistEncryptedAnswers('vitals:e', { bodyWeight: 60 })
    pending[0].finish(true)
    await expect(kept).resolves.toBe(true)
    const lost = persistEncryptedAnswers('vitals:e', { bodyWeight: 61 })
    pending[1].finish(false)
    await expect(lost).resolves.toBe(false)
  })
})
