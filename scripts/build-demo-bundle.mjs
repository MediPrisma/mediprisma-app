// Build the bundled demo ("試用資料 / 示範病人") from a REAL NHI 健保存摺 export.
//
//   node scripts/build-demo-bundle.mjs [path-to-real-bundle.json]
//   node scripts/build-demo-bundle.mjs --latest-only [path-to-real-bundle.json]
//
// The real source NEVER enters git. This script reads it from outside the repo,
// (1) trims it to a representative subset, (2) recompresses embedded images,
// (3) strips ALL PII — patient name/ID, medical-record numbers, physician names,
// and institution names — and (4) refuses to write unless a leak gate proves
// none of the harvested PII tokens survive anywhere (including inside the
// base64-encoded discharge-summary HTML). Output: public/demo/demo-bundle.json,
// which is safe to commit and ship.
//
// Anonymisation contract (see also memory: feedback_* privacy rules):
//   - Patient name                → fixed fictitious name 陳大明
//   - national id / 病歷號碼      → masked fake national ID / fixed fake MRN
//   - physician names 謝○諭       → fake masked names from a fixed pool
//   - institutions 長庚嘉義 …      → 示範-prefixed realistic fakes (type preserved)
//   - all resource ids            → regenerated demo-* (drops any hash-of-PII)
//   - birthDate                   → day shifted to 15 (age band preserved)

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import demoLabDedupe from './demo-lab-dedupe.cjs'
import demoEchoFixture from './demo-echo-fixture.cjs'

const { pruneCrossLinkedLabDuplicates } = demoLabDedupe
const { addDemoEchoFixture } = demoEchoFixture

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(__dirname, '..')

const DEFAULT_SRC =
  '/Users/kuoyihsin/Downloads/nhi-P10109XXXX-20230613-20260613-v0.18.12-img.json'
const OUT = path.join(REPO, 'public/demo/demo-bundle.json')
const args = process.argv.slice(2)
const LATEST_ONLY = args.includes('--latest-only')
const SRC = args.find((arg) => arg !== '--latest-only') || DEFAULT_SRC
const baseBundle = LATEST_ONLY
  ? JSON.parse(execFileSync('git', ['show', 'HEAD:public/demo/demo-bundle.json'], {
      cwd: REPO,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    }))
  : null

// ---- target volumes (the "balanced ~225" plan) -----------------------------
const TARGET = {
  labObservations: 100, // curated lab/vitals Observations → trends render
  textRadReports: 6, // radiology reports with text/conclusion (no image)
  imageRadReports: 2, // real images (recompressed): chest X-ray + abdominal US
  medications: 30, // recent representative MedicationRequests
  dischargeSummaries: 2, // 出院病摘 DocumentReference (HTML scrubbed)
}

// ---- fixed fake replacements ----------------------------------------------
const FAKE = {
  patientFamily: '陳',
  patientGiven: '大明',
  patientFamilyLatin: 'Chen',
  patientGivenLatin: 'Da-Ming',
  nationalId: 'A123XXX789',
  mrn: 'M00000001',
  birthDay: '15',
}
// Physician fake pool — surname + given-last. ALWAYS rendered masked (姓○名),
// even when the source name was a full unmasked name in the discharge narrative,
// so (a) no real given char leaks and (b) the leak gate can treat any UNMASKED
// "中文中文醫師" as a residual real name to reject.
const FAKE_DOCTORS = [
  ['林', '華'], ['張', '安'], ['李', '誠'], ['王', '宏'],
  ['吳', '勳'], ['黃', '哲'], ['周', '翰'], ['鄭', '愷'], ['許', '昇'],
]

// "<name>醫師" guard: a 2–4 Han run before 醫師 that is a TITLE (主治醫師…) or a
// DEPARTMENT (放射科醫師, 胸腔內科醫師 — ends in 科) is NOT a person name. Used by
// both the narrative harvester and the residual leak gate.
const isTitleOrDept = (s) =>
  /科$/.test(s) ||
  /^(主治|主任|住院|總|實習|值班|經治|代理|門診|急診|專科|護理|個管|放射|麻醉|病理|核醫|家醫|身心|中醫|牙|請洽詢)/.test(s)

// Institution suffix matcher + generic words that are NOT a specific institution
// name (so we neither replace nor flag them).
const INSTITUTION_SUFFIX = '(?:醫院|診所|藥局|醫學中心|衛生所|門診部|聯合診所|護理之家)'
const GENERIC_INSTITUTION = new Set([
  '轉入醫院', '轉出醫院', '轉診醫院', '原醫院', '他院', '該院', '本院', '至醫院', '回醫院',
  '醫院', '診所', '藥局', '醫學中心', '衛生所',
])

