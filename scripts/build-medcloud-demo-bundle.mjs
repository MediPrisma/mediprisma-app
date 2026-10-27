// Build the 雲端病歷 demo ("試用資料（雲端病歷）") from a REAL MediCloud export
// produced by the 雲端懷爾抓抓 adapter. It is the same patient as the 健康存摺
// demo, so it carries the same fake demographics and the same fake institution
// names (scripts/demo-institutions.cjs).
//
//   node scripts/build-medcloud-demo-bundle.mjs [path-to-real-medcloud-bundle.json]
//
// The real source NEVER enters git. Unlike the 健康存摺 builder this keeps the
// whole export — it is small and has no images — and only de-identifies it:
//   - Patient name / masked national id / birth day → the 健康存摺 demo's fakes
//   - institution names                              → 示範-prefixed fakes
//   - NHI provider codes (醫事機構代碼)               → all-zero fakes, one per code
//   - imaging case serials (ipl-case-seq-no)         → fake serials, one per value
//   - every 32/64-hex opaque id (resource ids, source-row and group hashes,
//     the patient-context hash)                      → deterministic fresh hex,
//     consistent within the bundle so every link still resolves
//   - the NHI image-viewer request extension         → removed: it asks NHI for
//     the real patient's images, which a demo can never open
// It refuses to write unless a leak gate proves no harvested token survives.
// Output: public/demo/demo-medcloud-bundle.json, safe to commit and ship.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import demoInstitutions from './demo-institutions.cjs'

const { INSTITUTION_MAP } = demoInstitutions

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(__dirname, '..')

const DEFAULT_SRC = '/Users/kuoyihsin/Downloads/medcloud-P101XXXXXX-20261026-v0.15.14.json'
const OUT = path.join(REPO, 'public/demo/demo-medcloud-bundle.json')
const SRC = process.argv[2] || DEFAULT_SRC

// Must match src/shared/constants/demo-data.constants.ts and the 健康存摺 demo
// Patient in public/demo/demo-bundle.json.
const FAKE = {
  patientId: 'demo-medcloud-patient-1',
  patientName: '陳大明',
  patientIdentifier: 'A123***789',
  birthDate: '1932-01-15',
}

const NHI_VIEWER_REQUEST_URL =
  'https://cloud-wildcatch.invalid/fhir/StructureDefinition/medcloud-nhi-viewer-request'
const PROVIDER_SYSTEM = 'https://cloud-wildcatch.invalid/fhir/sid/medcloud-provider'
const INSTITUTION_SUFFIX = '(?:醫院|診所|藥局|醫學中心|衛生所|門診部|聯合診所|護理之家|牙醫|耳鼻喉科)'

function die(msg) {
  console.error('\n❌ ' + msg)
  process.exit(1)
}
if (!fs.existsSync(SRC)) die(`source not found: ${SRC}\nPass the real bundle path as the first argument.`)

const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'))
if (raw.resourceType !== 'Bundle' || !Array.isArray(raw.entry)) die('source is not a FHIR Bundle')
const resources = raw.entry.map((e) => e?.resource).filter(Boolean)
const patients = resources.filter((r) => r.resourceType === 'Patient')
if (patients.length !== 1) die(`expected exactly one Patient, found ${patients.length}`)
const patient = patients[0]

// ===========================================================================
// 1. HARVEST identifying tokens
// ===========================================================================
const nameTokens = new Set()
for (const name of patient.name || []) {
  for (const v of [name.text, name.family, ...(name.given || [])]) if (v) nameTokens.add(v)
}
const identifierTokens = new Set((patient.identifier || []).map((i) => i.value).filter(Boolean))
const birthTokens = new Set([patient.birthDate].filter(Boolean))

