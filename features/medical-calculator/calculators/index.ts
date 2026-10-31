// Barrel: reassembles all category calculator arrays into CALCULATORS and
// re-exports the tag/info helpers. Consumers import from `./calculators` (or
// `../calculators`) exactly as before — this file replaced the old
// single-file calculators.ts.

import type { CalculatorDef } from '../types'
import { RENAL } from './renal'
import { HEPATIC } from './hepatic'
import { GI } from './gi'
import { ELECTROLYTE } from './electrolyte'
import { HFPEF } from './hfpef'
import { CARDIAC } from './cardiac'
import { PREVENT } from './prevent'
import { PULMONARY } from './pulmonary'
import { HEME } from './heme'
import { NEURO } from './neuro'
import { MENTAL } from './mental'
import { GENERAL } from './general'
import { HPA_RISK } from './hpa-risk'
import { HEART_FAILURE_PROGNOSIS } from './heart-failure-prognosis'
import { DOAC_DOSE } from './doac-dose'

export const CALCULATORS: CalculatorDef[] = [
  ...RENAL,
  ...HEPATIC,
  ...GI,
  ...ELECTROLYTE,
  ...CARDIAC,
  ...DOAC_DOSE,
  PREVENT,
  ...HFPEF,
  ...HEART_FAILURE_PROGNOSIS,
  ...PULMONARY,
  ...HEME,
  ...NEURO,
  ...MENTAL,
  ...GENERAL,
  ...HPA_RISK,
]

export { CALC_TAGS, getCalcTags } from './tags'
export type { CalcTags } from './tags'
export { CALC_INFO, getCalcInfo } from './info'
export type { CalcInfo } from './info'
export { CALC_SCORING, getCalcScoring } from './scoring'
export type { CalcScoring, ScoringFactor, ScoringGrid, GridColor } from './scoring'
