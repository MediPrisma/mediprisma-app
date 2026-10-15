/** @jest-environment node */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

test('generated Collector contract must match its canonical checksum pin', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/shared/contracts/collector-event.ts'), 'utf8').replace(/\r\n/g, '\n')
  const pin = readFileSync(resolve(process.cwd(), 'src/shared/contracts/collector-event.sha256'), 'utf8').trim()
  expect(createHash('sha256').update(source).digest('hex')).toBe(pin)
})
