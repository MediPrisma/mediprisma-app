import { render, screen, fireEvent } from '@testing-library/react'
import { randomUUID } from 'node:crypto'
import { HfExcludedLabs } from '@/features/medical-calculator/prognosis/HfExcludedLabs'
import { buildMedcloudHfInput } from '@/src/core/hf-risk/medcloud-input'
import { hfMedcloudFixture } from './hf-medcloud-fixture'
import type { FhirRecord } from '@/src/core/hf-risk/contract'

const selection = { provider: 'SYNTHETIC-HOSPITAL', encounter: 'Encounter/synthetic-visit', claim: 'P1_CD_mortality_1m' as const }
const build = (bundle: FhirRecord) => buildMedcloudHfInput(bundle, selection, { today: '2026-10-04', uuid: randomUUID })

describe('HF excluded observation diagnostics', () => {
  it.each([
    [{ value: '7' }, 'value-invalid'],
    [{ value: 7 }, 'unit-missing'],
    [{ value: 7, unit: 'unknown', comparator: 'approximately' }, 'unit-unsupported'],
    [{ value: 7, unit: 'mg/dL', comparator: 'approximately' }, 'comparator-invalid'],
  ])('distinguishes the value / unit failure %j', (valueQuantity, valueIssue) => {
    const bundle = hfMedcloudFixture()
    bundle.entry.at(-1).resource.valueQuantity = valueQuantity
    expect(build(bundle).excludedLabs![0]).toMatchObject({ valueIssue, name: 'CREAT' })
  })
  it.each([
    ['lab-value-unit', { valueQuantity: { value: 7200, unit: 'unsupported', code: 'local-unit' } }],
    ['lab-value-unit', { valueQuantity: undefined, valueString: 'not numeric' }],
    ['lab-unmapped', { code: { text: 'Local test', coding: [{ system: 'urn:local', code: 'WBC' }] } }],
    ['lab-date', { effectiveDateTime: '2026-02-30' }],
    ['future-omitted', { effectiveDateTime: '2026-10-02' }],
    ['lab-status', { status: 'preliminary' }],
    ['void-omitted', { status: 'cancelled' }],
    ['source-omitted', { performer: [{ reference: 'Organization/other-hospital' }] }],
  ])('explains %s without changing the transport or exposing narrative', (reason, patch) => {
    const bundle = hfMedcloudFixture()
    const observation = bundle.entry.find((item: FhirRecord) => item.resource.resourceType === 'Observation').resource
    observation.code.text = 'Synthetic creatinine'
    Object.assign(observation, patch)
    const before = JSON.stringify(bundle)
    const result = build(bundle)
    expect(result.excludedLabs).toHaveLength(1)
    expect(result.excludedLabs![0]).toMatchObject({ row: 5, reason, status: observation.status })
    expect(result.gaps).toContainEqual({ code: reason, count: 1 })
    expect(result.counts.Observation).toBeUndefined()
    expect(JSON.stringify(bundle)).toBe(before)
    expect(JSON.stringify(result.excludedLabs)).not.toMatch(/PRIVATE|FAKE-ID|synthetic-patient/)
    expect(JSON.stringify(result.bundle)).not.toMatch(/excludedLabs|Synthetic creatinine|local-unit/)
  })

  it('keeps exact source quantities, separate duplicate rows and only the first exclusion reason', () => {
    const bundle = hfMedcloudFixture()
    const lab = bundle.entry.at(-1).resource
    lab.code.text = 'WBC source'
    lab.valueQuantity = { value: 0, comparator: '<', unit: 'K/uL', code: 'unsupported' }
    bundle.entry.push({ resource: { ...lab, id: 'repeat' } })
    const result = build(bundle)
    expect(result.excludedLabs?.map(item => item.row)).toEqual([5, 6])
    expect(result.excludedLabs![0]).toMatchObject({ name: 'WBC source', value: '< 0', unit: 'K/uL', unitCode: 'unsupported' })
    lab.status = 'cancelled'
    expect(build(bundle).excludedLabs![0].reason).toBe('void-omitted')
  })

  it('does not list accepted or foreign-patient observations and rebuilds for another index date', () => {
    const bundle = hfMedcloudFixture()
    expect(build(bundle).excludedLabs).toEqual([])
    const lab = bundle.entry.at(-1).resource
    lab.subject = { reference: 'Patient/foreign' }
    expect(build(bundle).excludedLabs).toEqual([])
    lab.subject = { reference: 'Patient/synthetic-patient' }
    lab.effectiveDateTime = '2026-10-02'
    expect(build(bundle).excludedLabs).toHaveLength(1)
    bundle.entry.find((item: FhirRecord) => item.resource.resourceType === 'Encounter').resource.period.start = '2026-10-03'
    expect(build(bundle).excludedLabs).toEqual([])
  })

  it('renders source details and reveals every row without silently truncating', () => {
    const items = Array.from({ length: 21 }, (_, i) => ({ row: i + 1, name: `Synthetic WBC ${i + 1}`, reason: 'lab-value-unit', codes: ['http://loinc.org | 6690-2'], value: '7200', unit: '/uL', unitCode: 'unknown', date: '2026-09-30' }))
    render(<HfExcludedLabs items={items} indexDate="2026-10-01" locale="zh" />)
    fireEvent.click(screen.getByText(/未納入的檢驗／觀察項目明細/))
    expect(screen.getByText('Synthetic WBC 1')).toBeInTheDocument()
    expect(screen.queryByText('Synthetic WBC 21')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /再顯示 1 筆/ }))
    expect(screen.getByText('Synthetic WBC 21')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText(/不送給模型/)).toBeInTheDocument()
  })

  it('explains the empty state in English', () => {
    render(<HfExcludedLabs items={[]} indexDate="2026-10-01" locale="en" />)
    expect(screen.getByText(/Tests absent from the source cannot be listed/)).toBeInTheDocument()
  })
})