// Identifying social/family asides — a parenthetical naming a relative's
// profession / affiliation (e.g. "(兒子是中榮放射科醫師，尚未討論好DNR)") is
// directional: it points at an identifiable third party. Strip the whole clause.
// Clinical parentheticals (no family term) are untouched.
const FAMILY_TERMS = '兒子|女兒|媳婦|女婿|太太|先生|配偶|老公|老婆|家屬|家人|孫子|孫女|父親|母親|兄弟|姊妹|姐妹|照顧者|看護'
const SOCIAL_ASIDE_RE = () => new RegExp(`[(（][^)）]*(?:${FAMILY_TERMS})[^)）]*[)）]`, 'g')
const redactSocialAsides = (text) => text.replace(SOCIAL_ASIDE_RE(), '')

// Known institution short-names → 示範-prefixed realistic fakes (type kept).
const INSTITUTION_MAP = {
  '長庚嘉義': '示範長青醫院',
  '林口長庚': '示範林楓醫學中心',
  '臺北榮總': '示範榮恩醫學中心',
  '中國附醫': '示範華佗醫學中心',
  '嘉基醫院': '示範嘉恩醫院',
  '戴德森嘉基': '示範嘉恩醫院',
  '中國北港醫': '示範北辰醫院',
  // long / narrative forms of the same hospitals → same fake, so the demo never
  // shows one real hospital under two different names.
  '財團法人嘉義長庚紀念醫院': '示範長青醫院',
  '長庚醫療財團法人嘉義長庚紀念醫院': '示範長青醫院',
  '北港媽祖醫院': '示範北辰醫院',
  '部嘉義醫院': '示範嘉惠醫院',
  '三順診所': '示範祥安診所',
  '王耳鼻喉科': '示範安心耳鼻喉科診所',
  '曾外科診所': '示範仁心外科診所',
  '北港眼科診': '示範明亮眼科診所',
  '龔顯琦診所': '示範康德診所',
  '王垂鎰牙醫': '示範微笑牙醫診所',
  '益安大藥局': '示範康健藥局',
  '南方藥局': '示範向陽藥局',
  '安麗兒藥局': '示範安寧藥局',
}

// ---------------------------------------------------------------------------
function die(msg) {
  console.error('\n❌ ' + msg)
  process.exit(1)
}
if (!fs.existsSync(SRC)) die(`source not found: ${SRC}\nPass the real bundle path as the first argument.`)
if (LATEST_ONLY && (baseBundle?.resourceType !== 'Bundle' || !Array.isArray(baseBundle.entry))) {
  die('--latest-only requires a valid public/demo/demo-bundle.json in HEAD')
}

const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'))
if (raw.resourceType !== 'Bundle' || !Array.isArray(raw.entry)) die('source is not a FHIR Bundle')

const entries = raw.entry.filter((e) => e && e.resource)
const byType = (t) => entries.filter((e) => e.resource.resourceType === t).map((e) => e.resource)

// Ultrasound reports — the only modality in this export that burns the patient
// banner into the image pixels (so its frames need the banner cropped).
const isUltrasoundDR = (dr) => {
  const txt = (dr.code?.text || '') + ' ' +
    (dr.code?.coding || []).map((c) => `${c.display || ''} ${c.code || ''}`).join(' ')
  return /超音波|超聲|ultrason|ultrasound|sonograph|echocardiograph|\becho\b/i.test(txt)
}

const getDate = (r) =>
  r.effectiveDateTime || r.authoredOn || r.date || r.period?.start || r.recordedDate || ''
const cmpRecent = (a, b) => String(getDate(b)).localeCompare(String(getDate(a)))
const isCat = (r, code) =>
  (r.category || []).some((c) => (c.coding || []).some((x) => x.code === code))
const isAdultPreventiveComposition = (r) =>
  r.resourceType === 'Composition' &&
  ((r.type?.coding || []).some((coding) => coding.system === 'http://loinc.org' && coding.code === '75484-6') ||
    /成人預防保健/.test(`${r.type?.text || ''} ${r.title || ''}`))

// ===========================================================================
// 1. SELECT a representative subset
// ===========================================================================
const patient = byType('Patient')[0]
if (!patient) die('no Patient in source')

