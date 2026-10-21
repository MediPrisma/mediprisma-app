/** @jest-environment node */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

type Sdk = Pick<typeof import('@/vendor/nhi-fhir-bridge-sdk-json/browser.js'), 'parseJsonBytes' | 'convertSdkJsonToFhir'>

function loadSdk(windowPresent: boolean, clientDefines: boolean): Sdk {
  let source = fs.readFileSync(path.join(process.cwd(), 'vendor/nhi-fhir-bridge-sdk-json/browser.js'), 'utf8')
  // Reproduce Next's client build optimization, including when emitted for a Worker.
  if (clientDefines) source = source.replaceAll('typeof window', '"object"')
  // Execute the actual standalone ESM artifact in an isolated global scope.
  source = source.replace(/export\{([^}]+)\};/, (_, names: string) =>
    `globalThis.__sdk={${names.split(',').map(name => {
      const [local, exported = local] = name.trim().split(/\s+as\s+/)
      return `${exported}:${local}`
    }).join(',')}};`)
  const globals: Record<string, unknown> = { TextDecoder, ArrayBuffer, Uint8Array, URL }
  globals.self = globals
  if (windowPresent) globals.window = globals
  return vm.runInNewContext(source + ';globalThis.__sdk', globals) as Sdk
}

test('the SDK avoids a bare window probe and loads in a Worker-like global with matching results and IDs', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'vendor/nhi-fhir-bridge-sdk-json/browser.js'), 'utf8')
  expect(source).not.toMatch(/\btypeof\s+window\b/)
  const browser = loadSdk(true, false)
  const worker = loadSdk(false, true)
  const input = { myhealthbank: { bdata: {
    'b1.1': 'A123456789', 'b1.2': '1151021',
    r7: ['98', '101'].map(value => ({ 'r7.4': '合成測試醫院', 'r7.6': '20261020',
      'r7.8': '09005C', 'r7.10': 'Glucose', 'r7.11': value })),
  } } }
  const options = { identifierMode: 'masked' as const, timestamp: '2026-10-21T00:00:00Z' }
  expect(worker.convertSdkJsonToFhir(input, options)).toEqual(browser.convertSdkJsonToFhir(input, options))
  // Golden IDs computed with the unpatched v0.1.5 artifact at af0bfe42.
  expect((worker.convertSdkJsonToFhir(input, options).bundle.entry as { resource: { id: string } }[])
    .map(({ resource }) => resource.id)).toEqual([
    '3a40bd33f424934b1040cd7281bb8eeb',
    'f5bd91e1c3d861d017eea09963a6eb19',
    '967621a68e63c5dfdddaa4a6823064be',
    'b79633ec9278c5f0594714ca2ecc307f',
    'sdk-unit-policy-v2', 'sdk-unit-inference',
  ])
  const original = '\uFEFF{"resourceType":"Bundle","extension":[{"url":"urn:example:raw","valueString":"原始內容"}]}'
  expect(worker.parseJsonBytes(new TextEncoder().encode(original).buffer))
    .toEqual(JSON.parse(original.slice(1)))
})
