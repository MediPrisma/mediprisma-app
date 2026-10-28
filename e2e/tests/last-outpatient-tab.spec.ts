import fs from 'node:fs/promises'
import { test, expect } from '../fixtures/test'
import { importBundle, SYNTHETIC_BUNDLE } from '../fixtures/import'

// 上次門診 is listed only for a chart with a hospital (院內) outpatient visit.
// Fictional data throughout.
const HOSPITAL_META = { tag: [{ system: 'urn:wildcatch:source', code: 'vghtpe-outpatient-supplement' }] }
const PATIENT = { reference: 'Patient/test-patient-1' }

const visit = (id: string, date: string) => ({
  resourceType: 'Encounter', id, meta: HOSPITAL_META, status: 'finished',
  class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB' },
  subject: PATIENT, period: { start: `${date}T09:00:00+08:00` },
  serviceType: { text: '心臟內科' }, participant: [{ individual: { display: '陳怡君' } }],
  serviceProvider: { display: '臺北榮總' },
})

const lab = (id: string, loinc: string, text: string, value: number, unit: string, date: string, encounter: string, extra: Record<string, unknown> = {}) => ({
  resourceType: 'Observation', id, meta: HOSPITAL_META, status: 'final', subject: PATIENT,
  category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
  code: { coding: [{ system: 'http://loinc.org', code: loinc, display: text }], text },
  valueQuantity: { value, unit }, effectiveDateTime: `${date}T09:40:00+08:00`,
  encounter: { reference: `Encounter/${encounter}` }, ...extra,
})

const range = (low: number | undefined, high: number | undefined, unit: string) => ({
  referenceRange: [{ ...(low !== undefined ? { low: { value: low, unit } } : {}), ...(high !== undefined ? { high: { value: high, unit } } : {}) }],
})
const flag = (code: string) => ({ interpretation: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation', code }] }] })

const ECHO = [
  'Transthoracic Echocardiography',
  'M-mode / 2D',
  '  LA 44 mm    IVSd 11 mm    LVEDD 54 mm    LVESD 40 mm',
  '  LVEF (biplane Simpson) 48 %',
  'Doppler',
  "  MV E/A 0.9   E/e' 14   TR Vmax 2.6 m/s   RVSP 32 mmHg",
  'Conclusion:',
  '  1. Mildly reduced LV systolic function, LVEF 48%.',
  '  2. Inferior wall hypokinesia.',
  '  3. Grade II LV diastolic dysfunction. Mild MR, mild TR.',
].join('\n')

const HOLTER = [
  '24-hour Holter ECG',
  'Heart rate: min 52 bpm, mean 71 bpm, max 118 bpm',
  'PVC 7,231 (7.1%), monomorphic; couplets 18; NSVT 2 runs, longest 4 beats',
  'PAC 146 (0.1%); no SVT. No atrial fibrillation. Longest RR 1.6 s.',
  'Conclusion: Sinus rhythm with frequent monomorphic PVCs (burden 7.1%) and 2 short runs of NSVT.',
].join('\n')

async function hospitalBundle(outputPath: string) {
  const bundle = JSON.parse(await fs.readFile(SYNTHETIC_BUNDLE, 'utf8'))
  const resources = [
    visit('h-visit-old', '2026-07-10'),
    visit('h-visit', '2026-10-09'),
    lab('wbc-old', '6690-2', 'WBC', 7.1, '10^3/uL', '2026-07-10', 'h-visit-old'),
    lab('hb-old', '718-7', 'Hb', 13.2, 'g/dL', '2026-07-10', 'h-visit-old'),
    lab('cr-old', '2160-0', 'Creatinine', 1.12, 'mg/dL', '2026-07-10', 'h-visit-old'),
    lab('wbc', '6690-2', 'WBC', 6.8, '10^3/uL', '2026-10-09', 'h-visit', range(3.5, 10, '10^3/uL')),
    lab('hb', '718-7', 'Hb', 12.6, 'g/dL', '2026-10-09', 'h-visit', { ...range(13.5, 17.5, 'g/dL'), ...flag('L') }),
    lab('plt', '777-3', 'Platelet', 212, '10^3/uL', '2026-10-09', 'h-visit', range(150, 400, '10^3/uL')),
    lab('cr', '2160-0', 'Creatinine', 1.26, 'mg/dL', '2026-10-09', 'h-visit', range(0.7, 1.3, 'mg/dL')),
    lab('k', '2823-3', 'Potassium', 4.6, 'mmol/L', '2026-10-09', 'h-visit', range(3.5, 5.1, 'mmol/L')),
    lab('ldl', '13457-7', 'LDL-C', 88, 'mg/dL', '2026-10-09', 'h-visit', range(undefined, 100, 'mg/dL')),
    lab('bnp', '33762-6', 'NT-proBNP', 612, 'pg/mL', '2026-10-09', 'h-visit', { ...range(undefined, 125, 'pg/mL'), ...flag('H') }),
    {
      resourceType: 'DiagnosticReport', id: 'echo', meta: HOSPITAL_META, status: 'final', subject: PATIENT,
      code: { text: 'Echocardiography' }, conclusion: ECHO,
      effectiveDateTime: '2026-10-14T10:00:00+08:00', encounter: { reference: 'Encounter/h-visit' },
    },
    {
      resourceType: 'DiagnosticReport', id: 'holter', meta: HOSPITAL_META, status: 'final', subject: PATIENT,
      code: { text: 'Holter ECG (24 hours)' }, conclusion: HOLTER,
      effectiveDateTime: '2026-10-16T10:00:00+08:00', encounter: { reference: 'Encounter/h-visit' },
    },
  ]
  bundle.entry.push(...resources.map((resource) => ({ resource })))
  await fs.writeFile(outputPath, JSON.stringify(bundle))
  return outputPath
}

test('a cloud-only chart does not list 上次門診', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await importBundle(page)
  await expect(page.getByRole('tab', { name: '總覽' })).toBeVisible()
  await expect(page.getByRole('tab', { name: '上次門診' })).toHaveCount(0)
})

test('a chart with a hospital outpatient visit lists 上次門診 with everything it ordered', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const bundlePath = await hospitalBundle(testInfo.outputPath('hospital-bundle.json'))
  await importBundle(page, { bundlePath })

  const tab = page.getByRole('tab', { name: '上次門診' })
  await expect(tab).toBeVisible({ timeout: 20_000 })
  await tab.click()

  const card = page.getByTestId('last-outpatient')
  await expect(card).toBeVisible({ timeout: 20_000 })
  await expect(card.getByText('2026/10/09')).toBeVisible()
  await expect(card.getByText('12.6 g/dL')).toBeVisible()
  await expect(card.getByText('前次 1.12 · 07/10')).toBeVisible()
  await expect(card.getByText('Echocardiography').first()).toBeVisible()
  await expect(card.getByText('Holter ECG (24 hours)').first()).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('last-outpatient-1440.png') })

  await card.getByRole('button', { name: '異常', exact: true }).click()
  await expect(card.getByText('1.26 mg/dL')).toHaveCount(0)
  await expect(card.getByText('612 pg/mL')).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(card.getByText('612 pg/mL')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('last-outpatient-390.png') })
})
