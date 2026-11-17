// Embedded import: MediPrisma shown inside an allowlisted page (the 門診 AI 助理's
// visit page) receives that patient's FHIR Bundle from the page, imports it the
// way the import button does, and answers with the patient it now shows, so the
// page can check it is the patient on screen before showing the frame.
//
// Only the exact parent origins below are accepted, only from the frame's own
// parent window, and the answer goes back to that origin alone. Nothing is sent
// anywhere else; the record stays in this browser as any local import does.

export const EMBED_SOURCE_PARENT = 'mediprisma-ai-assistant'
export const EMBED_SOURCE_APP = 'mediprisma'
export const EMBED_VERSION = 1
export const EMBED_IMPORT = 'mediprisma:embed-import'
export const EMBED_IMPORTED = 'mediprisma:embed-imported'
export const EMBED_READY = 'mediprisma:embed-ready'

/** The 門診 AI 助理 on the hospital VM. */
const PRODUCTION_PARENTS = ['https://opd-ai-agent.mediprisma.tw']

/**
 * Whether a parent origin may hand this frame a record. A local development
 * parent (localhost, any port) is accepted only when MediPrisma itself runs on
 * localhost, so the public site never takes a record from a local page.
 */
export function isAllowedEmbedParent(parentOrigin: string, ownOrigin: string): boolean {
  if (PRODUCTION_PARENTS.includes(parentOrigin)) return true
  const local = (origin: string) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
  return local(ownOrigin) && local(parentOrigin)
}

export interface EmbedImportMessage {
  source: typeof EMBED_SOURCE_PARENT
  type: typeof EMBED_IMPORT
  version: typeof EMBED_VERSION
  requestId: string
  /** The Bundle as JSON text, as a file the import button reads would hold it. */
  bundle: string
  filename?: string
}

export function isEmbedImportMessage(data: unknown): data is EmbedImportMessage {
  const message = data as Partial<EmbedImportMessage> | null
  return Boolean(message) && message!.source === EMBED_SOURCE_PARENT && message!.type === EMBED_IMPORT
    && message!.version === EMBED_VERSION && typeof message!.requestId === 'string' && message!.requestId.length > 0
    && message!.requestId.length <= 100 && typeof message!.bundle === 'string' && message!.bundle.length > 0
}

/** The Patient ids a Bundle holds. */
export function patientIdsOf(bundle: unknown): string[] {
  const entries = (bundle as { entry?: { resource?: { resourceType?: string; id?: unknown } }[] } | null)?.entry ?? []
  return entries.flatMap((entry) => (entry?.resource?.resourceType === 'Patient' && typeof entry.resource.id === 'string' ? [entry.resource.id] : []))
}

export function importedReply(requestId: string, result: { ok: true; patientIds: string[] } | { ok: false; error: string }) {
  return { source: EMBED_SOURCE_APP, type: EMBED_IMPORTED, version: EMBED_VERSION, requestId, ...result }
}
