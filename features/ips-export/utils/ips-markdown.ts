// Deterministic Markdown companion export for the IPS snapshot.
//
// This intentionally does not ask an LLM to summarize. It renders the same
// curated clinical data used by the IPS Bundle into a compact table-oriented
// Markdown document that is easy for clinicians, LLM prompts, and RAG pipelines
// to read without parsing FHIR JSON.

import type { PatientEntity } from '@/src/core/entities/patient.entity'
import { getPatientDisplayName } from '@/src/core/entities/patient.entity'
import {
  buildLabPivots,
  cellDisplayValue,
  type LabCell,
  type LabPivot,
  type LabRow,
} from '@/features/clinical-summary/reports/hooks/useLabPivot'
import type {
  AllergyEntity,
  CarePlanEntity,
  ClinicalDataCollection,
  ConditionEntity,
  ConsentEntity,
  DeviceEntity,
  DiagnosticReportEntity,
  ImmunizationEntity,
  MedicationEntity,
  ObservationEntity,
  ProcedureEntity,
} from '@/src/core/entities/clinical-data.entity'
import { inferGroupFromCategory, inferGroupFromObservation } from '@/src/shared/utils/report-grouping-helpers'
import { categorizeObservation, LAB_CATEGORIES } from '@/src/shared/utils/lab-categories'
import {
  conceptLabel,
  conceptLabelEn,
  formatDate,
  orphanResultObservations,
  resultLabel,
} from './ips-helpers'
import {
  DEFAULT_SECTION_LABELS,
  type IpsSectionLabels,
} from './ips-builder'
import { medicationDisplayParts } from './medication-display'

export interface BuildIpsMarkdownOptions {
  patient: PatientEntity | null
  data: ClinicalDataCollection
  labels?: Partial<IpsSectionLabels>
  generatedAt?: Date
  /** Include direct patient identifiers. Default true. */
  includePatientIdentifiers?: boolean
}

function clean(value: unknown): string {
  if (value == null) return ''
  return String(value).replace(/\s+/g, ' ').trim()
}

function dash(value: unknown): string {
  const s = clean(value)
  return s || '-'
}

function tableCell(value: unknown): string {
  return dash(value)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>')
}

function mdTable(headers: string[], rows: string[][]): string {
  if (!rows.length) return '_No information available._'
  const header = `| ${headers.map(tableCell).join(' | ')} |`
  const sep = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map((row) => `| ${row.map(tableCell).join(' | ')} |`)
  return [header, sep, ...body].join('\n')
}

function section(title: string, body: string): string {
  return `## ${dash(title)}\n\n${body}`
}

function subsection(title: string, body: string): string {
  return heading(3, title, body)
}

function heading(level: number, title: string, body: string): string {
  return `${'#'.repeat(level)} ${dash(title)}\n\n${body}`
}

function quantityText(q?: { value?: number; unit?: string }): string {
  if (q?.value == null) return ''
  return `${q.value}${q.unit ? ' ' + q.unit : ''}`
}

function componentValueText(c: NonNullable<ObservationEntity['component']>[number]): string {
  const q = quantityText(c.valueQuantity)
  if (q) return q
  if (c.valueString) return c.valueString
  return ''
}

function observationValueText(o: ObservationEntity): string {
  const q = quantityText(o.valueQuantity)
  if (q) return q
  if (o.valueString) return o.valueString
  const coded = conceptLabel(o.valueCodeableConcept)
  if (coded) return coded
  if (o.component?.length) {
    const parts = o.component
      .map((c) => {
        const value = componentValueText(c)
        if (!value) return ''
        const label = resultLabel(c.code)
        return label ? `${label} ${value}` : value
      })
      .filter(Boolean)
    if (parts.length) return parts.join('; ')
  }
  if (o.hasMember?.length) return `${o.hasMember.length} result(s)`
  return ''
}

function interpretationText(o: ObservationEntity): string {
  return conceptLabel(o.interpretation)
}

function codingSystemLabel(system?: string): string {
  const s = (system || '').toLowerCase()
  if (s.includes('snomed')) return 'SNOMED CT'
  if (s.includes('icd-10')) return 'ICD-10'
  if (s.includes('loinc')) return 'LOINC'
  if (s.includes('nhi')) return 'NHI'
  return system || ''
}

