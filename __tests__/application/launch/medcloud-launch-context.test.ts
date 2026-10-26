import { webcrypto } from 'crypto'
import {
  isVghtpeUnattendedLaunch,
  createVghtpeTvghbrainRuntimeProfile,
  decryptVghtpeMedcloudCredential,
  isMedcloudAutoLaunchUrl,
  isVghtpeLaunchUrl,
  MEDCLOUD_AUTO_LAUNCH_URL,
  getLaunchWorkstation,
  parseMedcloudLaunchOptions,
  parseMedcloudLaunchContext,
  VGTPE_SITE_LAUNCH_URL,
  VGTPE_HMC_MEDCLOUD_LAUNCH_URL,
  VGTPE_HMC_SITE_LAUNCH_URL,
  VGTPE_MEDCLOUD_LAUNCH_URL,
  VGTPE_TVGHBRAIN_BASE_URL,
  VGTPE_TVGHBRAIN_MODEL_ID,
} from '@/src/application/launch/medcloud-launch-context'
import { resolveOpenAiCompatibleConversationMode } from '@/src/shared/utils/openai-compatible.utils'

const ENCRYPTED_RUNTIME_SECRET =
  'a256gcm.v1.AAECAwQFBgcICQoL.xdA13rrC_SiHbJycmQY.VPy_M14qGoZF29EY9sG1Qw'
const jsdomCrypto = globalThis.crypto

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
})

afterAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: jsdomCrypto, configurable: true })
})

