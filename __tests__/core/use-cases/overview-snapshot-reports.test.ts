import { buildOverviewSnapshot } from '@/src/core/use-cases/medical-summary/overview-snapshot'

const ct = (id: string, date: string, conclusion: string, accession?: string, text = '電腦斷層造影－有造影劑') => ({
  id,
  code: { text },
  category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'RAD' }] }],
  effectiveDateTime: `${date}T08:00:00Z`,
  conclusion,
  ...(accession ? { identifier: [{ system: 'urn:acc', value: accession }] } : {}),
})

describe('overview snapshot reports — same-named studies from different body parts', () => {
  const reports = [
    ct('ct-head', '2026-05-01', 'Brain: no acute lesion.', 'ACC-1'),
    ct('ct-chest', '2026-04-20', 'Chest: RUL nodule 8 mm.', 'ACC-2'),
    ct('ct-chest-en', '2026-04-20', 'Chest: RUL nodule 8 mm.', 'ACC-2', 'CT chest with contrast'),
    ct('ct-abd', '2026-03-10', 'Abdomen: fatty liver.', 'ACC-3'),
    ct('ct-old', '2025-01-10', 'Pelvis: unremarkable.', 'ACC-4'),
  ]
  const catalog = reports.map((r, i) => ({ key: `L${i + 1}`, resourceType: 'DiagnosticReport', resourceId: r.id, display: r.code.text, date: r.effectiveDateTime.slice(0, 10) }))

  it('keeps several same-named CTs and collapses only the bilingual duplicate of one study', () => {
    const snapshot = buildOverviewSnapshot(
      { clinicalData: { diagnosticReports: reports as any }, catalog: catalog as any, patient: {} as any },
      { nowMs: Date.parse('2026-06-01'), locale: 'zh-TW' },
    )
    const text = snapshot.clinicalContext
    expect(text).toContain('Brain: no acute lesion')
    expect(text).toContain('RUL nodule')
    expect(text).toContain('fatty liver')
    expect(text).not.toContain('Pelvis: unremarkable')
    expect(text.match(/RUL nodule/g)).toHaveLength(1)
  })
})
