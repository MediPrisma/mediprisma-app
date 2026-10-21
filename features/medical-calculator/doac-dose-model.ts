/**
 * DOAC dose for non-valvular atrial fibrillation by each agent's label — the
 * label rules the AF CDSS deliberately does not hold (it follows ESC 2024
 * Table 11 and ACC/AHA 2023, and sends what they do not settle here).
 *
 * Every rule quotes the EU SmPC (EMA product information) it comes from, with
 * section and physical PDF page, so a pharmacist can disagree with one row.
 * The Taiwan labels are taken to follow the EU SmPC unless a difference is
 * known; the known and the unverified ones are listed in `TAIWAN_LABEL_CHECKS`
 * and shown with every result. Owner decision 2026-10-21: CDSS = guideline,
 * label rules = this calculator, opened from the AF dose point (DP-09); the
 * result never changes a CDSS recommendation.
 *
 * Scope: adult NVAF only. VTE treatment and prophylaxis, peri-procedural
 * interruption and paediatric dosing are not computed.
 */
import type { CalcValues, L } from './types'

export type DoacAgent = 'apixaban' | 'rivaroxaban' | 'edoxaban' | 'dabigatran'
export const DOAC_AGENTS: readonly DoacAgent[] = ['apixaban', 'rivaroxaban', 'edoxaban', 'dabigatran']

/** The label document a quotation is read from. */
export interface LabelSource {
  agent: DoacAgent
  title: string
  url: string
  /** The dates the document itself prints; its 「Date of revision」 is blank. */
  dates: string
  /** The product-information file the pages were read from (EMA PDF metadata date). */
  fileDate: string
}

export const LABEL_SOURCES: Record<DoacAgent, LabelSource> = {
  apixaban: {
    agent: 'apixaban',
    title: 'Eliquis 5 mg film-coated tablets — EU SmPC (EMA product information)',
    url: 'https://www.ema.europa.eu/en/documents/product-information/eliquis-epar-product-information_en.pdf',
    dates: 'First authorisation 18 May 2011; latest renewal 11 January 2021',
    fileDate: '2026-03-26',
  },
  rivaroxaban: {
    agent: 'rivaroxaban',
    title: 'Xarelto 20 mg film-coated tablets — EU SmPC (EMA product information)',
    url: 'https://www.ema.europa.eu/en/documents/product-information/xarelto-epar-product-information_en.pdf',
    dates: 'First authorisation 30 September 2008; latest renewal 22 May 2018',
    fileDate: '2026-08-07',
  },
  edoxaban: {
    agent: 'edoxaban',
    title: 'Lixiana film-coated tablets — EU SmPC (EMA product information)',
    url: 'https://www.ema.europa.eu/en/documents/product-information/lixiana-epar-product-information_en.pdf',
    dates: 'First authorisation 19 June 2015; latest renewal 24 February 2020',
    fileDate: '2025-05-14',
  },
  dabigatran: {
    agent: 'dabigatran',
    title: 'Pradaxa 110 mg / 150 mg hard capsules — EU SmPC (EMA product information)',
    url: 'https://www.ema.europa.eu/en/documents/product-information/pradaxa-epar-product-information_en.pdf',
    dates: 'First authorisation 18 March 2008; latest renewal 08 January 2018',
    fileDate: '2025-10-09',
  },
}

/** Raise whenever a rule, a quotation or a source document changes. */
export const DOAC_RULES_VERSION = 'eu-smpc-nvaf-2026-10-21'

export interface LabelCite {
  agent: DoacAgent
  section: string
  /** Physical page of the EMA product-information PDF. */
  page: number
  quote: string
}

const cite = (agent: DoacAgent, section: string, page: number, quote: string): LabelCite => ({ agent, section, page, quote })

/**
 * Every quotation the rules print, by id. Copied from the EMA PDFs page by
 * page; `__tests__/.../doac-dose-model.test.ts` keeps each one verbatim-shaped,
 * and the source check in docs/DOAC-DOSE-CALCULATOR.md re-reads them off the pages.
 */
