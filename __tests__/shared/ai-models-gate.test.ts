// gateModel is the single graceful-degradation rule every AI call relies on:
// a key-required model the user has no key for must downgrade to the free,
// proxy-eligible default model — never dead-end with "API key is missing".
import {
  gateModel,
  gateModelForAgentSupport,
  gateModelForKeys,
  DEFAULT_MODEL_ID,
  CUSTOM_OPENAI_MODEL_ID,
} from '@/src/shared/constants/ai-models.constants'

describe('gateModel — downgrade stranded premium models', () => {
  it('leaves a free (proxy-eligible) model untouched, with or without a key', () => {
    expect(gateModel('gemini-3.1-flash-lite', false)).toBe('gemini-3.1-flash-lite')
    expect(gateModel('gemini-3.1-flash-lite', true)).toBe('gemini-3.1-flash-lite')
    // Gemini 4 Hydrogen is now a second free (proxy-eligible) Gemini tier
    expect(gateModel('gemini-4-hydrogen', false)).toBe('gemini-4-hydrogen')
    expect(gateModel('gemini-4-hydrogen', true)).toBe('gemini-4-hydrogen')
    expect(gateModel('gemini-4-hydrogen', false)).toBe('gemini-4-hydrogen')
    expect(gateModel('gemini-4-hydrogen', true)).toBe('gemini-4-hydrogen')
  })

  it('keeps a key-required model when the user HAS the provider key', () => {
    expect(gateModel('gemini-4-argon', true)).toBe('gemini-4-argon')
    expect(gateModel('gpt-6.1-terra', true)).toBe('gpt-6.1-terra')
  })

  it('downgrades a key-required model to the free default when no key', () => {
    // every stranded premium pick lands on the one free default, regardless of
    // its original provider — a single predictable fallback.
    expect(gateModel('gemini-4-argon', false)).toBe(DEFAULT_MODEL_ID)
    expect(gateModel('gpt-6.1-terra', false)).toBe(DEFAULT_MODEL_ID)
    expect(gateModel('claude-opus-5-5', false)).toBe(DEFAULT_MODEL_ID)
  })

  it('falls back to the default for an unknown model id', () => {
    expect(gateModel('totally-made-up', false)).toBe(DEFAULT_MODEL_ID)
    expect(gateModel('totally-made-up', false, 'gpt-5.4-nano')).toBe('gpt-5.4-nano')
  })
})

// gateModelForKeys is what agent chat calls: it owns the user's three provider
// keys and must downgrade exactly like the shared stream adapter does.
describe('gateModelForKeys — provider-key-aware gate (agent chat)', () => {
  it('downgrades a key-required model to the free default when no matching key', () => {
    expect(gateModelForKeys('claude-opus-5-5', {})).toBe(DEFAULT_MODEL_ID)
    expect(gateModelForKeys('gemini-4-argon', {})).toBe(DEFAULT_MODEL_ID)
    expect(gateModelForKeys('gpt-6.1-terra', {})).toBe(DEFAULT_MODEL_ID)
  })

  it('keeps a key-required model when the matching provider key IS present', () => {
    expect(gateModelForKeys('claude-opus-5-5', { claudeKey: 'k' })).toBe('claude-opus-5-5')
    expect(gateModelForKeys('gemini-4-argon', { geminiKey: 'k' })).toBe('gemini-4-argon')
    expect(gateModelForKeys('gpt-6.1-terra', { openAiKey: 'k' })).toBe('gpt-6.1-terra')
  })

  it('falls back for a retired GPT model even if an OpenAI key still exists', () => {
    expect(gateModelForKeys('gpt-5.5', { openAiKey: 'k' })).toBe(DEFAULT_MODEL_ID)
  })

  it('a key for a DIFFERENT provider does not rescue the pick', () => {
    // Opus needs a Claude key; Gemini/OpenAI keys must not keep it on Opus.
    expect(gateModelForKeys('claude-opus-5-5', { geminiKey: 'k', openAiKey: 'k' })).toBe(DEFAULT_MODEL_ID)
  })

  it('leaves a free (proxy-eligible) model untouched regardless of keys', () => {
    expect(gateModelForKeys('gemini-4-hydrogen', {})).toBe('gemini-4-hydrogen')
    expect(gateModelForKeys('gemini-4-hydrogen', {})).toBe('gemini-4-hydrogen')
    expect(gateModelForKeys('gemini-4-hydrogen', { geminiKey: 'k' })).toBe('gemini-4-hydrogen')
    expect(gateModelForKeys('gemini-3.1-flash-lite', { claudeKey: 'k' })).toBe('gemini-3.1-flash-lite')
  })

  it('keeps a hospital-model choice fail-closed instead of falling back to a proxy model', () => {
    expect(gateModelForKeys(CUSTOM_OPENAI_MODEL_ID, {})).toBe(CUSTOM_OPENAI_MODEL_ID)
  })
})

describe('gateModelForAgentSupport — tool-calling compatibility', () => {
  it('keeps a supported model and rejects an unknown persisted id', () => {
    expect(gateModelForAgentSupport('gemini-4-hydrogen')).toBe('gemini-4-hydrogen')
    expect(gateModelForAgentSupport('removed-model')).toBe(DEFAULT_MODEL_ID)
  })
})