const allDR = byType('DiagnosticReport')
const labDRs = allDR.filter((d) => isCat(d, 'LAB')).sort(cmpRecent)
const radDRs = allDR.filter((d) => isCat(d, 'RAD')).sort(cmpRecent)
const hasImage = (d) =>
  (d.presentedForm || []).some((a) => /^image\//.test(a.contentType || ''))

// image RAD: most-recent chest + most-recent abdominal ultrasound (visual variety)
const imageRad = radDRs.filter(hasImage)
const pickImage = (re) => imageRad.find((d) => re.test(d.code?.text || ''))
const keptImageRad = [...new Set([pickImage(/胸/), pickImage(/腹部超音波/) || pickImage(/超音波/)].filter(Boolean))]
  .slice(0, TARGET.imageRadReports)

// text RAD: most-recent with a conclusion, excluding the image ones
const keptImageIds = new Set(keptImageRad.map((d) => d.id))
const keptTextRad = radDRs
  .filter((d) => !keptImageIds.has(d.id) && (d.conclusion || (d.presentedForm || []).some((a) => /text|pdf/.test(a.contentType || ''))))
  .slice(0, TARGET.textRadReports)

// lab DRs: most-recent, accumulate their `result` Observations up to target
const obsById = new Map(byType('Observation').map((o) => [o.id, o]))
const keptObs = new Map()
const keptLabDRs = []
for (const dr of labDRs) {
  if (keptObs.size >= TARGET.labObservations) break
  const resultIds = (dr.result || []).map((r) => String(r.reference || '').split('/').pop())
  const obs = resultIds.map((id) => obsById.get(id)).filter(Boolean)
  if (!obs.length) continue
  keptLabDRs.push(dr)
  for (const o of obs) keptObs.set(o.id, o)
}
// a few recent vital-signs Observations (BP etc.) for the vitals card
byType('Observation')
  .filter((o) => isCat(o, 'vital-signs'))
  .sort(cmpRecent)
  .slice(0, 10)
  .forEach((o) => keptObs.set(o.id, o))

const keptDocs = byType('DocumentReference').sort(cmpRecent).slice(0, TARGET.dischargeSummaries)
// Keep the latest adult preventive-care report and every Observation referenced
// by its sections so the document renders as a complete, navigable report.
const keptPreventiveCompositions = byType('Composition')
  .filter(isAdultPreventiveComposition)
  .sort(cmpRecent)
  .slice(0, 1)
for (const composition of keptPreventiveCompositions) {
  for (const section of composition.section || []) {
    for (const entry of section.entry || []) {
      const observationId = String(entry.reference || '').split('/').pop()
      const observation = obsById.get(observationId)
      if (observation) keptObs.set(observation.id, observation)
    }
  }
}
const keptProc = byType('Procedure')
const keptImm = byType('Immunization')
const keptCare = byType('CarePlan')

// --- Inpatient admissions ---------------------------------------------------
// Keep EVERY 住院 (IMP) Encounter so the visit list (就診紀錄) shows the full
// hospitalization history AND each kept discharge summary's context.encounter
// link resolves to a real visit (without it the 出院病摘 can't be associated
// with its admission). Then enrich the admissions that carry a kept discharge
// summary with their meds + a capped slice of their labs, so the 住院 visit
// isn't an empty shell.
const allEnc = byType('Encounter')
const encById = new Map(allEnc.map((e) => [e.id, e]))
const inpatientEnc = allEnc.filter((e) => (e.class?.code || '').toUpperCase() === 'IMP')

// inpatient encounters referenced by the kept discharge summaries → their windows
const focusEncIds = new Set()
for (const d of keptDocs)
  for (const ce of d.context?.encounter || [])
    if (ce?.reference) focusEncIds.add(String(ce.reference).split('/').pop())
const focusWindows = [...focusEncIds]
  .map((id) => encById.get(id))
  .filter((e) => e?.period?.start)
  .map((e) => [e.period.start.slice(0, 10), (e.period.end || e.period.start).slice(0, 10)])
const inFocusWindow = (date) => {
  const d = (date || '').slice(0, 10)
  return !!d && focusWindows.some(([s, en]) => d >= s && d <= en)
}

// medications: recent representative set ∪ every med tied to an inpatient stay
const inpatientEncIds = new Set(inpatientEnc.map((e) => e.id))
const keptMedsMap = new Map()
byType('MedicationRequest').sort(cmpRecent).slice(0, TARGET.medications).forEach((m) => keptMedsMap.set(m.id, m))
byType('MedicationRequest').forEach((m) => {
  const encId = String(m.encounter?.reference || '').split('/').pop()
  if (encId && inpatientEncIds.has(encId)) keptMedsMap.set(m.id, m)
})
const keptMeds = [...keptMedsMap.values()]

// admission labs: a capped slice of DiagnosticReports inside a focus window plus
// their member Observations — enough to show inpatient labs without dragging in
// the whole multi-week panel set.
labDRs
  .filter((dr) => inFocusWindow(dr.effectiveDateTime))
  .sort(cmpRecent)
  .slice(0, 24)
  .forEach((dr) => {
    if (!keptLabDRs.includes(dr)) keptLabDRs.push(dr)
    ;(dr.result || [])
      .map((r) => String(r.reference || '').split('/').pop())
      .map((id) => obsById.get(id))
      .filter(Boolean)
      .forEach((o) => keptObs.set(o.id, o))
  })

// Encounters: every one referenced by a kept resource (top-level `encounter`
// AND `context.encounter`), plus all inpatient encounters.
const referencedEnc = new Set()
const collectEnc = (r) => {
  const top = r.encounter?.reference
  if (top) referencedEnc.add(String(top).split('/').pop())
  for (const ce of r.context?.encounter || []) if (ce?.reference) referencedEnc.add(String(ce.reference).split('/').pop())
}
;[...keptLabDRs, ...keptTextRad, ...keptImageRad, ...keptMeds, ...keptDocs, ...keptPreventiveCompositions, ...keptProc, ...keptObs.values()].forEach(collectEnc)
inpatientEnc.forEach((e) => referencedEnc.add(e.id))
const keptEnc = [...referencedEnc].map((id) => encById.get(id)).filter(Boolean)

const kept = [
  patient,
  ...keptPreventiveCompositions,
  ...keptDocs,
  ...keptImageRad,
  ...keptTextRad,
  ...keptLabDRs,
  ...keptObs.values(),
  ...keptMeds,
  ...keptEnc,
  ...keptProc,
  ...keptImm,
  ...keptCare,
]

// Some source exports cross-link analyte-level reports (for example an Hb
// report also points at HCT while the HCT report points back at Hb), producing
// visually duplicated cumulative values. Prune only the copy whose NHI+LOINC
// disagree with its parent report when one otherwise-identical copy matches
// both identifiers. This intentionally does NOT dedupe on date/value alone.
const demoLabDedup = pruneCrossLinkedLabDuplicates(kept)

// ===========================================================================
// 2. HARVEST PII tokens from structured fields + discharge HTML
// ===========================================================================
const htmlOf = (doc) => {
  const a = (doc.content || [])[0]?.attachment
  return a?.data ? Buffer.from(a.data, 'base64').toString('utf8') : ''
}
// label：</b>VALUE<   (the consistent NHI discharge-summary markup)
const harvestLabel = (html, label) => {
  const out = []
  const re = new RegExp(label + '\\s*[:：]\\s*<\\/b>\\s*([^<]*)', 'g')
  let m
  while ((m = re.exec(html))) {
    const v = m[1].trim()
    if (v) out.push(v)
  }
  return out
}

const patientNameTokens = new Set()
const nationalIdTokens = new Set()
const mrnTokens = new Set()
const physicianTokens = new Set()
const institutionTokens = new Set(Object.keys(INSTITUTION_MAP))
const birthTokens = new Set()
// NHI institution / personnel codes (醫療機構代碼, 醫事人員代碼, …). These are a
// re-identification vector — a 醫療機構代碼 publicly maps back to the real
// hospital, undoing the name anonymisation — so they must be replaced too.
const codeTokens = new Set()

// structured patient
if (patient.name?.[0]) {
  for (const v of [patient.name[0].text, patient.name[0].family, ...(patient.name[0].given || [])])
    if (v) patientNameTokens.add(v)
}
;(patient.identifier || []).forEach((i) => i.value && nationalIdTokens.add(i.value))
if (patient.birthDate) birthTokens.add(patient.birthDate)

// structured institution displays — sweep EVERY `display` string anywhere in the
// resource graph (serviceProvider, requester, performer[].display AND nested
// performer[].actor.display on Immunization/Procedure, location.display, …).
// Anything ending in an institution suffix is an institution name to anonymise;
// the explicit short-name list lives in INSTITUTION_MAP.
const endsInstitution = new RegExp(`${INSTITUTION_SUFFIX}$`)
const sweepDisplays = (node) => {
  if (Array.isArray(node)) return node.forEach(sweepDisplays)
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'display' && typeof v === 'string' && v.trim()) {
        const s = v.trim()
        if (Object.prototype.hasOwnProperty.call(INSTITUTION_MAP, s)) institutionTokens.add(s)
        else if (endsInstitution.test(s) && !GENERIC_INSTITUTION.has(s)) institutionTokens.add(s)
      } else sweepDisplays(v)
    }
  }
}
for (const r of entries.map((e) => e.resource)) sweepDisplays(r)