export const CITES = {
  apixabanDose: cite('apixaban', '4.2', 36, 'The recommended dose of apixaban is 5 mg taken orally twice daily.'),
  apixabanReduce: cite('apixaban', '4.2', 36, 'The recommended dose of apixaban is 2.5 mg taken orally twice daily in patients with NVAF and at least two of the following characteristics: age ≥ 80 years, body weight ≤ 60 kg, or serum creatinine ≥ 1.5 mg/dL (133 micromole/L).'),
  apixabanSevereRenal: cite('apixaban', '4.2', 38, 'for the prevention of stroke and systemic embolism in patients with NVAF, patients should receive the lower dose of apixaban 2.5 mg twice daily.'),
  apixabanEsrd: cite('apixaban', '4.2', 38, 'In patients with creatinine clearance < 15 mL/min, or in patients undergoing dialysis, there is no clinical experience therefore apixaban is not recommended'),
  apixabanLiverCoag: cite('apixaban', '4.3', 40, 'Hepatic disease associated with coagulopathy and clinically relevant bleeding risk'),
  apixabanLiverSevere: cite('apixaban', '4.2', 38, 'It is not recommended in patients with severe hepatic impairment'),
  apixabanLiverMild: cite('apixaban', '4.2', 39, 'It should be used with caution in patients with mild or moderate hepatic impairment (Child Pugh A or B). No dose adjustment is required in patients with mild or moderate hepatic impairment'),
  apixabanEnzymes: cite('apixaban', '4.2', 39, 'Therefore Eliquis should be used with caution in this population'),
  apixabanDualInhibitor: cite('apixaban', '4.4', 44, 'The use of apixaban is not recommended in patients receiving concomitant systemic treatment with strong inhibitors of both CYP3A4 and P-gp, such as azole-antimycotics (e.g., ketoconazole, itraconazole, voriconazole and posaconazole) and HIV protease inhibitors (e.g., ritonavir).'),
  apixabanLessPotent: cite('apixaban', '4.5', 45, 'No dose adjustment for apixaban is required when coadministered with agents that are not strong inhibitors of both CYP3A4 and P-gp.'),
  apixabanInducer: cite('apixaban', '4.4', 44, 'for the prevention of stroke and systemic embolism in patients with NVAF and for the prevention of recurrent DVT and PE, apixaban should be used with caution;'),
  apixabanAnticoagulant: cite('apixaban', '4.3', 40, 'Concomitant treatment with any other anticoagulant agent'),
  apixabanPregnancy: cite('apixaban', '4.6', 47, 'As a precautionary measure, it is preferable to avoid the use of apixaban during pregnancy.'),

  rivaroxabanDose: cite('rivaroxaban', '4.2', 86, 'The recommended dose is 20 mg once daily, which is also the recommended maximum dose.'),
  rivaroxabanRenal: cite('rivaroxaban', '4.2', 89, 'For the prevention of stroke and systemic embolism in patients with non-valvular atrial fibrillation, the recommended dose is 15 mg once daily'),
  rivaroxabanRenalBands: cite('rivaroxaban', '4.2', 88, 'In patients with moderate (creatinine clearance 30 - 49 ml/min) or severe (creatinine clearance 15 - 29 ml/min) renal impairment the following dose recommendations apply:'),
  rivaroxabanSevereRenal: cite('rivaroxaban', '4.2', 88, 'Therefore, Xarelto is to be used with caution in these patients. Use is not recommended in patients with creatinine clearance < 15 ml/min'),
  rivaroxabanDialysis: cite('rivaroxaban', '4.9', 101, 'Due to the high plasma protein binding rivaroxaban is not expected to be dialysable.'),
  rivaroxabanLiver: cite('rivaroxaban', '4.3', 90, 'Hepatic disease associated with coagulopathy and clinically relevant bleeding risk including cirrhotic patients with Child Pugh B and C'),
  rivaroxabanAzole: cite('rivaroxaban', '4.4', 91, 'The use of Xarelto is not recommended in patients receiving concomitant systemic treatment with azole-antimycotics (such as ketoconazole, itraconazole, voriconazole and posaconazole) or HIV protease inhibitors (e.g. ritonavir).'),
  rivaroxabanDronedarone: cite('rivaroxaban', '4.5', 94, 'Given the limited clinical data available with dronedarone, co-administration with rivaroxaban should be avoided.'),
  rivaroxabanMacrolide: cite('rivaroxaban', '4.5', 94, 'The interaction with erythromycin is likely not clinically relevant in most patients but can be potentially significant in high-risk patients.'),
  rivaroxabanRenalInteraction: cite('rivaroxaban', '4.4', 91, 'Xarelto should be used with caution in patients with renal impairment concomitantly receiving other medicinal products which increase rivaroxaban plasma concentrations'),
  rivaroxabanInducer: cite('rivaroxaban', '4.5', 95, 'Therefore, concomitant administration of strong CYP3A4 inducers should be avoided unless the patient is closely observed for signs and symptoms of thrombosis.'),
  rivaroxabanAnticoagulant: cite('rivaroxaban', '4.3', 90, 'Concomitant treatment with any other anticoagulants'),
  rivaroxabanPregnancy: cite('rivaroxaban', '4.3', 90, 'Pregnancy and breast-feeding'),
  rivaroxabanFood: cite('rivaroxaban', '4.2', 90, 'The tablets are to be taken with food'),

  edoxabanDose: cite('edoxaban', '4.2', 3, 'The recommended dose is 60 mg edoxaban once daily.'),
  edoxabanReduce: cite('edoxaban', '4.2', 3, 'For NVAF and VTE the recommended dose is 30 mg edoxaban once daily in patients with one or more of the following clinical factors:'),
  edoxabanEsrd: cite('edoxaban', '4.2', 6, 'In patients with end stage renal disease (ESRD) (CrCl < 15 mL/min) or on dialysis, the use of edoxaban is not recommended'),
  edoxabanHighCrcl: cite('edoxaban', '4.4', 9, 'Edoxaban should be used in patients with NVAF and high CrCl only after a careful evaluation of the individual thromboembolic and bleeding risk.'),
  edoxabanLiverCoag: cite('edoxaban', '4.3', 7, 'Hepatic disease associated with coagulopathy and clinically relevant bleeding risk.'),
  edoxabanLiverSevere: cite('edoxaban', '4.2', 6, 'In patients with severe hepatic impairment edoxaban is not recommended'),
  edoxabanLiverMild: cite('edoxaban', '4.2', 6, 'Edoxaban should be used with caution in patients with mild to moderate hepatic impairment'),
  edoxabanEnzymes: cite('edoxaban', '4.2', 7, 'Therefore edoxaban should be used with caution in this population'),
  edoxabanNoReduction: cite('edoxaban', '4.2', 7, 'No dose reduction is required for concomitant use of amiodarone, quinidine or verapamil'),
  edoxabanHivPi: cite('edoxaban', '4.2', 7, 'The use of Lixiana with other P-gp inhibitors including HIV protease inhibitors has not been studied.'),
  edoxabanInducer: cite('edoxaban', '4.5', 11, 'Edoxaban should be used with caution when co-administered with P-gp inducers.'),
  edoxabanAnticoagulant: cite('edoxaban', '4.3', 8, 'Concomitant treatment with any other anticoagulants'),
  edoxabanPregnancy: cite('edoxaban', '4.3', 8, 'Pregnancy and breast-feeding'),
  edoxaban15: cite('edoxaban', '4.4', 8, 'Edoxaban 15 mg is not indicated as monotherapy, as it may result in decreased efficacy.'),

  dabigatranDose: cite('dabigatran', '4.2 Table 2', 34, '300 mg dabigatran etexilate taken as one 150 mg capsule twice daily'),
  dabigatranReduce: cite('dabigatran', '4.2 Table 2', 34, 'daily dose of 220 mg dabigatran etexilate taken as one 110 mg capsule twice daily'),
  dabigatranConsider: cite('dabigatran', '4.2 Table 2', 34, 'daily dose of dabigatran etexilate of 300 mg or 220 mg should be selected based on an individual assessment of the thromboembolic risk and the risk of bleeding'),
  dabigatranVerapamil: cite('dabigatran', '4.2', 36, 'In this situation dabigatran etexilate and verapamil should be taken at the same time.'),
  dabigatranRenal: cite('dabigatran', '4.3', 38, 'Severe renal impairment (CrCL < 30 mL/min) in adult patients'),
  dabigatranLiver: cite('dabigatran', '4.3', 39, 'Hepatic impairment or liver disease expected to have any impact on survival'),
  dabigatranEnzymes: cite('dabigatran', '4.4', 43, 'No treatment experience is available for this subpopulation of patients, and therefore the use of dabigatran etexilate is not recommended in this population.'),
  dabigatranPgp: cite('dabigatran', '4.3', 39, 'Concomitant treatment with the following strong P-gp inhibitors: systemic ketoconazole, cyclosporine, itraconazole, dronedarone and the fixed-dose combination glecaprevir/pibrentasvir'),
  dabigatranTacrolimus: cite('dabigatran', '4.5 Table 9', 44, 'Concomitant use not recommended'),
  dabigatranRitonavir: cite('dabigatran', '4.5 Table 9', 46, 'They have not been studied and are therefore not recommended for concomitant treatment with dabigatran etexilate.'),
  dabigatranCaution: cite('dabigatran', '4.4', 40, 'Particular caution should be exercised when dabigatran etexilate is co-administered with verapamil, amiodarone, quinidine or clarithromycin (P-gp inhibitors)'),
  dabigatranPosaconazole: cite('dabigatran', '4.5 Table 9', 45, 'Caution should be exercised when dabigatran etexilate is coadministered with posaconazole.'),
  dabigatranInducer: cite('dabigatran', '4.4', 43, 'Concomitant administration of P-gp inducers is expected to result in decreased dabigatran plasma concentrations, and should be avoided'),
  dabigatranAnticoagulant: cite('dabigatran', '4.3', 39, 'Concomitant treatment with any other anticoagulants'),
  dabigatranPregnancy: cite('dabigatran', '4.6', 48, 'Pradaxa should not be used during pregnancy unless clearly necessary.'),
  dabigatranBreastfeeding: cite('dabigatran', '4.6', 48, 'Breast-feeding should be discontinued during treatment with Pradaxa.'),
  dabigatran75: cite('dabigatran', '4.1 (75 mg)', 2, 'Primary prevention of venous thromboembolic events (VTE) in adult patients who have undergone elective total hip replacement surgery or total knee replacement surgery.'),
} as const satisfies Record<string, LabelCite>

