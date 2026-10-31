#!/usr/bin/env tsx
// Builds src/infrastructure/fhir/data/vghtpe-medication-index.generated.json
// from the local-only VGH hospital drug identity table. The table itself
// (hospital item codes, candidate lists, local evidence) never enters this
// repository.
//
//   npx tsx scripts/build-vghtpe-medication-index.ts path/to/hospital-identity.local.json
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
  console.error('usage: npx tsx scripts/build-vghtpe-medication-index.ts <hospital-identity.local.json>')
  process.exit(1)
}
const identityBytes = fs.readFileSync(input)
const master = JSON.parse(fs.readFileSync(MASTER, 'utf8'))
const { index, report } = buildVghtpeMedicationIndex({
  identity: JSON.parse(identityBytes.toString('utf8')), identityBytes,
  masterRows: master.rows, terminologySnapshotId: master.manifest.snapshotId,
})
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, `${JSON.stringify(index)}\n`)
console.log(JSON.stringify({ output: path.relative(ROOT, OUT), bytes: fs.statSync(OUT).size, ...report }, null, 2))
