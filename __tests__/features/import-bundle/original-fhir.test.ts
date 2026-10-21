import { convertLocalImportBytes } from '@/features/import-bundle/services/sdk-import-converter'
import { LocalBundleService, prepareImagesForStorage } from '@/src/infrastructure/fhir/services/local-bundle.service'

const source = '{\n  "resourceType": "Bundle", "type": "collection", "entry": [\n'
  + '{"fullUrl":"urn:uuid:patient","resource":{"resourceType":"Patient","id":"patient"}},\n'
  + '{"resource":{"resourceType":"Binary","id":"unknown-to-ips","data":"YWJj"}},\n'
  + '{"resource":{"resourceType":"DiagnosticReport","id":"image","presentedForm":'
  + '[{"contentType":"image/png","data":"YWJj"}]}}],'
  + '"extension":[{"url":"https://example.test/raw","valueDecimal":1.2300}]}\n'

// Parse/storage behaviour runs for real; no alternate export implementation.
describe('original FHIR snapshot', () => {
  afterEach(async () => { await LocalBundleService.clear() })

  it('preserves the input text independently of parsing and image extraction', () => {
    const prepared = convertLocalImportBytes(new TextEncoder().encode(source).buffer)
    LocalBundleService.parse(prepared.bundle)
    prepareImagesForStorage(prepared.bundle, 'one')
    expect(prepared.originalFhirJson).toBe(source)
    expect(JSON.stringify(prepared.bundle)).not.toContain('"data":"YWJj"}]')
  })

  it('preserves the UTF-8 BOM when the source has one', () => {
    const original = '\uFEFF' + source
    expect(convertLocalImportBytes(new TextEncoder().encode(original).buffer).originalFhirJson).toBe(original)
  })

  it('retains the snapshot through same-import saves and clears it on replacement', async () => {
    const prepared = convertLocalImportBytes(new TextEncoder().encode(source).buffer)
    await LocalBundleService.save(prepared.bundle, { importId: 'one', originalFhirJson: prepared.originalFhirJson })
    await LocalBundleService.save(prepared.bundle, { importId: 'one' })
    expect(await LocalBundleService.loadOriginalFhirJson()).toBe(source)
    await LocalBundleService.save({ resourceType: 'Bundle' }, { importId: 'two' })
    expect(await LocalBundleService.loadOriginalFhirJson()).toBeNull()
  })

  it('removes the original on clear and never fabricates it for old imports', async () => {
    await LocalBundleService.save(JSON.parse(source), { importId: 'one', originalFhirJson: source })
    await LocalBundleService.clear()
    expect(await LocalBundleService.loadOriginalFhirJson()).toBeNull()
    await LocalBundleService.save(JSON.parse(source), { importId: 'old' })
    expect(await LocalBundleService.loadOriginalFhirJson()).toBeNull()
  })
})