/**
 * What the Taiwan labels are known, or not yet known, to say differently —
 * shown with every result until the pharmacy has read each line off the
 * current Taiwan insert. The calculator does not apply any of them.
 */
export const TAIWAN_LABEL_CHECKS: readonly L[] = [
  {
    zh: '臺灣 Lixiana 仿單（2025 年版）另列高齡、高出血風險者的 edoxaban 15 mg qd 用法；本計算機依 EU SmPC，不判定 15 mg，條件待藥學部依原文核對。',
    en: 'The Taiwan Lixiana insert (2025) adds edoxaban 15 mg qd for elderly patients at high bleeding risk; this calculator follows the EU SmPC and does not judge 15 mg. Conditions pending pharmacy review of the insert.',
  },
  {
    zh: '臺灣 Eliquis 仿單對強效 CYP3A4＋P-gp 雙重抑制劑的寫法（不建議或減量）待藥學部核對。',
    en: 'How the Taiwan Eliquis insert words strong dual CYP3A4 + P-gp inhibitors (not recommended vs dose reduction) is pending pharmacy review.',
  },
  {
    zh: '臺灣 Pradaxa 75 mg 膠囊的適應症待核對；EU SmPC 的 75 mg 不含 NVAF。',
    en: 'The Taiwan indications of Pradaxa 75 mg are pending review; in the EU SmPC 75 mg has no NVAF indication.',
  },
]

/** How strongly a rule bears on an agent; the agent takes its strongest. */
export type DoacLevel = 'contraindicated' | 'not-recommended' | 'avoid' | 'review' | 'caution' | 'dose'
const RANK: Record<DoacLevel, number> = { contraindicated: 5, 'not-recommended': 4, avoid: 3, review: 2, caution: 1, dose: 0 }

export interface DoacRuleHit {
  level: DoacLevel
  text: L
  cite: LabelCite
}

export interface DoacRegimen {
  mg: number
  perDay: 1 | 2
}

export type DoacVerdict =
  /** The label dose (one, or two to choose between). */
  | 'dose'
  | 'contraindicated'
  | 'not-recommended'
  /** The label says to avoid the combination; a dose is still shown. */
  | 'avoid'
  /** The label gives no dose here (dialysis for rivaroxaban, dabigatran's liver wording): the clinician's. */
  | 'review'
  | 'missing'

export interface DoacAgentResult {
  agent: DoacAgent
  verdict: DoacVerdict
  /** The label dose; two for dabigatran's 「dose reduction for consideration」. */
  doses: DoacRegimen[]
  /** Whether the dose given is the agent's reduced one. */
  reduced: boolean
  /** What decided the dose or the verdict, strongest first. */
  hits: DoacRuleHit[]
  /** Inputs the agent's rules still need. */
  missing: string[]
}

