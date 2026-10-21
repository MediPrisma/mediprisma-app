import { convertLocalImportBytes } from '@/features/import-bundle/services/sdk-import-converter'
import { LocalBundleService, prepareImagesForStorage } from '@/src/infrastructure/fhir/services/local-bundle.service'

const source = '{\n  "resourceType": "Bundle", "type": "collection", "entry": [\n'
  + '{"fullUrl":"urn:uuid:patient","resource":{"resourceType":"Patient","id":"patient"}},\n'
  + '{"resource":{"resourceType":"Binary","id":"unknown-to-ips","data":"YWJj"}},\n'
  + '{"resource":{"resourceType":"DiagnosticReport","id":"image","presentedForm":'
  + '[{"contentType":"image/png","data":"YWJj"}]}}],'
  + '"extension":[{"url":"https://example.test/raw","valueDecimal":1.2300}]}\n'

async function textOf(blob: Blob | null): Promise<string | null> {
  if (!blob) return null
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
}

// Parse/storage behaviour runs for real; no alternate export implementation.
describe('original FHIR snapshot', () => {
  afterEach(async () => { await LocalBundleService.clear() })

  it('preserves the input text independently of parsing and image extraction', async () => {
    const prepared = convertLocalImportBytes(new TextEncoder().encode(source).buffer)
    LocalBundleService.parse(prepared.bundle)
    prepareImagesForStorage(prepared.bundle, 'one')
    expect(await textOf(prepared.originalFhir)).toBe(source)
    expect(JSON.stringify(prepared.bundle)).not.toContain('"data":"YWJj"}]')
  })

  it('preserves the UTF-8 BOM when the source has one', async () => {
    const original = '\uFEFF' + source
    expect(await textOf(convertLocalImportBytes(new TextEncoder().encode(original).buffer).originalFhir)).toBe(original)
  })

  it('retains the snapshot through same-import saves and clears it on replacement', async () => {
    const prepared = convertLocalImportBytes(new TextEncoder().encode(source).buffer)
    await LocalBundleService.save(prepared.bundle, { importId: 'one', originalFhir: prepared.originalFhir })
    await LocalBundleService.save(prepared.bundle, { importId: 'one' })
    expect(await textOf(await LocalBundleService.loadOriginalFhir())).toBe(source)
    await LocalBundleService.save({ resourceType: 'Bundle' }, { importId: 'two' })
    expect(await LocalBundleService.loadOriginalFhir()).toBeNull()
  })

  it('removes the original on clear and never fabricates it for old imports', async () => {
    await LocalBundleService.save(JSON.parse(source), { importId: 'one', originalFhir: new Blob([source], { type: 'application/fhir+json' }) })
    await LocalBundleService.clear()
    expect(await LocalBundleService.loadOriginalFhir()).toBeNull()
    await LocalBundleService.save(JSON.parse(source), { importId: 'old' })
    expect(await LocalBundleService.loadOriginalFhir()).toBeNull()
  })
})
