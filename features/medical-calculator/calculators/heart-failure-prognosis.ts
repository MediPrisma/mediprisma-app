import type { CalculatorDef, CalcValues, L, SelectInput } from '../types'
import { AGE_INPUT, SEX_INPUT, n, requireSex, round } from './_shared'

const label = (en: string, zh = en): L => ({ en, zh })
const yesNo = (key: string, en: string, zh: string): SelectInput => ({
  key,
  type: 'select',
  label: label(en, zh),
  defaultValue: '',
  options: [
    { value: 'no', label: label('No', '否') },
    { value: 'yes', label: label('Yes', '是') },
  ],
})

const MAGGIC_ONE_YEAR = [
  .015, .016, .018, .020, .022, .024, .027, .029, .032, .036, .039, .043, .048,
  .052, .058, .063, .070, .077, .084, .093, .102, .111, .122, .134, .147, .160,
  .175, .191, .209, .227, .248, .269, .292, .316, .342, .369, .398, .427, .458,
  .490, .523, .557, .591, .625, .659, .692, .725, .757, .787, .816, .842,
] as const

const MAGGIC_THREE_YEAR = [
  .039, .043, .048, .052, .058, .063, .070, .077, .084, .092, .102, .111, .122,
  .134, .146, .160, .175, .191, .209, .227, .247, .269, .292, .316, .342, .369,
  .397, .427, .458, .490, .523, .556, .590, .625, .658, .692, .725, .756, .787,
  .815, .842, .866, .889, .908, .926, .941, .953, .964, .973, .980, .985,
] as const

const pct = (risk: number) => `${round(risk * 100, 1)}%`
const choicesComplete = (v: CalcValues, keys: string[], allowed = ['yes', 'no']) =>
  keys.every((key) => allowed.includes(v[key]))

export interface MaggicEstimate {
  score: number
  oneYearRisk?: number
  threeYearRisk?: number
  components: Array<{ label: L; points: number }>
}

/** Pocock 2013 Figure 2 integer score and Table 4 mortality lookup. */
export function calculateMaggic(v: CalcValues): MaggicEstimate | null {
  const age = n(v, 'age')
  const ef = n(v, 'lvef')
  const sbp = n(v, 'sbp')
  const bmi = n(v, 'bmi')
  const creatinineMgDl = n(v, 'creatinine')
  const sex = requireSex(v)
  if (age === undefined || ef === undefined || sbp === undefined || bmi === undefined || creatinineMgDl === undefined || !sex) return null
  if (age < 18 || age > 110 || ef < 0 || ef > 100 || sbp < 50 || sbp > 250 || bmi < 10 || bmi > 80 || creatinineMgDl < 0.1 || creatinineMgDl > 20) return null
  if (!['1', '2', '3', '4'].includes(v.nyha)) return null
  if (!choicesComplete(v, ['diabetes', 'betaBlocker', 'hfDuration', 'smoker', 'copd', 'aceiArb'])) return null

  const efPoints = ef < 20 ? 7 : ef < 25 ? 6 : ef < 30 ? 5 : ef < 35 ? 3 : ef < 40 ? 2 : 0
  const efTier = ef < 30 ? 0 : ef < 40 ? 1 : 2
  const ageRow = age < 55 ? [0, 0, 0] : age < 60 ? [1, 2, 3] : age < 65 ? [2, 4, 5]
    : age < 70 ? [4, 6, 7] : age < 75 ? [6, 8, 9] : age < 80 ? [8, 10, 12] : [10, 13, 15]
  const sbpRow = sbp < 110 ? [5, 3, 2] : sbp < 120 ? [4, 2, 1] : sbp < 130 ? [3, 1, 1]
    : sbp < 140 ? [2, 1, 0] : sbp < 150 ? [1, 0, 0] : [0, 0, 0]
  const bmiPoints = bmi < 15 ? 6 : bmi < 20 ? 5 : bmi < 25 ? 3 : bmi < 30 ? 2 : 0
  const creatinineUmolL = creatinineMgDl * 88.42
  const creatininePoints = creatinineUmolL < 90 ? 0 : creatinineUmolL < 110 ? 1 : creatinineUmolL < 130 ? 2
    : creatinineUmolL < 150 ? 3 : creatinineUmolL < 170 ? 4 : creatinineUmolL < 210 ? 5
      : creatinineUmolL < 250 ? 6 : 8
  const nyhaPoints = ({ '1': 0, '2': 2, '3': 6, '4': 8 } as const)[v.nyha as '1' | '2' | '3' | '4']
  const components = [
    { label: label('LVEF', '左心室射出分率'), points: efPoints },
    { label: label('Age × LVEF', '年齡 × 射出分率'), points: ageRow[efTier] },
    { label: label('Systolic BP × LVEF', '收縮壓 × 射出分率'), points: sbpRow[efTier] },
    { label: label('BMI'), points: bmiPoints },
    { label: label('Creatinine', '肌酸酐'), points: creatininePoints },
    { label: label('NYHA class', 'NYHA 分級'), points: nyhaPoints },
    { label: label('Male sex', '男性'), points: sex === 'male' ? 1 : 0 },
    { label: label('Current smoker', '目前吸菸'), points: v.smoker === 'yes' ? 1 : 0 },
    { label: label('Diabetes', '糖尿病'), points: v.diabetes === 'yes' ? 3 : 0 },
    { label: label('COPD'), points: v.copd === 'yes' ? 2 : 0 },
    { label: label('HF duration ≥18 months', '心衰竭病程 ≥18 個月'), points: v.hfDuration === 'yes' ? 2 : 0 },
    { label: label('No beta-blocker', '未使用 β 阻斷劑'), points: v.betaBlocker === 'no' ? 3 : 0 },
    { label: label('No ACEI/ARB', '未使用 ACEI/ARB'), points: v.aceiArb === 'no' ? 1 : 0 },
  ]
  const score = components.reduce((sum, item) => sum + item.points, 0)
  return {
    score,
    oneYearRisk: MAGGIC_ONE_YEAR[score],
    threeYearRisk: MAGGIC_THREE_YEAR[score],
    components,
  }
}