function codingSummary(
  concept?: { coding?: Array<{ system?: string; code?: string; display?: string }> },
): string {
  const rows = [...(concept?.coding ?? [])]
  const seen = new Set<string>()
  const out: string[] = []
  for (const coding of rows) {
    const code = clean(coding.code)
    if (!code) continue
    const system = codingSystemLabel(coding.system)
    const text = system ? `${system} ${code}` : code
    if (seen.has(text)) continue
    seen.add(text)
    out.push(text)
  }
  return out.join('; ')
}

function humanizeIdentifierKey(value: string): string {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\bid\b/gi, 'ID')
    .replace(/\b\w/g, (m) => m.toUpperCase())
}

function identifierTypeCodeLabel(code?: string): string {
  const c = clean(code).toUpperCase()
  if (c === 'NI') return 'National ID'
  if (c === 'MR') return 'Medical record number'
  if (c === 'PPN' || c === 'PP') return 'Passport number'
  return clean(code)
}

function identifierSystemLabel(system?: string): string {
  const raw = clean(system)
  if (!raw) return ''
  const s = raw.toLowerCase()
  if (s.includes('national-id')) return 'National ID'
  if (s.includes('medical-record')) return 'Medical record number'
  if (s.includes('passport')) return 'Passport number'
  if (s.includes('nhi')) return 'NHI number'

  try {
    const url = new URL(raw)
    const lastPath = url.pathname.split('/').filter(Boolean).pop()
    return humanizeIdentifierKey(lastPath || url.hostname)
  } catch {
    return raw
  }
}

function patientIdentifierLabel(id: NonNullable<PatientEntity['identifier']>[number]): string {
  const typeText = clean(id.type?.text)
  if (typeText) return typeText
  const typeCode = identifierTypeCodeLabel(id.type?.coding?.[0]?.code)
  if (typeCode) return typeCode
  return identifierSystemLabel(id.system) || 'Identifier'
}

function patientIdentifiers(patient: PatientEntity | null): string {
  const ids = patient?.identifier ?? []
  return ids
    .map((id) => {
      const label = patientIdentifierLabel(id)
      return id.value ? `${label}: ${id.value}` : ''
    })
    .filter(Boolean)
    .slice(0, 5)
    .join('; ')
}

function patientSection(patient: PatientEntity | null, labels: IpsSectionLabels, includeIdentifiers: boolean): string {
  if (!includeIdentifiers) {
    return section('Patient', [
      `- Name: ${labels.maskedPatient}`,
      `- Gender: ${dash(patient?.gender)}`,
    ].join('\n'))
  }
  const lines = [
    `- Name: ${dash(getPatientDisplayName(patient))}`,
    `- Gender: ${dash(patient?.gender)}`,
    `- Birth date: ${dash(patient?.birthDate)}`,
    `- Patient ID: ${dash(patient?.id)}`,
  ]
  const ids = patientIdentifiers(patient)
  if (ids) lines.push(`- Identifiers: ${ids}`)
  return section('Patient', lines.join('\n'))
}

function sourceSummary(
  item: { sourceSystem?: string; sourceId?: string },
  inferred?: ConditionEntity['_inferred'],
): string {
  const parts: string[] = []
  if (inferred) parts.push(`AI-inferred (${inferred.inferenceConfidence} confidence)`)
  if (item.sourceSystem || item.sourceId) {
    parts.push([item.sourceSystem, item.sourceId].filter(Boolean).join('/'))
  }
  return parts.join('; ')
}

function problemsSection(title: string, rows: ConditionEntity[]): string {
  return section(
    title,
    mdTable(
      ['Problem', 'Status', 'Onset / Recorded', 'Code', 'Source'],
      rows.map((c) => [
        conceptLabelEn(c.code),
        c.clinicalStatus || '',
        formatDate(c.onsetDateTime) || formatDate(c.recordedDate),
        codingSummary(c.code),
        sourceSummary(c, c._inferred),
      ]),
    ),
  )
}

function allergiesSection(title: string, rows: AllergyEntity[]): string {
  return section(
    title,
    mdTable(
      ['Allergen', 'Status', 'Criticality', 'Reaction', 'Recorded'],
      rows.map((a) => {
        const reaction = (a.reaction ?? [])
          .flatMap((r) => (r.manifestation ?? []).map((m) => m.text || ''))
          .filter(Boolean)
          .join(', ')
        return [
          conceptLabel(a.code),
          a.clinicalStatus || '',
          a.criticality || '',
          reaction,
          formatDate(a.recordedDate),
        ]
      }),
    ),
  )
}