// discharge HTML (only the kept docs need scrubbing, but harvest globally to be safe)
for (const doc of byType('DocumentReference')) {
  const html = htmlOf(doc)
  if (!html) continue
  harvestLabel(html, '病患姓名').forEach((v) => patientNameTokens.add(v))
  harvestLabel(html, '身分證字號').forEach((v) => nationalIdTokens.add(v))
  harvestLabel(html, '病歷號碼').forEach((v) => mrnTokens.add(v))
  harvestLabel(html, '醫事人員').forEach((v) => physicianTokens.add(v))
  ;['醫療機構名稱', '轉入醫院', '轉出醫院', '文件保管單位'].forEach((l) =>
    harvestLabel(html, l).forEach((v) => institutionTokens.add(v)))
  harvestLabel(html, '出生日期').forEach((v) => birthTokens.add(v))
  // every "…代碼" field (機構 / 醫事人員 / 保管單位 / 轉入 / 轉出 …)
  let mc
  const reCode = /[一-龥]{2,10}代碼\s*[:：]\s*<\/b>\s*([0-9A-Za-z]{3,})/g
  while ((mc = reCode.exec(html))) codeTokens.add(mc[1])

  // FREE-TEXT NARRATIVE — the discharge body (回診安排 / 住院經過 …) carries
  // FULL, unmasked physician names and other institutions that never appear in
  // the structured label fields. Harvest them here so they get scrubbed too.
  const text = html.replace(/<[^>]+>/g, ' ')
  let mn
  const reDoctor = /([一-龥]{2,4})醫師/g
  while ((mn = reDoctor.exec(text))) {
    const name = mn[1]
    if (!isTitleOrDept(name) && !name.includes('○')) physicianTokens.add(name)
  }
  const reInst = new RegExp(`([一-龥]{2,12}${INSTITUTION_SUFFIX})`, 'g')
  while ((mn = reInst.exec(text))) {
    const inst = mn[1]
    if (!GENERIC_INSTITUTION.has(inst) && !inst.startsWith('示範')) institutionTokens.add(inst)
  }
}