// Reitsma 2026 Supplementary Table S7. Each position is one 3-month age
// interval from 40.00 through 89.75 years. These are SwedeHF baseline
// survivals for the two cause-specific models; do not interpolate or replace
// them with a single annual baseline hazard.
const HFH_CV_BASELINE_WOMEN = [
  0.991152, 0.991332, 0.991513, 0.991694, 0.991873, 0.99205, 0.992225, 0.992396, 0.992563, 0.992724,
  0.99288, 0.993028, 0.993169, 0.993305, 0.993441, 0.993576, 0.993708, 0.993839, 0.993968, 0.994093,
  0.994215, 0.994334, 0.994448, 0.994558, 0.994662, 0.994763, 0.994862, 0.99496, 0.995054, 0.995147,
  0.995237, 0.995324, 0.995409, 0.995491, 0.995569, 0.995645, 0.995717, 0.995786, 0.995851, 0.995914,
  0.995973, 0.99603, 0.996084, 0.996135, 0.996184, 0.99623, 0.996274, 0.996315, 0.996354, 0.996391,
  0.996423, 0.996449, 0.99647, 0.996486, 0.996497, 0.996506, 0.996512, 0.996517, 0.996521, 0.996524,
  0.996528, 0.996534, 0.996541, 0.996549, 0.996556, 0.996561, 0.996564, 0.996568, 0.99657, 0.996573,
  0.996576, 0.99658, 0.996585, 0.996591, 0.996598, 0.996609, 0.996623, 0.99664, 0.996659, 0.996681,
  0.996704, 0.996727, 0.996751, 0.996775, 0.996798, 0.996819, 0.996839, 0.996856, 0.996873, 0.996891,
  0.996911, 0.996931, 0.996952, 0.996973, 0.996994, 0.997015, 0.997036, 0.997056, 0.997075, 0.997093,
  0.99711, 0.997126, 0.997142, 0.997158, 0.997173, 0.997188, 0.997203, 0.997218, 0.997232, 0.997246,
  0.99726, 0.997274, 0.997288, 0.997302, 0.997316, 0.99733, 0.997344, 0.997359, 0.997373, 0.997387,
  0.997401, 0.997414, 0.997428, 0.99744, 0.997452, 0.997464, 0.997476, 0.997487, 0.997497, 0.997508,
  0.997518, 0.997528, 0.997537, 0.997546, 0.997555, 0.997564, 0.997572, 0.99758, 0.997587, 0.997595,
  0.997602, 0.997609, 0.997616, 0.997622, 0.997628, 0.997634, 0.997639, 0.997645, 0.997649, 0.997654,
  0.997658, 0.997662, 0.997666, 0.997669, 0.997672, 0.997675, 0.997677, 0.99768, 0.997682, 0.997683,
  0.997685, 0.997686, 0.997687, 0.997688, 0.997689, 0.997689, 0.997689, 0.997689, 0.997689, 0.997688,
  0.997687, 0.997686, 0.997685, 0.997683, 0.997681, 0.997679, 0.997676, 0.997673, 0.99767, 0.997667,
  0.997664, 0.99766, 0.997656, 0.997651, 0.997647, 0.997642, 0.997637, 0.997631, 0.997626, 0.99762,
  0.997614, 0.997607, 0.9976, 0.997593, 0.997586, 0.997579, 0.997571, 0.997563, 0.997554, 0.997546,
] as const