describe('medcloud launch context', () => {
  it('parses medcloud automation and VGH site routing as independent controls', () => {
    expect(parseMedcloudLaunchOptions('https://mediprisma.tw/app/')).toEqual({
      auto: false,
      site: null,
      workstation: null,
    })
    expect(parseMedcloudLaunchOptions(MEDCLOUD_AUTO_LAUNCH_URL)).toEqual({
      auto: true,
      site: null,
      workstation: null,
    })
    expect(parseMedcloudLaunchOptions(VGTPE_SITE_LAUNCH_URL)).toEqual({
      auto: false,
      site: 'vghtpe',
      workstation: null,
    })
    expect(parseMedcloudLaunchOptions(VGTPE_MEDCLOUD_LAUNCH_URL)).toEqual({
      auto: true,
      site: 'vghtpe',
      workstation: null,
    })
    expect(parseMedcloudLaunchOptions(VGTPE_HMC_MEDCLOUD_LAUNCH_URL)).toEqual({
      auto: true,
      site: 'vghtpe',
      workstation: null,
    })
    expect(parseMedcloudLaunchOptions(VGTPE_HMC_SITE_LAUNCH_URL)).toEqual({
      auto: false,
      site: 'vghtpe',
      workstation: null,
    })
    expect(parseMedcloudLaunchOptions(
      'https://mediprisma.tw/app/?site=vghtpe&medcloud2=auto',
    )).toEqual({ auto: true, site: 'vghtpe', workstation: null })
    expect(isMedcloudAutoLaunchUrl(MEDCLOUD_AUTO_LAUNCH_URL)).toBe(true)
    expect(isMedcloudAutoLaunchUrl(VGTPE_SITE_LAUNCH_URL)).toBe(false)
    expect(isVghtpeLaunchUrl(VGTPE_SITE_LAUNCH_URL)).toBe(true)
    expect(isVghtpeLaunchUrl(MEDCLOUD_AUTO_LAUNCH_URL)).toBe(false)
  })

  it('rejects ambiguous or untrusted launch controls', () => {
    expect(parseMedcloudLaunchOptions(
      'https://evil.example/app/?medcloud2=auto&site=vghtpe',
    )).toBeNull()
    expect(parseMedcloudLaunchOptions(
      'https://mediprisma.tw/app/?medcloud2=auto&site=vghtpe&site=evil',
    )).toBeNull()
    expect(parseMedcloudLaunchOptions(
      'https://mediprisma.tw/app/?medcloud2=manual&site=vghtpe',
    )).toBeNull()
    expect(parseMedcloudLaunchOptions(
      'https://mediprisma.tw/app?medcloud2=auto&site=vghtpe',
    )).toBeNull()
    expect(parseMedcloudLaunchOptions(
      'https://mediprisma.tw/app/?medcloud2=auto&site=vghtpe&extra=1',
    )).toBeNull()
    expect(parseMedcloudLaunchOptions(
      'https://mediprisma.tw/app/?medcloud2=auto&site=vghtpe#extra',
    )).toBeNull()
  })

  it('carries a workstation / clinic-room code alongside the existing controls', () => {
    expect(parseMedcloudLaunchOptions(
      'https://mediprisma.tw/app/?medcloud2=auto&site=vghtpe&ws=OPD-3F-01',
    )).toEqual({ auto: true, site: 'vghtpe', workstation: 'OPD-3F-01' })
    // The Extension may hand over the site route without the unattended flow.
    expect(parseMedcloudLaunchOptions(
      'https://mediprisma.tw/app/?site=vghtpe&ws=ws_12',
    )).toEqual({ auto: false, site: 'vghtpe', workstation: 'ws_12' })
    // A code alone still identifies a plain launch.
    expect(parseMedcloudLaunchOptions(
      'https://mediprisma.tw/app/?ws=A',
    )).toEqual({ auto: false, site: null, workstation: 'A' })
    expect(parseMedcloudLaunchOptions(
      `https://mediprisma.tw/app/?ws=${'w'.repeat(32)}`,
    )?.workstation).toBe('w'.repeat(32))

    expect(getLaunchWorkstation(
      'https://mediprisma.tw/app/?medcloud2=auto&site=vghtpe&ws=OPD-3F-01',
    )).toBe('OPD-3F-01')
    expect(getLaunchWorkstation(VGTPE_MEDCLOUD_LAUNCH_URL)).toBeNull()
    expect(getLaunchWorkstation('https://evil.example/app/?ws=OPD-3F-01')).toBeNull()

    // The launch controls keep working exactly as before with a code present.
    expect(isMedcloudAutoLaunchUrl(
      'https://mediprisma.tw/app/?medcloud2=auto&site=vghtpe&ws=OPD-3F-01',
    )).toBe(true)
    expect(isVghtpeLaunchUrl(
      'https://mediprisma.tw/app/?site=vghtpe&ws=OPD-3F-01',
    )).toBe(true)
  })

  it('fails the whole launch URL on a malformed workstation code', () => {
    // Fail-closed: a bad code is a launcher bug the operator must see, not
    // something to drop silently.
    expect(parseMedcloudLaunchOptions(
      'https://mediprisma.tw/app/?site=vghtpe&ws=A&ws=B',
    )).toBeNull()
    expect(parseMedcloudLaunchOptions(
      'https://mediprisma.tw/app/?site=vghtpe&ws=',
    )).toBeNull()
    expect(parseMedcloudLaunchOptions(
      'https://mediprisma.tw/app/?site=vghtpe&ws=a b',
    )).toBeNull()
    expect(parseMedcloudLaunchOptions(
      `https://mediprisma.tw/app/?site=vghtpe&ws=${'w'.repeat(33)}`,
    )).toBeNull()
    // The character class keeps person-shaped values out.
    expect(parseMedcloudLaunchOptions(
      'https://mediprisma.tw/app/?site=vghtpe&ws=kuo.yihsin@vghtpe.gov.tw',
    )).toBeNull()
    // An unrelated extra parameter is still rejected, code or not.
    expect(parseMedcloudLaunchOptions(
      'https://mediprisma.tw/app/?site=vghtpe&ws=OPD-3F-01&extra=1',
    )).toBeNull()
    expect(getLaunchWorkstation(
      'https://mediprisma.tw/app/?site=vghtpe&ws=a b',
    )).toBeNull()
  })

  it('validates the encrypted Extension message envelope', () => {
    expect(parseMedcloudLaunchContext({
      source: 'medcloud2-extension',
      type: 'MEDIPRISMA_LAUNCH_CONTEXT',
      version: 1,
      messageId: 'message-1',
      site: 'vghtpe',
      credential: ENCRYPTED_RUNTIME_SECRET,
    })).toEqual({
      messageId: 'message-1',
      site: 'vghtpe',
      credential: ENCRYPTED_RUNTIME_SECRET,
    })
    expect(parseMedcloudLaunchContext({
      source: 'medcloud2-extension',
      type: 'MEDIPRISMA_LAUNCH_CONTEXT',
      version: 1,
      messageId: 'message-default',
    })).toEqual({
      messageId: 'message-default',
    })
    expect(parseMedcloudLaunchContext({
      source: 'medcloud2-extension',
      type: 'MEDIPRISMA_LAUNCH_CONTEXT',
      version: 1,
      messageId: 'message-default-with-vgh-secret',
      credential: ENCRYPTED_RUNTIME_SECRET,
    })).toBeNull()
    expect(parseMedcloudLaunchContext({
      source: 'other-script',
      type: 'MEDIPRISMA_LAUNCH_CONTEXT',
      version: 1,
      messageId: 'message-1',
      site: 'vghtpe',
      credential: ENCRYPTED_RUNTIME_SECRET,
    })).toBeNull()
    expect(parseMedcloudLaunchContext({
      source: 'medcloud2-extension',
      type: 'MEDIPRISMA_LAUNCH_CONTEXT',
      version: 1,
      messageId: 'message-1',
      site: 'vghtpe',
      credential: 'runtime-secret',
    })).toBeNull()
  })

  it('decrypts AES-256-GCM Base64URL credentials and rejects tampering', async () => {
    await expect(
      decryptVghtpeMedcloudCredential(ENCRYPTED_RUNTIME_SECRET),
    ).resolves.toBe('runtime-secret')
    await expect(
      decryptVghtpeMedcloudCredential(`${ENCRYPTED_RUNTIME_SECRET.slice(0, -1)}A`),
    ).resolves.toBeNull()
    await expect(
      decryptVghtpeMedcloudCredential('a256gcm.v1.bad.bad.bad'),
    ).resolves.toBeNull()
  })

  it('creates an Agent-enabled direct runtime-only tvghbrain profile without a baked credential', () => {
    const profile = createVghtpeTvghbrainRuntimeProfile('extension-secret')
    expect(profile).toMatchObject({
      runtimeOnly: true,
      trustedAgentRuntime: true,
      enabled: true,
      baseUrl: VGTPE_TVGHBRAIN_BASE_URL,
      modelId: VGTPE_TVGHBRAIN_MODEL_ID,
      apiKey: 'extension-secret',
      transport: 'direct',
      contextWindowTokens: 262144,
      contextWindowSource: 'suggested',
      agentMode: 'auto',
      agentCapability: 'unknown',
      agentCapabilityTestedAt: null,
    })
    expect(resolveOpenAiCompatibleConversationMode(profile)).toBe('deep-agent')
  })
})