// ===========================================================================
// 3. BUILD replacement map (longest-first to avoid partial overlaps)
// ===========================================================================
const repl = new Map() // exact source string -> fake

// Replace the entire source name with a fixed fictitious name. No source
// given-name character is reused; CDSS masks the fictitious name on transport.
const fakePatientName = () => FAKE.patientFamily + FAKE.patientGiven
for (const tok of patientNameTokens) {
  if (tok === patient.name?.[0]?.family) repl.set(tok, FAKE.patientFamily)
  else if ((patient.name?.[0]?.given || []).includes(tok)) repl.set(tok, fakePatientName().slice(1))
  else repl.set(tok, fakePatientName())
}
for (const tok of nationalIdTokens) repl.set(tok, FAKE.nationalId)
for (const tok of mrnTokens) repl.set(tok, FAKE.mrn)

// Physician fakes are ALWAYS masked (姓○名), regardless of whether the source
// name was masked (謝○諭) or a full narrative name (洪明賜) — so no given char
// leaks and the residual gate can flag any surviving unmasked "中文中文醫師".
let dIdx = 0
for (const tok of physicianTokens) {
  const [s, g] = FAKE_DOCTORS[dIdx++ % FAKE_DOCTORS.length]
  repl.set(tok, s + '○' + g)
}

const fakeInstitution = (() => {
  let i = 0
  const cache = new Map()
  const suffix = (s) =>
    /醫學中心/.test(s) ? '醫學中心' : /醫院/.test(s) ? '醫院'
    : /牙醫/.test(s) ? '牙醫診所' : /眼科/.test(s) ? '眼科診所'
    : /耳鼻喉/.test(s) ? '耳鼻喉科診所' : /藥局/.test(s) ? '藥局'
    : /診所/.test(s) ? '診所' : '醫療機構'
  const cores = ['長青', '康健', '仁愛', '祥和', '安心', '明德', '廣濟', '惠生', '欣榮', '同仁']
  return (s) => {
    if (INSTITUTION_MAP[s]) return INSTITUTION_MAP[s]
    if (cache.has(s)) return cache.get(s)
    const fake = '示範' + cores[i % cores.length] + suffix(s)
    i++
    cache.set(s, fake)
    return fake
  }
})()
for (const tok of institutionTokens) repl.set(tok, fakeInstitution(tok))

for (const tok of birthTokens) {
  // YYYY-MM-DD → same year/month, day = 15. Some NHI narrative fields mask
  // the month/day as XX even though Patient.birthDate is complete; normalize
  // those variants to the same fake DOB so the source token cannot survive.
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(tok)
  const patientBirth = /^(\d{4})-(\d{2})-\d{2}/.exec(patient.birthDate || '')
  const samePatientYear = /^(\d{4})-XX-XX$/i.exec(tok)
  const fakeBirth = m
    ? `${m[1]}-${m[2]}-${FAKE.birthDay}`
    : samePatientYear && patientBirth?.[1] === samePatientYear[1]
      ? `${patientBirth[1]}-${patientBirth[2]}-${FAKE.birthDay}`
      : null
  if (!fakeBirth) die(`unsupported birth-date token: ${tok}`)
  repl.set(tok, fakeBirth)
}
// institution / personnel codes → obviously-fake all-zero codes (same length),
// distinct per source code so they don't all collapse together.
let codeIdx = 0
for (const tok of codeTokens) {
  codeIdx++
  repl.set(tok, ('0'.repeat(tok.length) + codeIdx).slice(-tok.length))
}

// guard: a fake value must never CONTAIN its original token (would defeat the
// leak gate and re-leak PII). Catch it here, at map-build time.
for (const [from, to] of repl) {
  if (from && to.includes(from)) die(`replacement "${from}" → "${to}" still contains the original token`)
}

// ordered longest-first
const orderedRepl = [...repl.entries()].filter(([k]) => k).sort((a, b) => b[0].length - a[0].length)
const applyTokens = (s) => {
  let out = s
  for (const [from, to] of orderedRepl) out = out.split(from).join(to)
  return out
}

// ===========================================================================
// 4. REWRITE ids + references, scrub HTML, recompress images
// ===========================================================================
// id map old "Type/id" -> new "Type/demo-n"
const idMap = new Map()
const counter = {}
for (const r of kept) {
  const t = r.resourceType
  counter[t] = (counter[t] || 0) + 1
  idMap.set(`${t}/${r.id}`, `${t}/demo-${t.toLowerCase()}-${counter[t]}`)
}
const remapRef = (ref) => idMap.get(ref) || ref

