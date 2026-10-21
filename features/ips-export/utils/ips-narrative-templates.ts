// Per-section XHTML narrative (Composition.section.text.div) generators.
//
// IPS narratives are human-readable interchange artifacts. Table headers use
// the active export labels, while cells keep the data's own display text (which
// may be Chinese from 健保存摺). All dynamic content is HTML-escaped. The div is
// wrapped in the required XHTML namespace.

import type {
  AllergyEntity,
  CarePlanEntity,
  ConditionEntity,
  ConsentEntity,
  DeviceEntity,
  DiagnosticReportEntity,
  ImmunizationEntity,
  MedicationEntity,
  ObservationEntity,
  ProcedureEntity,
} from '@/src/core/entities/clinical-data.entity'
import { conceptLabel, conceptLabelEn, escapeHtml, formatDate, resultLabel } from './ips-helpers'
import { inferGroupFromCategory } from '@/src/shared/utils/report-grouping-helpers'
import { medicationDisplayParts } from './medication-display'
import type { IpsSectionLabels } from './ips-builder'
import { sourceComparisonNarrative } from '@/src/shared/utils/source-record-comparison'
import { sourceSelfPurchase } from '@/src/shared/utils/medication-source-markers'
import { medicationExportUnit, sourceSupplyText } from './medication-source-records'

const XHTML_NS = 'http://www.w3.org/1999/xhtml'

function wrap(inner: string): string {
  return `<div xmlns="${XHTML_NS}">${inner}</div>`
}

/** Narrative for an empty (or unavailable) section. */
export function emptyNarrative(message: string): string {
  return wrap(`<p>${escapeHtml(message)}</p>`)
}

/** Table HTML without the XHTML wrapper div — for composing multiple tables
 *  (e.g. the lab/imaging sub-groups in Results) under a single wrap(). */
function rawTable(headers: string[], rows: string[][]): string {
  if (!rows.length) return ''
  const thead = `<thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>`
  const tbody = `<tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
    .join('')}</tbody>`
  return `<table>${thead}${tbody}</table>`
}

function table(headers: string[], rows: string[][]): string {
  const t = rawTable(headers, rows)
  return t ? wrap(t) : ''
}

function dash(v: string): string {
  return v && v.trim() ? v : '-'
}

function quantityText(q?: { value?: number; unit?: string }): string {
  if (q?.value == null) return ''
  return `${q.value}${q.unit ? ' ' + q.unit : ''}`
}

/** Value text for a single Observation.component (quantity or string). */
function componentValueText(c: NonNullable<ObservationEntity['component']>[number]): string {
  const q = quantityText(c.valueQuantity)
  if (q) return q
  if (c.valueString) return c.valueString
  return ''
}

/**
 * Total value extractor for an Observation — covers every value channel the
 * `ObservationEntity` model can carry, in priority order. This is the single
 * place that answers "what does this observation read as?", so neither a new
 * bundle nor a new section needs its own value-branching:
 *   1. valueQuantity            — most labs ("121 mg/dL")
 *   2. valueString              — free-text result ("Normal")
 *   3. valueCodeableConcept     — coded result (blood type, Positive/Negative)
 *   4. component[]              — multi-component, no top-level value[x]
 *                                 (e.g. blood pressure "Systolic 120 mmHg; …")
 *   5. hasMember[]              — panel-as-observation grouping; children render
 *                                 as their own rows, so surface a count not a dash
 *   6. nothing usable          — "-" (dataAbsentReason / empty)
 */
function observationValueText(o: ObservationEntity): string {
  const q = quantityText(o.valueQuantity)
  if (q) return q
  if (o.valueString) return o.valueString
  const vcc = conceptLabel(o.valueCodeableConcept)
  if (vcc) return vcc
  if (o.component?.length) {
    const parts = o.component
      .map((c) => {
        const val = componentValueText(c)
        if (!val) return ''
        const label = resultLabel(c.code)
        return label ? `${label} ${val}` : val
      })
      .filter(Boolean)
    if (parts.length) return parts.join('; ')
  }
  if (o.hasMember?.length) return `${o.hasMember.length} result(s)`
  return '-'
}

export function narrativeAllergies(allergies: AllergyEntity[]): string {
  const rows = allergies.map((a) => {
    const manifestations = (a.reaction ?? [])
      .flatMap((r) => (r.manifestation ?? []).map((m) => m.text || ''))
      .filter(Boolean)
      .join(', ')
    return [
      dash(conceptLabel(a.code)),
      dash(a.clinicalStatus || ''),
      dash(a.criticality || ''),
      dash(manifestations),
      dash(formatDate(a.recordedDate)),
    ]
  })
  return table(['Allergen', 'Status', 'Criticality', 'Reaction', 'Recorded'], rows)
}

