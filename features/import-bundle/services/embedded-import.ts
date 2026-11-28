// Embedded import: MediPrisma shown inside an allowlisted page (the 門診 AI 助理's
// visit page) receives that patient's FHIR Bundle from the page, imports it the
// way the import button does, and answers with the patient it now shows, so the
// page can check it is the patient on screen before showing the frame.
//
// The page can also sign this browser in as the account it is signed in as
// (mediprisma:embed-sign-in), with a Firebase custom token its server minted,
// so that account's templates and settings are here; it does so before
// handing a record, since switching accounts clears the open patient.
//
// The other way round (mediprisma:embed-lend-sign-in): a page where nobody is
// signed in asks whether a real account is signed in here, and is answered with
// that account's ID token, which its own server exchanges for a sign-in as the
// same physician if it lets that account in. A guest session lends nothing.
//
// The page can also ask which part of this app the frame shows
// (mediprisma:embed-navigate): the clinical record as it was left, one of its
// tabs (總覽, 上次門診, …), 醫療摘要's 標準摘要／自訂摘要, or 安全 (the hospital
// drug-interaction check), so a tab on the page opens straight onto it. A view
// this version does not know, or a tab this patient or this browser does not
// have (上次門診 without a hospital visit; 安全 off the hospital network or in
// a build without the check), is answered as not shown, and the page leaves
// the frame where it was. With `compact: true` the frame leaves out what the
// page already draws around it: the brand, the patient line and its own tab
// rows (stores/embed-view.store.ts); `compact: false` brings them back, and a
// message without it changes nothing.
//
// Once a page has spoken to it, the frame tells that page which patient and
// which view it shows whenever either changes (mediprisma:embed-shown), so
// the page can check both.
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
export const EMBED_SIGN_IN = 'mediprisma:embed-sign-in'
export const EMBED_SIGNED_IN = 'mediprisma:embed-signed-in'
export const EMBED_LEND_SIGN_IN = 'mediprisma:embed-lend-sign-in'
export const EMBED_LENT_SIGN_IN = 'mediprisma:embed-lent-sign-in'
export const EMBED_NAVIGATE = 'mediprisma:embed-navigate'
export const EMBED_NAVIGATED = 'mediprisma:embed-navigated'
export const EMBED_SHOWN = 'mediprisma:embed-shown'

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

export interface EmbedSignInMessage {
  source: typeof EMBED_SOURCE_PARENT
  type: typeof EMBED_SIGN_IN
  version: typeof EMBED_VERSION
  requestId: string
  /** The account the page is signed in as, and a custom token for it. */
  uid: string
  token: string
}

export function isEmbedSignInMessage(data: unknown): data is EmbedSignInMessage {
  const message = data as Partial<EmbedSignInMessage> | null
  return Boolean(message) && message!.source === EMBED_SOURCE_PARENT && message!.type === EMBED_SIGN_IN
    && message!.version === EMBED_VERSION && typeof message!.requestId === 'string' && message!.requestId.length > 0
    && message!.requestId.length <= 100 && typeof message!.uid === 'string' && message!.uid.length > 0
    && typeof message!.token === 'string' && message!.token.length > 0
}

export function signedInReply(requestId: string, result: { ok: true } | { ok: false; error: string }) {
  return { source: EMBED_SOURCE_APP, type: EMBED_SIGNED_IN, version: EMBED_VERSION, requestId, ...result }
}

export interface EmbedLendSignInMessage {
  source: typeof EMBED_SOURCE_PARENT
  type: typeof EMBED_LEND_SIGN_IN
  version: typeof EMBED_VERSION
  requestId: string
}

export function isEmbedLendSignInMessage(data: unknown): data is EmbedLendSignInMessage {
  const message = data as Partial<EmbedLendSignInMessage> | null
  return Boolean(message) && message!.source === EMBED_SOURCE_PARENT && message!.type === EMBED_LEND_SIGN_IN
    && message!.version === EMBED_VERSION && typeof message!.requestId === 'string' && message!.requestId.length > 0
    && message!.requestId.length <= 100
}