function medicationsSection(
  title: string,
  rows: MedicationEntity[],
  labels: IpsSectionLabels['medicationTable'],
): string {
  return section(
    title,
    mdTable(
      [labels.medication, labels.status, labels.directions, labels.supply, labels.date, labels.code],
      rows.map((m) => {
        const dosage = medicationDisplayParts(m)
        return [
          conceptLabelEn(m.medicationCodeableConcept),
          m.status || '',
          dosage.directions,
          dosage.supply,
          formatDate(m.authoredOn),
          codingSummary(m.medicationCodeableConcept),
        ]
      }),
    ),
  )
}

function immunizationsRows(rows: ImmunizationEntity[]): string[][] {
  return rows.map((im) => [
    conceptLabel(im.vaccineCode),
    im.status || '',
    formatDate(im.occurrenceDateTime),
    (im.performer ?? []).map((p) => p.actor?.display || '').filter(Boolean).join('; '),
  ])
}

function procedureDate(p: ProcedureEntity): string {
  return formatDate(p.performedDateTime) || formatDate(p.performedPeriod?.start)
}

function proceduresRows(rows: ProcedureEntity[]): string[][] {
  return rows.map((p) => [
    conceptLabel(p.code),
    p.status || '',
    procedureDate(p),
    (p.performer ?? []).map((x) => x.actor?.display || x.display || '').filter(Boolean).join('; '),
  ])
}

function conclusionCodeText(raw: unknown): string {
  if (!raw) return ''
  const list = Array.isArray(raw) ? raw : [raw]
  return list
    .map((cc) => conceptLabel(cc as { text?: string; coding?: Array<{ display?: string; code?: string }> }))
    .filter(Boolean)
    .join('; ')
}

type ResultGroupKey = 'lab' | 'imaging'

interface ResultBlock {
  date: string
  group: ResultGroupKey
  dr: DiagnosticReportEntity
  rows: string[][]
}

interface CompactResultRow {
  date: string
  group: ResultGroupKey
  row: string[]
}

function reportGroupKey(dr: DiagnosticReportEntity): ResultGroupKey {
  return inferGroupFromCategory(dr.category) === 'imaging' ? 'imaging' : 'lab'
}

function observationGroupKey(obs: ObservationEntity): ResultGroupKey {
  return inferGroupFromObservation(obs) === 'imaging' ? 'imaging' : 'lab'
}

function reportGroup(dr: DiagnosticReportEntity): 'Laboratory' | 'Imaging' {
  return reportGroupKey(dr) === 'imaging' ? 'Imaging' : 'Laboratory'
}

function reportTitle(dr: DiagnosticReportEntity): string {
  return resultLabel(dr.code) || conceptLabel(dr.code) || 'Diagnostic report'
}

function observationSpecimenText(obs: ObservationEntity): string {
  const explicit = clean(obs.specimen?.display)
  if (explicit) return explicit
  const categoryText = (obs.category ?? [])
    .flatMap((c) => [
      c.text,
      ...(c.coding ?? []).flatMap((coding) => [coding.display, coding.code]),
    ])
    .map(clean)
    .find((text) => /urine|urinaly|尿|blood|serum|plasma|stool|sputum|csf/i.test(text))
  if (categoryText) return categoryText
  return categorizeObservation(obs)?.id === 'urine' ? 'Urine' : ''
}

function specimenSummary(observations: ObservationEntity[]): string {
  const values = new Set<string>()
  for (const obs of observations) {
    const specimen = observationSpecimenText(obs)
    if (specimen) values.add(specimen)
  }
  return Array.from(values).slice(0, 3).join(', ')
}

function diagnosticReportRows(dr: DiagnosticReportEntity): string[][] {
  return [
    ...diagnosticReportTextRows(dr),
    ...diagnosticReportObservationRows(dr),
  ]
}

function diagnosticReportTextRows(dr: DiagnosticReportEntity): string[][] {
  const out: string[][] = []
  const label = reportTitle(dr)
  const conclusion = dr.conclusion?.trim()
  if (conclusion) out.push([label, conclusion])

  const coded = conclusionCodeText(dr.conclusionCode)
  if (coded) out.push([label, coded])

  const noteText = (dr.note ?? []).map((n) => n.text?.trim()).filter(Boolean).join('; ')
  if (noteText) out.push([label, noteText])
  return out
}

