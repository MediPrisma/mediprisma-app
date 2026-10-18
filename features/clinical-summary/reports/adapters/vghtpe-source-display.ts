/** Presentation-only VGH adapter. Never rewrites imported FHIR resources. */
type SourceResource = {
  meta?: { source?: string; tag?: Array<{ system?: string; code?: string }> }
  extension?: Array<{ url?: string }>
}
export type HospitalSource = 'in-house' | 'cloud' | 'cloud-and-in-house'

export function getVghtpeSource(resources: SourceResource[]): HospitalSource | undefined {
  const inHouse = resources.some(resource => resource.meta?.tag?.some(tag =>
    tag.system === 'urn:wildcatch:source' && tag.code === 'vghtpe-outpatient-supplement'))
  const cloud = resources.some(resource => resource.meta?.source === 'https://medcloud2.nhi.gov.tw/')
  const merged = resources.some(resource => resource.extension?.some(extension =>
    extension.url === 'urn:wildcatch:dedup-method'))
  if (inHouse) return merged || cloud ? 'cloud-and-in-house' : 'in-house'
  return cloud ? 'cloud' : undefined
}

export function vghtpeSourceDisplay(
  institution: string,
  source: HospitalSource | undefined,
  locale: string,
): string | undefined {
  const names = ['臺北榮總', '台北榮總', '臺北榮民總醫院', '台北榮民總醫院']
  if (!names.includes(institution.trim())) return undefined
  // Cloud-only records keep the source spelling. Records containing in-house
  // data use the compact label explicitly requested by the user.
  const name = source === 'in-house' || source === 'cloud-and-in-house' ? '臺北榮總' : institution
  if (source !== 'in-house' && source !== 'cloud-and-in-house') return name
  const merged = source === 'cloud-and-in-house'
  return locale === 'en'
    ? `${name} (${merged ? 'Cloud + in-house' : 'In-house'})`
    : `${name}(${merged ? '院內+雲端' : '院內'})`
}
