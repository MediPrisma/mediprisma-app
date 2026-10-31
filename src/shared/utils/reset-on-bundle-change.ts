// Run `reset` whenever the locally-imported FHIR bundle changes — an import, a
// demo load, or a clear (all dispatch `mediprisma:local-bundle-changed` from
// useImportBundle). The in-memory AI-result stores (medical summary, safety
// scan, report interpretation) use this so importing NEW data never renders the
// PREVIOUS bundle's cached results (which is especially wrong when the two
// bundles share a patient id). Module-level, one listener per store for the app
// lifetime; SSR-safe no-op on the server.
export const BUNDLE_CHANGED_EVENT = 'mediprisma:local-bundle-changed'
export const BUNDLE_CHANGE_SETTLED_EVENT = 'mediprisma:local-bundle-change-settled'

export function isSummaryContinuation(event: Event): boolean {
  return (event as CustomEvent).detail?.preserveMedicalSummary === true
}

export function resetOnBundleChange(reset: () => void, preserveSummary = false): void {
  if (typeof window === 'undefined') return
  window.addEventListener(BUNDLE_CHANGED_EVENT, event => {
    if (preserveSummary && isSummaryContinuation(event)) return
    reset()
  })
}

/** Dispatch the bundle-changed signal (import / demo load / clear / logout wipe). */
export function notifyBundleChanged(preserveMedicalSummary = false): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(BUNDLE_CHANGED_EVENT, { detail: { preserveMedicalSummary } }))
}

/** Signal that React Query has finished publishing the new patient/data. */
export function notifyBundleChangeSettled(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(BUNDLE_CHANGE_SETTLED_EVENT))
}
