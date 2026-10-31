/** Presentation-only VGH adapter. Never rewrites imported FHIR resources. */
type SourceResource = {
  meta?: { source?: string; tag?: Array<{ system?: string; code?: string }> }
  extension?: Array<{ url?: string }>
}
export type HospitalSource = 'in-house' | 'cloud' | 'cloud-and-in-house'
export type InstitutionDisplay = { name: string; suffix: string; label: string }

export function mergeHospitalSources(sources: Array<HospitalSource | undefined>): HospitalSource | undefined {
  if (sources.includes('cloud-and-in-house') || (sources.includes('in-house') && sources.includes('cloud'))) return 'cloud-and-in-house'
  if (sources.includes('in-house')) return 'in-house'
  return sources.includes('cloud') ? 'cloud' : undefined
}

export function getVghtpeSource(resources: SourceResource[]): HospitalSource | undefined {
  const inHouse = resources.some(resource => resource.meta?.tag?.some(tag =>
    tag.system === 'urn:wildcatch:source' && tag.code === 'vghtpe-outpatient-supplement'))
  const cloud = resources.some(resource => /^https:\/\/medcloud2\.nhi\.gov\.tw(?:\/|$)/.test(resource.meta?.source ?? ''))
  const merged = resources.some(resource => Array.isArray(resource.extension) && resource.extension.some(extension =>
    extension.url === 'urn:wildcatch:dedup-method'))
  if (inHouse) return merged || cloud ? 'cloud-and-in-house' : 'in-house'
  return cloud ? 'cloud' : undefined
}

export function vghtpeSourceDisplay(
  institution: string,
  source: HospitalSource | undefined,
  locale: string,
): InstitutionDisplay | undefined {
  const names = ['臺北榮總', '台北榮總', '臺北榮民總醫院', '台北榮民總醫院']
  if (!names.includes(institution.trim())) return undefined
  // Cloud-only records keep the source spelling. Records containing in-house
  // data use the compact label explicitly requested by the user.
  const name = source === 'in-house' || source === 'cloud-and-in-house' ? '臺北榮總' : institution
  if (source !== 'in-house' && source !== 'cloud-and-in-house') return { name, suffix: '', label: name }
  const merged = source === 'cloud-and-in-house'
  const suffix = locale === 'en'
    ? `(${merged ? 'Cloud + in-house' : 'In-house'})`
    : `(${merged ? '院內+雲端' : '院內'})`
  return { name, suffix, label: `${name}${locale === 'en' ? ' ' : ''}${suffix}` }
}
