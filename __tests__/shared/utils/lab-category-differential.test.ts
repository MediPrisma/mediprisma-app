/**
 * @jest-environment node
 *
 * Differential guard for lab categorisation against the base branch.
 *
 * The base commit's lab-categories + lab-pivot (and every repo module they
 * import) are extracted from git into the git-ignored tmp/ folder, with their
 * `@/` imports rewritten to that copy. A corpus built from every (NHI code ×
 * name) pair the category tables know — each category alias × section
 * representative codes, every NHI order-name table entry, and the
 * look-alike analytes — × name shapes × unit families × inspect modes is
 * categorised by both, under both NHI coding systems. Every category or
 * pivot-column change must be explained by the explicit allow-list below,
 * else the test fails and names the rows.
 *
 * Skips (with a warning) when the base commit is not available — e.g. a
 * shallow CI clone. Override the base with LAB_DIFF_BASE=<commit>.
 */
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { dirname, join, posix } from 'path'
import { LAB_CATEGORIES, categorizeObservation } from '@/src/shared/utils/lab-categories'
import { getLabPivotTestIdentity } from '@/src/shared/utils/lab-pivot.utils'
import { NHI_ORDER_CODE_TO_EN, NHI_ORDER_CODE_TO_ZH } from '@/src/shared/utils/nhi-order-names'
import { dualSpecimenAnalyte } from '@/src/shared/utils/specimen-evidence'
import { IMMUNOLOGY_NHI_ORDER_CODES } from '@/src/shared/utils/immunology-analytes'
import { PARAPROTEIN_NHI_ORDER_CODES } from '@/src/shared/utils/paraprotein-analytes'
import { LOOK_ALIKES } from '../../helpers/lab-lookalikes'

const ROOT = process.cwd()
const MEDCLOUD = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medical-service-payment-tw'
const HEALTHBANK = 'https://twcore.mohw.gov.tw/CodeSystem/nhi-medical-order-code'
const LOCAL = 'https://example.invalid/fhir/CodeSystem/his-local-lab'
const INSPECT = 'https://cloud-wildcatch.invalid/fhir/StructureDefinition/medcloud-source-inspect-mode'

// ── base copy ─────────────────────────────────────────────────────────────

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

function resolveBase(): string | null {
  try {
    const base = process.env.LAB_DIFF_BASE || git(['merge-base', 'HEAD', 'origin/master'])
    git(['cat-file', '-e', `${base}:src/shared/utils/lab-categories.ts`])
    return base
  } catch {
    return null
  }
}

