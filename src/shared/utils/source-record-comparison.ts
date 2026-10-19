/** App-only provenance. A contextual candidate is not proof of one event. */
export interface SourceRecordComparison {
  status: 'candidate' | 'confirmed'
  references: string[]
}

export function sourceComparisonNarrative(record: { _sourceRecordComparison?: SourceRecordComparison }): string | undefined {
  const comparison = record._sourceRecordComparison
  if (!comparison) return undefined
  return `${comparison.status === 'candidate'
    ? 'Possible cross-source copy; order identity unconfirmed. Do not sum quantities or infer two prescriptions.'
    : 'Cross-source copies confirmed by a shared order identifier.'} Source group: ${comparison.references.join(', ')}`
}

export function sharedSourceIdentifier(left: any, right: any): boolean {
  return (left.identifier ?? []).some((identifier: any) => identifier.system && identifier.value
    && (right.identifier ?? []).some((other: any) => other.system === identifier.system && other.value === identifier.value))
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
      reasonCode: union('reasonCode'), diagnosis: union('diagnosis'), participant: union('participant'),
      _comparisonEncounterIds: sources.map((source) => source.id),
    })
    sources.forEach((source) => consumed.add(source.id))
  }
  return result
}
