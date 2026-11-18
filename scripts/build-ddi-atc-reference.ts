#!/usr/bin/env tsx
// Builds src/shared/data/ddi-atc-reference.generated.json from the
// local-only VGH pharmacy formulary export (tvgh_ddi_ingredients_and_atc_summary.json).
//
//   npx tsx scripts/build-ddi-atc-reference.ts path/to/tvgh_ddi_ingredients_and_atc_summary.json
//
// For each WHO ATC substance the hospital stocks, one NHI code the hospital
// files for it. The interaction service knows only the hospital's own codes,
// so a cloud prescription of another maker's product is sent by this code
// instead. Output holds public codes only (ATC and NHI): hospital item codes
// (udCode), names, barcodes and billing codes are never copied (owner
// decision 2026-11-18: no hospital codes in plain text in this repository).
//
// Left out: inactive and trial items (udCode starting with T); ATC codes
// below the substance level; WHO combination codes (last two digits 50 and
// above); and any code under which the NHI drug master files more than one
// substance or a combination (see singleSubstanceAtcCodes).
// Where one substance comes in several routes, an oral product is preferred:
// cloud records are outpatient prescriptions.

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDdiAtcReference, type DictionaryRow, type FormularyItem } from './lib/ddi-atc-reference'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'src/shared/data/ddi-atc-reference.generated.json')
const MASTER = path.join(ROOT, 'vendor/nhi-fhir-bridge-nhi-drug-terminology/data/nhi-drug-terminology-20260728.json')

const input = process.argv[2]
if (!input) {
  console.error('usage: npx tsx scripts/build-ddi-atc-reference.ts <tvgh_ddi_ingredients_and_atc_summary.json>')
  process.exit(1)
}
const bytes = fs.readFileSync(input)
const source = JSON.parse(bytes.toString('utf8')) as { items: FormularyItem[] }
const master = JSON.parse(fs.readFileSync(MASTER, 'utf8')) as { rows: DictionaryRow[] }
const byAtc = buildDdiAtcReference(source.items, master.rows)
const output = {
  schemaVersion: 'ddi-atc-reference-v1',
  sourceSha256: createHash('sha256').update(bytes).digest('hex'),
  byAtc,
}
fs.writeFileSync(OUT, `${JSON.stringify(output)}\n`)
console.log(JSON.stringify({ output: path.relative(ROOT, OUT), atcCodes: Object.keys(byAtc).length }))
