import { customOpenAiModelIdForProfile } from '@/src/shared/constants/ai-models.constants'
import type { OpenAiCompatibleProfile } from '@/src/shared/types/openai-compatible.types'
import { suggestedOpenAiCompatibleContextWindow } from '@/src/shared/types/openai-compatible.types'
import { sanitizeApiKey } from '@/src/shared/utils/api-key.utils'

export const VGTPE_TVGHBRAIN_PROFILE_ID = 'vghtpe-tvghbrain'
export const VGTPE_TVGHBRAIN_BASE_URL = 'https://whisper.vghtpe.gov.tw:30001/v1'
export const VGTPE_TVGHBRAIN_MODEL_ID = 'tvghbrain3.5'
export const VGTPE_TVGHBRAIN_LOGICAL_MODEL_ID = customOpenAiModelIdForProfile(
  VGTPE_TVGHBRAIN_PROFILE_ID,
)

export const MEDCLOUD_LAUNCH_CONTEXT_SOURCE = 'medcloud2-extension'
export const MEDCLOUD_LAUNCH_CONTEXT_TYPE = 'MEDIPRISMA_LAUNCH_CONTEXT'
export const MEDCLOUD_LAUNCH_CONTEXT_ACK_TYPE = 'MEDIPRISMA_LAUNCH_CONTEXT_ACK'

export const MEDIPRISMA_PRODUCTION_ORIGIN = 'https://mediprisma.tw'
export const MEDCLOUD_AUTO_LAUNCH_URL =
  'https://mediprisma.tw/app/?medcloud2=auto'
export const VGTPE_SITE_LAUNCH_URL =
  'https://mediprisma.tw/app/?site=vghtpe'
export const VGTPE_MEDCLOUD_LAUNCH_URL =
  'https://mediprisma.tw/app/?medcloud2=auto&site=vghtpe'
export const VGTPE_HMC_MEDCLOUD_LAUNCH_URL =
  'https://mediprisma.tw/app-hmc/?medcloud2=auto&site=vghtpe'
export const VGTPE_HMC_SITE_LAUNCH_URL =
  'https://mediprisma.tw/app-hmc/?site=vghtpe'
export const VGTPE_MEDCLOUD_DECRYPTION_KEY_BASE64URL =
  'T3oVibAh8qDaZlxykiWSEewbSh9kj4naOHWABviM5Fg'

const MAX_MESSAGE_ID_LENGTH = 128
const MAX_CREDENTIAL_LENGTH = 4096
const AES_256_KEY_LENGTH = 32
const AES_GCM_IV_LENGTH = 12
const AES_GCM_AUTH_TAG_LENGTH = 16
const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+$/
// Any top-level workspace starting with "app" (/app/, /app-hmc/, /app-staging/, ...), as the 雲端病歷 extension accepts.
const MEDIPRISMA_APP_PATH = /^\/app[a-z0-9-]*\/$/

export type MedcloudLaunchContext =
  | {
      messageId: string
      site: 'vghtpe'
      credential: string
    }
  | {
      messageId: string
      site?: undefined
      credential?: never
    }

/** Workstation / clinic-room code supplied by the launcher.
 *
 * Deliberately narrow: letters, digits, `_` and `-`, at most 32 characters.
 * The code identifies a ROOM OR MACHINE, never a person — the character class
 * excludes the `@`, `.` and space that usernames, e-mail addresses and human
 * names carry, so a launcher that reaches for a login name has to notice. */
export const WORKSTATION_CODE_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

export interface MedcloudLaunchOptions {
  auto: boolean
  site: 'vghtpe' | null
  /** `?ws=` code, or null when the launcher did not supply one. */
  workstation: string | null
}