export type DoacInputKey =
  | 'age' | 'sex' | 'weight' | 'scr' | 'crcl_manual' | 'dialysis' | 'liver' | 'liver_enzymes' | 'bilirubin_high' | 'regimen' | 'gi_risk' | 'pregnancy'
  | 'ddi_ketoconazole' | 'ddi_itraconazole' | 'ddi_vori_posaconazole' | 'ddi_hiv_pi' | 'ddi_ciclosporin' | 'ddi_tacrolimus'
  | 'ddi_dronedarone' | 'ddi_verapamil' | 'ddi_erythromycin' | 'ddi_clarithromycin' | 'ddi_glecaprevir' | 'ddi_inducer' | 'ddi_anticoagulant'

export interface DoacCrcl {
  value: number
  source: 'cockcroft-gault' | 'manual'
}

/** Cockcroft–Gault with actual body weight, as `crcl-cockcroft-gault` computes it; null without all four inputs. */
export function cockcroftGault(age?: number, weight?: number, scr?: number, sex?: string): number | null {
  if (age === undefined || weight === undefined || scr === undefined || !(scr > 0) || !(weight > 0) || age < 18 || age > 120) return null
  if (sex !== 'male' && sex !== 'female') return null
  return ((140 - age) * weight * (sex === 'female' ? 0.85 : 1)) / (72 * scr)
}

const num = (values: CalcValues, key: string): number | undefined => {
  const raw = values[key]
  if (raw === undefined || raw === '') return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}
const yes = (values: CalcValues, key: DoacInputKey) => values[key] === 'yes'

export function doacCrcl(values: CalcValues): DoacCrcl | null {
  const manual = num(values, 'crcl_manual')
  if (manual !== undefined && manual > 0) return { value: manual, source: 'manual' }
  const computed = cockcroftGault(num(values, 'age'), num(values, 'weight'), num(values, 'scr'), values.sex)
  return computed === null ? null : { value: computed, source: 'cockcroft-gault' }
}

/** A CrCl as compared: the raw value, printed to one decimal where that keeps it on the same side of 15, 30 and 50. */
export function crclLabel(value: number): string {
  const shown = Math.round(value * 10) / 10
  const bands = [15, 30, 50]
  const same = bands.every((band) => (shown < band) === (value < band) && (shown <= band) === (value <= band))
  return same ? shown.toFixed(1) : value.toFixed(2)
}

/**
 * The four agents for these inputs, each by its own label. Pure; every
 * threshold compares the unrounded CrCl. An answer left blank is unknown,
 * never 「no」: it is listed in `missing` where a rule needs it.
 */
