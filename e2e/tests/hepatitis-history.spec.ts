import { test, expect } from '@playwright/test'
import path from 'node:path'
import { importBundle, SYNTHETIC_BUNDLE } from '../fixtures/import'

test('MediCloud documents keep source chapters without adding a separate screening surface', async ({ page }) => {
  await importBundle(page, { bundlePath: path.join(__dirname, '../fixtures/medcloud-hepatitis-bundle.json') })
  await page.getByRole('tab', { name: '文件', exact: true }).click()
  await expect(page.getByTestId('hepatitis-history')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '歷史 B/C 肝篩檢' })).toHaveCount(0)
  await page.getByRole('button', { name: '展開全文', exact: true }).first().click()
  await expect(page.getByRole('heading', { name: 'B型肝炎檢查', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'C型肝炎檢查', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '展開全文', exact: true }).click()
  const emptyExam = page.locator('[data-continuous-composition-body="true"]').filter({ hasText: '本文件沒有肝炎章節' })
  await expect(emptyExam.getByRole('heading', { name: 'B型肝炎檢查' })).toBeVisible()
  await expect(emptyExam.getByRole('heading', { name: 'C型肝炎檢查' })).toBeVisible()
  await expect(emptyExam.locator('td')).toHaveText(['', ''])

  await page.getByRole('tab', { name: '報告', exact: true }).click()
  const hepatitis = page.locator('[data-cumulative-section="hep"]')
  await expect(hepatitis).toBeVisible()
  await expect(hepatitis).toContainText('陰性')
  await expect(hepatitis.getByLabel('含成人預防保健結果').first()).toHaveText('健')
  await expect(hepatitis.locator('[data-lab-test-key="HBSAG"]').first()).toBeVisible()
  await expect(hepatitis.locator('[data-lab-test-key="ANTI-HCV"]').first()).toBeVisible()

  await importBundle(page, { bundlePath: SYNTHETIC_BUNDLE })
  await page.getByRole('tab', { name: '文件', exact: true }).click()
  await expect(page.getByTestId('hepatitis-history')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'B型肝炎檢查', exact: true })).toHaveCount(0)
})