// deep clone so we never mutate the source object graph
const out = JSON.parse(JSON.stringify(kept))

function walk(node) {
  if (Array.isArray(node)) return node.forEach(walk)
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'reference' && typeof v === 'string') node[k] = remapRef(v)
      else if (typeof v === 'string') node[k] = applyTokens(v)
      else walk(v)
    }
  }
}

let imagesDone = 0
const imageEntries = []
for (const r of out) {
  // assign new id
  const newRef = idMap.get(`${r.resourceType}/${r.id}`)
  r.id = newRef.split('/').pop()
  walk(r)
  // hard-set patient demographics (don't rely on token replace alone)
  if (r.resourceType === 'Patient') {
    r.name = [{ use: 'official', text: FAKE.patientFamily + FAKE.patientGiven, family: FAKE.patientFamilyLatin, given: [FAKE.patientGivenLatin] }]
    ;(r.identifier || []).forEach((i) => { if (i.value) i.value = FAKE.nationalId })
  }
  // discharge HTML: token-scrub the decoded body, re-encode
  if (r.resourceType === 'DocumentReference') {
    for (const c of r.content || []) {
      const a = c.attachment
      if (a?.data) {
        const html = Buffer.from(a.data, 'base64').toString('utf8')
        const scrubbed = redactSocialAsides(applyTokens(html))
        a.data = Buffer.from(scrubbed, 'utf8').toString('base64')
        if (a.size) a.size = Buffer.byteLength(scrubbed, 'utf8')
      }
    }
  }
  if (r.resourceType === 'DiagnosticReport') {
    // Ultrasound machines (GE here) BURN the patient banner — name / 病歷號 /
    // age / institution — into the top of every frame's pixels, which no
    // text/metadata scrub can reach. Flag US frames so they get the banner
    // cropped off below. (X-ray / CT thumbnails in this 健保存摺 export carry
    // only laterality + frame-number markers, no PII — verified frame-by-frame.)
    const ultrasound = isUltrasoundDR(r)
    for (const a of r.presentedForm || []) {
      if (/^image\//.test(a.contentType || '') && a.data) imageEntries.push({ a, ultrasound })
    }
  }
}

// prune references that don't resolve within the subset (orphan refs exist in
// the real data, e.g. encounter ids that were never exported). Keep refs that
// still carry a useful `display`.
const keptIds = new Set(out.map((r) => `${r.resourceType}/${r.id}`))
const isUnresolved = (v) =>
  v && typeof v === 'object' && typeof v.reference === 'string' &&
  /^[A-Za-z]+\/[^/]+$/.test(v.reference) && !keptIds.has(v.reference) && !v.display
function prune(node) {
  if (Array.isArray(node)) {
    for (let i = node.length - 1; i >= 0; i--) {
      if (isUnresolved(node[i])) node.splice(i, 1)
      else prune(node[i])
    }
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (isUnresolved(v)) delete node[k]
      else prune(v)
    }
  }
}
out.forEach(prune)

// recompress images (sharp): crop the burned-in US banner, then downscale to
// ≤1280px, JPEG q72. US_BANNER_CROP_FRAC of the top is removed for ultrasound
// frames — enough to clear the GE patient banner while leaving the full scan
// sector + machine params intact (verified visually).
const US_BANNER_CROP_FRAC = 0.13
let bannersCropped = 0
for (const { a, ultrasound } of imageEntries) {
  const before = a.data.length
  let buf = Buffer.from(a.data, 'base64')
  if (ultrasound) {
    const meta = await sharp(buf).metadata()
    const top = Math.round((meta.height || 0) * US_BANNER_CROP_FRAC)
    if (top > 0 && meta.height && meta.width) {
      buf = await sharp(buf).extract({ left: 0, top, width: meta.width, height: meta.height - top }).toBuffer()
      bannersCropped++
    }
  }
  const jpg = await sharp(buf).rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 72, mozjpeg: true }).toBuffer()
  a.data = jpg.toString('base64')
  a.contentType = 'image/jpeg'
  if (a.size) a.size = jpg.length
  imagesDone++
  console.log(`   image ${imagesDone}${ultrasound ? ' (US banner cropped)' : ''}: ${(before / 1024 / 1024).toFixed(2)}MB → ${(jpg.length / 1024 / 1024).toFixed(2)}MB`)
}
console.log(`   ${bannersCropped} ultrasound banner(s) cropped`)