/** Parse only the PHI-free launch controls accepted by the production app.
 * Both the regular app and the HMC preview are valid entry points. The controls
 * are deliberately independent: `medcloud2=auto` owns the
 * unattended workflow, `site=vghtpe` owns hospital routing, and `ws=` names the
 * workstation / clinic room for usage statistics.
 *
 * Fail-closed, including for `ws`: a malformed or repeated code invalidates the
 * WHOLE launch URL rather than being dropped. Silently ignoring it would let a
 * launcher ship a broken (or over-informative) code for months without anyone
 * noticing, and this parser is the app's only gate on what a URL may carry. */
export function parseMedcloudLaunchOptions(
  value: string | URL,
): MedcloudLaunchOptions | null {
  try {
    const url = value instanceof URL ? value : new URL(value)
    if (
      url.origin !== MEDIPRISMA_PRODUCTION_ORIGIN ||
      !MEDIPRISMA_APP_PATH.test(url.pathname) ||
      url.hash !== ''
    ) return null

    let parameterCount = 0
    url.searchParams.forEach(() => {
      parameterCount += 1
    })
    const autoValues = url.searchParams.getAll('medcloud2')
    const siteValues = url.searchParams.getAll('site')
    const workstationValues = url.searchParams.getAll('ws')
    if (
      autoValues.length > 1 ||
      siteValues.length > 1 ||
      workstationValues.length > 1 ||
      parameterCount !== autoValues.length + siteValues.length + workstationValues.length ||
      (autoValues.length === 1 && autoValues[0] !== 'auto') ||
      (siteValues.length === 1 && siteValues[0] !== 'vghtpe') ||
      (workstationValues.length === 1 && !WORKSTATION_CODE_PATTERN.test(workstationValues[0]))
    ) return null

    return {
      auto: autoValues.length === 1,
      site: siteValues.length === 1 ? 'vghtpe' : null,
      workstation: workstationValues.length === 1 ? workstationValues[0] : null,
    }
  } catch {
    return null
  }
}

export function isMedcloudAutoLaunchUrl(value: string | URL): boolean {
  return parseMedcloudLaunchOptions(value)?.auto === true
}

export function isVghtpeLaunchUrl(value: string | URL): boolean {
  return parseMedcloudLaunchOptions(value)?.site === 'vghtpe'
}

/**
 * The in-hospital hand-off: `medcloud2=auto` together with `site=vghtpe`.
 *
 * The unattended route hides every Beta surface, because a tester's switch
 * must not follow a clinician into a hand-off. The hospital's own launch is
 * the one Medcloud route where Beta is allowed again: the switch in 設定 is
 * offered and honoured exactly as on a plain visit, so a clinician who wants
 * the personalized guidance turns it on once in that browser, and one who
 * does not never sees it. Nothing turns on by itself. Reads the current page
 * when no URL is given.
 */
export function isVghtpeUnattendedLaunch(value?: string | URL): boolean {
  const resolved = value ?? (typeof window === 'undefined' ? '' : window.location.href)
  if (!resolved) return false
  const options = parseMedcloudLaunchOptions(resolved)
  return options?.auto === true && options.site === 'vghtpe'
}

/** The launcher-supplied workstation / clinic-room code, or null. Null also
 *  covers an invalid launch URL — a rejected URL has no trustworthy code. */
export function getLaunchWorkstation(value: string | URL): string | null {
  return parseMedcloudLaunchOptions(value)?.workstation ?? null
}

function decodeBase64UrlSegment(value: string): Uint8Array | null {
  if (!BASE64URL_SEGMENT.test(value) || value.length % 4 === 1) return null
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')
  try {
    return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
  } catch {
    return null
  }
}

interface ParsedEncryptedCredential {
  iv: Uint8Array
  ciphertext: Uint8Array
  authenticationTag: Uint8Array
}

function parseEncryptedCredential(value: string): ParsedEncryptedCredential | null {
  const segments = value.split('.')
  if (
    segments.length !== 5 ||
    segments[0] !== 'a256gcm' ||
    segments[1] !== 'v1'
  ) return null

  const iv = decodeBase64UrlSegment(segments[2])
  const ciphertext = decodeBase64UrlSegment(segments[3])
  const authenticationTag = decodeBase64UrlSegment(segments[4])
  if (
    iv?.length !== AES_GCM_IV_LENGTH ||
    !ciphertext?.length ||
    authenticationTag?.length !== AES_GCM_AUTH_TAG_LENGTH
  ) return null
  return { iv, ciphertext, authenticationTag }
}

