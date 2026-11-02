import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { projectClinicalAggregate } from '@/src/infrastructure/fhir/mappers/clinical-aggregate-projection'
import { buildLabPivots } from '@/src/shared/utils/lab-pivot.utils'
import { labReportsCategory } from '@/src/core/categories/lab-reports.category'
import { reconcileClinicalSources } from '@/src/core/services/clinical-reconciliation'
import { orderingVisitIds, resultsOrderedAt } from '@/features/clinical-summary/last-outpatient/utils/last-outpatient'

const assays = [['FSH', '83098-4', 56.5, 'mIU/mL', 'm[iU]/mL'], ['E2', '83096-8', 13.2, 'pg/mL', 'pg/mL'], ['CA199', '24108-3', 13.62, 'U/mL', 'U/mL']] as const
function fixture(assay: typeof assays[number] = assays[0]) {
  const [name, code, value, unit, ucum] = assay
  const observations = ['hospital', 'cloud'].map((source, index) => ({
    resourceType: 'Observation', id: `${source}-${name}`, status: 'final',
    meta: { source: index ? 'https://medcloud2.nhi.gov.tw/imu/' : 'ehr-fhir-bridge/scraper' },
    subject: { reference: 'Patient/test' }, category: [{ coding: [{ code: 'laboratory' }] }],
    code: { text: name, coding: [{ system: !index && name !== 'CA199' ? 'urn:oid:his.lab.code' : 'http://loinc.org', code: !index && name !== 'CA199' ? name : code }] },
    effectiveDateTime: index ? '2026-01-16' : '2026-01-16T14:18:00+08:00',
    performer: [{ display: index ? '臺北榮總' : '臺北榮民總醫院' }],
    specimen: { display: index ? 'Blood' : 'SERUM_RG' },
    valueQuantity: { value, unit, code: index ? ucum : unit, system: 'http://unitsofmeasure.org' },
    note: [{ text: `${source} synthetic original` }],
  }))
  return observations as any[]
}
function bundle(observations: any[]) {
  return { resourceType: 'Bundle', type: 'collection', entry: [
    { resource: { resourceType: 'Patient', id: 'test', name: [{ text: '測試病人' }] } },
    ...observations.map(resource => ({ resource })),
    ...observations.map((o, index) => ({ resource: { resourceType: 'DiagnosticReport', id: `report-${index}`, status: 'final', subject: { reference: 'Patient/test' },
      code: { text: 'Synthetic laboratory report' }, category: [{ coding: [{ code: 'LAB' }] }], result: [{ reference: `Observation/${o.id}` }] } })),
  ] }
}
const project = (observations: any[]) => projectClinicalAggregate(LocalBundleService.parse(bundle(observations))!.collection)

test.each([false, true])('reprojection retains imported order/visit links when pairing is withdrawn: %s', withdraw => {
  const observations = fixture()
  observations[0].basedOn = [{ reference: 'ServiceRequest/order' }]
  const input: any = bundle(observations)
  input.entry.push({ resource: { resourceType: 'Encounter', id: 'visit', status: 'finished',
    class: { code: 'AMB' }, subject: { reference: 'Patient/test' }, period: { start: '2026-01-16T09:00:00+08:00' } } },
  { resource: { resourceType: 'ServiceRequest', id: 'order', status: 'completed', intent: 'order',
    subject: { reference: 'Patient/test' }, encounter: { reference: 'Encounter/visit' }, code: { text: 'FSH order' } } })
  const first = projectClinicalAggregate(LocalBundleService.parse(input)!.collection)
  const original = first.observations[0]
  expect(original.basedOn?.[0].display).toBe('FSH order')
  expect(original._orderEncounterIds?.length).toBe(1)
  expect(original.encounter).toBeDefined()
  if (withdraw) input.entry.push({ resource: { ...observations[0], id: 'second-draw', effectiveDateTime: '2026-01-16T16:00:00+08:00' } })
  const latest = withdraw ? { ...LocalBundleService.parse(input)!.collection, observations: first.observations } : first
  const again = projectClinicalAggregate(latest)
  const retained = again.observations.find(row => row.sourceId === original.sourceId)!
  expect(retained.encounter).toEqual(original.encounter)
  expect(retained._encounterInferred).toEqual(original._encounterInferred)
  expect(retained._orderEncounterIds).toEqual(original._orderEncounterIds)
  expect(retained.basedOn).toEqual(original.basedOn)
  expect(resultsOrderedAt([retained], new Set(orderingVisitIds(original)), 'visit').results).toHaveLength(1)
  expect(retained.clinicalSourceCopyKeys?.length ?? 0).toBe(withdraw ? 0 : 2)
})