const institutionTokens = new Set()
const providerCodes = new Set()
const caseSerials = new Set()
const walkAll = (node, visit) => {
  if (Array.isArray(node)) return node.forEach((v) => walkAll(v, visit))
  if (node && typeof node === 'object') {
    visit(node)
    for (const v of Object.values(node)) walkAll(v, visit)
  }
}
for (const r of resources) {
  if (r.resourceType === 'Organization') {
    // "戴德森嘉基" or the composite "戴德森嘉基 / 門診 / 1122010012"
    if (r.name) institutionTokens.add(r.name.split(/\s*[;/]\s*/)[0].trim())
    for (const id of r.identifier || []) if (id.value) providerCodes.add(id.value)
    for (const a of r.alias || []) if (a) providerCodes.add(a)
  }
  walkAll(r, (node) => {
    if (node.system === PROVIDER_SYSTEM && node.value) providerCodes.add(node.value)
    if (node.url === 'ipl-case-seq-no' && node.valueString) caseSerials.add(node.valueString)
    // "長庚嘉義;門診;1140010510" — name;setting;code. Only on references to an
    // Organization: lab and order codings also use ";" ("尿酸 ;(Uric acid)").
    const toOrganization = typeof node.reference === 'string' && node.reference.startsWith('Organization/')
    if (toOrganization && typeof node.display === 'string' && /[;/]/.test(node.display)) {
      const [inst, , code] = node.display.split(/\s*[;/]\s*/)
      if (inst && /[一-龥]/.test(inst)) institutionTokens.add(inst.trim())
      if (code && /^\d{6,}$/.test(code)) providerCodes.add(code)
    }
  })
}
// Free-text institution names (Composition narrative: 檢查醫事機構：…).
const rawText = JSON.stringify(raw)
for (const m of rawText.matchAll(new RegExp(`([一-龥]{2,12}${INSTITUTION_SUFFIX})`, 'g'))) {
  if (!m[1].startsWith('示範')) institutionTokens.add(m[1])
}

// ===========================================================================
// 2. BUILD the replacement map
// ===========================================================================
const repl = new Map()
for (const tok of nameTokens) repl.set(tok, FAKE.patientName)
for (const tok of identifierTokens) repl.set(tok, FAKE.patientIdentifier)
for (const tok of birthTokens) repl.set(tok, FAKE.birthDate)

const fakeInstitution = (() => {
  let i = 0
  const cores = ['長青', '康健', '仁愛', '祥和', '安心', '明德', '廣濟', '惠生', '欣榮', '同仁']
  const suffix = (s) =>
    /醫學中心/.test(s) ? '醫學中心' : /醫院/.test(s) ? '醫院'
    : /牙醫/.test(s) ? '牙醫診所' : /眼科/.test(s) ? '眼科診所'
    : /耳鼻喉/.test(s) ? '耳鼻喉科診所' : /藥局/.test(s) ? '藥局'
    : /診所/.test(s) ? '診所' : '醫療機構'
  return (s) => INSTITUTION_MAP[s] || `示範${cores[i++ % cores.length]}${suffix(s)}`
})()
for (const tok of institutionTokens) repl.set(tok, fakeInstitution(tok))
// Any known real name that is a substring of a harvested token (北港眼科診 in
// 北港眼科診所) is covered by longest-first replacement below; add every map
// key so a short form inside free text is replaced too.
for (const [from, to] of Object.entries(INSTITUTION_MAP)) if (!repl.has(from)) repl.set(from, to)

let codeIdx = 0
for (const tok of providerCodes) {
  codeIdx++
  repl.set(tok, ('0'.repeat(tok.length) + codeIdx).slice(-tok.length))
}
let serialIdx = 0
for (const tok of caseSerials) {
  serialIdx++
  repl.set(tok, `${tok.slice(0, 6)}${String(serialIdx).padStart(tok.length - 6, '0')}`)
}

for (const [from, to] of repl) {
  if (from && to.includes(from)) die(`replacement "${from}" → "${to}" still contains the original token`)
}
const orderedRepl = [...repl.entries()].filter(([k]) => k).sort((a, b) => b[0].length - a[0].length)
const applyTokens = (s) => {
  let out = s
  for (const [from, to] of orderedRepl) out = out.split(from).join(to)
  return out
}

// Opaque hex ids. The adapter derives them from source rows and the patient,
// so they are re-identification handles. Map each distinct value, in order of
// first appearance, to a fresh value of the same length; the same input always
// gets the same output, so references and cross-resource groupings survive.
const sourcePatientRef = `Patient/${patient.id}`
const hexMap = new Map()
const freshHex = (len) =>
  crypto.createHash('sha256').update(`mediprisma-demo-medcloud:${hexMap.size}`).digest('hex')
    .repeat(2).slice(0, len)
const remapHex = (s) =>
  s.replace(/(?<![0-9a-f])(?:[0-9a-f]{64}|[0-9a-f]{32})(?![0-9a-f])/g, (hex) => {
    if (!hexMap.has(hex)) hexMap.set(hex, freshHex(hex.length))
    return hexMap.get(hex)
  })