const HFH_CV_BASELINE_MEN = [
  0.993511, 0.993579, 0.993646, 0.993714, 0.99378, 0.993846, 0.993912, 0.993976, 0.994039, 0.994101,
  0.994162, 0.994221, 0.994279, 0.994335, 0.994391, 0.994446, 0.9945, 0.994554, 0.994607, 0.994659,
  0.99471, 0.994761, 0.99481, 0.994858, 0.994906, 0.994952, 0.994998, 0.995043, 0.995087, 0.99513,
  0.995172, 0.995214, 0.995254, 0.995294, 0.995334, 0.995372, 0.99541, 0.995448, 0.995484, 0.99552,
  0.995555, 0.995589, 0.995622, 0.995655, 0.995686, 0.995717, 0.995747, 0.995777, 0.995805, 0.995834,
  0.99586, 0.995884, 0.995907, 0.995927, 0.995946, 0.995963, 0.99598, 0.995996, 0.996011, 0.996026,
  0.996041, 0.996057, 0.996073, 0.996089, 0.996104, 0.996119, 0.996134, 0.996148, 0.996162, 0.996176,
  0.996189, 0.996203, 0.996216, 0.99623, 0.996243, 0.996257, 0.99627, 0.996283, 0.996296, 0.996309,
  0.996321, 0.996334, 0.996346, 0.996359, 0.996371, 0.996383, 0.996396, 0.996408, 0.99642, 0.996432,
  0.996444, 0.996456, 0.996467, 0.996479, 0.996491, 0.996502, 0.996514, 0.996526, 0.996538, 0.996551,
  0.996564, 0.996578, 0.996592, 0.996608, 0.996623, 0.996639, 0.996655, 0.996671, 0.996687, 0.996702,
  0.996717, 0.996731, 0.996744, 0.996758, 0.996772, 0.996786, 0.996801, 0.996816, 0.996831, 0.996846,
  0.996861, 0.996875, 0.996889, 0.996902, 0.996914, 0.996925, 0.996937, 0.996949, 0.99696, 0.996972,
  0.996984, 0.996995, 0.997006, 0.997016, 0.997026, 0.997036, 0.997045, 0.997053, 0.997061, 0.997069,
  0.997077, 0.997085, 0.997093, 0.997101, 0.997108, 0.997115, 0.997121, 0.997127, 0.997132, 0.997136,
  0.99714, 0.997143, 0.997146, 0.997149, 0.997152, 0.997154, 0.997156, 0.997157, 0.997158, 0.997159,
  0.997159, 0.997159, 0.997159, 0.997158, 0.997157, 0.997155, 0.997153, 0.997151, 0.997149, 0.997146,
  0.997143, 0.997139, 0.997135, 0.99713, 0.997126, 0.99712, 0.997115, 0.997109, 0.997102, 0.997095,
  0.997088, 0.997081, 0.997073, 0.997065, 0.997056, 0.997047, 0.997037, 0.997028, 0.997017, 0.997007,
  0.996996, 0.996985, 0.996973, 0.996961, 0.996948, 0.996935, 0.996922, 0.996908, 0.996894, 0.99688,
] as const

const NON_CV_BASELINE_WOMEN = [
  0.998331, 0.998301, 0.99827, 0.998238, 0.998206, 0.998174, 0.998141, 0.998107, 0.998073, 0.998038,
  0.998002, 0.997966, 0.997929, 0.997891, 0.997853, 0.997814, 0.997774, 0.997734, 0.997693, 0.997651,
  0.997608, 0.997565, 0.99752, 0.997475, 0.99743, 0.997383, 0.997335, 0.997287, 0.997238, 0.997188,
  0.997137, 0.997085, 0.997032, 0.996978, 0.996923, 0.996867, 0.99681, 0.996752, 0.996693, 0.996633,
  0.996572, 0.99651, 0.996446, 0.996382, 0.996316, 0.996249, 0.996181, 0.996112, 0.996041, 0.995969,
  0.995896, 0.995822, 0.995746, 0.995669, 0.99559, 0.99551, 0.995428, 0.995345, 0.995261, 0.995175,
  0.995087, 0.994998, 0.994907, 0.994815, 0.994721, 0.994625, 0.994527, 0.994428, 0.994327, 0.994224,
  0.994119, 0.994012, 0.993903, 0.993793, 0.99368, 0.993565, 0.993448, 0.993329, 0.993208, 0.993085,
  0.992959, 0.992832, 0.992701, 0.992569, 0.992434, 0.992297, 0.992157, 0.992014, 0.991869, 0.991722,
  0.991571, 0.991418, 0.991263, 0.991104, 0.990942, 0.990778, 0.990611, 0.99044, 0.990266, 0.99009,
  0.98991, 0.989727, 0.98954, 0.98935, 0.989157, 0.98896, 0.988759, 0.988555, 0.988348, 0.988136,
  0.987921, 0.987701, 0.987478, 0.987251, 0.987019, 0.986783, 0.986543, 0.986299, 0.98605, 0.985797,
  0.985539, 0.985277, 0.985009, 0.984737, 0.98446, 0.984178, 0.983891, 0.983598, 0.9833, 0.982997,
  0.982688, 0.982374, 0.982054, 0.981728, 0.981397, 0.981059, 0.980715, 0.980365, 0.980008, 0.979645,
  0.979276, 0.978899, 0.978516, 0.978126, 0.977729, 0.977325, 0.976913, 0.976494, 0.976067, 0.975632,
  0.97519, 0.97474, 0.974281, 0.973814, 0.973339, 0.972854, 0.972362, 0.97186, 0.971349, 0.970829,
  0.970299, 0.96976, 0.969211, 0.968652, 0.968082, 0.967503, 0.966913, 0.966312, 0.965701, 0.965078,
  0.964444, 0.963798, 0.963141, 0.962472, 0.96179, 0.961096, 0.96039, 0.959671, 0.958939, 0.958193,
  0.957434, 0.956661, 0.955874, 0.955073, 0.954258, 0.953427, 0.952581, 0.95172, 0.950844, 0.949951,
  0.949043, 0.948117, 0.947175, 0.946216, 0.94524, 0.944246, 0.943233, 0.942203, 0.941153, 0.940085,
] as const

