import { createModelPrefsStore } from '@/src/application/hooks/ai-generation/create-model-prefs-store'
import { getModelDefinitionOrThrow, SMART_TITLE_MODEL_ID } from '@/src/shared/constants/ai-models.constants'

it('restores an old summary Nano choice as the feature default while keeping the auto-run setting', () => {
  localStorage.setItem('medical-summary-prefs', JSON.stringify({
    state: { modelId: 'gpt-5.4-nano', autoGenerate: false }, version: 0,
  }))
  const store = createModelPrefsStore({
    storageName: 'medical-summary-prefs',
    defaultModelId: 'gemini-3.1-flash-lite',
    initializer: () => ({ modelId: 'gemini-3.1-flash-lite', autoGenerate: true }),
  })
  expect(store.getState()).toMatchObject({ modelId: 'gemini-3.1-flash-lite', autoGenerate: false })
  expect(getModelDefinitionOrThrow(SMART_TITLE_MODEL_ID)).toMatchObject({
    id: 'gpt-5.4-nano', status: 'available', selectable: false,
  })
  localStorage.removeItem('medical-summary-prefs')
})
