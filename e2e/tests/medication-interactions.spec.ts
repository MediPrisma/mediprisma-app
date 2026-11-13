import path from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/test'
import { importBundle, openLeftTab } from '../fixtures/import'

const bundlePath = path.join(__dirname, '../fixtures/interaction-bundle.json')

// What the hospital service answered for these ingredient names on
// 2026-11-13 (trimmed). An ingredient it does not carry comes back as a RAW
// placeholder with no alert.
const KNOWN: Record<string, { udCode: string; genericName: string }> = {
  tamoxifen: { udCode: '04373', genericName: 'Tamoxifen citrate (tamoxifen)' },
  ciprofloxacin: { udCode: '04508', genericName: 'Ciprofloxacin lactate (ciprofloxacin)' },
  'paroxetine hcl': { udCode: '05230', genericName: 'Paroxetine HCl (paroxetine)' },
  'warfarin sodium': { udCode: '03951', genericName: 'Warfarin' },
  spironolactone: { udCode: '00050', genericName: 'Spironolactone' },
  'enalapril maleate': { udCode: '01675', genericName: 'Enalapril maleate (enalapril)' },
}
const alert = (a: string, b: string, severity: string, nursingAction: string, mechanism: string, type = 'DRUG_INTERACTION') => ({
  alertId: `db50::${a}::${b}`, type, severity, drugA: { udCode: a }, drugB: { udCode: b },
  nursingAction, mechanism, source: '北榮藥劑部交互作用資料庫 (.50 OLAP.DRGINACT)',
})
const ALERTS = [
  alert('04508', '03951', 'high', '併用或停用quinolones時，應密切監測PT、INR及臨床症狀以調整warfarin劑量；並指導病人若有異常出血應立即告知醫師。', '併用時可能增加warfarin抗凝血作用，引發凝血時間延長或出血。'),
  alert('03951', '04373', 'high', '併用時應持續監測PT、INR及臨床症狀以調整warfarin劑量；並指導病人若有異常出血應立即告知醫師。', '併用時可能增加warfarin抗凝血作用，引發凝血時間延長或出血。'),
  alert('04373', '05230', 'high', '儘量避免併用，若需併用建議改以較不抑制CYP2D6之SSRIs如citalopram、esciltalopram或venlafaxine取代。', '部份SSRIs抑制CYP2D6而減少tamoxifen活性代謝物endoxifen之生成，可能降低抗癌療效而增加乳癌復發風險。'),
  alert('00050', '01675', 'moderate', '定期追蹤血清鉀離子 (K+) 與腎功能 (eGFR/Cr)，注意高血鉀相關心電圖變化。', '保鉀利尿劑或鉀離子補充劑與 ACEI/ARB 併用會減少腎臟排鉀，易導致高血鉀症。'),
]

async function mockInteractionService(page: Page) {
  const bodies: Array<{ medications: Array<Record<string, unknown>> }> = []
  await page.route('https://ddi.e2e.test/api/ddi-check', async (route) => {
    const body = route.request().postDataJSON()
    bodies.push(body)
    await route.fulfill({
      json: {
        resolvedMedications: body.medications.map((medication: { drugName: string }, inputIndex: number) => {
          const known = KNOWN[medication.drugName.toLowerCase()]
          return known
            ? { inputIndex, ...known }
            : { inputIndex, udCode: `RAW-${inputIndex + 1}`, matchedBy: 'rawName', genericName: medication.drugName }
        }),
        alerts: ALERTS,
      },
    })
  })
  return bodies
}

test('用藥 lists cross-visit interactions, keeps the rest collapsed, and sends ingredient names only', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-13T04:00:00Z'))
  const bodies = await mockInteractionService(page)
  await importBundle(page, { bundlePath })
  const panel = await openLeftTab(page, /^用藥$/)
  const section = panel.getByRole('region', { name: '交互作用' })

  await expect(section.getByText('避免併用 1')).toBeVisible()
  await expect(section.getByText('需處理 2')).toBeVisible()
  await expect(section.getByText('已檢核 6／7 項')).toBeVisible()
  const avoid = section.getByRole('button', { name: /TAMOXIFEN.* × PAROXETINE/ })
  await expect(avoid).toContainText('儘量避免併用')
  await expect(section.getByRole('button', { name: /CIPROFLOXACIN.* × WARFARIN/ })).toBeVisible()
  await expect(section.getByText(/SPIRONOLACTONE.* × ENALAPRIL/)).toHaveCount(0)

  await avoid.click()
  await expect(section.getByText(/減少tamoxifen活性代謝物/)).toBeVisible()
  await expect(section.getByText(/院內/).first()).toBeVisible()
  await expect(section.getByText(/合成範例診所/).first()).toBeVisible()

  await section.getByRole('button', { name: '其他 1 項、1 項未檢核' }).click()
  await expect(section.getByRole('button', { name: /SPIRONOLACTONE.* × ENALAPRIL/ })).toContainText('同次開立')
  await expect(section.getByText(/未檢核：成分未對到/)).toBeVisible()

  // Only ingredient names leave the browser.
  expect(bodies.length).toBeGreaterThan(0)
  for (const medication of bodies[0]!.medications) expect(Object.keys(medication)).toEqual(['drugName'])
  expect(JSON.stringify(bodies[0])).not.toMatch(/合成資料|1958|SYN0000/)

  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const summary = page.getByRole('button', { name: '摘要', exact: true })
    if (width < 768 && await summary.isVisible()) await summary.click()
    await expect(avoid).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  }
})

test('用藥 shows no 交互作用 section when the service cannot be reached', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-13T04:00:00Z'))
  await page.route('https://ddi.e2e.test/**', route => route.abort('connectionrefused'))
  await importBundle(page, { bundlePath })
  const panel = await openLeftTab(page, /^用藥$/)
  await expect(panel.getByText(/TAMOXIFEN/).first()).toBeVisible()
  await expect(panel.getByRole('region', { name: '交互作用' })).toHaveCount(0)
})
