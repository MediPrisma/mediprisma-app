import type { SourceRecordComparison } from './source-record-comparison'
import { isVghtpeSource, isMedcloudSource } from './clinical-source-identity'

type SourceState = { dataOrigin?: string; isInactive: boolean; currentnessUncertain?: boolean }

/** Shared display projection for lists and timelines. It never mutates source
 * records or establishes a confirmed prescription identity. */
export function projectMedicationComparisons<T extends { id: string }>(
  records: readonly T[],
  comparisonFor: (record: T) => SourceRecordComparison | undefined,
  stateFor: (record: T) => SourceState,
) {
  const byId = new Map(records.map(record => [record.id, record]))
  const consumed = new Set<string>()
  const result: Array<{ record: T; sources?: T[]; comparison?: SourceRecordComparison;
    ownedIds?: string[]; warnings?: string[]; collapsed?: boolean }> = []
  for (const record of records) {
    if (consumed.has(record.id)) continue
    const comparison = comparisonFor(record)
    if (!comparison || comparison.status === 'confirmed') { result.push({ record }); continue }
    const sources = comparison.references.map(reference => byId.get(reference.split('/').pop()!))
    if (sources.length < 2 || sources.some(source => !source)) {
      result.push({ record, comparison, sources: sources.filter(Boolean) as T[], warnings: [
        ...(comparison.warnings ?? []), 'source-partners-not-in-view',
      ] }); continue
    }
    const complete = sources as T[]
    const hospital = complete.filter(source => stateFor(source).dataOrigin === 'hospital')
    const cloud = complete.filter(source => stateFor(source).dataOrigin === 'medcloud')
    // The hospital order owns the displayed clinical facts. A cloud copy must
    // not promote an unknown or ended hospital order into current use.
    const representative = hospital[0]
      ?? complete.find(source => !stateFor(source).isInactive && !stateFor(source).currentnessUncertain) ?? complete[0]
    const mixedCurrentness = complete.some(source =>
      stateFor(source).isInactive !== stateFor(representative).isInactive
      || !!stateFor(source).currentnessUncertain !== !!stateFor(representative).currentnessUncertain)
    const display = hospital.length && cloud.length ? [...hospital] : [...complete]
    if (display.length > 1 && display.every(source => stateFor(source).isInactive) && !stateFor(representative).isInactive) display.unshift(representative)
    display.forEach((source, index) => result.push({ record: source, sources: complete, comparison,
      collapsed: display.length === 1,
      ownedIds: [source.id, ...(index === 0 ? complete.filter(other => !display.some(item => item.id === other.id)).map(other => other.id) : [])],
      warnings: [...(comparison.warnings ?? []), ...(mixedCurrentness ? ['source-currentness-differs'] : [])],
    }))
    complete.forEach(source => consumed.add(source.id))
  }
  return result
}

/** UI, AI and CDSS use the same hospital-primary clinical record set.
 * Original copies and pairing metadata remain in the source collection/audit;
 * choosing a display/decision source does not assert a shared FHIR identity. */
export function selectHospitalMedicationComparisons<T extends { id: string; _sourceRecordComparison?: SourceRecordComparison }>(records: T[]): T[] {
  const projected=projectHospitalMedicationComparisons(records).map(item=>item.record)
  return projected.length===records.length && projected.every((record,index)=>record===records[index]) ? records : projected
}

export function projectHospitalMedicationComparisons<T extends { id: string; _sourceRecordComparison?: SourceRecordComparison }>(records: T[]) {
  return projectMedicationComparisons(records, record=>record._sourceRecordComparison, record=>({
    dataOrigin:isVghtpeSource(record as any) ? 'hospital' : isMedcloudSource(record as any) ? 'medcloud' : undefined,
    isInactive:false,
  }))
}
