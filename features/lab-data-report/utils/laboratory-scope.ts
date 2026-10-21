// The policy boundary of a lab-data report: laboratory Observations only
// (PRIVACY_POLICY §2.10). Decided from the FHIR category alone — never from a
// name, since a "Blood pressure questionnaire" survey reads like a lab.
//
// The `submitLabDataReport` Function checks the same boundary on the category
// codes each row carries (row.category), so a row the app would not send is
// also a row the server refuses.

const OBSERVATION_CATEGORY_SYSTEMS = new Set([
  'http://terminology.hl7.org/CodeSystem/observation-category',
  // Pre-R4 canonical, still emitted by some servers.
  'http://hl7.org/fhir/observation-category',
])

/** Every other observation-category code. One of these on any coding — of
 *  any system — keeps the row out, even next to "laboratory". */
export const NON_LAB_CATEGORY_CODES: ReadonlySet<string> = new Set([
  'social-history',
  'vital-signs',
  'imaging',
  'survey',
  'exam',
  'therapy',
  'activity',
  'procedure',
])

function categoryCodings(observation: any): any[] {
  const categories = Array.isArray(observation?.category)
    ? observation.category
    : observation?.category ? [observation.category] : []
  return categories.flatMap((concept: any) => (Array.isArray(concept?.coding) ? concept.coding : []))
}

export function isLaboratoryObservation(observation: any): boolean {
  if (!observation || typeof observation !== 'object') return false
  // The app's ObservationEntity (FhirMapper.toObservation) carries no
  // resourceType, so only a resource that names another type is refused;
  // the category below is what decides.
  if (observation.resourceType !== undefined && observation.resourceType !== 'Observation') return false
  const codings = categoryCodings(observation)
  const isLab = codings.some((coding) =>
    OBSERVATION_CATEGORY_SYSTEMS.has(coding?.system) && coding?.code === 'laboratory')
  if (!isLab) return false
  return !codings.some((coding) => typeof coding?.code === 'string' && NON_LAB_CATEGORY_CODES.has(coding.code))
}
