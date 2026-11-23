import { existsSync } from 'node:fs'
import { join } from 'node:path'
import * as fallback from '@/src/optional/report-text'

// The public fallback must stay a copy of the private module. Only a clone
// with the package installed can compare them; a public clone skips.
const installed = existsSync(join(process.cwd(), 'node_modules/@voho0000/personalized-care-fhir/dist/report-text.js'))
const describeInstalled = installed ? describe : describe.skip

// Synthetic report text only.
const longFindings = Array.from({ length: 80 }, (_, i) => `Segment ${i + 1} shows normal wall motion and thickness.`).join(' ')
const narratives = [
  'Exam date: 2026/01/02\nReported by: Dr. Example\nFindings: Small nodule in the right upper lobe.\nImpression: Benign-appearing nodule, follow up in 12 months.',
  `Findings:\n${longFindings}\nConclusion & Comments:\n1. Preserved LV systolic function.\n2. Mild mitral regurgitation.`,
  'Findings: Liver echo texture is homogeneous. No focal lesion. Gallbladder unremarkable.',
  `Findings: ${longFindings}`,
  '診斷：右側乳房良性纖維腺瘤。\n建議：六個月後追蹤。',
  '',
]

describeInstalled('report-text public fallback', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pkg = installed ? require('@voho0000/personalized-care-fhir/report-text') : {}

  test('exports the same names', () => {
    expect(Object.keys(fallback).sort()).toEqual(Object.keys(pkg).sort())
    for (const name of Object.keys(fallback).filter(key => key.startsWith('REPORT_'))) {
      expect((fallback as Record<string, unknown>)[name]).toEqual(pkg[name])
    }
  })

  test.each(narratives.map((text, index) => [index, text] as const))('narrative %i gives identical output', (_index, text) => {
    expect(fallback.findConclusionSection(text)).toEqual(pkg.findConclusionSection(text))
    expect(fallback.deterministicReportExcerpt(text)).toEqual(pkg.deterministicReportExcerpt(text))
    for (const maxChars of [300, 1_800]) {
      expect(fallback.buildReportPromptBody(text, maxChars)).toEqual(pkg.buildReportPromptBody(text, maxChars))
    }
    for (const line of text.split('\n')) {
      expect(fallback.isAdministrativeLine(line)).toBe(pkg.isAdministrativeLine(line))
    }
  })

  test('fitting reports to a budget gives identical output', () => {
    const candidates = [...narratives, narratives[1]].map((narrative, index) => ({
      key: `L${index + 1}`, date: `2026-01-0${(index % 3) + 1}`, rank: index % 2, narrative, header: `[L${index + 1}] Report`,
      identities: index === narratives.length ? ['study-1'] : [`study-${index}`],
    }))
    const estimateTokens = (text: string) => Math.ceil(text.length / 4)
    for (const extra of [{}, { tokenBudget: 400 }, { tokenBudget: 50, maxReports: 2 }, { perReportChars: 500 }]) {
      const options = { estimateTokens, ...extra }
      expect(fallback.fitReportTextsToBudget(candidates, options)).toEqual(pkg.fitReportTextsToBudget(candidates, options))
    }
  })
})