export function narrativeMedications(
  medications: MedicationEntity[],
  labels: IpsSectionLabels['medicationTable'],
): string {
  const rows = medications.map((medication) => {
    const { canonical: m, sources } = medicationExportUnit(medication)
    const dosage = medicationDisplayParts(m)
    return [
      // Prefer the English coding[].display (bridge canonical); fall back to
      // text so non-bridge sources are carried over faithfully.
      dash([conceptLabelEn(m.medicationCodeableConcept), m.exportSourceLabel, sourceComparisonNarrative(m),
        sourceSelfPurchase(m) === true ? '自費／自購（self-pay）' : undefined].filter(Boolean).join(' · ')),
      dash(m.exportCurrentnessUnconfirmed ? `unknown (original source: ${m.status || 'unknown'})` : m.status || ''),
      dash(dosage.directions),
      dash([dosage.supply, sourceSupplyText(m), ...sources.map(source => [source.exportSourceLabel, sourceSupplyText(source)].filter(Boolean).join('; '))].filter(Boolean).join(' | ')),
      dash(formatDate(m.authoredOn)),
    ]
  })
  return table([labels.medication, labels.status, labels.directions, labels.supply, labels.date], rows)
}

export function narrativeProblemList(conditions: ConditionEntity[]): string {
  const rows = conditions.map((c) => [
    // The problem list is text-only from the app's side (no SNOMED CT generated).
    // Show the billing-ICD English label carried in coding[].display / text.
    dash(conceptLabelEn(c.code)),
    dash(c.clinicalStatus || ''),
    dash(formatDate(c.onsetDateTime) || formatDate(c.recordedDate)),
  ])
  return table(['Problem', 'Status', 'Onset / Recorded'], rows)
}

export function narrativeImmunizations(immunizations: ImmunizationEntity[]): string {
  const rows = immunizations.map((im) => [
    dash(conceptLabel(im.vaccineCode)),
    dash(im.status || ''),
    dash(formatDate(im.occurrenceDateTime)),
  ])
  return table(['Vaccine', 'Status', 'Date'], rows)
}

export function narrativeProcedures(procedures: ProcedureEntity[]): string {
  const rows = procedures.map((p) => [
    dash(conceptLabel(p.code)),
    dash(p.status || ''),
    dash(formatDate(p.performedDateTime) || formatDate(p.performedPeriod?.start)),
  ])
  return table(['Procedure', 'Status', 'Date'], rows)
}

export function narrativeVitalSigns(vitals: ObservationEntity[]): string {
  const rows = vitals.map((o) => [
    dash(resultLabel(o.code)),
    dash(observationValueText(o)),
    dash(formatDate(o.effectiveDateTime)),
  ])
  return table(['Vital Sign', 'Value', 'Date'], rows)
}

/** Joined label for DiagnosticReport.conclusionCode (CodeableConcept | array). */
function conclusionCodeText(raw: unknown): string {
  if (!raw) return ''
  const list = Array.isArray(raw) ? raw : [raw]
  return list
    .map((cc) => conceptLabel(cc as { text?: string; coding?: Array<{ display?: string; code?: string }> }))
    .filter(Boolean)
    .join('; ')
}

/**
 * Diagnostic Results narrative.
 *
 * A DiagnosticReport's presentable content is the ADDITIVE UNION of independent
 * channels — any combination of them may be present, and none suppresses
 * another. We emit a row for every channel that exists and fall back to a single
 * "-" row only when the report is genuinely empty. New bundles exercise
 * different *combinations* of these finite channels, not new channels, so this
 * never needs per-dataset branching:
 *   • conclusion        (free-text summary)
 *   • conclusionCode    (coded conclusion)
 *   • _observations[]   (member analyte values, via the total observationValueText)
 *   • presentedForm[]   (attachment indicator — base64 images are never inlined)
 *   • note[]            (supplementary notes)
 */
