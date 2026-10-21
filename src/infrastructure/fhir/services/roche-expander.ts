// Roche DIP → standard-FHIR expander.
//
// WHAT: Roche's Digital Innovation Platform (DIP) exports oncology data (mCODE)
//   as a `Bundle.type = "message"` where the clinical resources are NOT top-
//   level entries — they are nested inside `List.contained[]` (a "Condition
//   List", "Observations List" for TNM staging, "Procedures List", etc.), and
//   cross-linked by hashed *business identifiers* (`subject`/`focus`/
//   `reasonReference` carry `{identifier}` instead of `{reference}`), plus some
//   `urn:uuid:`/`#` refs that point at those contained ids.
//
// WHY: the rest of the pipeline (byType() split, the FhirMappers, patient-id
//   gate, report linking) only sees TOP-LEVEL `entry[].resource` and only
//   follows `reference` strings. So without this pass the Condition, cancer
//   staging Observations and treatment Procedures never surface, and even the
//   top-level DiagnosticReports don't link to the patient.
//
// HOW: (1) hoist every `List.contained[]` resource to a top-level entry,
//   (2) index every resource by id and by identifier value, (3) walk the tree
//   and rewrite `urn:uuid:<id>` / `#<id>` refs and identifier-only references
//   into the relative `ResourceType/id` form the app resolves. Mirrors
//   claim-expander's contract: runs after canonicalizeBundleResources, MUTATES
//   the entry array in place, deterministic, no-op for non-Roche bundles.
//
// NOTE: the report BODIES (pathology / radiology) ship as base64 text/plain in
//   DiagnosticReport.presentedForm — those are decoded in useReportsData (the
//   presentedForm loop), not here.

/** True if any resource carries a Roche DIP marker (extension / identifier /
 *  codesystem under dip.roche.com). Cheap structural check — a plain TW-Core or
 *  健保存摺 bundle has none, so this stays a strict no-op for them. */
function isRocheBundle(entries: any[]): boolean {
  return entries.some((r) => {
    try {
      return JSON.stringify(r).includes('dip.roche.com')
    } catch {
      return false
    }
  })
}

/** A Reference-like node = an object holding a single `identifier` object (not a
 *  resource's identifier ARRAY) and/or a `reference` string. */
function looksLikeReference(node: any): boolean {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return false
  if (typeof node.reference === 'string') return true
  return node.identifier != null && !Array.isArray(node.identifier) && node.identifier.value != null
}

/** Recursively rewrite every reference under `node` to the relative
 *  ResourceType/id form: `urn:uuid:<id>` / `#<id>` via `byId`, identifier-only
 *  references via `byIdentifier`. Leaves already-relative references untouched. */
