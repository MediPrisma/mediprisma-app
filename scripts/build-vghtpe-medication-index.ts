#!/usr/bin/env tsx
// Builds src/infrastructure/fhir/data/vghtpe-medication-index.generated.json
// from the local-only hospital/cloud drug linkage. The linkage itself (hospital
// item codes, candidate lists, local evidence) never enters this repository.
//
//   npx tsx scripts/build-vghtpe-medication-index.ts path/to/hospital-cloud-linkage.local.json
//
// See scripts/lib/vghtpe-medication-index.ts for what enters the index.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildVghtpeMedicationIndex } from './lib/vghtpe-medication-index'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'src/infrastructure/fhir/data/vghtpe-medication-index.generated.json')
const MASTER = path.join(ROOT, 'vendor/nhi-fhir-bridge-nhi-drug-terminology/data/nhi-drug-terminology-20260728.json')

const input = process.argv[2]
if (!input) {
  console.error('usage: npx tsx scripts/build-vghtpe-medication-index.ts <hospital-cloud-linkage.local.json>')
  process.exit(1)
}
const bytes = fs.readFileSync(input)
const snapshotId = JSON.parse(fs.readFileSync(MASTER, 'utf8')).manifest.snapshotId
const { index, report } = buildVghtpeMedicationIndex(JSON.parse(bytes.toString('utf8')), bytes, snapshotId)
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, `${JSON.stringify(index, null, 1)}\n`)
console.log(JSON.stringify({ output: path.relative(ROOT, OUT), ...report, collidingNames: report.collidingNames.length }, null, 2))