const NON_CV_BASELINE_MEN = [
  0.998386, 0.998351, 0.998316, 0.99828, 0.998243, 0.998205, 0.998167, 0.998127, 0.998087, 0.998046,
  0.998004, 0.997962, 0.997918, 0.997873, 0.997828, 0.997781, 0.997734, 0.997685, 0.997636, 0.997585,
  0.997533, 0.99748, 0.997426, 0.997371, 0.997315, 0.997257, 0.997198, 0.997138, 0.997077, 0.997014,
  0.996951, 0.996885, 0.996818, 0.99675, 0.996681, 0.996609, 0.996537, 0.996463, 0.996387, 0.996309,
  0.99623, 0.996149, 0.996067, 0.995983, 0.995897, 0.995809, 0.995719, 0.995627, 0.995533, 0.995438,
  0.99534, 0.99524, 0.995138, 0.995034, 0.994927, 0.994819, 0.994708, 0.994594, 0.994478, 0.99436,
  0.994239, 0.994116, 0.99399, 0.993861, 0.993729, 0.993595, 0.993458, 0.993318, 0.993174, 0.993028,
  0.992879, 0.992726, 0.99257, 0.992411, 0.992248, 0.992082, 0.991913, 0.991739, 0.991562, 0.991381,
  0.991197, 0.991008, 0.990815, 0.990619, 0.990417, 0.990212, 0.990002, 0.989788, 0.989569, 0.989346,
  0.989117, 0.988884, 0.988646, 0.988403, 0.988154, 0.9879, 0.987641, 0.987376, 0.987106, 0.986829,
  0.986547, 0.986259, 0.985964, 0.985664, 0.985356, 0.985043, 0.984722, 0.984395, 0.98406, 0.983719,
  0.98337, 0.983013, 0.982649, 0.982278, 0.981898, 0.98151, 0.981114, 0.980709, 0.980296, 0.979873,
  0.979442, 0.979001, 0.978551, 0.978092, 0.977622, 0.977143, 0.976653, 0.976153, 0.975642, 0.97512,
  0.974587, 0.974042, 0.973486, 0.972917, 0.972337, 0.971744, 0.971139, 0.97052, 0.969889, 0.969243,
  0.968584, 0.967911, 0.967223, 0.966521, 0.965804, 0.965071, 0.964322, 0.963558, 0.962777, 0.961979,
  0.961164, 0.960332, 0.959482, 0.958614, 0.957727, 0.956821, 0.955896, 0.954951, 0.953985, 0.952999,
  0.951992, 0.950963, 0.949912, 0.948839, 0.947743, 0.946623, 0.945479, 0.94431, 0.943117, 0.941898,
  0.940653, 0.939381, 0.938082, 0.936755, 0.9354, 0.934016, 0.932602, 0.931157, 0.929682, 0.928175,
  0.926636, 0.925064, 0.923458, 0.921818, 0.920142, 0.918431, 0.916683, 0.914898, 0.913074, 0.911211,
  0.909309, 0.907365, 0.90538, 0.903352, 0.901281, 0.899166, 0.897005, 0.894798, 0.892543, 0.890241,
] as const