function diagnosticReportObservationRows(
  dr: DiagnosticReportEntity,
  observations = dr._observations ?? [],
): string[][] {
  const label = reportTitle(dr)
  return observations.map((obs) => [
    resultLabel(obs.code) || label,
    observationValueText(obs),
  ])
}

function diagnosticReportBlock(
  dr: DiagnosticReportEntity,
  rows = diagnosticReportRows(dr),
  level = 3,
): { date: string; markdown: string } | null {
  if (!rows.length) return null
  const date = formatDate(dr.effectiveDateTime)
  const specimen = specimenSummary(dr._observations ?? [])
  const meta = [date, reportTitle(dr), reportGroup(dr), specimen ? `Specimen: ${specimen}` : '']
    .filter(Boolean)
    .join(' - ')
  return {
    date: dr.effectiveDateTime || '',
    markdown: heading(level, meta, mdTable(['Result', 'Value / Conclusion'], rows)),
  }
}

function compactReportRows(dr: DiagnosticReportEntity, rows: string[][], group = reportGroupKey(dr)): CompactResultRow[] {
  if (rows.length !== 1) return []
  const [result, value] = rows[0]
  return [{
    date: dr.effectiveDateTime || '',
    group,
    row: [
      formatDate(dr.effectiveDateTime),
      result,
      value,
      specimenSummary(dr._observations ?? []),
    ],
  }]
}

function isPivotableLabObservation(obs: ObservationEntity): boolean {
  return !!obs.effectiveDateTime && !!observationValueText(obs) && !!categorizeObservation(obs)
}

function observationCompactRow(obs: ObservationEntity, group = observationGroupKey(obs)): CompactResultRow {
  return {
    date: obs.effectiveDateTime || '',
    group,
    row: [
      formatDate(obs.effectiveDateTime),
      resultLabel(obs.code),
      observationValueText(obs),
      observationSpecimenText(obs),
    ],
  }
}

function standaloneResultRows(
  data: ClinicalDataCollection,
  onPivotableLabObservation?: (obs: ObservationEntity) => void,
): CompactResultRow[] {
  const orphanRows = orphanResultObservations(data.diagnosticReports, data.observations)
  const rows: CompactResultRow[] = []
  for (const obs of orphanRows) {
    if (isPivotableLabObservation(obs)) {
      onPivotableLabObservation?.(obs)
      continue
    }
    rows.push(observationCompactRow(obs))
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date))
}

function renderCompactRows(group: ResultGroupKey, rows: string[][]): string {
  return group === 'lab'
    ? mdTable(['Date', 'Result', 'Value / Conclusion', 'Specimen'], rows)
    : rows
        .map(([date, study, conclusion]) => heading(4, [date, study].filter(Boolean).join(' - '), dash(conclusion)))
        .join('\n\n')
}

function labCellText(cell?: LabCell, includeUnit = false): string {
  if (!cell) return '-'
  const shown = cellDisplayValue(cell)
  const value = includeUnit && cell.unit ? `${shown} ${cell.unit}` : shown
  if (!cell.isAbnormal) return value
  const code = clean(cell.interpretationCode)
  return code ? `${value} ${code}` : `${value} *`
}

function labTestHeader(row: LabRow): string {
  return row.unit ? `${row.displayName} (${row.unit})` : row.displayName
}

function labCategoryLabel(pivot: LabPivot, labels: IpsSectionLabels): string {
  return labels.cumulativeCategories[pivot.category.id] || pivot.category.id
}

function labSubgroupLabel(id: string, labels: IpsSectionLabels): string {
  return labels.cumulativeSubgroups[id] || id
}

function pivotDateRows(pivot: LabPivot, tests: LabRow[]): string[][] {
  return pivot.dates
    .filter((date) => tests.some((test) => test.values.has(date)))
    .map((date) => [
      formatDate(date),
      ...tests.map((test) => labCellText(test.values.get(date), !test.unit)),
    ])
}

function renderLabPivotTable(title: string, pivot: LabPivot, tests: LabRow[], level: number): string {
  const rows = pivotDateRows(pivot, tests)
  if (!rows.length) return ''
  return heading(
    level,
    title,
    mdTable(['Date', ...tests.map(labTestHeader)], rows),
  )
}

