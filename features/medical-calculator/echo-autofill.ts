import { classifyReport, reportNarrative, extractEchoMeasurements } from '@voho0000/personalized-care-fhir'
import type { DiagnosticReportEntity } from '@/src/core/entities/clinical-data.entity'
import type { AutofillValue } from './hooks/use-lab-autofill.hook'

export type EchoKey = 'lvef' | 'ee' | 'averageEe' | 'pasp' | 'e' | 'septalE' | 'lateralE' | 'trv' | 'gls' | 'lavi' | 'lvmi' | 'rwt' | 'wall'
export type EchoValues = Partial<Record<EchoKey, number>>
const units: Record<EchoKey, string> = { lvef: '%', ee: '', averageEe: '', pasp: 'mmHg', e: 'cm/s', septalE: 'cm/s', lateralE: 'cm/s', trv: 'm/s', gls: '%', lavi: 'mL/m²', lvmi: 'g/m²', rwt: '', wall: 'mm' }

/** Extends personalization's cross-hospital echo scanner. No diagnoses are inferred.
 * Only unequivocal point measurements are accepted; ranges/comparators are not numbers.
 * In particular, a unilateral E/e′ is NOT an average for HFA-PEFF.
 */
export function parseCalculatorEcho(raw: string): EchoValues {
  const text = raw.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&prime;|&#8242;|&#39;|&apos;/gi, "'").replace(/[′’`]/g, "'").replace(/\s+/g, ' ')
  const base = extractEchoMeasurements(text)
  const values: EchoValues = {}
  const number = (pattern: string, unit?: string): number | undefined => {
    const match = text.match(new RegExp(`(?:${pattern})\\s*[:=]?\\s*(-?\\d+(?:\\.\\d+)?)(?![\\d.])(?:\\s*(${unit ?? ''}))?`, 'i'))
    if (!match) return undefined
    const end = (match.index ?? 0) + match[0].length
    if (/^\s*(?:[-–~～]|to\b)\s*\d/i.test(text.slice(end))) return undefined
    // Do not reinterpret a value written in a different physical unit.
    const tail = text.slice(end)
    if (/^\s*(?:kPa|Pa|cmH2O|mmol|pmol)\b/i.test(tail)) return undefined
    const value = Number(match[1])
    if (!Number.isFinite(value)) return undefined
    const u = (match[2] ?? '').toLowerCase().replace(/\s/g, '').replace(/sec$/, 's')
    return u === 'm/s' && unit?.includes('cm') ? value * 100 : value
  }
  // Some reports name the method, “LVEF(MOD-sp4) 62.5 %”, and glue the label
  // straight after the previous value, “LA volume:88.4mlLVEF(Bp):61.1%”.
  const lvef = number('(?:\\b|(?<=\\dml))(?:LVEF|LV\\s*(?:ejection\\s*fraction|EF)|left\\s*ventricular\\s*ejection\\s*fraction)(?:\\s*\\([^()]{1,20}\\))?', '%')
  if (lvef !== undefined && lvef > 0) values.lvef = lvef
  const e = number('\\b(?:MV\\s*)?E(?:\\s*(?:max\\s*vel(?:ocity)?|vel(?:ocity)?|wave))?\\b(?!\\s*[/\\\'])', 'cm\\s*/\\s*s(?:ec)?|m\\s*/\\s*s(?:ec)?')
  // Some reports print both transmitral velocities as “MV E/A 54/89.1cm/s”.
  // Require both point values and a velocity unit; a dimensionless E/A ratio is not E.
  const pairedVelocity = text.match(/\bMV\s*E\s*\/\s*A\s*[:=]?\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*(cm|m)\s*\/\s*s(?:ec)?\b(?!\s*(?:[-–~～]|to\b)\s*\d)/i)
  const pairedE = pairedVelocity && Number(pairedVelocity[2]) > 0
    ? Number(pairedVelocity[1]) * (pairedVelocity[3].toLowerCase() === 'm' ? 100 : 1)
    : undefined
  const mitralE = e ?? pairedE
  const septal = number("(?:\\b(?:med\\s*peak|sep(?:tal)?|medial)\\s*e'|(?<![/\\w])e'\\s*_?\\s*(?:sep(?:tal)?|med(?:ial)?\\b))(?:\\s*vel(?:ocity)?)?", 'cm\\s*/\\s*s(?:ec)?|m\\s*/\\s*s(?:ec)?')
  const lateral = number("(?:\\b(?:lat(?:eral)?)\\s*e'|(?<![/\\w])e'\\s*_?\\s*lat(?:eral)?)(?:\\s*vel(?:ocity)?)?", 'cm\\s*/\\s*s(?:ec)?|m\\s*/\\s*s(?:ec)?')
  if (mitralE !== undefined && mitralE > 0) values.e = mitralE
  if (septal !== undefined && septal > 0) values.septalE = septal
  if (lateral !== undefined && lateral > 0) values.lateralE = lateral
  const average = number("\\bE\\s*/\\s*(?:avg|ave|average|mean)\\s*e'?") ?? number("\\b(?:average|mean)\\s*E\\s*/\\s*e'?") ?? number("\\bE\\s*/\\s*e'?\\s*(?:avg|ave|average|mean)")
  if (average !== undefined && average > 0) values.averageEe = average
  else if (values.e !== undefined && values.septalE !== undefined && values.lateralE !== undefined) values.averageEe = 2 * values.e / (values.septalE + values.lateralE)
  // Keep the original scanner's preferred ratio for H2FPEF, but reject text
  // whose reported value is a range. HFA requires an explicitly averaged ratio.
  if (base.eOverEPrime !== undefined && !/E\s*\/[^:=]{0,20}[:=]?\s*\d+(?:\.\d+)?\s*[-–~～]\s*\d/i.test(text)) values.ee = values.averageEe ?? base.eOverEPrime
  if (values.averageEe !== undefined) values.ee = values.averageEe
  const pasp = number('\\b(?:PASP|RVSP|sPAP|estimated\\s+(?:systolic\\s+)?(?:PA|pulmonary\\s+artery)\\s+(?:systolic\\s+)?pressure)', 'mmHg')
  if (pasp !== undefined && pasp > 0) values.pasp = pasp
  const tr = number('\\b(?:TR\\s*(?:max\\s*)?V(?:\\s*max|el(?:ocity)?)?|TRV)', 'm\\s*/\\s*s(?:ec)?|cm\\s*/\\s*s(?:ec)?')
  // The shared scanner correctly normalizes cm/s. Only use it after the
  // strict point-value matcher above rejected inequalities and ranges.
  if (tr !== undefined && tr > 0) {
    const hasVelocityUnit = /\b(?:TR\s*(?:max\s*)?V(?:\s*max|el(?:ocity)?)?|TRV)\s*[:=]?\s*\d+(?:\.\d+)?\s*(?:cm|m)\s*\/\s*s(?:ec)?/i.test(text)
    values.trv = hasVelocityUnit || tr > 20 ? tr / 100 : tr
  }
  const rest: Array<[EchoKey, string, string?]> = [
    ['lavi', '\\b(?:LAVI|LA\\s*(?:volume|vol\\.?)\\s*index(?:ed)?)'],
    ['lvmi', '\\b(?:LVMI|LV\\s*mass\\s*index|LV\\s*mass\\(C\\)dI)'],
    ['rwt', '\\b(?:RWT[_\\\\]*|relative\\s*wall\\s*thickness)'],
    ['gls', '\\b(?:GLS|(?:LV\\s*)?global\\s*longitudinal\\s*strain)'],
    ['wall', '\\b(?:max(?:imum)?\\s*(?:LV\\s*)?wall\\s*thickness)', 'mm'],
  ]
  for (const [key, pattern, unit] of rest) {
    const value = number(pattern, unit)
    if (value !== undefined && (value > 0 || key === 'gls')) values[key] = key === 'gls' ? Math.abs(value) : value
  }
  const length = (pattern: string) => {
    const match = text.match(new RegExp(`\\b(?:${pattern})\\s*[:=]?\\s*(\\d+(?:\\.\\d+)?)\\s*(?:\\([^)]*\\)\\s*)?(mm|cm)\\b`, 'i'))
    return match ? Number(match[1]) * (match[2].toLowerCase() === 'cm' ? 10 : 1) : undefined
  }
  const ivs = length('IVSd|IVS'), pw = length('LVPWd|LVPW|PWd'), lvid = length('LVIDd|LVDd|LVEDD')
  if (values.wall === undefined && ivs !== undefined && pw !== undefined) values.wall = Math.max(ivs, pw)
  if (values.rwt === undefined && pw !== undefined && lvid !== undefined && lvid > 0) values.rwt = 2 * pw / lvid
  // Reject implausible scales rather than auto-filling an unconverted unit.
  const limits: Record<EchoKey, number> = { lvef: 100, ee: 100, averageEe: 100, pasp: 200, e: 300, septalE: 50, lateralE: 50, trv: 10, gls: 100, lavi: 300, lvmi: 500, rwt: 2, wall: 50 }
  for (const key of Object.keys(values) as EchoKey[]) {
    if (values[key]! < 0 || values[key]! > limits[key]) delete values[key]
  }
  return values
}