export function narrativeResults(
  diagnosticReports: DiagnosticReportEntity[],
  labObservations: ObservationEntity[],
  labLabel = 'Laboratory',
  imagingLabel = 'Imaging & studies',
): string {
  const headers = ['Result', 'Value / Conclusion', 'Date']

  // Rows for one report — covers every presentable TEXT channel (see doc above).
  // Attachments (images / scanned forms) are NOT surfaced: the IPS never embeds
  // them (presentedForm is stripped in mapResults). A report with no text at all
  // (e.g. image-only) yields NO rows and is omitted entirely.
  const reportRows = (dr: DiagnosticReportEntity): string[][] => {
    const out: string[][] = []
    const reportLabel = dash(resultLabel(dr.code))
    const reportDate = dash(formatDate(dr.effectiveDateTime))

    const conclusion = dr.conclusion?.trim()
    if (conclusion) out.push([reportLabel, conclusion, reportDate])

    const codeText = conclusionCodeText(dr.conclusionCode)
    if (codeText) out.push([reportLabel, codeText, reportDate])

    for (const o of dr._observations ?? []) {
      out.push([
        dash(resultLabel(o.code) || resultLabel(dr.code)),
        dash(observationValueText(o)),
        dash(formatDate(o.effectiveDateTime) || formatDate(dr.effectiveDateTime)),
      ])
    }

    const noteText = (dr.note ?? []).map((n) => n.text?.trim()).filter(Boolean).join('; ')
    if (noteText) out.push([reportLabel, noteText, reportDate])

    return out
  }

  // One sortable entry per study / orphan observation, so each study's rows stay
  // together and we can order the whole reading newest-first. Lab tests (incl.
  // orphan single observations) group together, imaging / studies group together.
  // The export stays ONE standard Results section (LOINC 30954-2) — this only
  // structures its human-readable narrative.
  type Entry = { date: string; group: 'lab' | 'imaging'; rows: string[][]; title?: string }
  const entries: Entry[] = []
  for (const o of labObservations) {
    entries.push({
      date: o.effectiveDateTime || '',
      group: 'lab',
      rows: [[dash(resultLabel(o.code)), dash(observationValueText(o)), dash(formatDate(o.effectiveDateTime))]],
    })
  }
  for (const dr of diagnosticReports) {
    const rows = reportRows(dr)
    if (!rows.length) continue // text-less report (e.g. image-only) → omitted
    const reportLabel = dash(resultLabel(dr.code))
    const reportDate = dash(formatDate(dr.effectiveDateTime))
    entries.push({
      date: dr.effectiveDateTime || '',
      group: inferGroupFromCategory(dr.category) === 'imaging' ? 'imaging' : 'lab',
      rows,
      title: rows.length > 1 ? [reportDate, reportLabel].filter((x) => x && x !== '-').join(' - ') : undefined,
    })
  }
  entries.sort((a, b) => b.date.localeCompare(a.date)) // newest first

  const labEntries = entries.filter((e) => e.group === 'lab')
  const imagingEntries = entries.filter((e) => e.group === 'imaging')

  const renderEntries = (groupEntries: Entry[]): string => {
    let html = ''
    let compactRows: string[][] = []
    const flushCompactRows = () => {
      if (!compactRows.length) return
      html += rawTable(headers, compactRows)
      compactRows = []
    }

    for (const entry of groupEntries) {
      if (!entry.title) {
        compactRows.push(...entry.rows)
        continue
      }
      flushCompactRows()
      html += `<p><strong>${escapeHtml(entry.title)}</strong></p>${rawTable(headers, entry.rows)}`
    }
    flushCompactRows()
    return html
  }

  const labHtml = renderEntries(labEntries)
  const imagingHtml = renderEntries(imagingEntries)

  // Two labeled groups only when both kinds are present; otherwise a plain table.
  if (labHtml && imagingHtml) {
    return wrap(
      `<p><strong>${escapeHtml(labLabel)}</strong></p>${labHtml}` +
        `<p><strong>${escapeHtml(imagingLabel)}</strong></p>${imagingHtml}`,
    )
  }
  const all = labHtml || imagingHtml
  return all ? wrap(all) : ''
}

export function narrativeDevices(devices: DeviceEntity[]): string {
  const rows = devices.map((d) => [
    dash(conceptLabel(d.type) || d.deviceName?.find((n) => n.name)?.name || ''),
    dash(d.manufacturer || ''),
    dash(formatDate(d.manufactureDate)),
  ])
  return table(['Device', 'Manufacturer', 'Date'], rows)
}

export function narrativeCarePlans(carePlans: CarePlanEntity[]): string {
  const rows = carePlans.map((cp) => [
    // CarePlan.title is optional (0..1); many sources (e.g. Synthea / SMART
    // sandbox) carry the plan name in `category` instead. Fall back through the
    // same chain the 照護計畫 panel uses so the IPS narrative isn't a bare "-".
    dash(cp.title || conceptLabel(cp.category?.[0]) || cp.description || 'Care plan'),
    dash(cp.status || ''),
    dash(formatDate(cp.period?.start) || formatDate(cp.created)),
  ])
  return table(['Plan', 'Status', 'Date'], rows)
}

export function narrativeAdvanceDirectives(consents: ConsentEntity[]): string {
  const rows = consents.map((c) => [
    dash(conceptLabel(c.scope) || conceptLabel(c.category?.[0]) || 'Advance directive'),
    dash(c.provision?.type || ''),
    dash(c.status || ''),
    dash(formatDate(c.dateTime)),
  ])
  return table(['Directive', 'Provision', 'Status', 'Date'], rows)
}