export interface LifePredictors {
  age: number
  sex: 'male' | 'female'
  diabetes: boolean
  smoker: boolean
  priorHfHospitalization: boolean
  recentHfHospitalization: boolean
  copd: boolean
  atrialFibrillation: boolean
  nyhaHigh: boolean
  ischemicHeartDisease: boolean
  ntProBnp: number
  bmi: number
  heartRate: number
  hemoglobinMmolL: number
  egfr: number
}

export interface LifePreservedEstimate {
  ageAtStart: number
  twoYearRisk?: number
  tenYearRisk?: number
  lifetimeRisk: number
  lifetimeNonCvRisk: number
  survivalTo90: number
  medianEventFreeAge?: number
}

function lifeLinearPredictors(p: LifePredictors, ageVector: number, firstYear: boolean) {
  const d = p.diabetes ? 1 : 0
  const s = p.smoker ? 1 : 0
  const nyha = p.nyhaHigh ? 1 : 0
  const copd = p.copd ? 1 : 0
  const prior = p.priorHfHospitalization ? 1 : 0
  const ihd = p.ischemicHeartDisease ? 1 : 0
  const af = p.atrialFibrillation ? 1 : 0
  const recent = p.recentHfHospitalization && firstYear ? 1 : 0
  const logNt = Math.log(p.ntProBnp) - Math.log(1250)
  const bmi1 = p.bmi - 25, bmi2 = p.bmi ** 2 - 25 ** 2, bmi3 = p.bmi ** 3 - 25 ** 3
  const hr1 = p.heartRate - 80, hr2 = p.heartRate ** 2 - 80 ** 2
  const egfr1 = p.egfr - 65, egfr2 = p.egfr ** 2 - 65 ** 2
  const hb1 = p.hemoglobinMmolL - 8, hb2 = p.hemoglobinMmolL ** 2 - 8 ** 2
  if (p.sex === 'female') {
    return {
      hfhCv: 0.72502722807 * recent + 0.04772439010 * (p.age - 40) + 1.64364704252 * d + 0.14672305231 * s
        + 0.23991524942 * logNt - 0.22020535287 * bmi1 + 0.00642547860 * bmi2 - 0.00005586338 * bmi3
        + 0.00852461199 * hr1 - 0.00004003875 * hr2 - 0.01209077516 * egfr1 + 0.00004952883 * egfr2
        - 0.62508756234 * hb1 + 0.03637319680 * hb2 + 0.21895731862 * nyha + 0.26588488439 * copd
        + 0.31854162088 * prior + 0.17906151258 * ihd + 0.18726322701 * af - 0.01744246329 * ageVector * d
        - Math.log(1.014965),
      nonCv: 0.2322771358 * recent - 0.0308672516 * (p.age - 40) + 0.2999288430 * d - 0.0395281553 * s
        + 0.2278187543 * logNt - 0.4714866682 * bmi1 + 0.0128711280 * bmi2 - 0.0001148799 * bmi3
        + 0.0253361734 * hr1 - 0.0001102053 * hr2 - 0.0279838659 * egfr1 + 0.0001939482 * egfr2
        - 2.0944659127 * hb1 + 0.1269888188 * hb2 + 0.3170897239 * nyha + 0.7196992131 * copd
        + 0.1343886560 * prior - 0.1464743725 * ihd - 0.1559688553 * af - Math.log(1.266831),
    }
  }
  return {
    hfhCv: 0.6767350532 * recent + 0.0457477942 * (p.age - 40) + 1.8095133714 * d + 0.1716017798 * s
      + 0.2512267882 * logNt - 0.3829380460 * bmi1 + 0.0114835523 * bmi2 - 0.0001044225 * bmi3
      + 0.0343981661 * hr1 - 0.0001983146 * hr2 - 0.0215315853 * egfr1 + 0.0001617259 * egfr2
      - 0.1787339966 * hb1 + 0.0061575399 * hb2 + 0.2893729126 * nyha + 0.2815851231 * copd
      + 0.3225854802 * prior + 0.1423570674 * ihd + 0.1507078243 * af - 0.0211031719 * ageVector * d
      - Math.log(1.002295),
    nonCv: 0.23080253030 * recent - 0.03468837243 * (p.age - 40) + 0.22736100293 * d + 0.25986173405 * s
      + 0.17940598574 * logNt - 0.74924785030 * bmi1 + 0.02127465160 * bmi2 - 0.00019593651 * bmi3
      + 0.02151364444 * hr1 - 0.00009378628 * hr2 - 0.03923164143 * egfr1 + 0.00035508272 * egfr2
      - 0.35862433394 * hb1 + 0.01268086278 * hb2 + 0.25793839765 * nyha + 0.56385822436 * copd
      + 0.20310848262 * prior - 0.15051652463 * ihd - 0.11082222298 * af - Math.log(1.232154),
  }
}