// ===========================================================================
// 5. LEAK GATE — refuse to write if any original PII token survives
// ===========================================================================
// In incremental mode, preserve the complete committed demo history and its
// stable resource ids. Append newer encounters/medications plus the latest
// adult preventive-care Composition and its referenced Observations. Reuse
// matching Observations already present in the demo and remap every reference.
let finalResources = out
let finalEntries = out.map((r) => ({ fullUrl: `${r.resourceType}/${r.id}`, resource: r }))
if (LATEST_ONLY) {
  const recentTypes = new Set(['Encounter', 'MedicationRequest'])
  const baseResources = baseBundle.entry.map((e) => e?.resource).filter(Boolean)
  // Keep fixed demo demographics in sync when rebuilding from the committed
  // bundle instead of from the private source export.
  for (const resource of baseResources) {
    if (resource.resourceType !== 'Patient') continue
    resource.name = [{
      use: 'official',
      text: FAKE.patientFamily + FAKE.patientGiven,
      family: FAKE.patientFamilyLatin,
      given: [FAKE.patientGivenLatin],
    }]
    ;(resource.identifier || []).forEach((identifier) => {
      if (identifier.value) identifier.value = FAKE.nationalId
    })
  }
  const cutoffs = new Map()
  for (const type of recentTypes) {
    const dates = baseResources
      .filter((r) => r.resourceType === type)
      .map(getDate)
      .filter(Boolean)
      .sort()
    cutoffs.set(type, dates.at(-1) || '')
  }

  const recentAdditions = out.filter((r) =>
    recentTypes.has(r.resourceType) &&
    getDate(r) > cutoffs.get(r.resourceType),
  )
  const preventiveKey = (r) => `${getDate(r)}|${r.type?.coding?.[0]?.code || ''}|${r.title || ''}`
  const existingPreventiveKeys = new Set(
    baseResources.filter(isAdultPreventiveComposition).map(preventiveKey),
  )
  const preventiveCompositions = out.filter((r) =>
    isAdultPreventiveComposition(r) && !existingPreventiveKeys.has(preventiveKey(r)),
  )

  const outByRef = new Map(out.map((r) => [`${r.resourceType}/${r.id}`, r]))
  const preventiveObservationRefs = new Set()
  for (const composition of preventiveCompositions) {
    for (const section of composition.section || []) {
      for (const entry of section.entry || []) {
        if (entry.reference?.startsWith('Observation/')) preventiveObservationRefs.add(entry.reference)
      }
    }
  }
  const codeKey = (code) => {
    const coding = (code?.coding || []).find((item) => item.system === 'http://loinc.org') || code?.coding?.[0]
    return coding ? `${coding.system || ''}|${coding.code || ''}` : code?.text || ''
  }
  const quantityKey = (quantity) => quantity
    ? [quantity.value, quantity.unit || quantity.code || '']
    : null
  const observationFingerprint = (r) => JSON.stringify([
    String(getDate(r)).slice(0, 10),
    codeKey(r.code),
    quantityKey(r.valueQuantity),
    r.valueString ?? r.valueCodeableConcept ?? r.valueBoolean ?? null,
    (r.component || []).map((component) => [
      codeKey(component.code),
      quantityKey(component.valueQuantity),
      component.valueString ?? component.valueCodeableConcept ?? component.valueBoolean ?? null,
    ]),
  ])
  const baseObservationByFingerprint = new Map(
    baseResources
      .filter((r) => r.resourceType === 'Observation')
      .map((r) => [observationFingerprint(r), r]),
  )
  const incrementalIdMap = new Map()
  const preventiveObservations = []
  for (const ref of preventiveObservationRefs) {
    const observation = outByRef.get(ref)
    if (!observation) continue
    const existing = baseObservationByFingerprint.get(observationFingerprint(observation))
    if (existing) incrementalIdMap.set(ref, `Observation/${existing.id}`)
    else preventiveObservations.push(observation)
  }

  const additions = [...recentAdditions, ...preventiveObservations, ...preventiveCompositions]
  const additionTypes = new Set(additions.map((r) => r.resourceType))
  for (const type of additionTypes) {
    const prefix = `demo-${type.toLowerCase()}-`
    let next = baseResources
      .filter((r) => r.resourceType === type && r.id?.startsWith(prefix))
      .map((r) => Number(r.id.slice(prefix.length)))
      .filter(Number.isFinite)
      .reduce((max, n) => Math.max(max, n), 0)
    for (const r of additions.filter((candidate) => candidate.resourceType === type)) {
      next++
      incrementalIdMap.set(`${type}/${r.id}`, `${type}/${prefix}${next}`)
    }
  }
  const appended = JSON.parse(JSON.stringify(additions))
  const remapIncrementalRefs = (node) => {
    if (Array.isArray(node)) return node.forEach(remapIncrementalRefs)
    if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (key === 'reference' && typeof value === 'string' && incrementalIdMap.has(value)) {
          node[key] = incrementalIdMap.get(value)
        } else {
          remapIncrementalRefs(value)
        }
      }
    }
  }
  for (const r of appended) {
    const newRef = incrementalIdMap.get(`${r.resourceType}/${r.id}`)
    r.id = newRef.split('/').pop()
    remapIncrementalRefs(r)
  }
  finalResources = [...baseResources, ...appended]
  finalEntries = [
    ...baseBundle.entry,
    ...appended.map((r) => ({ fullUrl: `${r.resourceType}/${r.id}`, resource: r })),
  ]
  console.log(`   latest-only: appended ${appended.filter((r) => r.resourceType === 'Encounter').length} encounters, ${appended.filter((r) => r.resourceType === 'MedicationRequest').length} medications, ${appended.filter((r) => r.resourceType === 'Composition').length} preventive report, and ${appended.filter((r) => r.resourceType === 'Observation').length} report observations`)
}

