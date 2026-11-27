// ASE/EACVI chamber reference values and grading for the echo measurements a
// VGH report carries. Rule-based only; values are judged unrounded.
//   ASE/EACVI 2015: Lang RM et al. Eur Heart J Cardiovasc Imaging 2015;16:233–271
//                   (= J Am Soc Echocardiogr 2015;28:1–39).
//   ASE/EACVI 2016: Nagueh SF et al. J Am Soc Echocardiogr 2016;29:277–314.

export type EchoSex = 'male' | 'female'
export type EchoGrade = 'normal' | 'abnormal' | 'mild' | 'moderate' | 'severe' | 'below' | 'above'

interface Range {
  /** Inclusive normal limits; an absent limit is open. */
  normal: { lo?: number; hi?: number }
  /** Bands above normal, ascending; the last one may be open. */
  high?: Array<{ grade: EchoGrade; hi?: number }>
  /** Bands below normal, descending; the last one may be open. */
  low?: Array<{ grade: EchoGrade; lo?: number }>
}

interface Reference { unit: string; source: string; male: Range; female: Range }

const both = (range: Range) => ({ male: range, female: range })
const lvefLow = (mildLo: number): Range['low'] => [{ grade: 'mild', lo: mildLo }, { grade: 'moderate', lo: 30 }, { grade: 'severe' }]

export const ECHO_CHAMBER_REFERENCES = {
  lvidd: {
    unit: 'mm', source: 'ASE/EACVI 2015 Table 2（mean ± 2SD）',
    male: { normal: { lo: 42.0, hi: 58.4 } }, female: { normal: { lo: 37.8, hi: 52.2 } },
  },
  ivsd: {
    unit: 'mm', source: 'ASE/EACVI 2015 Table 6（linear method）',
    male: { normal: { lo: 6, hi: 10 } }, female: { normal: { lo: 6, hi: 9 } },
  },
  lvpwd: {
    unit: 'mm', source: 'ASE/EACVI 2015 Table 6（linear method）',
    male: { normal: { lo: 6, hi: 10 } }, female: { normal: { lo: 6, hi: 9 } },
  },
  lvMass: {
    unit: 'g', source: 'ASE/EACVI 2015 Table 6（linear method）',
    male: { normal: { lo: 88, hi: 224 } }, female: { normal: { lo: 67, hi: 162 } },
  },
  // The 2015 update gives only the upper limit of normal, no severity partitions.
  lvmi: {
    unit: 'g/m²', source: 'ASE/EACVI 2015 Table 6（linear method）',
    male: { normal: { lo: 49, hi: 115 }, high: [{ grade: 'abnormal' }] },
    female: { normal: { lo: 43, hi: 95 }, high: [{ grade: 'abnormal' }] },
  },
  // Only the upper limit is used clinically: RWT > 0.42 is concentric.
  rwt: {
    unit: '', source: 'ASE/EACVI 2015 Table 6；RWT > 0.42 為向心性',
    ...both({ normal: { hi: 0.42 }, high: [{ grade: 'abnormal' }] }),
  },
  lvef: {
    unit: '%', source: 'ASE/EACVI 2015 Table 4（2DE biplane）',
    male: { normal: { lo: 52, hi: 72 }, low: lvefLow(41) },
    female: { normal: { lo: 54, hi: 74 }, low: lvefLow(41) },
  },
  lavi: {
    unit: 'mL/m²', source: 'ASE/EACVI 2015 Table 4（男女相同）',
    ...both({ normal: { lo: 16, hi: 34 }, high: [{ grade: 'mild', hi: 41 }, { grade: 'moderate', hi: 48 }, { grade: 'severe' }] }),
  },
  trv: {
    unit: 'm/s', source: 'ASE/EACVI 2016 Figure 8A／8B（TR > 2.8 m/s）',
    ...both({ normal: { hi: 2.8 }, high: [{ grade: 'abnormal' }] }),
  },
} satisfies Record<string, Reference>

export type EchoChamberMetric = keyof typeof ECHO_CHAMBER_REFERENCES

function gradeRange(value: number, range: Range): EchoGrade {
  const { lo, hi } = range.normal
  if ((lo === undefined || value >= lo) && (hi === undefined || value <= hi)) return 'normal'
  // A value in a gap between printed bands (LAVI 34.5, LVEF 40.5 or 51.5) belongs to
  // the band farther from normal. Basis: the tables print the last value of each band,
  // so anything past it is outside that band (the guideline's “LAVI > 34” is abnormal).
  if (hi !== undefined && value > hi) return range.high?.find(b => b.hi === undefined || value <= b.hi)?.grade ?? 'above'
  return range.low?.find(b => b.lo === undefined || value >= b.lo)?.grade ?? 'below'
}

export type EchoGradeResult =
  | { grade: EchoGrade; source: string }
  /** Sex unknown and the male and female references disagree. */
  | { grade: 'needsSex'; male: EchoGrade; female: EchoGrade; source: string }

/** Grades one measurement in the metric's unit; undefined when there is no usable value. */
export function gradeEchoMetric(metric: EchoChamberMetric, value: number | undefined, sex?: EchoSex): EchoGradeResult | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  const reference: Reference = ECHO_CHAMBER_REFERENCES[metric]
  if (sex) return { grade: gradeRange(value, reference[sex]), source: reference.source }
  const male = gradeRange(value, reference.male), female = gradeRange(value, reference.female)
  return male === female ? { grade: male, source: reference.source } : { grade: 'needsSex', male, female, source: reference.source }
}

export type LvGeometry = 'normal' | 'concentricRemodeling' | 'concentricHypertrophy' | 'eccentricHypertrophy'
export type LvGeometryResult =
  | { geometry: LvGeometry; source: string }
  | { geometry: 'needsSex'; male: LvGeometry; female: LvGeometry; source: string }

const GEOMETRY_SOURCE = 'ASE/EACVI 2015 Table 6（LVMI × RWT 四型；RWT > 0.42 為向心性）'

function geometryFor(lvmi: number, rwt: number, sex: EchoSex): LvGeometry {
  const increasedMass = gradeRange(lvmi, ECHO_CHAMBER_REFERENCES.lvmi[sex]) === 'abnormal'
  const concentric = rwt > 0.42
  if (increasedMass) return concentric ? 'concentricHypertrophy' : 'eccentricHypertrophy'
  return concentric ? 'concentricRemodeling' : 'normal'
}

/** LV geometry from LVMI (g/m²) and RWT; needs both. */
export function classifyLvGeometry(lvmi: number | undefined, rwt: number | undefined, sex?: EchoSex): LvGeometryResult | undefined {
  if (lvmi === undefined || rwt === undefined || !Number.isFinite(lvmi) || !Number.isFinite(rwt)) return undefined
  if (sex) return { geometry: geometryFor(lvmi, rwt, sex), source: GEOMETRY_SOURCE }
  const male = geometryFor(lvmi, rwt, 'male'), female = geometryFor(lvmi, rwt, 'female')
  return male === female ? { geometry: male, source: GEOMETRY_SOURCE } : { geometry: 'needsSex', male, female, source: GEOMETRY_SOURCE }
}
