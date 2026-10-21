export const MAX_NHI_VIEWER_URL_LENGTH = 100_000

export type AttachmentLike = { contentType?: unknown; url?: unknown; title?: unknown }

/** The legacy viewer is an access capability, never report HTML to compare. */
export function isTrustedLegacyNhiViewerAttachment(attachment: AttachmentLike | null | undefined): boolean {
  const mediaType = typeof attachment?.contentType === 'string'
    ? attachment.contentType.split(';', 1)[0].trim().toLowerCase() : ''
  if (mediaType !== 'text/html') return false
  const rawUrl = attachment?.url
  if (typeof rawUrl !== 'string' || rawUrl.length === 0 || rawUrl.length > MAX_NHI_VIEWER_URL_LENGTH) return false
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'https:' && url.username === '' && url.password === '' && url.port === ''
      && (url.hostname === 'nhi.gov.tw' || url.hostname.endsWith('.nhi.gov.tw'))
  } catch {
    return false
  }
}