/** Decrypt the Extension credential without ever returning or logging a
 * partially decoded value. WebCrypto expects the GCM tag appended to the
 * ciphertext; the launch envelope transports it as a separate segment. */
export async function decryptVghtpeMedcloudCredential(
  credential: string,
): Promise<string | null> {
  const encrypted = parseEncryptedCredential(credential)
  const keyBytes = decodeBase64UrlSegment(
    VGTPE_MEDCLOUD_DECRYPTION_KEY_BASE64URL,
  )
  if (
    !encrypted ||
    keyBytes?.length !== AES_256_KEY_LENGTH ||
    !globalThis.crypto?.subtle
  ) return null

  const sealed = new Uint8Array(
    encrypted.ciphertext.length + encrypted.authenticationTag.length,
  )
  sealed.set(encrypted.ciphertext)
  sealed.set(encrypted.authenticationTag, encrypted.ciphertext.length)

  try {
    const key = await globalThis.crypto.subtle.importKey(
      'raw',
      keyBytes as BufferSource,
      'AES-GCM',
      false,
      ['decrypt'],
    )
    const plaintext = await globalThis.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: encrypted.iv as BufferSource,
        tagLength: AES_GCM_AUTH_TAG_LENGTH * 8,
      },
      key,
      sealed as BufferSource,
    )
    return sanitizeApiKey(new TextDecoder('utf-8', { fatal: true }).decode(plaintext))
  } catch {
    return null
  }
}

export function parseMedcloudLaunchContext(value: unknown): MedcloudLaunchContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (
    candidate.source !== MEDCLOUD_LAUNCH_CONTEXT_SOURCE ||
    candidate.type !== MEDCLOUD_LAUNCH_CONTEXT_TYPE ||
    candidate.version !== 1 ||
    typeof candidate.messageId !== 'string' ||
    candidate.messageId.length < 1 ||
    candidate.messageId.length > MAX_MESSAGE_ID_LENGTH
  ) return null

  if (candidate.site === undefined) {
    // The default-model auto route carries no VGH secret. Rejecting even a
    // well-formed credential here keeps the two launch controls independent
    // and prevents accidental disclosure outside the VGH site route.
    if (candidate.credential !== undefined) return null
    return { messageId: candidate.messageId }
  }

  if (
    candidate.site !== 'vghtpe' ||
    typeof candidate.credential !== 'string' ||
    candidate.credential.length < 1 ||
    candidate.credential.length > MAX_CREDENTIAL_LENGTH
  ) return null

  const credential = candidate.credential
  if (!parseEncryptedCredential(credential)) return null
  return {
    messageId: candidate.messageId,
    site: 'vghtpe',
    credential,
  }
}

export function createVghtpeTvghbrainRuntimeProfile(
  apiKey: string,
): OpenAiCompatibleProfile {
  return {
    profileId: VGTPE_TVGHBRAIN_PROFILE_ID,
    runtimeOnly: true,
    trustedAgentRuntime: true,
    enabled: true,
    baseUrl: VGTPE_TVGHBRAIN_BASE_URL,
    modelId: VGTPE_TVGHBRAIN_MODEL_ID,
    apiKey,
    transport: 'direct',
    contextWindowTokens: suggestedOpenAiCompatibleContextWindow(
      VGTPE_TVGHBRAIN_MODEL_ID,
    ),
    contextWindowSource: 'suggested',
    agentMode: 'auto',
    // The runtime trust flag above is provisioned only by the authenticated
    // VGH-TPE Extension contract. Keep probe metadata honest: the parameter
    // path intentionally does not run the user-facing endpoint probe.
    agentCapability: 'unknown',
    agentCapabilityTestedAt: null,
  }
}
