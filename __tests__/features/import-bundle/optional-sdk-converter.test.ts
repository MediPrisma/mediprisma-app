import { convertLocalImportBytes } from '@/features/import-bundle/services/sdk-import-converter'

// The public deployment still accepts standard FHIR, with no converter artifact.
jest.mock('@/vendor/nhi-fhir-bridge-sdk-json/browser.js', () => jest.requireActual('@/src/optional/sdk-json'))

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer

test('imports a FHIR Bundle when the SDK converter is absent', () => {
  const bundle = { resourceType: 'Bundle', type: 'collection', entry: [] }
  expect(convertLocalImportBytes(bytes(bundle))).toEqual({ bundle, originalFhirJson: JSON.stringify(bundle) })
})
test('SDK input fails explicitly without inventing a converted bundle', () => {
  expect(() => convertLocalImportBytes(bytes({ myhealthbank: { bdata: {} } })))
    .toThrow('請上傳 FHIR Bundle')
})
