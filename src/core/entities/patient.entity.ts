// Core Domain Entity: Patient
//
// Kept intentionally loose on optional fields — TW Core IG Patient resources
// from TWCAT vendors carry useful demographic data (NI/MR identifiers,
// telecom, address, contact, communication) that the legacy 4-field display
// dropped. The display layer opts in to extra fields via a "show more"
// toggle so existing callers (medical-chat header, IPS export) stay quiet.
export interface PatientEntity {
  id: string
  resourceType: 'Patient'
  name?: {
    use?: string
    text?: string
    given?: string[]
    family?: string
  }[]
  gender?: 'male' | 'female' | 'other' | 'unknown'
  birthDate?: string
  age?: number
  /** Source data was explicitly de-identified; retained through local demographic overlays. */
  deidentified?: boolean
  // Optional extended demographics (filled in by PatientMapper.toDomain).
  identifier?: {
    use?: string
    type?: { coding?: { system?: string; code?: string }[]; text?: string }
    system?: string
    value?: string
  }[]
  telecom?: {
    system?: string
    value?: string
    use?: string
  }[]
  address?: {
    use?: string
    text?: string
    line?: string[]
    city?: string
    district?: string
    state?: string
    postalCode?: string
    country?: string
  }[]
  maritalStatus?: {
    coding?: { system?: string; code?: string; display?: string }[]
    text?: string
  }
  communication?: {
    language?: { coding?: { system?: string; code?: string; display?: string }[]; text?: string }
    preferred?: boolean
  }[]
  contact?: {
    relationship?: { coding?: { system?: string; code?: string; display?: string }[]; text?: string }[]
    name?: { text?: string; given?: string[]; family?: string }
    telecom?: { system?: string; value?: string; use?: string }[]
  }[]
  /** Present only when the App has overlaid user-entered demographics.
   * The source FHIR Patient remains unchanged. */
  demographicsSource?: 'user-entered-local-profile'
  userEnteredDemographicFields?: PatientDemographicField[]
}

/** Cloud export marks de-identified names as anonymous; ID masking alone is not this option. */
export function isDeidentifiedPatient(patient: PatientEntity): boolean {
  return patient.deidentified === true || (Array.isArray(patient.name) && patient.name.some(name => name?.use === 'anonymous'))
}

export type PatientDemographicField = 'name' | 'gender' | 'birthDate'

export interface UserEnteredPatientProfile {
  source: 'user-entered'
  name?: string
  gender?: 'male' | 'female' | 'other'
  birthDate?: string
  updatedAt: string
}

export interface UserEnteredPatientProfileInput {
  name?: string
  gender?: 'male' | 'female' | 'other'
  birthDate?: string
}

const PROFILE_GENDERS = new Set(['male', 'female', 'other'])
const FHIR_YEAR_PATTERN = /^\d{4}$/
const FHIR_YEAR_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/
const FHIR_FULL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function localDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function isValidPatientBirthDate(
  value: string,
  today = new Date(),
): boolean {
  if (FHIR_YEAR_PATTERN.test(value)) {
    return value >= '0001' && value <= localDateString(today).slice(0, 4)
  }
  if (FHIR_YEAR_MONTH_PATTERN.test(value)) {
    return value <= localDateString(today).slice(0, 7)
  }
  if (!FHIR_FULL_DATE_PATTERN.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return false
  if (parsed.toISOString().slice(0, 10) !== value) return false
  return value <= localDateString(today)
}

/** FHIR date values may intentionally carry only year or year-month precision. */
export function isPartialPatientBirthDate(value?: string | null): boolean {
  return Boolean(
    value
    && (FHIR_YEAR_PATTERN.test(value) || FHIR_YEAR_MONTH_PATTERN.test(value)),
  )
}

/** Build the only accepted shape for encrypted, user-entered demographics.
 * Empty strings are treated as "not supplied"; invalid dates fail closed. */
export function createUserEnteredPatientProfile(
  input: UserEnteredPatientProfileInput,
  now = new Date(),
): UserEnteredPatientProfile | null {
  const name = typeof input.name === 'string'
    ? input.name.trim().replace(/\s+/g, ' ').slice(0, 100)
    : ''
  const gender = PROFILE_GENDERS.has(input.gender ?? '')
    ? input.gender
    : undefined
  const birthDate = typeof input.birthDate === 'string' && input.birthDate.trim()
    ? input.birthDate.trim()
    : undefined

  if (birthDate && !isValidPatientBirthDate(birthDate, now)) {
    throw new Error('Invalid patient birth date')
  }
  if (!name && !gender && !birthDate) return null

  return {
    source: 'user-entered',
    ...(name ? { name } : {}),
    ...(gender ? { gender } : {}),
    ...(birthDate ? { birthDate } : {}),
    updatedAt: now.toISOString(),
  }
}

/** Parse untrusted decrypted storage without inventing or guessing values. */
export function parseUserEnteredPatientProfile(
  value: unknown,
): UserEnteredPatientProfile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Partial<UserEnteredPatientProfile>
  if (candidate.source !== 'user-entered') return null
  if (
    typeof candidate.updatedAt !== 'string'
    || Number.isNaN(Date.parse(candidate.updatedAt))
  ) {
    return null
  }
  try {
    const profile = createUserEnteredPatientProfile({
      name: candidate.name,
      gender: candidate.gender,
      birthDate: candidate.birthDate,
    }, new Date(candidate.updatedAt))
    return profile ? { ...profile, updatedAt: candidate.updatedAt } : null
  } catch {
    return null
  }
}

