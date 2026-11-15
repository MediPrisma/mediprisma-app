import { setDoc, updateDoc } from 'firebase/firestore'
import { FirestoreChatSessionRepository } from '@/src/infrastructure/firebase/repositories/chat-session.repository'
import { createModelExecution, reportModelExecution } from '@/src/shared/utils/ai-model-execution'

jest.mock('@/src/shared/config/firebase.config', () => ({ db: {} }))
jest.mock('firebase/firestore', () => ({
  collection: jest.fn(() => ({})),
  doc: jest.fn(() => ({ id: 'chat-1' })),
  setDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
  Timestamp: { fromDate: (date: Date) => date, now: () => new Date() },
}))

it('retains actual and requested models when a conversation is first saved and subsequently updated', async () => {
  const modelExecution = reportModelExecution(createModelExecution('gemini-4-hydrogen'), 'gemini-3.1-flash-lite')
  const message = { id: 'reply', role: 'assistant' as const, content: 'fixture', timestamp: 1, modelId: 'gemini-3.1-flash-lite', modelExecution }
  const repository = new FirestoreChatSessionRepository()
  await repository.create({ userId: 'test-user', patientId: 'fixture-patient', fhirServerUrl: 'local-bundle', title: 'Test', messages: [message] })
  await repository.update('chat-1', 'test-user', { messages: [message] })
  for (const write of [setDoc, updateDoc]) {
    expect(write).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      messages: [expect.objectContaining({ modelId: 'gemini-3.1-flash-lite', modelExecution })],
    }))
  }
})
