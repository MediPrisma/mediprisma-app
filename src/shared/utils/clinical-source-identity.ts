/** Source attribution shared by import and clinical views. */
type SourceResource = { meta?: { source?: string; tag?: Array<{ system?: string; code?: string }> } }

export function isVghtpeSource(resource: SourceResource): boolean {
  const source = resource.meta?.source ?? ''
  return resource.meta?.tag?.some((tag) => tag.system === 'urn:wildcatch:source'
    && tag.code === 'vghtpe-outpatient-supplement') === true
    || source === 'ehr-fhir-bridge/scraper'
    || /^https:\/\/web9\.vghtpe\.gov\.tw\/emr\/qemr\//.test(source)
}

export function isMedcloudSource(resource: SourceResource): boolean {
  return /^https:\/\/medcloud2\.nhi\.gov\.tw\//.test(resource.meta?.source ?? '')
}