describe('isVghtpeUnattendedLaunch', () => {
  it('is true only for medcloud2=auto together with site=vghtpe on the app origin', () => {
    expect(isVghtpeUnattendedLaunch('https://mediprisma.tw/app/?medcloud2=auto&site=vghtpe')).toBe(true)
    expect(isVghtpeUnattendedLaunch('https://mediprisma.tw/app/?site=vghtpe&medcloud2=auto')).toBe(true)
    expect(isVghtpeUnattendedLaunch('https://mediprisma.tw/app-hmc/?medcloud2=auto&site=vghtpe')).toBe(true)
    expect(isVghtpeUnattendedLaunch('https://mediprisma.tw/app-staging/?medcloud2=auto&site=vghtpe')).toBe(true)
    expect(isVghtpeUnattendedLaunch('https://mediprisma.tw/docs/?medcloud2=auto&site=vghtpe')).toBe(false)
    expect(isVghtpeUnattendedLaunch('https://mediprisma.tw/app-staging/x/?medcloud2=auto&site=vghtpe')).toBe(false)
    expect(isVghtpeUnattendedLaunch('https://mediprisma.tw/app/?medcloud2=auto')).toBe(false)
    expect(isVghtpeUnattendedLaunch('https://mediprisma.tw/app/?site=vghtpe')).toBe(false)
    expect(isVghtpeUnattendedLaunch('https://example.com/app/?medcloud2=auto&site=vghtpe')).toBe(false)
    expect(isVghtpeUnattendedLaunch('')).toBe(false)
  })
})
