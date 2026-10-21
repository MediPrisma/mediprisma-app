import { getPatientDisplayName, type PatientEntity } from '@/src/core/entities/patient.entity'

function filenamePart(value: string): string {
  // Windows forbids '*'; keep the source's masking explicit with 'X'.
  return value.replace(/[*＊]/gu, 'X').replace(/[^\p{L}\p{N}_\-○〇●◯]+/gu, '_')
    .replace(/^_+|_+$/g, '')
}

export function originalFhirFilename(patient: PatientEntity | null, date = new Date()): string {
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
  let identity = ''
  try {
    const identifiers = (Array.isArray(patient?.identifier) ? patient.identifier : [])
      .filter(id => typeof id?.value === 'string' && id.value.trim())
    const hasType = (id: typeof identifiers[number], codes: string[]) =>
      Array.isArray(id.type?.coding) && id.type.coding.some(coding => codes.includes(coding?.code ?? ''))
    const nationalId = identifiers.find(id => hasType(id, ['NI', 'NNxxx'])
      || /national[-_]?id|moi\.gov\.tw/i.test(id.system ?? ''))
    const chartId = identifiers.find(id => hasType(id, ['MR'])
      || /medical-record|mrn|chart/i.test(id.system ?? ''))
    const identifier = nationalId?.value ?? chartId?.value ?? identifiers[0]?.value ?? patient?.id ?? ''
    const name = getPatientDisplayName(patient)
    identity = [name === 'Unknown Patient' ? '' : name, identifier]
      .map(filenamePart).filter(Boolean).join('_')
    // Bound UTF-8 bytes without splitting Unicode characters or the extension.
    let bytes = 0
    const encoder = new TextEncoder()
    let bounded = ''
    for (const char of identity) {
      bytes += encoder.encode(char).length
      if (bytes > 200) break
      bounded += char
    }
    identity = bounded
  } catch {
    // Malformed optional demographics must not prevent an unchanged raw download.
  }
  return `FHIR_original${identity ? `_${identity}` : ''}_${stamp}.json`
}