export function calculateDoacDoses(values: CalcValues): { crcl: DoacCrcl | null; results: DoacAgentResult[] } {
  const crcl = doacCrcl(values)
  const age = num(values, 'age')
  const weight = num(values, 'weight')
  const scr = num(values, 'scr')
  const c = crcl?.value
  const t = (zh: string, en: string): L => ({ zh, en })
  const crclText = c === undefined ? '' : crclLabel(c)
  const liver = values.liver ?? ''
  const dialysis = values.dialysis ?? ''

  const results = DOAC_AGENTS.map((agent): DoacAgentResult => {
    const hits: DoacRuleHit[] = []
    const missing: string[] = []
    const hit = (level: DoacLevel, text: L, ref: LabelCite) => hits.push({ level, text, cite: ref })
    // A blank answer a rule of this agent reads is unknown, never 「no」: listed
    // to fill, and while any is open the prescription is not called 「一致」.
    const ask = (...keys: DoacInputKey[]) => { for (const key of keys) if ((values[key] ?? '') === '') missing.push(key) }
    let doses: DoacRegimen[] = []
    let reduced = false
    /** An unknown that could change the dose itself: no dose is given. */
    let doseUnknown = false
    ask('ddi_anticoagulant', 'liver', 'pregnancy')

    if (c === undefined) missing.push('CrCl')
    if (dialysis === '') missing.push('dialysis')
    if (yes(values, 'ddi_anticoagulant')) {
      hit('contraindicated', t('併用其他抗凝血劑（轉換、維持導管或消融時的 UFH 除外）', 'Another anticoagulant (except switching, catheter-patency or ablation UFH)'), CITES[`${agent}Anticoagulant`])
    }

    if (agent === 'apixaban') {
      if (dialysis === 'yes') hit('not-recommended', t('透析', 'On dialysis'), CITES.apixabanEsrd)
      if (c !== undefined && c < 15) hit('not-recommended', t(`CrCl ${crclText} <15`, `CrCl ${crclText} <15`), CITES.apixabanEsrd)
      if (liver === 'coag') hit('contraindicated', t('肝病合併凝血異常與臨床出血風險', 'Hepatic disease with coagulopathy and bleeding risk'), CITES.apixabanLiverCoag)
      if (liver === 'C') hit('not-recommended', t('Child-Pugh C（以 severe hepatic impairment 對應）', 'Child-Pugh C (read as severe hepatic impairment)'), CITES.apixabanLiverSevere)
      if (liver === 'A' || liver === 'B') hit('caution', t(`Child-Pugh ${liver}：謹慎使用，不調整劑量`, `Child-Pugh ${liver}: caution, no dose adjustment`), CITES.apixabanLiverMild)
      if (yes(values, 'liver_enzymes') || yes(values, 'bilirubin_high')) hit('caution', t('ALT/AST >2×ULN 或總膽紅素 ≥1.5×ULN：試驗排除，謹慎使用', 'ALT/AST >2×ULN or bilirubin ≥1.5×ULN: excluded from trials, caution'), CITES.apixabanEnzymes)
      ask('ddi_ketoconazole', 'ddi_itraconazole', 'ddi_vori_posaconazole', 'ddi_hiv_pi')
      const dual = (['ddi_ketoconazole', 'ddi_itraconazole', 'ddi_vori_posaconazole', 'ddi_hiv_pi'] as const).filter((key) => yes(values, key))
      if (dual.length) hit('not-recommended', t(`併用強效 CYP3A4＋P-gp 雙重抑制劑（${dual.map(drugName).join('、')}）`, `Strong dual CYP3A4 + P-gp inhibitor (${dual.map(drugName).join(', ')})`), CITES.apixabanDualInhibitor)
      const lesser = (['ddi_clarithromycin', 'ddi_verapamil'] as const).filter((key) => yes(values, key))
      if (lesser.length) hit('caution', t(`${lesser.map(drugName).join('、')}：非強效雙重抑制劑，不調整劑量`, `${lesser.map(drugName).join(', ')}: not a strong dual inhibitor, no dose adjustment`), CITES.apixabanLessPotent)
      if (yes(values, 'ddi_inducer')) hit('caution', t('併用強效 CYP3A4＋P-gp 誘導劑：NVAF 謹慎使用', 'Strong CYP3A4 + P-gp inducer: caution in NVAF'), CITES.apixabanInducer)
      if (values.pregnancy === 'yes') hit('avoid', t('懷孕／哺乳：懷孕時宜避免；哺乳需擇一', 'Pregnancy/breast-feeding: preferably avoided in pregnancy; choose between breast-feeding and therapy'), CITES.apixabanPregnancy)
      if (c !== undefined && c >= 15 && c < 30) {
        doses = [{ mg: 2.5, perDay: 2 }]
        reduced = true
        hit('dose', t(`CrCl ${crclText}（15–29）：2.5 mg bid`, `CrCl ${crclText} (15–29): 2.5 mg bid`), CITES.apixabanSevereRenal)
      } else {
        const criteria = [
          { met: age === undefined ? undefined : age >= 80, zh: `年齡 ${age ?? '—'} ≥80`, en: `age ${age ?? '—'} ≥80`, key: 'age' },
          { met: weight === undefined ? undefined : weight <= 60, zh: `體重 ${weight ?? '—'} kg ≤60`, en: `weight ${weight ?? '—'} kg ≤60`, key: 'weight' },
          { met: scr === undefined ? undefined : scr >= 1.5, zh: `Cr ${scr ?? '—'} ≥1.5`, en: `Cr ${scr ?? '—'} ≥1.5`, key: 'scr' },
        ]
        const met = criteria.filter((item) => item.met === true)
        const unknown = criteria.filter((item) => item.met === undefined)
        if (met.length >= 2) {
          doses = [{ mg: 2.5, perDay: 2 }]
          reduced = true
          hit('dose', t(`3 項中 ${met.length} 項：${met.map((item) => item.zh).join('、')}`, `${met.length} of 3: ${met.map((item) => item.en).join(', ')}`), CITES.apixabanReduce)
        } else if (met.length + unknown.length >= 2) {
          missing.push(...unknown.map((item) => item.key))
        } else {
          doses = [{ mg: 5, perDay: 2 }]
          hit('dose', t(`減量條件 ${met.length}/3，未達 2 項`, `${met.length} of 3 reduction criteria, fewer than 2`), met.length ? CITES.apixabanReduce : CITES.apixabanDose)
        }
      }
    }

    if (agent === 'rivaroxaban') {
      if (c !== undefined && c < 15) hit('not-recommended', t(`CrCl ${crclText} <15`, `CrCl ${crclText} <15`), CITES.rivaroxabanSevereRenal)
      if (dialysis === 'yes') hit('review', t('透析：仿單未給透析劑量（僅述不易被透析清除）', 'On dialysis: the label gives no dialysis dose (only that it is not expected to be dialysable)'), CITES.rivaroxabanDialysis)
      if (liver === 'coag' || liver === 'B' || liver === 'C') hit('contraindicated', t(liver === 'coag' ? '肝病合併凝血異常與臨床出血風險' : `Child-Pugh ${liver} 肝硬化`, liver === 'coag' ? 'Hepatic disease with coagulopathy and bleeding risk' : `Cirrhosis, Child-Pugh ${liver}`), CITES.rivaroxabanLiver)
      ask('ddi_ketoconazole', 'ddi_itraconazole', 'ddi_vori_posaconazole', 'ddi_hiv_pi', 'ddi_dronedarone', 'ddi_inducer')
      const azole = (['ddi_ketoconazole', 'ddi_itraconazole', 'ddi_vori_posaconazole', 'ddi_hiv_pi'] as const).filter((key) => yes(values, key))
      if (azole.length) hit('not-recommended', t(`併用 ${azole.map(drugName).join('、')}`, `With ${azole.map(drugName).join(', ')}`), CITES.rivaroxabanAzole)
      if (yes(values, 'ddi_dronedarone')) hit('avoid', t('併用 dronedarone：應避免', 'With dronedarone: avoid'), CITES.rivaroxabanDronedarone)
      const macrolide = (['ddi_erythromycin', 'ddi_clarithromycin'] as const).filter((key) => yes(values, key))
      if (macrolide.length) {
        hit('caution', t(`併用 ${macrolide.map(drugName).join('、')}：高風險病人可能有臨床意義`, `With ${macrolide.map(drugName).join(', ')}: may matter in high-risk patients`), CITES.rivaroxabanMacrolide)
        if (c !== undefined && c < 80) hit('caution', t(`腎功能不全（CrCl ${crclText}）併用升高濃度的藥物：謹慎`, `Renal impairment (CrCl ${crclText}) with drugs raising exposure: caution`), CITES.rivaroxabanRenalInteraction)
      }
      if (yes(values, 'ddi_inducer')) hit('avoid', t('併用強效 CYP3A4 誘導劑：應避免，除非密切觀察血栓徵候', 'Strong CYP3A4 inducer: avoid unless closely observed for thrombosis'), CITES.rivaroxabanInducer)
      if (values.pregnancy === 'yes') hit('contraindicated', t('懷孕／哺乳', 'Pregnancy/breast-feeding'), CITES.rivaroxabanPregnancy)
      if (c !== undefined && c >= 15) {
        if (c < 50) {
          doses = [{ mg: 15, perDay: 1 }]
          reduced = true
          hit('dose', t(`CrCl ${crclText}（15–49）：15 mg qd，隨餐`, `CrCl ${crclText} (15–49): 15 mg qd with food`), CITES.rivaroxabanRenal)
          if (c < 30) hit('caution', t(`CrCl ${crclText}（15–29）：謹慎使用`, `CrCl ${crclText} (15–29): use with caution`), CITES.rivaroxabanSevereRenal)
        } else {
          doses = [{ mg: 20, perDay: 1 }]
          hit('dose', t('20 mg qd，隨餐', '20 mg qd with food'), CITES.rivaroxabanFood)
        }
      }
    }

    if (agent === 'edoxaban') {
      if (dialysis === 'yes') hit('not-recommended', t('透析', 'On dialysis'), CITES.edoxabanEsrd)
      if (c !== undefined && c < 15) hit('not-recommended', t(`CrCl ${crclText} <15`, `CrCl ${crclText} <15`), CITES.edoxabanEsrd)
      if (liver === 'coag') hit('contraindicated', t('肝病合併凝血異常與臨床出血風險', 'Hepatic disease with coagulopathy and bleeding risk'), CITES.edoxabanLiverCoag)
      if (liver === 'C') hit('not-recommended', t('Child-Pugh C（以 severe hepatic impairment 對應）', 'Child-Pugh C (read as severe hepatic impairment)'), CITES.edoxabanLiverSevere)
      if (liver === 'A' || liver === 'B') hit('caution', t(`Child-Pugh ${liver}：謹慎使用`, `Child-Pugh ${liver}: caution`), CITES.edoxabanLiverMild)
      if (yes(values, 'liver_enzymes') || yes(values, 'bilirubin_high')) hit('caution', t('ALT/AST >2×ULN 或總膽紅素 ≥1.5×ULN：試驗排除，謹慎使用', 'ALT/AST >2×ULN or bilirubin ≥1.5×ULN: excluded from trials, caution'), CITES.edoxabanEnzymes)
      ask('ddi_hiv_pi')
      if (yes(values, 'ddi_hiv_pi')) hit('review', t('併用 HIV protease inhibitor：仿單未研究', 'HIV protease inhibitor: not studied in the label'), CITES.edoxabanHivPi)
      if (yes(values, 'ddi_inducer')) hit('caution', t('併用 P-gp 誘導劑：謹慎使用', 'P-gp inducer: caution'), CITES.edoxabanInducer)
      if (yes(values, 'ddi_verapamil')) hit('caution', t('verapamil：不需減量', 'Verapamil: no dose reduction'), CITES.edoxabanNoReduction)
      if (values.pregnancy === 'yes') hit('contraindicated', t('懷孕／哺乳', 'Pregnancy/breast-feeding'), CITES.edoxabanPregnancy)
      if (c !== undefined && c >= 15) {
        const pgp = (['ddi_ciclosporin', 'ddi_dronedarone', 'ddi_erythromycin', 'ddi_ketoconazole'] as const).filter((key) => yes(values, key))
        const factors = [
          ...(c <= 50 ? [t(`CrCl ${crclText}（15–50）`, `CrCl ${crclText} (15–50)`)] : []),
          ...(weight !== undefined && weight <= 60 ? [t(`體重 ${weight} kg ≤60`, `weight ${weight} kg ≤60`)] : []),
          ...(pgp.length ? [t(`併用 ${pgp.map(drugName).join('、')}`, `with ${pgp.map(drugName).join(', ')}`)] : []),
        ]
        const pgpUnknown = (['ddi_ciclosporin', 'ddi_dronedarone', 'ddi_erythromycin', 'ddi_ketoconazole'] as const).filter((key) => (values[key] ?? '') === '')
        if (factors.length) {
          doses = [{ mg: 30, perDay: 1 }]
          reduced = true
          hit('dose', t(`任一項：${factors.map((f) => f.zh).join('、')}`, `any one: ${factors.map((f) => f.en).join(', ')}`), CITES.edoxabanReduce)
        } else if (weight === undefined || pgpUnknown.length) {
          // Any of them could make it 30 mg: no 60 mg until each is answered.
          doseUnknown = true
          missing.push(...(weight === undefined ? ['weight'] : []), ...pgpUnknown)
        } else {
          doses = [{ mg: 60, perDay: 1 }]
          hit('dose', t('未達 30 mg 條件', 'No 30 mg factor'), CITES.edoxabanDose)
        }
        // §4.4 gives no number; §5.1 (p.23) defines high CrCl as >100 mL/min.
        if (c > 100) hit('caution', t(`CrCl ${crclText} >100：療效隨 CrCl 升高有下降趨勢，需個別評估`, `CrCl ${crclText} >100: efficacy trends down with rising CrCl; individual evaluation`), CITES.edoxabanHighCrcl)
      }
    }

    if (agent === 'dabigatran') {
      if (c !== undefined && c < 30) hit('contraindicated', t(`CrCl ${crclText} <30`, `CrCl ${crclText} <30`), CITES.dabigatranRenal)
      if (dialysis === 'yes') hit('review', t('透析：以 CrCl <30 禁忌判斷（仿單未另述透析）', 'On dialysis: judge by the CrCl <30 contraindication (the label does not address dialysis)'), CITES.dabigatranRenal)
      if (liver === 'coag' || liver === 'C') hit('review', t('肝病影響存活者禁忌；請依肝病嚴重度判斷', 'Liver disease expected to affect survival is contraindicated; judge by severity'), CITES.dabigatranLiver)
      ask('liver_enzymes', 'ddi_ketoconazole', 'ddi_itraconazole', 'ddi_ciclosporin', 'ddi_dronedarone', 'ddi_glecaprevir', 'ddi_tacrolimus', 'ddi_hiv_pi', 'ddi_inducer')
      if (yes(values, 'liver_enzymes')) hit('not-recommended', t('肝酵素 >2 ULN', 'Liver enzymes >2 ULN'), CITES.dabigatranEnzymes)
      const contra = (['ddi_ketoconazole', 'ddi_itraconazole', 'ddi_ciclosporin', 'ddi_dronedarone', 'ddi_glecaprevir'] as const).filter((key) => yes(values, key))
      if (contra.length) hit('contraindicated', t(`併用 ${contra.map(drugName).join('、')}`, `With ${contra.map(drugName).join(', ')}`), CITES.dabigatranPgp)
      if (yes(values, 'ddi_tacrolimus')) hit('not-recommended', t('併用 tacrolimus', 'With tacrolimus'), CITES.dabigatranTacrolimus)
      if (yes(values, 'ddi_hiv_pi')) hit('not-recommended', t('併用 ritonavir 等 protease inhibitor', 'With ritonavir or other protease inhibitors'), CITES.dabigatranRitonavir)
      if (yes(values, 'ddi_inducer')) hit('avoid', t('併用 P-gp 誘導劑：應避免', 'P-gp inducer: avoid'), CITES.dabigatranInducer)
      if (yes(values, 'ddi_vori_posaconazole')) hit('caution', t('posaconazole：謹慎（voriconazole 仿單未述）', 'Posaconazole: caution (voriconazole not addressed)'), CITES.dabigatranPosaconazole)
      if (yes(values, 'ddi_clarithromycin')) hit('caution', t('clarithromycin：特別謹慎', 'Clarithromycin: particular caution'), CITES.dabigatranCaution)
      if (values.pregnancy === 'yes') hit('avoid', t('懷孕：除非必要不用；哺乳期間停止哺乳', 'Pregnancy: not unless clearly necessary; stop breast-feeding'), CITES.dabigatranPregnancy)
      if (c !== undefined && c >= 30) {
        const must = [
          ...(age !== undefined && age >= 80 ? [t(`年齡 ${age} ≥80`, `age ${age} ≥80`)] : []),
          ...(yes(values, 'ddi_verapamil') ? [t('併用 verapamil（兩藥同時服用）', 'with verapamil (take at the same time)')] : []),
        ]
        const consider = [
          ...(age !== undefined && age >= 75 && age < 80 ? [t(`年齡 ${age}（75–80）`, `age ${age} (75–80)`)] : []),
          ...(c <= 50 ? [t(`CrCl ${crclText}（30–50）`, `CrCl ${crclText} (30–50)`)] : []),
          ...(values.gi_risk === 'yes' ? [t('胃炎／食道炎／GERD 或其他出血風險', 'Gastritis, oesophagitis, GERD or other bleeding risk')] : []),
        ]
        if (must.length) {
          doses = [{ mg: 110, perDay: 2 }]
          reduced = true
          hit('dose', t(`建議減量：${must.map((m) => m.zh).join('、')}`, `Reduction recommended: ${must.map((m) => m.en).join(', ')}`), yes(values, 'ddi_verapamil') ? CITES.dabigatranVerapamil : CITES.dabigatranReduce)
        } else if (age === undefined || (values.ddi_verapamil ?? '') === '') {
          // Either could make it 110 mg recommended: no dose until answered.
          doseUnknown = true
          missing.push(...(age === undefined ? ['age'] : []), ...((values.ddi_verapamil ?? '') === '' ? ['ddi_verapamil'] : []))
        } else if (consider.length) {
          doses = [{ mg: 150, perDay: 2 }, { mg: 110, perDay: 2 }]
          hit('dose', t(`可考慮減量（個別評估）：${consider.map((m) => m.zh).join('、')}`, `Reduction for consideration (individual assessment): ${consider.map((m) => m.en).join(', ')}`), CITES.dabigatranConsider)
        } else if ((values.gi_risk ?? '') === '') {
          // A GI or other bleeding risk would make 110 mg an option too.
          doseUnknown = true
          missing.push('gi_risk')
        } else {
          doses = [{ mg: 150, perDay: 2 }]
          hit('dose', t('未達減量條件', 'No reduction criterion'), CITES.dabigatranDose)
        }
        if (yes(values, 'ddi_verapamil') || yes(values, 'ddi_clarithromycin')) hit('caution', t('P-gp 抑制劑：密切觀察出血，腎功能不佳者尤甚', 'P-gp inhibitor: watch for bleeding, especially with reduced renal function'), CITES.dabigatranCaution)
      }
    }

    hits.sort((a, b) => RANK[b.level] - RANK[a.level])
    const levels = new Set(hits.map((item) => item.level))
    // A rule that takes the agent off the table or leaves its dose to the
    // clinician outranks any dose; 「avoid」 keeps a dose only once it is settled.
    const verdict: DoacVerdict = levels.has('contraindicated')
      ? 'contraindicated'
      : levels.has('not-recommended')
        ? 'not-recommended'
        : levels.has('review')
          ? 'review'
          : c === undefined || doseUnknown || !doses.length
            ? 'missing'
            : levels.has('avoid') ? 'avoid' : 'dose'
    return { agent, verdict, doses: verdict === 'dose' || verdict === 'avoid' ? doses : [], reduced, hits, missing: [...new Set(missing)] }
  })
  return { crcl, results }
}