export interface EchoObservation {
  id?: string
  status?: string
  code?: { text?: string; coding?: Array<{ display?: string }> }
  valueString?: string
  valueQuantity?: { value?: number; unit?: string; comparator?: string }
  component?: EchoObservation[]
}
function observationNarrative(obs: EchoObservation): string[] {
  if (['entered-in-error', 'cancelled', 'preliminary'].includes(obs.status ?? '')) return []
  const name = obs.code?.text || obs.code?.coding?.find(c => c.display)?.display || ''
  const q = obs.valueQuantity
  const point = q && !q.comparator && typeof q.value === 'number' && Number.isFinite(q.value)
    ? `${name}: ${q.value} ${q.unit ?? ''}` : ''
  return [point, obs.valueString ?? '', ...(obs.component ?? []).flatMap(observationNarrative)]
}

/** Latest actual echo report, never a per-field merge across institutions/dates.
 * Newer order stubs without findings do not displace an available report.
 */
export function buildEchoAutofill(reports: DiagnosticReportEntity[], observations: EchoObservation[] = []): Partial<Record<EchoKey, AutofillValue>> {
  let latest: { date: string; report: DiagnosticReportEntity; values: EchoValues } | undefined
  for (const report of reports) {
    if (['entered-in-error', 'cancelled', 'registered', 'partial', 'preliminary'].includes(report.status ?? '')) continue
    const refs = new Set((report.result ?? []).map(r => r.reference?.split('/').pop()).filter(Boolean))
    const members = [...(report._observations ?? []), ...observations.filter(o => o.id && refs.has(o.id))]
    const narrative = [reportNarrative(report), ...members.flatMap(observationNarrative)].filter(Boolean).join('\n')
    if (!narrative.trim() || classifyReport(report, narrative) !== 'echocardiography') continue
    const date = report.effectiveDateTime ?? report.effectivePeriod?.start ?? report.issued ?? ''
    if (!date || !Number.isFinite(Date.parse(date))) continue
    const values = parseCalculatorEcho(narrative)
    if (!latest || Date.parse(date) > Date.parse(latest.date)) latest = { date, report, values }
  }
  if (!latest) return {}
  const { report, date, values } = latest
  const result: Partial<Record<EchoKey, AutofillValue>> = {}
  for (const key of Object.keys(values) as EchoKey[]) {
    result[key] = { value: values[key]!, unit: units[key], date, testName: `${report.code?.text || report.code?.coding?.find(c => c.display)?.display || '心臟超音波'} · ${({ lvef: 'LVEF', ee: 'E/e′', averageEe: '平均 E/e′', pasp: 'PASP', e: 'E', septalE: 'Septal e′', lateralE: 'Lateral e′', trv: 'TR Vmax', gls: 'GLS', lavi: 'LAVI', lvmi: 'LVMI', rwt: 'RWT', wall: 'LV wall thickness' })[key]}`, facility: report.performer?.find(p => p.display)?.display, obsId: report.id, resourceType: 'DiagnosticReport' }
  }
  return result
}
