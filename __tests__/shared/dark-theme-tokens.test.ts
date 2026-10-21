import { readFileSync } from "node:fs"
import { join } from "node:path"

type Oklch = readonly [lightness: number, chroma: number, hue: number]

function readDarkTokens() {
  const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8")
  const darkBlock = css.match(/\.dark\s*\{([\s\S]*?)\n\}/)?.[1]
  if (!darkBlock) throw new Error("Missing .dark theme block")

  return Object.fromEntries(
    [...darkBlock.matchAll(/--([\w-]+):\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\);/g)]
      .map((match) => [
        match[1],
        [Number(match[2]), Number(match[3]), Number(match[4])] as Oklch,
      ]),
  ) as Record<string, Oklch>
}

function relativeLuminance([lightness, chroma, hue]: Oklch) {
  const radians = hue * Math.PI / 180
  const a = chroma * Math.cos(radians)
  const b = chroma * Math.sin(radians)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  const red = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const green = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const blue = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s

  return 0.2126 * Math.min(1, Math.max(0, red))
    + 0.7152 * Math.min(1, Math.max(0, green))
    + 0.0722 * Math.min(1, Math.max(0, blue))
}

function contrast(first: Oklch, second: Oklch) {
  const a = relativeLuminance(first)
  const b = relativeLuminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

describe("dark theme comfort and accessibility", () => {
  const tokens = readDarkTokens()

  it("uses lifted low-chroma surfaces instead of an OLED-black canvas", () => {
    expect(tokens.background[0]).toBeGreaterThanOrEqual(0.22)
    expect(tokens.background[1]).toBeLessThanOrEqual(0.02)
    // The shell and the panels are one surface; cards lift from it.
    expect(tokens.background[0]).toBeLessThanOrEqual(tokens.panel[0])
    expect(tokens.panel[0]).toBeLessThan(tokens.card[0])
    expect(tokens.card[0]).toBeLessThan(tokens.popover[0])
  })

  it("keeps primary copy off-white while meeting WCAG AA", () => {
    expect(tokens.foreground[0]).toBeLessThanOrEqual(0.82)
    expect(contrast(tokens.foreground, tokens.background)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(tokens["card-foreground"], tokens.card)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(tokens["muted-foreground"], tokens.card)).toBeGreaterThanOrEqual(3)
  })

  it("keeps action and abnormal data pairs readable", () => {
    expect(contrast(tokens["primary-foreground"], tokens.primary)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(tokens["clinical-abnormal"], tokens.card)).toBeGreaterThanOrEqual(4.5)
  })
})