function resolveRefsDeep(
  node: any,
  byId: Map<string, string>,
  byIdentifier: Map<string, string>,
): void {
  if (Array.isArray(node)) {
    for (const item of node) resolveRefsDeep(item, byId, byIdentifier)
    return
  }
  if (!node || typeof node !== 'object') return

  if (looksLikeReference(node)) {
    if (typeof node.reference === 'string') {
      const m = node.reference.match(/^(?:urn:uuid:|#)(.+)$/)
      if (m && byId.has(m[1])) node.reference = byId.get(m[1])
    } else if (node.identifier?.value != null) {
      const target = byIdentifier.get(String(node.identifier.value))
      if (target) node.reference = target
    }
  }

  for (const key of Object.keys(node)) resolveRefsDeep(node[key], byId, byIdentifier)
}

/**
 * Expand every Roche DIP bundle in `entries` in place. Non-Roche bundles are
 * untouched (isRocheBundle returns false). Runs AFTER canonicalizeBundleResources
 * (so top-level ids are already stamped) and BEFORE the byType() split.
 */
export function expandRocheResources(entries: any[], onDerivedMember?: (report: any, observation: any) => void): void {
  if (!Array.isArray(entries) || entries.length === 0) return
  if (!isRocheBundle(entries)) return

  // (1) Hoist List.contained → top-level entries. The List wrappers themselves
  //     have no mapper (byType('List') is never queried), so we just empty their
  //     contained after lifting the clinical resources out. DiagnosticReport
  //     .contained is left intact — those are the report's own result
  //     Observations, reached via `result` refs, and the report renders from its
  //     presentedForm text anyway.
  const hoisted: any[] = []
  const biomarkerIds: string[] = []
  for (const res of entries) {
    if (!Array.isArray(res?.contained) || res.contained.length === 0) continue
    // Hoist clinical resources nested in List wrappers AND in DiagnosticReport
    // .contained (a pathology report's own result Observations — histologic
    // type / grade) up to top level so byType() and report-result matching see
    // them. The DR's `result` #refs (rewritten below) keep pointing at them.
    if (res.resourceType !== 'List' && res.resourceType !== 'DiagnosticReport') continue
    const listLabel =
      res.resourceType === 'List'
        ? (res.code?.text || res.code?.coding?.[0]?.display || '').toLowerCase()
        : ''
    for (const child of res.contained) {
      if (!child || typeof child !== 'object' || !child.resourceType) continue
      hoisted.push(child)
      if (child.resourceType === 'Observation' && child.id != null && listLabel.includes('biomarker')) {
        biomarkerIds.push(String(child.id))
      }
    }
    res.contained = []
  }
  entries.push(...hoisted)

  // (2) Index every top-level resource by id and by each identifier value.
  const byId = new Map<string, string>()
  const byIdentifier = new Map<string, string>()
  for (const res of entries) {
    if (!res?.resourceType || res.id == null) continue
    const ref = `${res.resourceType}/${res.id}`
    byId.set(String(res.id), ref)
    const ids = Array.isArray(res.identifier) ? res.identifier : []
    for (const ident of ids) {
      if (ident?.value != null && !byIdentifier.has(String(ident.value))) {
        byIdentifier.set(String(ident.value), ref)
      }
    }
  }

  // (3) Rewrite urn:uuid / # / identifier-only references throughout so
  //     subject → Patient, focus/reasonReference → Condition, hasMember/bodySite
  //     → their targets all resolve to relative ResourceType/id references.
  for (const res of entries) resolveRefsDeep(res, byId, byIdentifier)

  // (4) Cancer staging is a DIAGNOSIS attribute (mCODE models it on the
  //     Condition via `stage.assessment` → a TNM stage-group Observation whose
  //     `hasMember` are the T / N / M category Observations). Resolve that into
  //     a plain summary string stamped on the Condition (`_cancerStage`) so the
  //     problem list can show it — NOT a report card. The staging Observations
  //     themselves stay hoisted but carry no standalone value display.
  const byRef = new Map<string, any>()
  for (const res of entries) {
    if (res?.resourceType && res.id != null) byRef.set(`${res.resourceType}/${res.id}`, res)
  }
  const obsValue = (o: any): string =>
    o?.valueCodeableConcept?.text ||
    o?.valueCodeableConcept?.coding?.[0]?.display ||
    o?.valueString ||
    ''
  const stageObsToRemove = new Set<any>()
  for (const res of entries) {
    if (res?.resourceType !== 'Condition' || !Array.isArray(res.stage)) continue
    const parts: string[] = []
    for (const st of res.stage) {
      for (const a of Array.isArray(st?.assessment) ? st.assessment : []) {
        const group = typeof a?.reference === 'string' ? byRef.get(a.reference) : null
        if (!group) continue
        const memberObs = (Array.isArray(group.hasMember) ? group.hasMember : [])
          .map((m: any) => (typeof m?.reference === 'string' ? byRef.get(m.reference) : null))
          .filter(Boolean)
        const groupVal = obsValue(group)
        const members = memberObs.map(obsValue).filter(Boolean)
        let s = groupVal ? `Stage ${groupVal}` : ''
        if (members.length) s += `${s ? ' ' : ''}(${members.join(' · ')})`
        if (s) parts.push(s)
        // These staging Observations are now fully represented on the Condition
        // (as _cancerStage); drop the standalone copies so they don't surface as
        // orphan report rows (they're valueCodeableConcept-only, which now passes
        // the orphan filter).
        stageObsToRemove.add(group)
        for (const m of memberObs) stageObsToRemove.add(m)
      }
    }
    if (parts.length) res._cancerStage = parts.join('; ')
  }
  if (stageObsToRemove.size > 0) {
    for (let i = entries.length - 1; i >= 0; i--) {
      if (stageObsToRemove.has(entries[i])) entries.splice(i, 1)
    }
  }

  // (5) Biomarkers (ER / PR / HER2 / Ki-67 …) are pathology RESULTS, not a
  //     diagnosis — attach the "biomarkers" List observations to the Pathology
  //     report's `result` so they render as its rows (the report's histologic
  //     type / grade already ride there via its own result refs).
  if (biomarkerIds.length) {
    const pathologyDr = entries.find(
      (r) =>
        r?.resourceType === 'DiagnosticReport' &&
        (/patholog/i.test(r.code?.text || '') ||
          (Array.isArray(r.code?.coding) &&
            r.code.coding.some((c: any) => c?.code === '34819-3' || /patholog/i.test(c?.display || '')))),
    )
    if (pathologyDr) {
      if (!Array.isArray(pathologyDr.result)) pathologyDr.result = []
      for (const id of biomarkerIds) {
        pathologyDr.result.push({ type: 'Observation', reference: `Observation/${id}` })
        const matches = hoisted.filter(resource => resource.resourceType === 'Observation' && String(resource.id) === id)
        if (matches.length === 1) onDerivedMember?.(pathologyDr, matches[0])
      }
    }
  }
}