const DRUG_NAMES: Record<string, string> = {
  ddi_ketoconazole: 'ketoconazole', ddi_itraconazole: 'itraconazole', ddi_vori_posaconazole: 'voriconazole／posaconazole',
  ddi_hiv_pi: 'HIV protease inhibitor（ritonavir 等）', ddi_ciclosporin: 'ciclosporin', ddi_tacrolimus: 'tacrolimus',
  ddi_dronedarone: 'dronedarone', ddi_verapamil: 'verapamil', ddi_erythromycin: 'erythromycin', ddi_clarithromycin: 'clarithromycin',
  ddi_glecaprevir: 'glecaprevir/pibrentasvir',
}
function drugName(key: string): string {
  return DRUG_NAMES[key] ?? key
}

/** How an input the rules still need is named where it is asked for. */
export const DOAC_FIELD_LABELS: Record<string, L> = {
  CrCl: { zh: 'CrCl（年齡、性別、體重、Cr）', en: 'CrCl (age, sex, weight, creatinine)' },
  age: { zh: '年齡', en: 'age' },
  weight: { zh: '體重', en: 'weight' },
  scr: { zh: 'Cr', en: 'creatinine' },
  dialysis: { zh: '透析', en: 'dialysis' },
  liver: { zh: '肝功能', en: 'liver' },
  liver_enzymes: { zh: 'ALT/AST', en: 'ALT/AST' },
  bilirubin_high: { zh: '總膽紅素', en: 'bilirubin' },
  pregnancy: { zh: '懷孕／哺乳', en: 'pregnancy/breast-feeding' },
  gi_risk: { zh: '胃腸出血風險', en: 'GI bleeding risk' },
  ddi_inducer: { zh: '強效誘導劑', en: 'strong inducer' },
  ddi_anticoagulant: { zh: '其他抗凝血劑', en: 'another anticoagulant' },
  ...Object.fromEntries(Object.entries(DRUG_NAMES).map(([key, name]) => [key, { zh: name, en: name }])),
}

