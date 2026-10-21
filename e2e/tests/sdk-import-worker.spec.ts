import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { test, expect } from '../fixtures/test'
import { importBundle, openFeaturePanel } from '../fixtures/import'
import { expectImportWorker } from '../fixtures/import-worker'
import { convertSdkJsonToFhir } from '../../vendor/nhi-fhir-bridge-sdk-json/browser.js'

test('SDK JSON converts in the production Worker and its downloaded FHIR can be reimported', async ({ page, requireImportWorker }, info) => {
  test.skip(!requireImportWorker, 'Requires the production Worker profile')
  test.setTimeout(120_000)
  const source = info.outputPath('sdk-source.json')
  const input = { myhealthbank: { bdata: {
    'b1.1': 'A123456789', 'b1.2': '1151021',
    r7: ['98', '101'].map(value => ({ 'r7.4': '合成測試醫院', 'r7.6': '20261020',
      'r7.8': '09005C', 'r7.10': 'Glucose', 'r7.11': value })),
  } } }
  await fs.writeFile(source, JSON.stringify(input))
  await importBundle(page, { bundlePath: source })
  const sdkWorker = await expectImportWorker(page, info, 'sdk-conversion')
  await openFeaturePanel(page)
  await page.getByRole('tab', { name: '複製', exact: true }).click()
  await page.getByRole('tab', { name: '下載檔案', exact: true }).click()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '下載原始 FHIR', exact: true }).click()
  const path = info.outputPath('sdk-converted-fhir.json')
  await (await pending).saveAs(path)
  const bytes = await fs.readFile(path)
  const converted = JSON.parse(bytes.toString('utf8'))
  expect(sdkWorker.originalBytes).toBe(bytes.length)
  const reference = convertSdkJsonToFhir(input, {
    identifierMode: 'masked', timestamp: converted.timestamp,
  })
  expect(reference).toBeDefined()
  expect(converted).toEqual(reference?.bundle)
  expect(converted.resourceType).toBe('Bundle')
  const resources = converted.entry.map((entry: { resource: Record<string, unknown> }) => entry.resource)
  expect(resources.find((resource: { resourceType: string }) => resource.resourceType === 'Patient').identifier[0].value).toBe('A12345XXXX')
  expect(resources.filter((resource: { resourceType: string }) => resource.resourceType === 'Observation')
    .map((resource: { valueQuantity: { value: number } }) => resource.valueQuantity.value)
    .sort((a: number, b: number) => a - b)).toEqual([98, 101])
  await importBundle(page, { bundlePath: path })
  await expectImportWorker(page, info, 'converted-fhir-reimport', bytes.length)
  await openFeaturePanel(page)
  await page.getByRole('tab', { name: '複製', exact: true }).click()
  await page.getByRole('tab', { name: '下載檔案', exact: true }).click()
  const reimportDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '下載原始 FHIR', exact: true }).click()
  const reimportPath = info.outputPath('sdk-reimported-fhir.json')
  await (await reimportDownload).saveAs(reimportPath)
  const reimportedBytes = await fs.readFile(reimportPath)
  expect(reimportedBytes.equals(bytes)).toBe(true)
  await info.attach('sdk-roundtrip-evidence', { contentType: 'application/json', body: JSON.stringify({
    bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    reimportedBytes: reimportedBytes.length, reimportedSha256: createHash('sha256').update(reimportedBytes).digest('hex'),
    observations: [98, 101], fullReferenceBundleMatches: true,
  }, null, 2) })
})
