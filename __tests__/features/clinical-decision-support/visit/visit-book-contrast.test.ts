/**
 * 決策地圖 v2's filled buttons stay readable in both themes (#219 review: the
 * dark safety button's white text was 2.99:1). Read off the stylesheet's own
 * tokens, so a later colour change is measured the same way.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(process.cwd(), 'features/clinical-decision-support/renderers/visit/VisitBookLayout.module.css'), 'utf8')

/** The custom properties set in the first block whose selector starts with `selector`. */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`no block ${selector}`)
  const body = css.slice(start, css.indexOf('\n}', start))
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)].map((match) => [match[1], match[2]]))
}

function luminance(hex: string): number {
  const channel = (index: number) => {
    const value = parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

const light = tokens('.book')
const dark = { ...light, ...tokens(':global(.dark) .book') }
const FILLS = ['blue-fill', 'blue-fill-hover', 'red-fill', 'red-fill-hover'] as const

describe.each([['light', light], ['dark', dark]] as const)('決策地圖 v2 filled buttons — %s', (_theme, palette) => {
  it.each(FILLS)('white text on --%s is at least 4.5:1 (WCAG 1.4.3)', (fill) => {
    expect(palette[fill]).toMatch(/^#/)
    expect(contrast('#FFFFFF', palette[fill])).toBeGreaterThanOrEqual(4.5)
  })

  it('the buttons are drawn with the fills, white text on them', () => {
    expect(css).toMatch(/\.pri \{[^}]*background: var\(--blue-fill\);[^}]*color: #FFFFFF;/)
    expect(css).toMatch(/\.priSafety \{[^}]*background: var\(--red-fill\);[^}]*color: #FFFFFF;/)
  })
})

it('in dark mode a fill stands out from every surface it sits on (3:1, WCAG 1.4.11)', () => {
  for (const fill of FILLS) {
    for (const surface of ['sheet', 'paper', 'row-act', 'row-safety', 'panel'] as const) {
      expect(contrast(dark[fill], dark[surface])).toBeGreaterThanOrEqual(3)
    }
  }
})