/** The prescribed regimen, from the `regimen` select (「apixaban:2.5:2」). */
export function parseRegimen(value: string | undefined): { agent: DoacAgent; mg: number; perDay: number } | undefined {
  const match = /^(apixaban|rivaroxaban|edoxaban|dabigatran):(\d+(?:\.\d+)?):([12])$/.exec(value ?? '')
  return match ? { agent: match[1] as DoacAgent, mg: Number(match[2]), perDay: Number(match[3]) } : undefined
}

export type RegimenCheck =
  | { state: 'matches'; text: L }
  | { state: 'differs'; text: L; cite?: LabelCite }
  | { state: 'label-against'; text: L }
  | { state: 'unsettled'; text: L }

/** The prescription beside its agent's label dose. */
export function checkRegimen(regimenValue: string | undefined, results: readonly DoacAgentResult[]): RegimenCheck | undefined {
  const regimen = parseRegimen(regimenValue)
  if (!regimen) return undefined
  const result = results.find((item) => item.agent === regimen.agent)!
  const freq = (perDay: number) => (perDay === 2 ? 'bid' : 'qd')
  const prescribed = `${regimen.agent} ${regimen.mg} mg ${freq(regimen.perDay)}`
  if (result.verdict === 'contraindicated' || result.verdict === 'not-recommended') {
    return { state: 'label-against', text: { zh: `${prescribed}：仿單${result.verdict === 'contraindicated' ? '禁忌' : '不建議'}（${result.hits[0]!.text.zh}）`, en: `${prescribed}: label ${result.verdict} (${result.hits[0]!.text.en})` } }
  }
  if (result.verdict === 'avoid') {
    const reason = result.hits.find((item) => item.level === 'avoid')!
    return { state: 'label-against', text: { zh: `${prescribed}：仿單應避免（${reason.text.zh}）`, en: `${prescribed}: label says avoid (${reason.text.en})` } }
  }
  if (result.verdict === 'missing' || result.verdict === 'review' || !result.doses.length) {
    return { state: 'unsettled', text: { zh: `${prescribed}：仿單劑量尚未能判定`, en: `${prescribed}: label dose not yet settled` } }
  }
  if (result.doses.some((dose) => dose.mg === regimen.mg && dose.perDay === regimen.perDay)) {
    // The number agrees, but an unanswered rule could still turn it against.
    if (result.missing.length) {
      const open = result.missing.map((key) => DOAC_FIELD_LABELS[key]?.zh ?? key)
      const openEn = result.missing.map((key) => DOAC_FIELD_LABELS[key]?.en ?? key)
      return { state: 'unsettled', text: { zh: `${prescribed}：劑量數字與仿單相同，尚待確認 ${open.join('、')}`, en: `${prescribed}: the number agrees; still to confirm ${openEn.join(', ')}` } }
    }
    return { state: 'matches', text: { zh: `${prescribed}：與仿單劑量一致`, en: `${prescribed}: matches the label dose` } }
  }
  const label = result.doses.map((dose) => `${dose.mg} mg ${freq(dose.perDay)}`).join(' 或 ')
  const extra = regimen.agent === 'edoxaban' && regimen.mg === 15
    ? CITES.edoxaban15
    : regimen.agent === 'dabigatran' && regimen.mg === 75
      ? CITES.dabigatran75
      : undefined
  return {
    state: 'differs',
    text: { zh: `${prescribed}：仿單劑量為 ${label}`, en: `${prescribed}: the label dose is ${label.replace(' 或 ', ' or ')}` },
    ...(extra ? { cite: extra } : {}),
  }
}