/** `idToken` only when a real account is signed in here. */
export function lentSignInReply(requestId: string, idToken: string | null) {
  return { source: EMBED_SOURCE_APP, type: EMBED_LENT_SIGN_IN, version: EMBED_VERSION, requestId, ...(idToken ? { ok: true, idToken } : { ok: false }) }
}

/**
 * What the page may ask the frame to show: the clinical record as it was left
 * (`record`), one of its tabs by id, 醫療摘要's two views, or 安全.
 */
export const EMBED_LEFT_VIEWS = ['overview', 'last-outpatient', 'patient', 'visits', 'reports', 'meds', 'documents'] as const
export const EMBED_VIEWS = ['record', 'standard-summary', 'custom-summary', 'safety', ...EMBED_LEFT_VIEWS] as const
/** The right-panel tab `safety` opens. */
export const EMBED_SAFETY_TAB = 'medication-safety'
export type EmbedView = typeof EMBED_VIEWS[number]
export type EmbedLeftView = typeof EMBED_LEFT_VIEWS[number]

export interface EmbedNavigateMessage {
  source: typeof EMBED_SOURCE_PARENT
  type: typeof EMBED_NAVIGATE
  version: typeof EMBED_VERSION
  requestId: string
  /** One of EMBED_VIEWS; a later page may name a view this version does not have. */
  view: string
  /** The 精簡 mode, when the message says; absent leaves it as it is. */
  compact?: boolean
}

export function isEmbedNavigateMessage(data: unknown): data is EmbedNavigateMessage {
  const message = data as Partial<EmbedNavigateMessage> | null
  return Boolean(message) && message!.source === EMBED_SOURCE_PARENT && message!.type === EMBED_NAVIGATE
    && message!.version === EMBED_VERSION && typeof message!.requestId === 'string' && message!.requestId.length > 0
    && message!.requestId.length <= 100 && typeof message!.view === 'string'
    && (message!.compact === undefined || typeof message!.compact === 'boolean')
}

export const isEmbedView = (view: string): view is EmbedView => (EMBED_VIEWS as readonly string[]).includes(view)
export const isEmbedLeftView = (view: string): view is EmbedLeftView => (EMBED_LEFT_VIEWS as readonly string[]).includes(view)

export function navigatedReply(
  requestId: string,
  result: { ok: true; view: EmbedView; compact: boolean; patientIds: string[] } | { ok: false; error: string },
) {
  return { source: EMBED_SOURCE_APP, type: EMBED_NAVIGATED, version: EMBED_VERSION, requestId, ...result }
}

/**
 * The view the frame shows: on the phone layout the panel on screen, with the
 * left panel's open tab or the right panel's 醫療摘要 view or 安全; `features`
 * for any other right-panel tab. On the split layout both panels show, and the panel
 * last asked for counts. A record detail drawn over the right panel belongs to
 * the clinical tab it was opened from, so that tab is what shows.
 */
export function shownView(state: { panel: 'left' | 'right'; leftTab: string | null; rightTab: string | null; summaryView: 'standard' | 'custom'; detailOpen?: boolean }): EmbedLeftView | 'standard-summary' | 'custom-summary' | 'safety' | 'features' | null {
  if (state.panel === 'right' && !state.detailOpen) {
    if (state.rightTab === EMBED_SAFETY_TAB) return 'safety'
    if (state.rightTab !== 'medical-summary') return 'features'
    return state.summaryView === 'custom' ? 'custom-summary' : 'standard-summary'
  }
  return state.leftTab && isEmbedLeftView(state.leftTab) ? state.leftTab : null
}

export function shownMessage(view: ReturnType<typeof shownView>, patientIds: string[]) {
  return { source: EMBED_SOURCE_APP, type: EMBED_SHOWN, version: EMBED_VERSION, view, patientIds }
}