function renderLabPivot(pivot: LabPivot, labels: IpsSectionLabels, level: number): string {
  const testsWithValues = pivot.rows.filter((row) => row.values.size > 0)
  if (!testsWithValues.length) return ''

  const categoryLabel = labCategoryLabel(pivot, labels)
  const subgroups = pivot.category.subgroups ?? []
  if (!subgroups.length) {
    return renderLabPivotTable(categoryLabel, pivot, testsWithValues, level)
  }

  const rendered: string[] = []
  const usedSubgroups = new Set<string>()
  for (const sg of subgroups) {
    const tests = testsWithValues.filter((row) => row.subgroupId === sg.id)
    if (!tests.length) continue
    usedSubgroups.add(sg.id)
    rendered.push(renderLabPivotTable(`${categoryLabel} - ${labSubgroupLabel(sg.id, labels)}`, pivot, tests, level))
  }

  const otherTests = testsWithValues.filter((row) => !row.subgroupId || !usedSubgroups.has(row.subgroupId))
  if (otherTests.length) {
    rendered.push(renderLabPivotTable(categoryLabel, pivot, otherTests, level))
  }
  return rendered.filter(Boolean).join('\n\n')
}

function renderLabCumulative(observations: ObservationEntity[], labels: IpsSectionLabels, level: number): string {
  if (!observations.length) return ''
  const pivots = buildLabPivots(observations)
  return LAB_CATEGORIES
    .map((cat) => pivots[cat.id])
    .filter(Boolean)
    .map((pivot) => renderLabPivot(pivot, labels, level))
    .filter(Boolean)
    .join('\n\n')
}

function resultsSection(title: string, data: ClinicalDataCollection, labels: IpsSectionLabels): string | null {
  const blocks: ResultBlock[] = []
  const compactRows: CompactResultRow[] = []
  const labObservations: ObservationEntity[] = []
  const seenLabObservationIds = new Set<string>()
  const addLabObservation = (obs: ObservationEntity) => {
    if (obs.id) {
      if (seenLabObservationIds.has(obs.id)) return
      seenLabObservationIds.add(obs.id)
    }
    labObservations.push(obs)
  }

  for (const dr of data.diagnosticReports) {
    const group = reportGroupKey(dr)
    if (group === 'lab') {
      const observations = dr._observations ?? []
      const pivotable = observations.filter(isPivotableLabObservation)
      pivotable.forEach(addLabObservation)

      const pivotableSet = new Set(pivotable)
      const unpivotedRows = diagnosticReportObservationRows(
        dr,
        observations.filter((obs) => !pivotableSet.has(obs)),
      )
      const rows = [
        ...diagnosticReportTextRows(dr),
        ...unpivotedRows,
      ]
      const compact = compactReportRows(dr, rows, group)
      if (compact.length) {
        compactRows.push(...compact)
      } else if (rows.length) {
        blocks.push({
          date: dr.effectiveDateTime || '',
          group,
          dr,
          rows,
        })
      }
      continue
    }

    const rows = diagnosticReportRows(dr)
    const compact = compactReportRows(dr, rows, group)
    if (compact.length) {
      compactRows.push(...compact)
      continue
    }

    if (rows.length) {
      blocks.push({
        date: dr.effectiveDateTime || '',
        group,
        dr,
        rows,
      })
    }
  }
  compactRows.push(...standaloneResultRows(data, addLabObservation))
  compactRows.sort((a, b) => b.date.localeCompare(a.date))
  if (!blocks.length && !compactRows.length && !labObservations.length) return null
  blocks.sort((a, b) => b.date.localeCompare(a.date))

  const hasLab = labObservations.length > 0 || compactRows.some((r) => r.group === 'lab') || blocks.some((b) => b.group === 'lab')
  const hasImaging = compactRows.some((r) => r.group === 'imaging') || blocks.some((b) => b.group === 'imaging')
  const splitGroups = hasLab && hasImaging

  const renderGroup = (group: ResultGroupKey, label: string): string => {
    const labCumulative = group === 'lab'
      ? renderLabCumulative(labObservations, labels, splitGroups ? 4 : 3)
      : ''
    const groupRows = compactRows.filter((r) => r.group === group).map((r) => r.row)
    const groupBlocks = blocks
      .filter((b) => b.group === group)
      .map((b) => diagnosticReportBlock(b.dr, b.rows, splitGroups ? 4 : 3)?.markdown)
      .filter(Boolean)
    const body = [
      labCumulative,
      groupRows.length ? renderCompactRows(group, groupRows) : '',
      ...groupBlocks,
    ].filter(Boolean).join('\n\n')
    if (!body) return ''
    return splitGroups ? subsection(label, body) : body
  }

  const body = [
    renderGroup('lab', labels.resultsLab),
    renderGroup('imaging', labels.resultsImaging),
  ].filter(Boolean)
  return section(title, body.join('\n\n'))
}