test.each(assays.map(assay => ({ name: assay[0], assay })))('actual import projects $name once and retains both original sources', ({ assay }) => {
  const input = bundle(fixture(assay)), before = JSON.stringify(input)
  const parsed = LocalBundleService.parse(input)!
  const output = projectClinicalAggregate(parsed.collection)
  expect(output.observations).toHaveLength(1)
  const row = output.observations[0]
  expect(row.sourceId).toBe(`hospital-${assay[0]}`)
  expect(row.clinicalSourceCopyKeys).toHaveLength(2)
  expect(row.note).toHaveLength(2)
  expect(output.clinicalSource!.graph.nodes.filter(n => n.resource.resourceType === 'Observation')).toHaveLength(2)
  expect(output.diagnosticReports.every(r => r._observations?.length === 1 && r._observations[0].id === row.id)).toBe(true)
  expect(output.diagnosticReports.every(r => r.result?.[0].reference === `Observation/${row.id}`)).toBe(true)
  const cells = Object.values(buildLabPivots(output.observations)).flatMap(p => p.rows.flatMap(r => [...r.values.values()]))
  expect(cells.map(c => c.value)).toEqual([String(assay[2])])
  expect(labReportsCategory.getCount!(labReportsCategory.extractData(output), { labDepth: 'all', labReportTimeRange: 'all' }, output)).toBe(1)
  expect(JSON.stringify(input)).toBe(before)
  expect(projectClinicalAggregate(output).observations).toEqual(output.observations)
})

test.each([
  { valueQuantity: { value: 57, unit: 'mIU/mL' } },
  { valueQuantity: { value: 56.5, unit: 'IU/mL' } },
  { valueQuantity: { value: 56.5, unit: 'mIU/mL', comparator: '<' } },
  { specimen: { display: 'Plasma' } }, { status: 'corrected' },
  { effectiveDateTime: '2026-01-17' }, { effectiveDateTime: '2026-01-16T15:00:00+08:00' },
  { performer: [{ display: '另一間醫院' }] }, { performer: [{ reference: 'Organization/unresolved', display: '臺北榮總' }] },
  { meta: { source: 'https://unrelated.invalid/' } },
  { code: { coding: [{ system: 'http://loinc.org', code: '83096-8' }] } },
])('keeps incompatible or unverified records separate: %j', patch => {
  const observations = fixture(); Object.assign(observations[1], patch)
  const result = project(observations)
  expect(result.observations.every(row => !row.clinicalSourceCopyKeys)).toBe(true)
})

test('rejects a foreign patient before any pairing', () => {
  const observations = fixture(); observations[1].subject.reference = 'Patient/other'
  expect(() => project(observations)).toThrow('病人引用')
})

test.each(['interpretation', 'referenceRange', 'method', 'bodySite', 'identifier'])('preserves conflicting %s', field => {
  const observations = fixture()
  if (field === 'identifier') {
    observations[0][field] = [{ system: 'urn:accession', value: 'a' }]
    observations[1][field] = [{ system: 'urn:accession', value: 'b' }]
  } else {
    observations[0][field] = [{ text: 'a' }]; observations[1][field] = [{ text: 'b' }]
  }
  expect(project(observations).observations).toHaveLength(2)
})

test.each([56.5, 72])('multiple hospital collections stay separate even when only one value matches (%s)', value => {
  const observations = fixture()
  const repeat = JSON.parse(JSON.stringify(observations[0]))
  repeat.id = 'second-collection'; repeat.effectiveDateTime = '2026-01-16T16:00:00+08:00'; repeat.valueQuantity.value = value
  expect(project([...observations, repeat]).observations).toHaveLength(3)
})

test('a progressive additional collection restores both prior copies, with no stale merged notes', () => {
  const observations = fixture(), first = project(observations)
  const repeat = { ...observations[0], id: 'later', effectiveDateTime: '2026-01-16T16:00:00+08:00' }
  const latest = LocalBundleService.parse(bundle([...observations, repeat]))!.collection
  const output = projectClinicalAggregate({ ...latest, observations: first.observations })
  expect(output.observations).toHaveLength(3)
  expect(output.observations.every(row => !row.clinicalSourceCopyKeys && row.note?.length === 1)).toBe(true)
})

test('a corrected second hospital collection still prevents pairing the first with cloud', () => {
  const observations = fixture()
  const repeat = { ...observations[0], id: 'second-collection', effectiveDateTime: '2026-01-16T16:00:00+08:00', meta: { ...observations[0].meta, versionId: '1' } }
  const resources = bundle([...observations, repeat]).entry.map(entry => entry.resource)
  const source = reconcileClinicalSources([
    { sourceId: 'synthetic', patientScope: 'test', generation: '1', resources },
    { sourceId: 'synthetic', patientScope: 'test', generation: '2', resources: [{ ...repeat, status: 'corrected', meta: { ...repeat.meta, versionId: '2' } }] },
  ])
  const input = LocalBundleService.parse(bundle([...observations, repeat]))!.collection
  const output = projectClinicalAggregate(input, source)
  expect(output.observations).toHaveLength(3)
  expect(output.observations.every(row => !row.clinicalSourceCopyKeys)).toBe(true)
})
