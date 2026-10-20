/** App-only provenance. A contextual candidate is not proof of one event. */
export interface SourceRecordComparison {
  status: 'candidate' | 'ambiguous' | 'confirmed'
  references: string[]
  warnings?: string[]
}

export function sourceComparisonNarrative(record: { _sourceRecordComparison?: SourceRecordComparison }): string | undefined {
  const comparison = record._sourceRecordComparison
  if (!comparison) return undefined
  return comparison.status !== 'confirmed'
    ? `Possible cross-source copies (${comparison.references.length} source records); source correspondence is unconfirmed. Preserve distinct orders within each source. Do not infer additional prescriptions or add quantities from possible copies in another source. Verify any conflicting facts separately.`
    : 'Hospital and MediCloud copies confirmed by a shared prescription identifier; original source records retained.'
}

export function summarizeSourceComparisons(records: readonly { id: string; _sourceRecordComparison?: SourceRecordComparison }[]) {
  const groups = new Set<string>(), unconfirmed = new Set<string>()
  for (const [index, record] of records.entries()) {
    const comparison = record._sourceRecordComparison
    const key = comparison ? [...comparison.references].sort().join('|') : `record:${record.id || index}`
    groups.add(key)
    if (comparison && comparison.status !== 'confirmed') unconfirmed.add(key)
  }
  return { sourceRecordCount: records.length, comparisonGroupCount: groups.size, unconfirmedGroupCount: unconfirmed.size }
}

export function sharedEncounterIdentifier(left: any, right: any): boolean {
  const isVisit = (identifier: any) => identifier.type?.coding?.some((coding: any) =>
    coding.system === 'http://terminology.hl7.org/CodeSystem/v2-0203' && coding.code === 'VN')
  return (left.identifier ?? []).some((identifier: any) => identifier.system && identifier.value && isVisit(identifier)
    && (right.identifier ?? []).some((other: any) => other.system === identifier.system && other.value === identifier.value && isVisit(other)))
}

/** Only identifiers whose contract identifies a prescription, never a case,
 * patient or encounter identifier carried on a MedicationRequest. */
export function sharedPrescriptionIdentifier(left: any, right: any): boolean {
  const isPrescription = (identifier: any) => identifier.system === 'urn:oid:vgh.medication.order'
    || identifier.type?.coding?.some((coding: any) => coding.system === 'http://terminology.hl7.org/CodeSystem/v2-0203'
      && ['PLAC', 'FILL'].includes(coding.code))
  return (left.identifier ?? []).some((identifier: any) => identifier.system && identifier.value && isPrescription(identifier)
    && (right.identifier ?? []).some((other: any) => other.system === identifier.system && other.value === identifier.value && isPrescription(other)))
}

export function conflictingSourceIdentifier(left: any, right: any): boolean {
  return (left.identifier ?? []).some((identifier: any) => identifier.system && identifier.value
    && (right.identifier ?? []).some((other: any) => other.system === identifier.system && other.value)
    && !(right.identifier ?? []).some((other: any) => other.system === identifier.system && other.value === identifier.value))
}

/** View projection only. Both source Encounters stay in the clinical graph. */
export function projectEncounterComparisons<T extends Record<string, any>>(encounters: readonly T[]): T[] {
  const byReference = new Map(encounters.map((visit) => [`Encounter/${visit.id}`, visit]))
  const consumed = new Set<string>()
  const result: T[] = []
  for (const visit of encounters) {
    if (consumed.has(visit.id)) continue
    const comparison: SourceRecordComparison | undefined = visit._sourceRecordComparison
    const sources = comparison?.references.map((reference) => byReference.get(reference)).filter(Boolean) as T[] | undefined
    if (!sources || sources.length !== 2 || sources.some((source) => consumed.has(source.id))) {
      result.push(comparison ? { ...visit, _comparisonEncounterIds: comparison.references.map((reference) => reference.split('/').pop()) } : visit); continue
    }
    // The reconciler writes the hospital first. Keep its clinical detail;
    // Chinese wording is selected separately by system-aware ICD lookup.
    const [hospital, cloud] = sources
    const union = (field: string) => [...(hospital[field] ?? []), ...(cloud[field] ?? [])]
      .filter((item, index, all) => all.findIndex((other) => JSON.stringify(item) === JSON.stringify(other)) === index)
    result.push({ ...cloud, ...hospital,
      reasonCode: [...(cloud.reasonCode ?? []), ...(hospital.reasonCode ?? [])], diagnosis: union('diagnosis'), participant: union('participant'),
      _comparisonEncounterIds: sources.map((source) => source.id),
    })
    sources.forEach((source) => consumed.add(source.id))
  }
  return result
}
