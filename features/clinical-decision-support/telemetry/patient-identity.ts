import { isDeidentifiedPatient, type PatientEntity } from '@/src/core/entities/patient.entity'

const MASK = /[Xx*＊○〇●Ｏ◯]/u
const NAME_MASK = /[Xx○〇●Ｏ◯]/u
const MASKED_NATIONAL_ID = /^[A-Z][0-9X*＊○〇●Ｏ◯]{9}$/u
const NATIONAL_ID_SYSTEM = /national[-_]?id/i
const MEDCLOUD_SOURCE_ID_SYSTEM = 'https://cloud-wildcatch.invalid/fhir/IdentifierSystem/source-medcloud-patient-id'
const MEDCLOUD_MASKED_ID_SYSTEM = 'https://cloud-wildcatch.invalid/fhir/IdentifierSystem/masked-medcloud-patient-id'
const MEDCLOUD_NATIONAL_ID_SYSTEM = 'https://cloud-wildcatch.invalid/fhir/IdentifierSystem/masked-tw-national-id'
const BIRTH_DATE = /^\d{4}-\d{2}-\d{2}$/

function normalizedIdentifierSystem(system?: string): string {
  return system?.normalize('NFKC').trim() ?? ''
}

function isMedcloudSystem(system: string, expected: string): boolean {
  return system.toLowerCase() === expected.toLowerCase()
}

function isMedcloudNamespace(system: string): boolean {
  try {
    return new URL(system).hostname.toLowerCase().replace(/\.$/, '') === 'cloud-wildcatch.invalid'
  } catch { return false }
}

function normalizedName(patient: PatientEntity): string {
  const names = (patient.name ?? [])
    .map((name) => name.text?.normalize('NFKC').trim().replace(/\s+/gu, ' '))
    .filter((name): name is string => Boolean(name))
  // A source may substitute an unrecognized character with '*'. Keep it in
  // the lookup key; removing or guessing it could mix different patients.
  const knownLetters = names[0]?.match(/\p{L}/gu)?.length ?? 0
  if (names.length !== 1 || Array.from(names[0]).length < 2 || NAME_MASK.test(names[0])
    || (names[0].includes('*') && knownLetters < 2)) {
    throw new Error('cdss_identity_unavailable')
  }
  return names[0]
}

function maskedName(name: string): string {
  const chars = Array.from(name)
  const visible = chars.map((char, index) => (
    index === 0 || (index === chars.length - 1 && chars.length > 2) || /\s/u.test(char)
      ? char : '○'
  ))
  return visible.join('')
}

function nationalId(patient: PatientEntity): { system: string; value: string } {
  const matches = (patient.identifier ?? [])
    .map((identifier) => ({
      system: normalizedIdentifierSystem(identifier.system),
      value: identifier.value?.normalize('NFKC').trim().toUpperCase() ?? '',
    }))
    .filter(identifier => isMedcloudSystem(identifier.system, MEDCLOUD_SOURCE_ID_SYSTEM)
      || isMedcloudSystem(identifier.system, MEDCLOUD_NATIONAL_ID_SYSTEM)
      || (!isMedcloudNamespace(identifier.system) && NATIONAL_ID_SYSTEM.test(identifier.system)))
  if (matches.length !== 1 || !MASKED_NATIONAL_ID.test(matches[0].value)
    || !MASK.test(matches[0].value.slice(1))) {
    throw new Error('cdss_identity_unavailable')
  }
  const identifier = matches[0]
  if (isMedcloudSystem(identifier.system, MEDCLOUD_SOURCE_ID_SYSTEM)) {
    // The bridge uses a generic namespace for unmasked-name exports. Only a
    // partially masked TW national-ID shape can enter the existing ID tuple.
    if (!/^[A-Z][12][0-9X*＊○〇●Ｏ◯]{8}$/u.test(identifier.value)) {
      throw new Error('cdss_identity_unavailable')
    }
    return { ...identifier, system: MEDCLOUD_NATIONAL_ID_SYSTEM }
  }
  return identifier
}

/** The identifying inputs exist only in this browser; only the digest and masked display fields leave it. */
export async function cdssPatientIdentity(patient: PatientEntity) {
  const remaskedMedcloudId = (patient.identifier ?? []).some(identifier => {
    const system = normalizedIdentifierSystem(identifier.system)
    const value = identifier.value?.normalize('NFKC').trim().toUpperCase() ?? ''
    // The bridge's second masking pass hides the final four characters.
    // Detect it before name/date validation so even legacy exports get the
    // instruction to turn off de-identification and reimport.
    return isMedcloudSystem(system, MEDCLOUD_MASKED_ID_SYSTEM) ||
      (isMedcloudNamespace(system) && /[X*○〇●Ｏ◯]{4}$/u.test(value))
  })
  if (isDeidentifiedPatient(patient) || remaskedMedcloudId) throw new Error('cdss_patient_deidentified')
  const name = normalizedName(patient)
  const birthDate = patient.birthDate?.trim() ?? ''
  const parsedBirthDate = Date.parse(birthDate)
  if (!BIRTH_DATE.test(birthDate) || Number.isNaN(parsedBirthDate)
    || new Date(parsedBirthDate).toISOString().slice(0, 10) !== birthDate) {
    throw new Error('cdss_identity_unavailable')
  }
  const identifier = nationalId(patient)
  const canonical = JSON.stringify([1, 'vghtpe', name, birthDate, identifier.system, identifier.value])
  if (!crypto.subtle) throw new Error('cdss_crypto_unavailable')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  const patientKey = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return {
    patient_key_version: 1 as const,
    patient_key_sha256: patientKey,
    patient_identity: {
      name_masked: maskedName(name),
      birth_year: birthDate.slice(0, 4),
      identifier_masked: identifier.value,
      identifier_system: identifier.system,
    },
  }
}
