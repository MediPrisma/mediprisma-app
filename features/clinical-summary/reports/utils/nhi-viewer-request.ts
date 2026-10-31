import type { NhiViewerAction, NhiViewerRequestDescriptor } from '../types'
import { isTrustedLegacyNhiViewerAttachment, type AttachmentLike } from '@/src/shared/utils/nhi-viewer-attachment'
export { isTrustedLegacyNhiViewerAttachment, MAX_NHI_VIEWER_URL_LENGTH } from '@/src/shared/utils/nhi-viewer-attachment'

export const NHI_VIEWER_REQUEST_EXTENSION_URL =
  'https://cloud-wildcatch.invalid/fhir/StructureDefinition/medcloud-nhi-viewer-request'
export const MEDIPRISMA_ORIGIN = 'https://mediprisma.tw'
export const MEDIPRISMA_LOCAL_DEV_ORIGIN = 'http://localhost:3001'
export const NHI_VIEWER_REQUEST_TIMEOUT_MS = 20_000

type ExtensionLike = {
  url?: unknown
  extension?: unknown
  valueInteger?: unknown
  valueCode?: unknown
  valueString?: unknown
}

type DiagnosticReportLike = {
  extension?: unknown
  presentedForm?: unknown
}

function childValue(extension: ExtensionLike, name: string): unknown {
  if (!Array.isArray(extension.extension)) return undefined
  const child = extension.extension.find((item): item is ExtensionLike => (
    !!item && typeof item === 'object' && (item as ExtensionLike).url === name
  ))
  if (!child) return undefined
  return child.valueInteger ?? child.valueCode ?? child.valueString
}

function requiredString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function parseNhiViewerRequestExtension(
  extension: ExtensionLike | null | undefined,
): NhiViewerRequestDescriptor | null {
  if (extension?.url !== NHI_VIEWER_REQUEST_EXTENSION_URL) return null

  const version = childValue(extension, 'version')
  const procId = childValue(extension, 'proc-id')
  const patientContextHash = requiredString(childValue(extension, 'patient-context-hash'))
  const iplCaseSeqNo = requiredString(childValue(extension, 'ipl-case-seq-no'))

  if (version !== 1 || procId !== 'IMUE0130' || !patientContextHash || !iplCaseSeqNo) return null
  if (!/^[0-9a-fA-F]{64}$/.test(patientContextHash)) return null

  return {
    version: 1,
    procId: 'IMUE0130',
    patientContextHash,
    iplCaseSeqNo,
    readPos: optionalString(childValue(extension, 'read-pos')),
    ordMark: childValue(extension, 'ord-mark') === 'Y' ? 'Y' : '',
    fileType: optionalString(childValue(extension, 'file-type')),
    fileQty: optionalString(childValue(extension, 'file-qty')),
    feeYm: optionalString(childValue(extension, 'fee-ym')),
  }
}

function requestExtensions(report: DiagnosticReportLike): ExtensionLike[] {
  if (!Array.isArray(report.extension)) return []
  return report.extension.filter((item): item is ExtensionLike => (
    !!item && typeof item === 'object'
      && (item as ExtensionLike).url === NHI_VIEWER_REQUEST_EXTENSION_URL
  ))
}

/** New extension wins completely. Legacy URLs are exposed only if absent. */
export function getNhiViewerActions(report: DiagnosticReportLike): NhiViewerAction[] {
  const liveExtensions = requestExtensions(report)
  if (liveExtensions.length > 0) {
    return liveExtensions
      .map(parseNhiViewerRequestExtension)
      .filter((descriptor): descriptor is NhiViewerRequestDescriptor => descriptor !== null)
      .map((descriptor) => ({ kind: 'live' as const, descriptor }))
  }

  if (!Array.isArray(report.presentedForm)) return []
  return report.presentedForm
    .filter((item): item is AttachmentLike => !!item && typeof item === 'object')
    .filter(isTrustedLegacyNhiViewerAttachment)
    .map((attachment) => ({
      kind: 'legacy' as const,
      contentType: attachment.contentType as string,
      url: attachment.url as string,
      ...(typeof attachment.title === 'string' && attachment.title.trim()
        ? { title: attachment.title }
        : {}),
    }))
}

export type NhiViewerErrorCode =
  | 'INVALID_REQUEST'
  | 'REQUEST_IN_PROGRESS'
  | 'MEDCLOUD_TAB_NOT_FOUND'
  | 'PATIENT_MISMATCH'
  | 'SESSION_EXPIRED'
  | 'VIEWER_UNAVAILABLE'
  | 'OPEN_FAILED'
  | 'UNSUPPORTED_ORIGIN'
  | 'EXTENSION_UNAVAILABLE'

export type NhiViewerOpenResult = { ok: true } | { ok: false; code: NhiViewerErrorCode }