export function applyUserEnteredPatientProfile(
  patient: PatientEntity,
  profile: UserEnteredPatientProfile | null,
): PatientEntity {
  if (!profile) return patient

  const fields: PatientDemographicField[] = []
  const next: PatientEntity = { ...patient, ...(isDeidentifiedPatient(patient) ? { deidentified: true } : {}) }
  if (profile.name) {
    next.name = [{ use: 'usual', text: profile.name }]
    fields.push('name')
  }
  if (profile.gender) {
    next.gender = profile.gender
    fields.push('gender')
  }
  if (profile.birthDate) {
    next.birthDate = profile.birthDate
    next.age = calculateAge(profile.birthDate) ?? undefined
    fields.push('birthDate')
  }
  next.demographicsSource = 'user-entered-local-profile'
  next.userEnteredDemographicFields = fields
  return next
}

export function calculateAge(birthDate?: string | null): number | null {
  if (!birthDate || !isValidPatientBirthDate(birthDate)) return null
  const [yearText, monthText, dayText] = birthDate.split('-')
  const year = Number(yearText)

  const today = new Date()
  let age = today.getFullYear() - year
  if (monthText) {
    const birthMonth = Number(monthText) - 1
    const monthDiff = today.getMonth() - birthMonth
    if (
      monthDiff < 0
      || (dayText && monthDiff === 0 && today.getDate() < Number(dayText))
    ) {
      age -= 1
    }
  }
  return age >= 0 ? age : null
}

export type PatientNameLocale = 'zh-TW' | 'en'

function formatStructuredPatientName(
  name: NonNullable<PatientEntity['name']>[number],
): string {
  const given = name.given
    ?.map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
  const family = name.family?.trim()
  return [given, family].filter(Boolean).join(' ')
}

function isRomanizedPatientName(value: string): boolean {
  return /\p{Script=Latin}/u.test(value) && !/\p{Script=Han}/u.test(value)
}

export function getPatientDisplayName(
  patient: PatientEntity | null,
  locale: PatientNameLocale = 'zh-TW',
): string {
  if (!patient?.name?.[0]) return 'Unknown Patient'

  // TW Core commonly stores the official local-script name in `text`, while
  // `given` / `family` contain an explicit Romanization. In English, use only
  // a supplied Latin-script representation; never invent a transliteration
  // for a real patient whose resource contains Chinese alone.
  if (locale === 'en') {
    const structured = patient.name
      .map(formatStructuredPatientName)
      .find((name) => name && isRomanizedPatientName(name))
    if (structured) return structured

    const latinText = patient.name
      .map((name) => name.text?.trim() ?? '')
      .find((name) => name && isRomanizedPatientName(name))
    if (latinText) return latinText
  }

  // Prefer the official local-script name in `text` (TW Core / IPS put the
  // Chinese name there; given/family hold Pinyin). Mirrors patient-info's
  // formatName so a text-only name — legal FHIR, and exactly what our own IPS
  // export emits — never collapses to "Unknown Patient" on a round-trip.
  const text = patient.name.find((n) => n.text)?.text?.trim()
  if (text) return text
  return formatStructuredPatientName(patient.name[0]) || 'Unknown Patient'
}