function vitalRows(rows: ObservationEntity[]): string[][] {
  return rows.map((o) => [
    formatDate(o.effectiveDateTime),
    resultLabel(o.code),
    observationValueText(o),
    interpretationText(o),
  ])
}

function deviceRows(rows: DeviceEntity[]): string[][] {
  return rows.map((d) => [
    conceptLabel(d.type) || d.deviceName?.find((n) => n.name)?.name || '',
    d.status || '',
    d.manufacturer || '',
    [d.modelNumber, d.serialNumber].filter(Boolean).join(' / '),
  ])
}

function carePlanRows(rows: CarePlanEntity[]): string[][] {
  return rows.map((cp) => [
    // title is optional (0..1); fall back to `category` so SMART-sandbox /
    // Synthea plans (no title) still show a name instead of an empty cell.
    cp.title || conceptLabel(cp.category?.[0]) || cp.description || 'Care plan',
    cp.status || '',
    formatDate(cp.period?.start) || formatDate(cp.created),
    cp.description || (cp.activity ?? []).map((a) => a.detail?.description || '').filter(Boolean).join('; '),
  ])
}

function consentRows(rows: ConsentEntity[]): string[][] {
  return rows.map((c) => [
    formatDate(c.dateTime),
    conceptLabel(c.scope) || conceptLabel(c.category?.[0]) || 'Advance directive',
    c.provision?.type || '',
    c.status || '',
    (c.organization ?? []).map((o) => o.display || '').filter(Boolean).join('; '),
  ])
}

function frontmatter(generatedAt: Date, includeIdentifiers: boolean): string {
  return [
    '---',
    'format: clinical-summary-markdown',
    'source: taiwan-nhi-my-health-bank',
    'source_format: fhir-derived',
    `generated_at: "${generatedAt.toISOString()}"`,
    'clinical_attestation: none',
    `identifiers_included: ${includeIdentifiers}`,
    `contains_phi: ${includeIdentifiers ? 'true' : 'possible'}`,
    '---',
  ].join('\n')
}

export function buildIpsMarkdown(opts: BuildIpsMarkdownOptions): string {
  const labels: IpsSectionLabels = { ...DEFAULT_SECTION_LABELS, ...(opts.labels ?? {}) }
  const generatedAt = opts.generatedAt ?? new Date()
  const data = opts.data
  const includeIdentifiers = opts.includePatientIdentifiers !== false
  const parts = [
    frontmatter(generatedAt, includeIdentifiers),
    `# ${labels.documentTitle}`,
    `> **${labels.sourceNotice}**\n>\n> ${labels.notMedicalRecordNotice}\n>\n> ${labels.noClinicalAttestationNotice}`,
    patientSection(opts.patient, labels, includeIdentifiers),
    problemsSection(labels.problemList, data.conditions),
    allergiesSection(labels.allergies, data.allergies),
    medicationsSection(labels.medications, data.medications, labels.medicationTable),
  ]

  if (data.immunizations.length) {
    parts.push(section(labels.immunizations, mdTable(['Vaccine', 'Status', 'Date', 'Performer'], immunizationsRows(data.immunizations))))
  }
  if (data.procedures.length) {
    parts.push(section(labels.procedures, mdTable(['Procedure', 'Status', 'Date', 'Performer'], proceduresRows(data.procedures))))
  }
  const results = resultsSection(labels.results, data, labels)
  if (results) parts.push(results)
  if (data.vitalSigns.length) {
    parts.push(section(labels.vitalSigns, mdTable(['Date', 'Vital Sign', 'Value', 'Interpretation'], vitalRows(data.vitalSigns))))
  }
  if (data.devices.length) {
    parts.push(section(labels.medicalDevices, mdTable(['Device', 'Status', 'Manufacturer', 'Model / Serial'], deviceRows(data.devices))))
  }
  if (data.carePlans.length) {
    parts.push(section(labels.planOfCare, mdTable(['Plan', 'Status', 'Date', 'Details'], carePlanRows(data.carePlans))))
  }
  if (data.consents.length) {
    parts.push(section(labels.advanceDirectives, mdTable(['Date', 'Directive', 'Provision', 'Status', 'Organization'], consentRows(data.consents))))
  }

  return `${parts.join('\n\n').trim()}\n`
}