// Add the deidentified shared echo/Doppler pair after either full or
// incremental selection. The helper retains the original dates in a dedicated
// demo encounter and refuses collisions, so rerunning this build is idempotent and
// cannot overwrite a source-derived resource.
const echoFixtureResult = addDemoEchoFixture(finalResources)
finalResources = echoFixtureResult.resources
if (echoFixtureResult.addedResources.length > 0) {
  finalEntries = [
    ...finalEntries,
    ...echoFixtureResult.addedResources.map((resource) => ({
      fullUrl: `${resource.resourceType}/${resource.id}`,
      resource,
    })),
  ]
}
console.log(`   curated echo fixture: ${echoFixtureResult.addedResources.length} added (anchor ${echoFixtureResult.anchorEncounterId})`)

const finalBundle = {
  resourceType: 'Bundle',
  type: 'collection',
  entry: finalEntries,
}
const serialized = JSON.stringify(finalBundle)
// also build a "fully-decoded" view (HTML un-base64'd) for the leak scan
let decodedView = serialized
for (const r of finalResources) {
  if (r.resourceType === 'DocumentReference') {
    for (const c of r.content || []) {
      if (c.attachment?.data && /html|text/.test(c.attachment.contentType || '')) {
        decodedView += '\n' + Buffer.from(c.attachment.data, 'base64').toString('utf8')
      }
    }
  }
}

const leakTokens = new Set([
  ...patientNameTokens, ...nationalIdTokens, ...mrnTokens, ...physicianTokens,
  ...codeTokens,
  ...[...institutionTokens].filter((t) => !t.startsWith('示範')),
])
const leaks = [...leakTokens].filter((t) => t && t.length >= 2 && decodedView.includes(t))
if (leaks.length) {
  die(`LEAK GATE FAILED — these original PII tokens survived:\n` + leaks.map((l) => '   • ' + l).join('\n'))
}
// patient surname must not appear anywhere (defensive)
const surname = patient.name?.[0]?.family
if (surname && decodedView.includes(surname)) {
  die(`LEAK GATE FAILED — patient surname "${surname}" still present in output`)
}
// the demo patient name/id MUST be present (proves replacement ran)
if (!decodedView.includes(FAKE.patientFamily + FAKE.patientGiven)) {
  die('sanity check failed — fake patient name not found in output')
}

// STRICT residual gate on the free-text narrative — backstop for names the
// token harvest didn't enumerate. Any UNMASKED "中文中文醫師" (not a title /
// department) or any non-示範 institution that isn't a generic word means a real
// identity slipped through; fail loudly so it gets added to the harvest.
{
  let rm
  const residualDocs = new Set()
  const reDocG = /([一-龥]{2,4})醫師/g
  while ((rm = reDocG.exec(decodedView))) {
    if (!isTitleOrDept(rm[1])) residualDocs.add(rm[1] + '醫師')
  }
  if (residualDocs.size) {
    die('LEAK GATE FAILED — unmasked physician name(s) survived in narrative:\n' +
      [...residualDocs].map((l) => '   • ' + l).join('\n'))
  }
  const residualInst = new Set()
  const reInstG = new RegExp(`([一-龥]{2,12}${INSTITUTION_SUFFIX})`, 'g')
  while ((rm = reInstG.exec(decodedView))) {
    const n = rm[1]
    if (!n.startsWith('示範') && !GENERIC_INSTITUTION.has(n)) residualInst.add(n)
  }
  if (residualInst.size) {
    die('LEAK GATE FAILED — non-anonymised institution(s) survived:\n' +
      [...residualInst].map((l) => '   • ' + l).join('\n'))
  }
  // identifying social/family asides must be stripped
  const aside = SOCIAL_ASIDE_RE().exec(decodedView)
  if (aside) {
    die('LEAK GATE FAILED — identifying social/family aside survived:\n   • ' + aside[0])
  }
}

// ===========================================================================
// 6. WRITE
// ===========================================================================
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(finalBundle))
const sizeMB = (fs.statSync(OUT).size / 1024 / 1024).toFixed(2)

const hist = {}
for (const r of finalResources) hist[r.resourceType] = (hist[r.resourceType] || 0) + 1
console.log('\n✅ demo bundle written:', path.relative(REPO, OUT), `(${sizeMB} MB, ${finalResources.length} resources)`)
console.log('   histogram:', JSON.stringify(hist))
console.log(`   lab cross-link dedupe: removed ${demoLabDedup.removedIds.length}`)
console.log('   leak gate: PASSED — no original PII tokens survive')
console.log(`   replaced: ${patientNameTokens.size} name · ${nationalIdTokens.size} id · ${mrnTokens.size} mrn · ${physicianTokens.size} physician · ${institutionTokens.size} institution tokens`)
