import type { SourceRecordComparison } from './source-record-comparison'

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
    ownedIds?: string[]; warnings?: string[]; detailsInitiallyOpen?: boolean; collapsed?: boolean }> = []
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
    const representative = complete.find(source => !stateFor(source).isInactive && !stateFor(source).currentnessUncertain) ?? complete[0]
    const mixedCurrentness = !stateFor(representative).isInactive
      && complete.some(source => stateFor(source).isInactive || stateFor(source).currentnessUncertain)
    const factsConflict = comparison.warnings?.some(warning => ['source-facts-differ', 'source-status-conflict'].includes(warning))
    const display = factsConflict || !hospital.length || !cloud.length ? [...complete]
      : hospital.length > 1 ? [...hospital, ...(cloud.length > hospital.length ? cloud : [])] : [representative]
    if (display.length > 1 && display.every(source => stateFor(source).isInactive) && !stateFor(representative).isInactive) display.unshift(representative)
    display.forEach((source, index) => result.push({ record: source, sources: complete, comparison,
      collapsed: display.length === 1,
      detailsInitiallyOpen: index === 0,
      ownedIds: [source.id, ...(index === 0 ? complete.filter(other => !display.some(item => item.id === other.id)).map(other => other.id) : [])],
      warnings: [...(comparison.warnings ?? []), ...(mixedCurrentness ? ['source-currentness-differs'] : [])],
    }))
    complete.forEach(source => consumed.add(source.id))
  }
  return result
}