/** Copy `entry` and every repo module it imports, at `base`, into `dir`. */
function extractClosure(base: string, dir: string, entries: string[]): void {
  const exists = (path: string) => {
    try { git(['cat-file', '-e', `${base}:${path}`]); return true } catch { return false }
  }
  const resolveSpec = (from: string, spec: string): string | null => {
    let target: string
    if (spec.startsWith('@/')) target = spec.slice(2)
    else if (spec.startsWith('.')) target = posix.normalize(posix.join(posix.dirname(from), spec))
    else return null
    for (const candidate of [target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`]) {
      if (/\.(ts|tsx)$/.test(candidate) && exists(candidate)) return candidate
    }
    return null
  }
  const queue = [...entries]
  const done = new Set<string>()
  while (queue.length > 0) {
    const file = queue.shift()!
    if (done.has(file)) continue
    done.add(file)
    let source = git(['show', `${base}:${file}`])
    source = source.replace(/(from\s+|import\s*\(\s*|import\s+)(['"])([^'"]+)\2/g, (whole, lead, quote, spec) => {
      const target = resolveSpec(file, spec)
      if (!target) return whole
      queue.push(target)
      let rel = posix.relative(posix.dirname(file), target).replace(/\.(ts|tsx)$/, '').replace(/\/index$/, '')
      if (!rel.startsWith('.')) rel = `./${rel}`
      return `${lead}${quote}${rel}${quote}`
    })
    const out = join(dir, file)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, source)
  }
}

// ── corpus ────────────────────────────────────────────────────────────────

type Row = [code: string, alias: string, source: string, shape: string, unit: string, mode: string, orderName: string]

const SECTION_REPS = ['', '06013C', '08011C', '09001C', '09011C', '09015C', '09040C', '12015C', '12025B', '12103B', '13007C', '14032C', '27004C']
const UNITS = ['g/dL', 'mg/g', '']
const MODES = ['URINE(SPOT)', 'SERUM_YL', '']
const PRIORITY_CODES = new Set([...IMMUNOLOGY_NHI_ORDER_CODES, ...PARAPROTEIN_NHI_ORDER_CODES, '09011C', '09015C', '09016C', '09038C', '09040C', '06013C'])

function buildCorpus(): Row[] {
  const pairs = new Map<string, [string, string, string]>()
  for (const cat of LAB_CATEGORIES) {
    for (const alias of cat.codes) {
      if (/^\d{5}[A-Z]$/.test(alias)) continue
      for (const code of SECTION_REPS) pairs.set(`${code}|${alias}`, [code, alias, `alias:${cat.id}`])
    }
  }
  for (const alias of LOOK_ALIKES) for (const code of SECTION_REPS) pairs.set(`${code}|${alias}`, [code, alias, 'lookalike'])
  for (const [code, name] of Object.entries(NHI_ORDER_CODE_TO_EN)) pairs.set(`${code}|${name}`, [code, name, 'order-name-en'])
  for (const [code, name] of Object.entries(NHI_ORDER_CODE_TO_ZH)) pairs.set(`${code}|${name}`, [code, name, 'order-name-zh'])
  const rows: Row[] = []
  let index = 0
  for (const [code, alias, source] of pairs.values()) {
    const shapes = code ? ['own', 'order', 'both', 'opaque'] : ['own']
    for (const shape of shapes) for (const unit of UNITS) for (const mode of MODES) {
      index += 1
      // Deterministic sample: every row of the orders, names and look-alikes
      // this branch touches; one in five of the rest.
      const priority = PRIORITY_CODES.has(code) || source === 'lookalike' || /PROT|ALB|CA|CRE|蛋白|鈣|肌/i.test(alias)
      if (!priority && index % 5 !== 0) continue
      rows.push([code, alias, source, shape, unit, mode, (NHI_ORDER_CODE_TO_ZH as any)[code] ?? ''])
    }
  }
  return rows
}

function observation([code, alias, , shape, unit, mode, orderName]: Row, system: string): any {
  const codings: any[] = []
  let text: string | undefined
  if (shape === 'own') { text = alias; if (code) codings.push({ system, code }) }
  if (shape === 'order') codings.push({ system, code, display: alias })
  if (shape === 'both') { text = alias; codings.push({ system, code, display: orderName || alias }) }
  if (shape === 'opaque') { codings.push({ system, code, display: alias }); codings.push({ system: LOCAL, code: 'L0001' }) }
  return {
    resourceType: 'Observation', status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
    code: { ...(text ? { text } : {}), coding: codings },
    valueQuantity: { value: 5, ...(unit ? { unit } : {}) },
    ...(mode ? { extension: [{ url: INSPECT, valueString: mode }] } : {}),
    effectiveDateTime: '2026-01-01T08:00:00+08:00',
  }
}

type Placement = [category: string, key: string]
function place(categorize: (o: any) => any, identity: (o: any, c: string) => any, o: any): Placement {
  const category = categorize(o)?.id ?? 'none'
  return [category, category === 'none' ? '' : identity(o, category).mapKey]
}

// ── allow-list ────────────────────────────────────────────────────────────

const IMMUNO_ORDERS = new Set([...IMMUNOLOGY_NHI_ORDER_CODES, ...PARAPROTEIN_NHI_ORDER_CODES])
const DUAL_KEYS = new Set(['TP', 'ALB', 'CA', 'CREA'])

/** Every allowed kind of change, with its reason. */
export const ALLOW_LIST: Record<string, string> = {
  fromNoPanel: 'the base left the row in 其他 or uncategorised; this branch gives it a panel',
  immunoOrder: 'an immunology NHI order (incl. IEP / IFE / κλ and IgG-subclass orders) decides 免疫',
  unitUrine: 'a serum-or-urine analyte with a urine unit (mg/g …) → 尿液 (unit-specimen evidence)',
  unitBlood: 'a serum-or-urine analyte with a blood unit (g/dL, g/L) → 生化 with its TP / ALB / CA / CREA column',
  nameUrine: 'the row\'s own name states urine → 尿液',
  ownName: 'the own name wins over the order display (round 8): the row lands where its own name alone does',
  dualColumn: 'an exact serum-or-urine analyte name takes that analyte\'s column (TP / ALB / CA / CREA)',
  newAlias: '全蛋白 / 鈣 / 血清鈣 are names of TP / CA (rounds 6, 14)',
  medcloudLikeHealthbank: 'MediCloud NHI codes are now recognised: the row lands where the same row under the 健保存摺 system does, which is the base\'s 健保存摺 result or an allowed change',
}

function classify(row: Row, base: Placement, branch: Placement, ownOnly: Placement | undefined, o: any): string | null {
  const [code, alias, , shape, unit] = row
  const [bc] = base
  const [nc, nk] = branch
  if (bc === 'other' || bc === 'none') return 'fromNoPanel'
  if (IMMUNO_ORDERS.has(code) && nc === 'immuno') return 'immunoOrder'
  const dual = dualSpecimenAnalyte(o)
  if (dual && nc === 'urine' && unit === 'mg/g') return 'unitUrine'
  if (dual && nc === 'chem' && unit === 'g/dL' && nk === dual) return 'unitBlood'
  if (/尿|URINE|SPOT/i.test(alias) && nc === 'urine') return 'nameUrine'
  if (['全蛋白', '鈣', '血清鈣'].includes(alias) && (nk === 'TP' || nk === 'CA' || nc === 'chem')) return 'newAlias'
  if (bc === nc && dual && DUAL_KEYS.has(nk) && nk === dual) return 'dualColumn'
  if (shape === 'both' && ownOnly && ownOnly[0] === nc && ownOnly[1] === nk) return 'ownName'
  return null
}

// ── test ──────────────────────────────────────────────────────────────────

const base = resolveBase()

describe('lab categorisation differential against the base branch', () => {
  if (!base) {
    it('is skipped: the base commit is not available (shallow clone?)', () => {
      console.warn('lab-category-differential: base commit unavailable — set LAB_DIFF_BASE or fetch origin/master to run it')
    })
    return
  }

  it('changes nothing the allow-list does not explain', async () => {
    const dir = join(ROOT, 'tmp', 'lab-category-base', base.slice(0, 12))
    if (!existsSync(join(dir, '.complete'))) {
      extractClosure(base, dir, ['src/shared/utils/lab-categories.ts', 'src/shared/utils/lab-pivot.utils.ts'])
      writeFileSync(join(dir, '.complete'), base)
    }
    const baseCategories = await import(join(dir, 'src/shared/utils/lab-categories.ts'))
    const basePivot = await import(join(dir, 'src/shared/utils/lab-pivot.utils.ts'))

    const corpus = buildCorpus()
    // Where the same row lands on this branch with its own name only.
    const ownOnly = (row: Row, system: string): Placement =>
      place(categorizeObservation, getLabPivotTestIdentity, observation([row[0], row[1], row[2], 'own', row[4], row[5], row[6]], system))

    const unexplained: string[] = []
    const counts: Record<string, number> = {}
    const results: Record<string, Placement[]> = {}
    for (const [label, system] of [['healthbank', HEALTHBANK], ['medcloud', MEDCLOUD]] as const) {
      results[`base:${label}`] = corpus.map((row) => place(baseCategories.categorizeObservation, basePivot.getLabPivotTestIdentity, observation(row, system)))
      results[`branch:${label}`] = corpus.map((row) => place(categorizeObservation, getLabPivotTestIdentity, observation(row, system)))
    }
    const changed = (a: Placement, b: Placement) => a[0] !== b[0] || a[1] !== b[1]
    corpus.forEach((row, i) => {
      for (const label of ['healthbank', 'medcloud'] as const) {
        const baseP = results[`base:${label}`][i]
        const branchP = results[`branch:${label}`][i]
        if (!changed(baseP, branchP)) continue
        const o = observation(row, label === 'healthbank' ? HEALTHBANK : MEDCLOUD)
        let rule = classify(row, baseP, branchP, ownOnly(row, label === 'healthbank' ? HEALTHBANK : MEDCLOUD), o)
        if (!rule && label === 'medcloud') {
          const branchHb = results['branch:healthbank'][i]
          const baseHb = results['base:healthbank'][i]
          if (!changed(branchP, branchHb)) {
            const hbOwn = ownOnly(row, HEALTHBANK)
            if (!changed(baseHb, branchHb) || classify(row, baseHb, branchHb, hbOwn, observation(row, HEALTHBANK))) {
              rule = 'medcloudLikeHealthbank'
            }
          }
        }
        if (rule) counts[rule] = (counts[rule] ?? 0) + 1
        else unexplained.push(`${label} ${baseP.join('/')} -> ${branchP.join('/')} ${JSON.stringify(row.slice(0, 6))}`)
      }
    })
    if (process.env.LAB_DIFF_VERBOSE) console.log('lab-category-differential', { corpus: corpus.length, counts })
    // Every allowed kind is in the allow-list with its reason.
    for (const rule of Object.keys(counts)) expect(ALLOW_LIST[rule]).toBeTruthy()
    expect({ corpus: corpus.length, unexplained: unexplained.slice(0, 40), total: unexplained.length })
      .toEqual({ corpus: corpus.length, unexplained: [], total: 0 })
  }, 600_000)
})
