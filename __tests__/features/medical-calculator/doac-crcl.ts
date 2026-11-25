import { cockcroftGault } from '@/features/medical-calculator/doac-dose-model'
import type { CalcValues } from '@/features/medical-calculator/types'

/** The CrCl values a label or guideline rule turns on: a case on one must compute to it exactly. */
const BANDS = [15, 25, 30, 50, 80, 95, 100]

/**
 * A case names the CrCl it is about (`crcl`); the calculator has no CrCl field,
 * so the creatinine is set to the one that gives that CrCl for the case's age,
 * weight and sex — exactly, wherever the division allows and always on a band.
 * A blank `crcl` blanks the creatinine.
 */
export function withCrcl(values: CalcValues): CalcValues {
  const { crcl, ...rest } = values
  if (crcl === undefined) return rest
  if (crcl === '') return { ...rest, scr: '' }
  const target = Number(crcl)
  const at = (scr: number) => cockcroftGault(Number(rest.age), Number(rest.weight), scr, rest.sex)
  const first = at(1)! / target
  // The division may land a bit off the value the case names.
  const exact = [0, -1, 1, -2, 2, -3, 3, -4, 4].map((bits) => first * (1 + bits * 2 ** -52)).find((candidate) => at(candidate) === target)
  if (exact === undefined && BANDS.includes(target)) throw new Error(`no creatinine gives CrCl ${crcl} exactly`)
  return { ...rest, scr: String(exact ?? first) }
}