const NHI_VIEWER_ERROR_CODES = new Set<NhiViewerErrorCode>([
  'INVALID_REQUEST',
  'REQUEST_IN_PROGRESS',
  'MEDCLOUD_TAB_NOT_FOUND',
  'PATIENT_MISMATCH',
  'SESSION_EXPIRED',
  'VIEWER_UNAVAILABLE',
  'OPEN_FAILED',
  'UNSUPPORTED_ORIGIN',
  'EXTENSION_UNAVAILABLE',
])

function nhiViewerErrorCode(value: unknown): NhiViewerErrorCode {
  return typeof value === 'string' && NHI_VIEWER_ERROR_CODES.has(value as NhiViewerErrorCode)
    ? value as NhiViewerErrorCode
    : 'OPEN_FAILED'
}

let activeRequestId: string | null = null

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function isValidNhiViewerRequestDescriptor(
  descriptor: NhiViewerRequestDescriptor | null | undefined,
): descriptor is NhiViewerRequestDescriptor {
  return descriptor?.version === 1
    && descriptor.procId === 'IMUE0130'
    && /^[0-9a-fA-F]{64}$/.test(descriptor.patientContextHash)
    && typeof descriptor.iplCaseSeqNo === 'string'
    && descriptor.iplCaseSeqNo.length > 0
    && typeof descriptor.readPos === 'string'
    && (descriptor.ordMark === '' || descriptor.ordMark === 'Y')
    && typeof descriptor.fileType === 'string'
    && typeof descriptor.fileQty === 'string'
    && typeof descriptor.feeYm === 'string'
}

export function isSupportedNhiViewerOrigin(
  origin: string,
  environment = process.env.NODE_ENV,
): boolean {
  return origin === MEDIPRISMA_ORIGIN
    || (environment !== 'production' && origin === MEDIPRISMA_LOCAL_DEV_ORIGIN)
}

/** Request a fresh Viewer URL without ever receiving or retaining that URL. */
export function requestNhiViewerOpen(
  descriptor: NhiViewerRequestDescriptor,
  timeoutMs = NHI_VIEWER_REQUEST_TIMEOUT_MS,
  currentOrigin = typeof window === 'undefined' ? '' : window.location.origin,
): Promise<NhiViewerOpenResult> {
  if (typeof window === 'undefined') return Promise.resolve({ ok: false, code: 'EXTENSION_UNAVAILABLE' })
  // Keep the messaging boundary exact. The Bridge supports the official app
  // and, outside production builds, the local development server on port 3001.
  if (!isSupportedNhiViewerOrigin(currentOrigin)) {
    return Promise.resolve({ ok: false, code: 'UNSUPPORTED_ORIGIN' })
  }
  if (!isValidNhiViewerRequestDescriptor(descriptor)) {
    return Promise.resolve({ ok: false, code: 'INVALID_REQUEST' })
  }
  if (activeRequestId) return Promise.resolve({ ok: false, code: 'REQUEST_IN_PROGRESS' })

  const requestId = newRequestId()
  activeRequestId = requestId

  return new Promise((resolve) => {
    let settled = false
    const finish = (result: NhiViewerOpenResult) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      window.removeEventListener('message', handleMessage)
      if (activeRequestId === requestId) activeRequestId = null
      resolve(result)
    }
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== currentOrigin || event.source !== window) return
      const data = event.data as Record<string, unknown> | null
      if (!data
        || data.source !== 'medcloud2-extension'
        || data.type !== 'MEDIPRISMA_NHI_VIEWER_OPEN_RESULT'
        || data.version !== 1
        || data.requestId !== requestId) return

      if (data.ok === true) finish({ ok: true })
      else if (data.ok === false) finish({
        ok: false,
        code: nhiViewerErrorCode(data.code),
      })
    }
    window.addEventListener('message', handleMessage)
    const timer = window.setTimeout(
      () => finish({ ok: false, code: 'EXTENSION_UNAVAILABLE' }),
      timeoutMs,
    )

    try {
      window.postMessage({
        source: 'mediprisma',
        type: 'MEDIPRISMA_NHI_VIEWER_OPEN_REQUEST',
        version: 1,
        requestId,
        patientContextHash: descriptor.patientContextHash,
        descriptor: {
          version: 1,
          procId: descriptor.procId,
          iplCaseSeqNo: descriptor.iplCaseSeqNo,
          readPos: descriptor.readPos,
          ordMark: descriptor.ordMark,
          fileType: descriptor.fileType,
          fileQty: descriptor.fileQty,
          feeYm: descriptor.feeYm,
        },
      }, currentOrigin)
    } catch {
      finish({ ok: false, code: 'OPEN_FAILED' })
    }
  })
}

export function resetNhiViewerRequestForTests(): void {
  activeRequestId = null
}