/** Reitsma 2026 Supplementary Methods lifetable, with non-CV death competing risk. */
export function calculateLifePreserved(p: LifePredictors): LifePreservedEstimate | null {
  const continuous = [p.age, p.ntProBnp, p.bmi, p.heartRate, p.hemoglobinMmolL, p.egfr]
  if (!continuous.every(Number.isFinite) || !Number.isInteger(p.age)) return null
  const ageAtStart = p.age
  if (ageAtStart < 40 || ageAtStart > 89 || p.ntProBnp <= 0 || p.ntProBnp > 20_000
    || p.bmi < 18 || p.bmi > 55 || p.heartRate < 40 || p.heartRate > 120
    || p.hemoglobinMmolL < 3 || p.hemoglobinMmolL > 11 || p.egfr < 15 || p.egfr > 90) return null
  const hfhBaseline = p.sex === 'female' ? HFH_CV_BASELINE_WOMEN : HFH_CV_BASELINE_MEN
  const nonCvBaseline = p.sex === 'female' ? NON_CV_BASELINE_WOMEN : NON_CV_BASELINE_MEN
  const startIndex = Math.round((ageAtStart - 40) * 4)
  let eventFree = 1
  let hfhCvRisk = 0
  let nonCvRisk = 0
  let twoYearRisk: number | undefined
  let tenYearRisk: number | undefined
  let medianEventFreeAge: number | undefined
  for (let i = startIndex; i < 200; i += 1) {
    const ageVector = 40 + i / 4
    const lp = lifeLinearPredictors(p, ageVector, i - startIndex < 4)
    const hfhSurvival = hfhBaseline[i] ** Math.exp(lp.hfhCv)
    const nonCvSurvival = nonCvBaseline[i] ** Math.exp(lp.nonCv)
    const hfhIntervalRisk = 1 - hfhSurvival
    const nonCvIntervalRisk = 1 - nonCvSurvival
    const intervalSurvival = 1 - hfhIntervalRisk - nonCvIntervalRisk
    if (intervalSurvival <= 0 || intervalSurvival > 1) return null
    const before = eventFree
    hfhCvRisk += before * hfhIntervalRisk
    nonCvRisk += before * nonCvIntervalRisk
    eventFree = before * intervalSurvival
    const elapsedQuarters = i - startIndex + 1
    if (elapsedQuarters === 8) twoYearRisk = hfhCvRisk
    if (elapsedQuarters === 40) tenYearRisk = hfhCvRisk
    if (medianEventFreeAge === undefined && before >= .5 && eventFree < .5) {
      const fraction = (before - .5) / (before - eventFree)
      medianEventFreeAge = ageVector + .25 * fraction
    }
  }
  return { ageAtStart, twoYearRisk, tenYearRisk, lifetimeRisk: hfhCvRisk, lifetimeNonCvRisk: nonCvRisk, survivalTo90: eventFree, medianEventFreeAge }
}

function lifePredictors(v: CalcValues): LifePredictors | null {
  const age = n(v, 'age'), ntProBnp = n(v, 'ntprobnp'), bmi = n(v, 'bmi'), heartRate = n(v, 'heartRate')
  const hemoglobinGdl = n(v, 'hemoglobin'), egfr = n(v, 'egfr'), lvef = n(v, 'lvef')
  const sex = requireSex(v)
  if (age === undefined || ntProBnp === undefined || bmi === undefined || heartRate === undefined || hemoglobinGdl === undefined || egfr === undefined || lvef === undefined || !sex) return null
  if (lvef < 50 || lvef > 100) return null
  if (!choicesComplete(v, ['priorReducedLvef', 'diabetes', 'smoker', 'copd', 'af', 'ihd']) || v.priorReducedLvef === 'yes') return null
  if (!['low', 'high'].includes(v.nyha) || !['never', 'prior', 'recent'].includes(v.hfHospitalization)) return null
  return {
    age, sex, ntProBnp, bmi, heartRate, egfr,
    hemoglobinMmolL: hemoglobinGdl / 1.6113,
    diabetes: v.diabetes === 'yes', smoker: v.smoker === 'yes', copd: v.copd === 'yes',
    atrialFibrillation: v.af === 'yes', ischemicHeartDisease: v.ihd === 'yes', nyhaHigh: v.nyha === 'high',
    priorHfHospitalization: v.hfHospitalization !== 'never', recentHfHospitalization: v.hfHospitalization === 'recent',
  }
}