// ===========================================================================
// 3. REWRITE
// ===========================================================================
const out = JSON.parse(JSON.stringify(raw))
const stripViewerRequests = (node) => {
  if (Array.isArray(node)) return node.forEach(stripViewerRequests)
  if (node && typeof node === 'object') {
    if (Array.isArray(node.extension)) {
      node.extension = node.extension.filter((ext) => ext?.url !== NHI_VIEWER_REQUEST_URL)
      if (node.extension.length === 0) delete node.extension
    }
    for (const v of Object.values(node)) stripViewerRequests(v)
  }
}
stripViewerRequests(out)

const rewriteStrings = (node) => {
  if (Array.isArray(node)) {
    node.forEach((v, i) => { if (typeof v === 'string') node[i] = rewrite(v); else rewriteStrings(v) })
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string') node[k] = rewrite(v)
      else rewriteStrings(v)
    }
  }
}
const rewrite = (s) => {
  // the source patient id is "mc-<hex>"; give the demo a stable readable id
  let v = s.split(sourcePatientRef).join(`Patient/${FAKE.patientId}`)
  if (v === patient.id) v = FAKE.patientId
  return remapHex(applyTokens(v))
}
rewriteStrings(out)

for (const entry of out.entry) {
  const r = entry.resource
  if (r?.resourceType !== 'Patient') continue
  r.id = FAKE.patientId
  // family/given match the 健康存摺 demo so the English UI shows the same name
  r.name = [{ use: 'official', text: FAKE.patientName, family: 'Chen', given: ['Da-Ming'] }]
  r.birthDate = FAKE.birthDate
  for (const id of r.identifier || []) if (id.value) id.value = FAKE.patientIdentifier
}

// ===========================================================================
// 4. LEAK GATE
// ===========================================================================
const serialized = JSON.stringify(out)
const leakTokens = [
  ...nameTokens, ...identifierTokens, ...birthTokens, ...providerCodes, ...caseSerials,
  ...institutionTokens, ...Object.keys(INSTITUTION_MAP),
  patient.id, ...hexMap.keys(),
]
const leaks = [...new Set(leakTokens)].filter((t) => t && t.length >= 2 && serialized.includes(t))
if (leaks.length) die('LEAK GATE FAILED — original tokens survived:\n' + leaks.map((l) => '   • ' + l).join('\n'))

// Individual characters of the real given name must not survive either; the
// surname alone is too common a character to test.
for (const name of patient.name || []) {
  const text = name.text || ''
  if (text.length >= 3 && serialized.includes(text.slice(1))) die(`LEAK GATE FAILED — given name "${text.slice(1)}" survived`)
}
const residualInst = new Set()
for (const m of serialized.matchAll(new RegExp(`([一-龥]{2,12}${INSTITUTION_SUFFIX})`, 'g'))) {
  if (!m[1].startsWith('示範') && !/^(?:[一-龥]*示範)/.test(m[1])) residualInst.add(m[1])
}
// "示範X藥局" matches as "範X藥局"/"X藥局" suffixes; keep only names that are
// not the tail of a 示範 fake.
const fakeNames = new Set([...repl.values()].filter((v) => v.startsWith('示範')))
const isTailOfFake = (n) => [...fakeNames].some((f) => f.endsWith(n))
const realResidual = [...residualInst].filter((n) => !isTailOfFake(n))
if (realResidual.length) die('LEAK GATE FAILED — non-anonymised institution(s) survived:\n' + realResidual.map((l) => '   • ' + l).join('\n'))
if (serialized.includes(NHI_VIEWER_REQUEST_URL)) die('LEAK GATE FAILED — NHI viewer request survived')
if (!serialized.includes(FAKE.patientName)) die('sanity check failed — fake patient name not found in output')

// ===========================================================================
// 5. WRITE
// ===========================================================================
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, serialized)
const hist = {}
for (const e of out.entry) hist[e.resource.resourceType] = (hist[e.resource.resourceType] || 0) + 1
console.log('✅ medcloud demo bundle written:', path.relative(REPO, OUT),
  `(${(fs.statSync(OUT).size / 1024 / 1024).toFixed(2)} MB, ${out.entry.length} resources)`)
console.log('   histogram:', JSON.stringify(hist))
console.log(`   replaced: ${nameTokens.size} name · ${institutionTokens.size} institution · ${providerCodes.size} provider code · ${caseSerials.size} case serial · ${hexMap.size} opaque id tokens`)
console.log('   leak gate: PASSED')
