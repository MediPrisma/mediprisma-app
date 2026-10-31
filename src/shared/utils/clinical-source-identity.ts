/** Source attribution shared by import and clinical views. */
type SourceResource = { meta?: { source?: string; tag?: Array<{ system?: string; code?: string }> } }

export function isVghtpeSource(resource: SourceResource): boolean {
  const source = resource.meta?.source ?? ''
  return resource.meta?.tag?.some((tag) => tag.system === 'urn:wildcatch:source'
    && tag.code === 'vghtpe-outpatient-supplement') === true
    // Legacy identifier of the North VGH exporter used by this app. Its
    // extension manifest restricts capture to *.vghtpe.gov.tw; retain the
    // adapter contract for old downloads that predate the explicit qemr tag.
    || source === 'ehr-fhir-bridge/scraper'
    || /^https:\/\/web9\.vghtpe\.gov\.tw\/emr\/qemr\//.test(source)
}

export function isMedcloudSource(resource: SourceResource): boolean {
  return /^https:\/\/medcloud2\.nhi\.gov\.tw\//.test(resource.meta?.source ?? '')
}