export const HEART_FAILURE_PROGNOSIS: CalculatorDef[] = [{
  id: 'maggic-hf',
  name: label('MAGGIC Heart Failure Risk Score', 'MAGGIC 心衰竭預後分數'),
  category: 'cardiac',
  blurb: label('1- and 3-year all-cause mortality in stable chronic heart failure.', '穩定慢性心衰竭之 1 年與 3 年全因死亡率。'),
  inputs: [
    AGE_INPUT,
    SEX_INPUT,
    { key: 'lvef', type: 'number', label: label('Left ventricular ejection fraction', '左心室射出分率'), unit: '%', source: { kind: 'echo', key: 'lvef' } },
    { key: 'nyha', type: 'select', source: { kind: 'hfpefClinical', key: 'nyha' }, label: label('NYHA functional class', 'NYHA 功能分級'), defaultValue: '', options: [
      { value: '1', label: label('Class I', '第 I 級') }, { value: '2', label: label('Class II', '第 II 級') },
      { value: '3', label: label('Class III', '第 III 級') }, { value: '4', label: label('Class IV', '第 IV 級') },
    ] },
    { key: 'creatinine', type: 'number', label: label('Serum creatinine', '血清肌酸酐'), unit: 'mg/dL', dimension: 'creatinine', source: { kind: 'lab', keys: ['CREATININE', 'CREA'] } },
    { ...yesNo('diabetes', 'Diabetes mellitus', '糖尿病'), source: { kind: 'hfpefClinical', key: 'diabetes' } },
    { ...yesNo('betaBlocker', 'Currently prescribed a beta-blocker', '目前使用 β 阻斷劑'), source: { kind: 'hfpefClinical', key: 'betaBlocker' } },
    { key: 'sbp', type: 'number', label: label('Systolic blood pressure', '收縮壓'), unit: 'mmHg', source: { kind: 'vital', loinc: ['8480-6'], vital: 'sbp' } },
    { key: 'bmi', type: 'number', label: label('Body mass index', '身體質量指數'), unit: 'kg/m²', source: { kind: 'bmi' } },
    yesNo('hfDuration', 'Heart failure first diagnosed ≥18 months ago', '心衰竭初次診斷已 ≥18 個月'),
    yesNo('smoker', 'Current smoker', '目前吸菸'),
    { ...yesNo('copd', 'Chronic obstructive pulmonary disease', '慢性阻塞性肺病'), source: { kind: 'hfpefClinical', key: 'copd' } },
    { ...yesNo('aceiArb', 'Currently prescribed an ACEI or ARB', '目前使用 ACEI 或 ARB'), source: { kind: 'hfpefClinical', key: 'aceiArb' } },
  ],
  coherence: { keys: ['lvef', 'creatinine', 'sbp', 'bmi'], windowDays: 180 },
  compute(v) {
    const estimate = calculateMaggic(v)
    if (!estimate) return null
    const hasRiskLookup = estimate.oneYearRisk !== undefined && estimate.threeYearRisk !== undefined
    return {
      value: `${estimate.score}`,
      unit: 'pts',
      interpretation: hasRiskLookup ? label('Estimated all-cause mortality', '估計全因死亡率') : label('Score exceeds the published probability table', '分數超出原始論文機率表'),
      extra: [
        { label: label('1-year all-cause mortality', '1 年全因死亡率'), value: estimate.oneYearRisk === undefined ? '—' : pct(estimate.oneYearRisk) },
        { label: label('3-year all-cause mortality', '3 年全因死亡率'), value: estimate.threeYearRisk === undefined ? '—' : pct(estimate.threeYearRisk) },
        ...estimate.components.map((item) => ({ label: item.label, value: `+${item.points}` })),
      ],
      notes: hasRiskLookup
        ? label('Use at a stable point in chronic HF. This estimate supports prognosis discussion; it does not replace clinical assessment or determine treatment by itself.', '適用於慢性心衰竭的穩定期。此估計用於預後討論，不能取代臨床評估，也不能單獨決定治療。')
        : label('The original Table 4 reports probabilities only for scores 0–50; the score is shown without extrapolating or silently capping its risk.', '原始 Table 4 僅公布 0–50 分的機率；此處保留實際分數，不外推也不將風險偷偷截斷在 50 分。'),
    }
  },
  reference: 'Pocock SJ et al. Eur Heart J. 2013;34:1404–1413. doi:10.1093/eurheartj/ehs337 (Figure 2; Table 4).',
}, {
  id: 'life-preserved',
  name: label('LIFE-Preserved', 'LIFE‑Preserved'),
  category: 'cardiac',
  blurb: label('Short-term and lifetime risk of first HF hospitalization or cardiovascular death in HFpEF.', 'HFpEF 首次心衰住院或心血管死亡之短期與終生風險。'),
  inputs: [
    AGE_INPUT,
    SEX_INPUT,
    { key: 'lvef', type: 'number', label: label('Current LVEF (eligibility)', '目前 LVEF（適用條件）'), unit: '%', source: { kind: 'echo', key: 'lvef' } },
    yesNo('priorReducedLvef', 'Any previously documented LVEF <50%', '過去是否曾記錄 LVEF <50%'),
    { ...yesNo('diabetes', 'Diabetes mellitus', '糖尿病'), source: { kind: 'hfpefClinical', key: 'diabetes' } },
    yesNo('smoker', 'Current smoker', '目前吸菸'),
    { key: 'hfHospitalization', type: 'select', label: label('Previous HF hospitalization', '過去心衰竭住院'), defaultValue: '', options: [
      { value: 'never', label: label('Never', '無') },
      { value: 'prior', label: label('Yes, but not within 6 months', '有，但非近 6 個月內') },
      { value: 'recent', label: label('Yes, within the past 6 months', '有，且在近 6 個月內') },
    ] },
    yesNo('copd', 'Chronic obstructive pulmonary disease', '慢性阻塞性肺病'),
    yesNo('af', 'Atrial fibrillation', '心房顫動'),
    { key: 'nyha', type: 'select', label: label('NYHA functional class', 'NYHA 功能分級'), defaultValue: '', options: [
      { value: 'low', label: label('Class I or II', '第 I 或 II 級') },
      { value: 'high', label: label('Class III or IV', '第 III 或 IV 級') },
    ] },
    yesNo('ihd', 'Ischemic heart disease', '缺血性心臟病'),
    { key: 'ntprobnp', type: 'number', label: label('NT-proBNP'), unit: 'pg/mL', source: { kind: 'natriuretic', assay: 'NT-PROBNP' } },
    { key: 'bmi', type: 'number', label: label('Body mass index', '身體質量指數'), unit: 'kg/m²', source: { kind: 'bmi' } },
    { key: 'heartRate', type: 'number', label: label('Heart rate', '心率'), unit: 'bpm', source: { kind: 'vital', loinc: ['8867-4'] } },
    { key: 'hemoglobin', type: 'number', label: label('Hemoglobin', '血色素'), unit: 'g/dL', dimension: 'hemoglobin', source: { kind: 'lab', keys: ['HB', 'HEMOGLOBIN'] } },
    { key: 'egfr', type: 'number', label: label('eGFR (CKD-EPI 2009 in derivation)', 'eGFR（衍生研究採 CKD-EPI 2009）'), unit: 'mL/min/1.73m²', source: { kind: 'lab', keys: ['EGFR(EPI)'] } },
  ],
  coherence: { keys: ['lvef', 'ntprobnp', 'bmi', 'heartRate', 'hemoglobin', 'egfr'], windowDays: 180 },
  compute(v) {
    const predictors = lifePredictors(v)
    if (!predictors) return null
    const estimate = calculateLifePreserved(predictors)
    if (!estimate) return null
    const headline = estimate.twoYearRisk ?? estimate.lifetimeRisk
    const horizon = estimate.twoYearRisk === undefined ? label('Risk through age 90', '至 90 歲風險') : label('2-year risk', '2 年風險')
    return {
      value: pct(headline),
      interpretation: label(`${horizon.en} of HF hospitalization or CV death`, `${horizon.zh}：心衰住院或心血管死亡`),
      extra: [
        { label: label('2-year risk', '2 年風險'), value: estimate.twoYearRisk === undefined ? '—' : pct(estimate.twoYearRisk) },
        { label: label('10-year risk', '10 年風險'), value: estimate.tenYearRisk === undefined ? '—' : pct(estimate.tenYearRisk) },
        { label: label('Risk through age 90', '至 90 歲風險'), value: pct(estimate.lifetimeRisk) },
        { label: label('Competing non-CV death risk through age 90', '至 90 歲非心血管死亡競爭風險'), value: pct(estimate.lifetimeNonCvRisk) },
        { label: label('Event-free survival at age 90', '90 歲時無事件存活率'), value: pct(estimate.survivalTo90) },
        { label: label('Age at 50% event-free survival', '無事件存活率降至 50% 的年齡'), value: estimate.medianEventFreeAge === undefined ? '≥90 y' : `${round(estimate.medianEventFreeAge, 1)} y` },
      ],
      notes: label('For confirmed HFpEF with current and all prior documented LVEF ≥50%, completed age 40–89. Inputs outside the author calculator’s supported ranges are not extrapolated. SwedeHF baseline risks are used without local recalibration; predictions account for competing non-CV death. Investigational prognosis support only—not a medical device or treatment recommendation.', '僅適用於已確認 HFpEF、目前及過去所有已記錄 LVEF 均 ≥50%、完成歲數 40–89 歲者。超出作者計算機支援範圍的輸入不予外推。採 SwedeHF 基準風險且未做台灣在地校正，並納入非心血管死亡競爭風險。僅供研究性預後輔助；不是醫療器材或治療建議。'),
    }
  },
  reference: 'Reitsma TH et al. Eur Heart J. 2026;47:4773–4788. doi:10.1093/eurheartj/ehag182 (Supplementary Tables S7–S8).',
}]
