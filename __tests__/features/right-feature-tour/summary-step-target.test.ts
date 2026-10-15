import fs from 'node:fs'
import path from 'node:path'
import { getRightTourSteps } from '@/features/right-feature-tour/right-feature-tour.steps'

// The 醫療摘要 step must point at something the summary still renders; the
// card nav it used to highlight was removed with the first-visit rebuild.
test('the summary tour step targets an element the summary renders', () => {
  const step = getRightTourSteps('quick', { medical: true, authenticated: true, betaEnabled: true }).find((candidate) => candidate.id === 'summary')!
  const attribute = step.target.match(/data-tour="([^"]+)"/)![1]
  const featureDir = path.join(process.cwd(), 'features/medical-summary')
  const sources = [
    fs.readFileSync(path.join(featureDir, 'Feature.tsx'), 'utf8'),
    ...fs.readdirSync(path.join(featureDir, 'components'))
      .map((file) => fs.readFileSync(path.join(featureDir, 'components', file), 'utf8')),
  ]
  expect(sources.some((source) => source.includes(`data-tour="${attribute}"`))).toBe(true)
  for (const text of [step.body['zh-TW'], step.body.en]) {
    expect(text).not.toMatch(/捷徑|shortcut|timeline|歷程|趨勢|trends/i)
  }
})
