/**
 * Stopping a DOAC before a procedure and restarting it after: EHRA 2021 for
 * the hours by bleeding risk and renal function, ASRA 2018 for neuraxial
 * anaesthesia, and each agent's EU SmPC beside them. Neither guideline is a
 * label, so their quotations live in `GUIDELINE_CITES` with their own source
 * and journal page.
 *
 * Corrections to the 2026-10-20 specification, each from its source:
 * - AF ablation is not the general high-risk flow (EHRA Table 12 puts
 *   uncomplicated ablation in the minor tier; Figure 16 is its own plan).
 * - Neuraxial anaesthesia is checked at every tier, the minimal one included,
 *   and is itself a high-risk intervention (Table 12).
 * - Dabigatran before neuraxial block is 120 h unless renal function is
 *   reliably known and no bleeding risk factor is present (ASRA 11.1).
 * - CrCl <15, dialysis, and dabigatran below 30 get no hours: Figure 14 gives
 *   none, and the 15–29 row is not borrowed for them.
 * - Restart is the latest of the procedure's own interval, catheter removal
 *   + 6 h and a traumatic puncture's 24 h; haemostasis is always a condition.
 * - Skipped doses need the times the patient actually takes them.
 * - Anti-Xa is a drug-calibrated level with no accepted threshold; nothing
 *   here says a patient may proceed.
 * - Andexanet is not a general pre-operative reversal (EU approval is for
 *   life-threatening or uncontrolled bleeding; ANNEXA-4 had no surgery).
 *
 * A blank answer is unknown, never 「no」: an unknown that could change the
 * hours withholds them; one that moves the restart withholds the earliest time.
 */
import type { CalcValues, L } from './types'
import { CITES, doacCrcl, parseRegimen, type DoacAgent, type DoacCrcl, type LabelCite } from './doac-dose-model'

export interface GuidelineSource {
  title: string
  citation: string
  url: string
}

export const GUIDELINE_SOURCES = {
  ehra: {
    title: '2021 EHRA Practical Guide on the use of NOACs in patients with AF',
    citation: 'Steffel J, et al. Europace 2021;23:1612–1676. doi:10.1093/europace/euab065',
    url: 'https://academic.oup.com/europace/article/23/10/1612/6247378',
  },
  asra: {
    title: 'ASRA Evidence-Based Guidelines (4th ed): regional anesthesia in the patient receiving antithrombotic therapy',
    citation: 'Horlocker TT, et al. Reg Anesth Pain Med 2018;43:263–309. doi:10.1097/AAP.0000000000000763',
    url: 'https://rapm.bmj.com/content/43/3/263',
  },
} as const satisfies Record<string, GuidelineSource>

export interface GuidelineCite {
  source: keyof typeof GUIDELINE_SOURCES
  section: string
  /** The journal page printed on it. */
  page: number
  /** Physical page of the PDF the quotation was checked on. */
  pdfPage: number
  quote: string
  /** For a figure: what the image itself shows, read off it (its text is not extractable). */
  figure?: L
}

const ehra = (section: string, pdfPage: number, quote: string, figure?: L): GuidelineCite => ({ source: 'ehra', section, page: 1611 + pdfPage, pdfPage, quote, ...(figure ? { figure } : {}) })
const asra = (section: string, pdfPage: number, page: number, quote: string): GuidelineCite => ({ source: 'asra', section, page, pdfPage, quote })

/**
 * Checked 2026-10-21: EHRA against `pdftotext` of euab065.pdf page by page
 * (physical page + 1611 = journal page); its Figures 12, 14, 15 and 16 are
 * images, read off the rendered page. ASRA against the publisher PDF's text
 * page by page (PDF p.17 = journal p.279, p.19 = p.281).
 */
export const GUIDELINE_CITES = {
  ehraTable12Minor: ehra('Table 12', 31, 'Electrophysiological study or catheter ablation (except complex procedures)'),
  ehraTable12Neuraxial: ehra('Table 12', 31, 'Spinal or epidural anaesthesia; lumbar diagnostic puncture'),
  ehraFig14: ehra('Figure 14', 32, 'Timing of last NOAC intake before an elective intervention.', {
    zh: '圖內：Minor risk 在谷底濃度做（最後一劑後 12／24 h），當天或最晚隔天恢復。Dabigatran CrCl ≥80：低風險 ≥24 h、高風險 ≥48 h；50–79：≥36／≥72 h；30–49：≥48／≥96 h；15–29：Not indicated。Apixaban／edoxaban／rivaroxaban CrCl ≥30：≥24／≥48 h；15–29：≥36／≥48 h。CrCl <15：No official indication for use。累積風險（腎功能不全、高齡、併用藥）可考慮提早 12–24 h 停藥。低風險 24 h、高風險 48（–72）h 後恢復全劑量。',
    en: 'In the figure: minor risk at trough (12/24 h after the last intake), resume the same or next day. Dabigatran CrCl ≥80: low ≥24 h, high ≥48 h; 50–79: ≥36/≥72 h; 30–49: ≥48/≥96 h; 15–29: not indicated. Apixaban/edoxaban/rivaroxaban CrCl ≥30: ≥24/≥48 h; 15–29: ≥36/≥48 h. CrCl <15: no official indication for use. With a risk of accumulation (renal insufficiency, older age, co-medication) pausing 12–24 h earlier may be considered. Resume full dose 24 h after low-risk and 48 (–72) h after high-risk interventions.',
  }),
  ehraFig15: ehra('Figure 15', 32, 'Consider +24 h of interruption in situations likely resulting in increased plasma levels [e.g. body weight < 50 kg, significant interactions', {
    zh: '圖內：Minor risk 術後 ≥6 h 恢復；High risk 術後 ≥48 h（–72 h）恢復，期間考慮依院內流程給予預防劑量 heparin；全程不橋接。',
    en: 'In the figure: minor risk restart ≥6 h after surgery; high risk restart ≥48 h (–72 h) after, with prophylactic-dose heparin per hospital protocol meanwhile; no bridging throughout.',
  }),
  ehraFig12: ehra('Figure 12', 30, 'NOAC management in the setting of unplanned surgery.', {
    zh: '圖內：抽完整凝血檢查（PT、aPTT、anti-FXa、dTT…）。可安全延後 12–24 h 則延後並重抽，無明顯殘餘作用再手術；不能延後則逆轉（若必要、可取得、已核准）後手術，術後重抽並依結果處理。',
    en: 'In the figure: full coagulation panel (PT, aPTT, anti-FXa, dTT…). If deferring 12–24 h is safe, defer and repeat; operate once no relevant residual effect. If not, reverse (if necessary/available/approved), operate, repeat the panel and treat by it.',
  }),
  ehraEmergency: ehra('Patients requiring an urgent surgical intervention', 33, 'If an emergency intervention is required, any NOAC should be discontinued immediately.'),
  ehraLevels: ehra('Laboratory testing before surgery or invasive procedures', 33, 'adapting the duration of interruption based on residual NOAC levels is without prospectively validated evidence concerning its clinical impact'),
  ehraBridging: ehra('Bridging', 34, 'Pre-operative bridging with low-molecular weight heparin (LMWH) or UFH is not recommended in NOAC-treated patients'),
  ehraAblation: ehra('Patients undergoing catheter ablation of AF', 34, 'uninterrupted NOAC therapy can be considered safe and effective in AF ablation'),
  ehraFig16: ehra('Figure 16', 36, 'NOAC management before and after AF ablation.', {
    zh: '圖內：最後一劑術前 12 h（預設），可至 24 h；高 CHA₂DS₂-VASc（≥4）、穿刺前未給 heparin、拔 sheath 前給 protamine 時可縮短中斷。拔 sheath 後 3–5 h 恢復，恢復前排除心包填塞與其他大出血。',
    en: 'In the figure: last intake 12 h before (default), up to 24 h; shorten with CHA₂DS₂-VASc ≥4, no heparin before the first transseptal puncture, or protamine before sheath removal. Resume 3–5 h after sheath removal, once tamponade and other major bleeding are ruled out.',
  }),
  ehraAndexanet: ehra('Direct reversal of FXa-inhibitors', 29, 'In the EU Andexanet alpha is only approved for the reversal of life-threatening or uncontrollable bleeding in patients taking apixaban or rivaroxaban.'),
  ehraAnnexa: ehra('Direct reversal of FXa-inhibitors', 29, 'the trial did not include patients undergoing emergency surgery.'),

  asraRivaroxaban: asra('6.1', 17, 279, 'We suggest that rivaroxaban be discontinued 72 hours prior to neuraxial block.'),
  asraApixaban: asra('7.1', 17, 279, 'We suggest that apixaban be discontinued 72 hours prior to neuraxial block.'),
  asraEdoxaban: asra('8.1', 17, 279, 'We suggest that edoxaban be discontinued 72 hours prior to neuraxial block.'),
  asraRivaroxabanLevel: asra('6.1', 17, 279, 'An acceptable level of residual rivaroxaban activity to proceed with neuraxial block remains undetermined'),
  asraApixabanLevel: asra('7.1', 17, 279, 'An acceptable level of residual apixaban activity to proceed with neuraxial block remains undetermined'),
  asraEdoxabanLevel: asra('8.1', 17, 279, 'An acceptable level of residual edoxaban activity to proceed with neuraxial block remains undetermined'),
  asraXaCatheter: asra('6.2 / 7.2 / 8.2', 17, 279, 'We suggest that neuraxial catheters be removed 6 hours prior to the first (postoperative) dose'),
  asraDabigatran: asra('11.1', 19, 281, 'We suggest that dabigatran be discontinued 120 hours prior to neuraxial block.'),
  asraDabigatranGraded: asra('11.1', 19, 281, 'if renal function has been reliably determined, and there are no additional risk factors for bleeding (eg, age >65 years, hypertension, concomitant antiplatelet medications)'),
  asraDabigatran80: asra('11.1.1', 19, 281, 'We suggest that dabigatran be discontinued 72 hours in patients with a CrCl 80 mL/min or greater.'),
  asraDabigatran50: asra('11.1.2', 19, 281, 'We suggest that dabigatran be discontinued 96 hours in patients with a CrCl of 50 to 79 mL/min.'),
  asraDabigatran30: asra('11.1.3', 19, 281, 'We suggest that dabigatran be discontinued 120 hours in patients with a CrCl of 30 to 49 mL/min.'),
  asraDabigatranBelow30: asra('11.1.4', 19, 281, 'We suggest against the performance of neuraxial blocks in patients with a CrCl of less than 30 mL/min'),
  asraDabigatranLevel: asra('11.1.1', 19, 281, 'An acceptable level of residual dabigatran activity to proceed with neuraxial block remains undetermined'),
  asraDabigatranCatheter: asra('11.2', 19, 281, 'We suggest that neuraxial catheters be removed 6 hours prior to the first (postoperative) dose'),
} as const satisfies Record<string, GuidelineCite>

export type AnyCite = LabelCite | GuidelineCite
export const isLabelCite = (cite: AnyCite): cite is LabelCite => 'agent' in cite

export interface PeriopLine {
  text: L
  cites: AnyCite[]
}

export type ProcedureKind = 'af-ablation' | 'minimal' | 'low' | 'high' | 'emergency'
export type Tier = 'minimal' | 'low' | 'high'

export interface PeriopResult {
  agent?: DoacAgent
  perDay?: number
  crcl: DoacCrcl | null
  /**
   * - `missing`: an input the hours depend on is blank.
   * - `no-hours`: the sources give no interval for this patient (CrCl <15,
   *   dialysis, dabigatran below 30).
   * - `timed`: hours from the tier (and neuraxial rules).
   * - `ablation`: EHRA Figure 16's own plan.
   * - `emergency`: Figure 12; no interval.
   */
  state: 'missing' | 'no-hours' | 'timed' | 'ablation' | 'emergency'
  /** The tier the hours were read at (neuraxial makes it high). */
  tier?: Tier
  /** The minimum interval between the last dose and the procedure. */
  holdHours?: number
  /** Where the interval came from, and what the label says beside it. */
  basis: PeriopLine[]
  /** The procedure time less `holdHours`: the latest a last dose may be taken. */
  lastDoseBy?: Date
  /** The last scheduled dose to take, from the patient's own dose times. */
  lastDose?: Date
  /** Scheduled doses after `lastDose`, up to and including the procedure time. */
  skippedBefore: Date[]
  resume: {
    lines: PeriopLine[]
    /** The latest of every timed condition; absent while any is unknown. */
    earliest?: Date
    /** The first scheduled dose at or after `earliest`. */
    firstDose?: Date
    /** Scheduled doses after the procedure and before `firstDose`. */
    skippedAfter: Date[]
  }
  notes: PeriopLine[]
  /** Inputs the hours still need. */
  missing: string[]
  /** Inputs the clock times or the restart still need. */
  pending: string[]
}

export type PeriopInputKey =
  | 'regimen' | 'age' | 'sex' | 'weight' | 'scr' | 'crcl_manual' | 'dialysis'
  | 'procedure_kind' | 'neuraxial' | 'surgery_at' | 'dose_time_1' | 'dose_time_2'
  | 'haemostasis' | 'catheter_removed_at' | 'traumatic_puncture' | 'renal_reliable' | 'hypertension' | 'antiplatelet'

/** 「2026-11-03T08:00」 as local time; undefined for anything else. */
export function parseLocalDateTime(value: string | undefined): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value ?? '')
  if (!match) return undefined
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number]
  const date = new Date(y, mo - 1, d, h, mi)
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d && date.getHours() === h ? date : undefined
}

/** 「20:00」 as minutes after midnight; undefined for anything else. */
export function parseClock(value: string | undefined): number | undefined {
  const match = /^(\d{2}):(\d{2})$/.exec(value ?? '')
  if (!match) return undefined
  const h = Number(match[1])
  const m = Number(match[2])
  return h < 24 && m < 60 ? h * 60 + m : undefined
}

const HOUR = 3_600_000
const addHours = (date: Date, hours: number) => new Date(date.getTime() + hours * HOUR)

/** Every scheduled dose between two instants, at the patient's own times of day. */
function scheduledDoses(minutes: number[], from: Date, to: Date): Date[] {
  const out: Date[] = []
  const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() - 1)
  for (let cursor = day; cursor.getTime() <= to.getTime() + 24 * HOUR; cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)) {
    for (const minute of minutes) {
      const at = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), Math.floor(minute / 60), minute % 60)
      if (at.getTime() >= from.getTime() && at.getTime() <= to.getTime()) out.push(at)
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime())
}

/** EHRA Figure 14: [low, high] hours; undefined where it gives none. */
export function ehraHours(agent: DoacAgent, crcl: number): [number, number] | undefined {
  if (crcl < 15) return undefined
  if (agent === 'dabigatran') {
    if (crcl >= 80) return [24, 48]
    if (crcl >= 50) return [36, 72]
    if (crcl >= 30) return [48, 96]
    return undefined
  }
  return crcl >= 30 ? [24, 48] : [36, 48]
}

const G = GUIDELINE_CITES
const t = (zh: string, en: string): L => ({ zh, en })
const line = (text: L, ...cites: AnyCite[]): PeriopLine => ({ text, cites })

const ASRA_XA: Record<Exclude<DoacAgent, 'dabigatran'>, { hold: GuidelineCite; level: GuidelineCite }> = {
  apixaban: { hold: G.asraApixaban, level: G.asraApixabanLevel },
  rivaroxaban: { hold: G.asraRivaroxaban, level: G.asraRivaroxabanLevel },
  edoxaban: { hold: G.asraEdoxaban, level: G.asraEdoxabanLevel },
}
const ANTI_XA_LABEL: Record<Exclude<DoacAgent, 'dabigatran'>, LabelCite> = {
  apixaban: CITES.apixabanAntiXa,
  rivaroxaban: CITES.rivaroxabanAntiXa,
  edoxaban: CITES.edoxabanAntiXa,
}
const RESTART_LABEL: Record<DoacAgent, LabelCite> = {
  apixaban: CITES.apixabanRestart,
  rivaroxaban: CITES.rivaroxabanRestart,
  edoxaban: CITES.edoxabanRestart,
  dabigatran: CITES.dabigatranRestart,
}

/** What each SmPC itself says beside the EHRA hours; shown, never the deciding number. */
function labelInterval(agent: DoacAgent, tier: Exclude<Tier, 'minimal'>, crcl: number): PeriopLine {
  if (agent === 'apixaban') {
    return tier === 'high'
      ? line(t('仿單：中高出血風險至少停 48 小時', 'Label: at least 48 h for moderate or high bleeding risk'), CITES.apixabanSurgeryHigh)
      : line(t('仿單：低出血風險至少停 24 小時', 'Label: at least 24 h for low bleeding risk'), CITES.apixabanSurgeryLow)
  }
  if (agent === 'rivaroxaban') return line(t('仿單：至少停 24 小時', 'Label: at least 24 h'), CITES.rivaroxabanSurgery)
  if (agent === 'edoxaban') return line(t('仿單：最好至少停 24 小時', 'Label: preferably at least 24 h'), CITES.edoxabanSurgery)
  const band = crcl >= 80 ? ['2 天', '24 小時', '2 days', '24 h'] : crcl >= 50 ? ['2–3 天', '1–2 天', '2–3 days', '1–2 days'] : ['4 天', '2–3 天（>48 小時）', '4 days', '2–3 days (>48 h)']
  return line(
    t(`仿單 Table 7：高出血風險或大手術 ${band[0]}，一般風險 ${band[1]}`, `Label Table 7: high bleeding risk or major surgery ${band[2]}, standard risk ${band[3]}`),
    CITES.dabigatranSurgeryTable,
  )
}

/** ASRA's neuraxial interval and the reason for it. */
function asraHours(agent: DoacAgent, crcl: number, values: CalcValues): { hours: number; lines: PeriopLine[] } {
  if (agent !== 'dabigatran') {
    return { hours: 72, lines: [line(t('神經軸阻斷前停 72 小時（ASRA）', '72 h before neuraxial block (ASRA)'), ASRA_XA[agent].hold)] }
  }
  const age = Number(values.age)
  const reasons: L[] = []
  if (values.renal_reliable !== 'yes') reasons.push(values.renal_reliable === 'no' ? t('腎功能未可靠評估', 'renal function not reliably determined') : t('腎功能是否可靠評估未填', 'whether renal function is reliable is unanswered'))
  if (values.age === undefined || values.age === '' || !Number.isFinite(age)) reasons.push(t('年齡未填', 'age unanswered'))
  else if (age > 65) reasons.push(t(`年齡 ${age} >65`, `age ${age} >65`))
  for (const [key, zh, en] of [['hypertension', '高血壓', 'hypertension'], ['antiplatelet', '抗血小板藥', 'antiplatelet drug']] as const) {
    if (values[key] === 'yes') reasons.push(t(zh, en))
    else if (values[key] !== 'no') reasons.push(t(`${zh}未填`, `${en} unanswered`))
  }
  if (reasons.length) {
    return {
      hours: 120,
      lines: [line(
        t(`dabigatran 神經軸阻斷前停 120 小時（ASRA 預設；不分級，因為：${reasons.map((r) => r.zh).join('、')}）`, `Dabigatran: 120 h before neuraxial block (ASRA default; not graded because ${reasons.map((r) => r.en).join(', ')})`),
        G.asraDabigatran, G.asraDabigatranGraded,
      )],
    }
  }
  const [hours, ref] = crcl >= 80 ? [72, G.asraDabigatran80] : crcl >= 50 ? [96, G.asraDabigatran50] : [120, G.asraDabigatran30]
  return {
    hours,
    lines: [line(t(`dabigatran 神經軸阻斷前停 ${hours} 小時（腎功能已可靠評估、無出血風險因子，依 CrCl 分級）`, `Dabigatran: ${hours} h before neuraxial block (renal function reliable, no bleeding risk factor: graded by CrCl)`), G.asraDabigatranGraded, ref)],
  }
}

/** The residual-level line: what a drug-calibrated assay can say, and that no level clears a patient. */
function levelNote(agent: DoacAgent): PeriopLine {
  if (agent === 'dabigatran') {
    return line(
      t('殘餘藥效：可用 dTT 或 ECT 估計 dabigatran 濃度；可接受的殘餘濃度未定，結果不代表可以手術或麻醉，由手術與麻醉團隊判斷。', 'Residual effect: dTT or ECT estimate the dabigatran level; no acceptable residual level is established, and a result does not clear the procedure or block — the surgical and anaesthetic team decides.'),
      G.asraDabigatranLevel, G.ehraLevels,
    )
  }
  return line(
    t(`殘餘藥效：以 ${agent} 校正的 anti-Xa 可估計藥物濃度（ng/mL，不是 heparin 的 IU/mL）；可接受的殘餘濃度未定，結果不代表可以手術或麻醉，由手術與麻醉團隊判斷。`, `Residual effect: an anti-Xa assay calibrated to ${agent} estimates the drug level (ng/mL, not heparin IU/mL); no acceptable residual level is established, and a result does not clear the procedure or block — the surgical and anaesthetic team decides.`),
    ANTI_XA_LABEL[agent], ASRA_XA[agent].level, G.ehraLevels,
  )
}

/**
 * The plan for one prescription and one procedure. Pure, given the inputs;
 * times are local (the app's, Asia/Taipei).
 */
export function calculatePeriop(values: CalcValues): PeriopResult {
  const crcl = doacCrcl(values)
  const c = crcl?.value
  const regimen = parseRegimen(values.regimen)
  const kind = (values.procedure_kind ?? '') as ProcedureKind | ''
  const neuraxial = values.neuraxial ?? ''
  const dialysis = values.dialysis ?? ''
  const result: PeriopResult = { crcl, state: 'missing', basis: [], skippedBefore: [], resume: { lines: [], skippedAfter: [] }, notes: [], missing: [], pending: [] }
  if (!regimen) result.missing.push('regimen')
  if (kind === '') result.missing.push('procedure_kind')
  if (!regimen) return result
  const agent = regimen.agent
  result.agent = agent
  result.perDay = regimen.perDay

  if (kind === 'emergency') {
    result.state = 'emergency'
    result.notes.push(line(t('立即停藥。', 'Stop the DOAC now.'), G.ehraEmergency))
    result.notes.push(line(t('抽完整凝血檢查（PT、aPTT、anti-FXa、dTT…）。可安全延後 12–24 小時就延後並重抽；不能延後才考慮逆轉（若必要、可取得、已核准）。', 'Draw a full coagulation panel (PT, aPTT, anti-FXa, dTT…). If 12–24 h of delay is safe, delay and repeat it; reversal only if surgery cannot wait (if necessary, available and approved).'), G.ehraFig12))
    if (agent === 'dabigatran') {
      result.notes.push(line(t('需要快速逆轉時：idarucizumab；血液透析也可移除 dabigatran。', 'When rapid reversal is needed: idarucizumab; haemodialysis also removes dabigatran.'), CITES.dabigatranIdarucizumab, CITES.dabigatranDialysable))
    } else {
      result.notes.push(line(
        t('Xa 抑制劑：andexanet 不作為術前通用逆轉——EU 只核准用於危及生命或無法控制的出血，ANNEXA-4 也未納入緊急手術病人。是否給止血製劑依院內流程。', 'FXa inhibitors: andexanet is not a general pre-operative reversal — EU approval covers life-threatening or uncontrolled bleeding only, and ANNEXA-4 enrolled no emergency surgery. Haemostatic agents per hospital protocol.'),
        G.ehraAndexanet, G.ehraAnnexa,
      ))
    }
    result.notes.push(levelNote(agent))
    return result
  }

  if (neuraxial === '') result.missing.push('neuraxial')
  if (c === undefined) result.missing.push('CrCl')
  if (dialysis === '') result.missing.push('dialysis')

  // No interval exists for these; the 15–29 row is not borrowed.
  const noIndication = dialysis === 'yes' || (c !== undefined && c < 15)
  const dabigatranOff = agent === 'dabigatran' && c !== undefined && c < 30
  if (noIndication || dabigatranOff) {
    result.state = 'no-hours'
    result.missing = result.missing.filter((key) => key !== 'CrCl' && key !== 'dialysis')
    result.basis.push(noIndication
      ? line(t(`${dialysis === 'yes' ? '透析' : `CrCl ${c!.toFixed(1)} <15`}：EHRA 無正式停藥時數（No official indication for use），需個別評估，建議會診。`, `${dialysis === 'yes' ? 'Dialysis' : `CrCl ${c!.toFixed(1)} <15`}: EHRA gives no interval (no official indication for use); individual assessment, consult.`), G.ehraFig14)
      : line(t(`dabigatran CrCl ${c!.toFixed(1)} <30：仿單禁忌，EHRA 列為 Not indicated，不給停藥時數。`, `Dabigatran, CrCl ${c!.toFixed(1)} <30: contraindicated in the label, not indicated in EHRA; no interval given.`), CITES.dabigatranRenal, G.ehraFig14))
    if (agent === 'dabigatran' && c !== undefined && c < 30 && neuraxial !== 'none') {
      result.basis.push(line(t('ASRA：CrCl <30 建議不做神經軸阻斷。', 'ASRA: no neuraxial block at CrCl <30.'), G.asraDabigatranBelow30))
    }
    result.notes.push(levelNote(agent), line(t('不以 LMWH／UFH 橋接。', 'No LMWH/UFH bridging.'), G.ehraBridging))
    return result
  }
  if (result.missing.length) return result

  const crclValue = c!
  const neuraxialUsed = neuraxial !== 'none'
  let hours: number
  let tier: Tier | undefined
  if (kind === 'af-ablation') {
    result.state = 'ablation'
    hours = 12
    result.basis.push(line(t('AF 導管消融：不中斷或最小中斷；最後一劑預設術前 12 小時（可至 24 小時），不套一般高風險流程。', 'AF catheter ablation: uninterrupted or minimally interrupted; last dose 12 h before by default (up to 24 h), not the general high-risk flow.'), G.ehraFig16, G.ehraAblation, G.ehraTable12Minor))
    if (agent === 'apixaban') result.basis.push(line(t('仿單：AF 消融時 apixaban 不需中斷。', 'Label: apixaban need not be interrupted for AF ablation.'), CITES.apixabanAblation))
    if (agent === 'dabigatran' && regimen.mg === 110) result.notes.push(line(t('仿單：dabigatran 110 mg bid 用於 AF 消融沒有資料。', 'Label: no data for dabigatran 110 mg bid in AF ablation.'), CITES.dabigatranAblation110))
  } else {
    result.state = 'timed'
    tier = neuraxialUsed ? 'high' : kind as Tier
    if (neuraxialUsed && kind !== 'high') {
      result.basis.push(line(t('有脊髓／硬膜外麻醉或穿刺：屬高出血風險處置，不論手術本身分級。', 'Spinal/epidural anaesthesia or puncture: a high-risk intervention whatever the procedure’s own tier.'), G.ehraTable12Neuraxial))
    }
    if (tier === 'minimal') {
      hours = regimen.perDay === 2 ? 12 : 24
      result.basis.push(line(t(`極低風險：在谷底濃度做，最後一劑後 ${hours} 小時；不停藥超過一次給藥間隔。`, `Minor risk: at trough, ${hours} h after the last dose; no interruption beyond one dosing interval.`), G.ehraFig14))
    } else {
      const pair = ehraHours(agent, crclValue)!
      hours = tier === 'high' ? pair[1] : pair[0]
      result.basis.push(line(t(`EHRA：${tier === 'high' ? '高' : '低'}出血風險、CrCl ${crclValue.toFixed(1)}，最後一劑距手術 ≥${hours} 小時`, `EHRA: ${tier} bleeding risk, CrCl ${crclValue.toFixed(1)}: last dose ≥${hours} h before`), G.ehraFig14))
      result.basis.push(labelInterval(agent, tier, crclValue))
    }
    result.tier = tier
  }
  if (neuraxialUsed) {
    const neuro = asraHours(agent, crclValue, values)
    result.basis.push(...neuro.lines)
    if (neuro.hours > hours) {
      result.basis.push(line(t(`取較長者：${neuro.hours} 小時（ASRA）`, `The longer applies: ${neuro.hours} h (ASRA)`)))
      hours = neuro.hours
    }
  }
  result.holdHours = hours

  if (result.state === 'timed') {
    const weight = Number(values.weight)
    result.notes.push(line(
      t(`考慮再延長（不自動加入）：有累積風險（腎功能不全、高齡、併用藥）時可提早 12–24 小時停藥；體重 <50 kg 或顯著交互作用時考慮多停 24 小時${values.weight && weight < 50 ? `。本例體重 ${weight} kg <50。` : '。'}`, `Consider longer (not added automatically): with a risk of accumulation (renal insufficiency, older age, co-medication) stop 12–24 h earlier; with body weight <50 kg or significant interactions consider +24 h${values.weight && weight < 50 ? `. Weight here ${weight} kg <50.` : '.'}`),
      G.ehraFig14, G.ehraFig15,
    ))
  }
  result.notes.push(levelNote(agent), line(t('不以 LMWH／UFH 橋接。', 'No LMWH/UFH bridging.'), G.ehraBridging))

  // Clock times: the procedure, then the patient's own dose times.
  const surgery = parseLocalDateTime(values.surgery_at)
  if (!surgery) result.pending.push('surgery_at')
  const timeKeys = (['dose_time_1', 'dose_time_2'] as const).slice(0, regimen.perDay)
  const minutes = timeKeys.map((key) => parseClock(values[key]))
  const known = minutes.every((m): m is number => m !== undefined)
  if (!known) result.pending.push(...timeKeys.filter((_, index) => minutes[index] === undefined))
  if (surgery) {
    result.lastDoseBy = addHours(surgery, -hours)
    if (known) {
      const before = scheduledDoses(minutes, addHours(result.lastDoseBy, -48), surgery)
      const last = [...before].reverse().find((at) => at.getTime() <= result.lastDoseBy!.getTime())
      if (last) result.lastDose = last
      result.skippedBefore = before.filter((at) => at.getTime() > (last ?? result.lastDoseBy!).getTime())
    }
  }

  // Restart: the latest of every timed condition; haemostasis always.
  const restart: { at?: Date; line: PeriopLine; key?: string }[] = []
  if (result.state === 'ablation') {
    restart.push({ line: line(t('拔除 sheath 後 3–5 小時恢復，恢復前排除心包填塞與其他大出血。', 'Resume 3–5 h after sheath removal, once tamponade and other major bleeding are ruled out.'), G.ehraFig16), key: 'sheath' })
  } else {
    const after = tier === 'minimal' ? 6 : tier === 'low' ? 24 : 48
    restart.push({
      at: surgery ? addHours(surgery, after) : undefined,
      line: line(t(
        tier === 'minimal' ? '極低風險：術後 ≥6 小時恢復' : tier === 'low' ? '低風險：術後 24 小時恢復全劑量' : '高風險：術後 48（–72）小時恢復全劑量；其間依院內流程考慮預防劑量 heparin',
        tier === 'minimal' ? 'Minor risk: restart ≥6 h after' : tier === 'low' ? 'Low risk: full dose 24 h after' : 'High risk: full dose 48 (–72) h after; prophylactic-dose heparin per hospital protocol meanwhile',
      ), G.ehraFig14, G.ehraFig15),
      key: surgery ? undefined : 'surgery_at',
    })
  }
  if (neuraxial === 'catheter') {
    const removed = parseLocalDateTime(values.catheter_removed_at)
    const labelCatheter = agent === 'apixaban' ? [t('仿單 ≥5 小時', 'label ≥5 h'), CITES.apixabanCatheter] as const
      : agent === 'rivaroxaban' ? [t('仿單 ≥6 小時', 'label ≥6 h'), CITES.rivaroxabanCatheter] as const
        : agent === 'dabigatran' ? [t('仿單 ≥2 小時', 'label ≥2 h'), CITES.dabigatranCatheter] as const
          : [t('仿單未述', 'label silent'), undefined] as const
    restart.push({
      at: removed ? addHours(removed, 6) : undefined,
      line: line(
        t(`拔除神經軸導管後 ≥6 小時才給下一劑（ASRA；${labelCatheter[0].zh}，取 6 小時）`, `Next dose ≥6 h after neuraxial catheter removal (ASRA; ${labelCatheter[0].en}; 6 h applies)`),
        agent === 'dabigatran' ? G.asraDabigatranCatheter : G.asraXaCatheter, ...(labelCatheter[1] ? [labelCatheter[1]] : []),
      ),
      key: removed ? undefined : 'catheter_removed_at',
    })
  }
  if (neuraxialUsed) {
    const traumatic = values.traumatic_puncture ?? ''
    if (traumatic === '') restart.push({ line: line(t('穿刺是否出血未填：若出血，延後 24 小時', 'Traumatic puncture unanswered: if so, delay 24 h'), CITES.rivaroxabanTraumatic), key: 'traumatic_puncture' })
    else if (traumatic === 'yes') {
      restart.push({
        at: surgery ? addHours(surgery, 24) : undefined,
        line: line(t(
          agent === 'rivaroxaban' ? '穿刺出血：延後 24 小時（以手術時刻為穿刺時刻）' : '穿刺出血：延後 24 小時（rivaroxaban 仿單；本藥仿單未述，請與麻醉科確認；以手術時刻為穿刺時刻）',
          agent === 'rivaroxaban' ? 'Traumatic puncture: delay 24 h (puncture taken as the procedure time)' : 'Traumatic puncture: delay 24 h (rivaroxaban label; this agent’s label is silent — confirm with anaesthesia; puncture taken as the procedure time)',
        ), CITES.rivaroxabanTraumatic),
        key: surgery ? undefined : 'surgery_at',
      })
    }
  }
  const haemostasis = values.haemostasis ?? ''
  restart.push({
    line: line(
      haemostasis === 'no' ? t('尚未止血：止血確認後才恢復', 'Haemostasis not yet established: restart only once it is') : haemostasis === 'yes' ? t('止血已確認', 'Haemostasis confirmed') : t('恢復前需確認止血', 'Confirm haemostasis before restarting'),
      RESTART_LABEL[agent],
    ),
    key: haemostasis === 'no' ? 'haemostasis' : undefined,
  })
  result.resume.lines = restart.map((item) => item.line)
  const open = restart.filter((item) => item.key).map((item) => item.key!)
  result.pending.push(...open.filter((key) => key !== 'sheath'))
  if (!open.length && restart.some((item) => item.at)) {
    const earliest = new Date(Math.max(...restart.filter((item) => item.at).map((item) => item.at!.getTime())))
    result.resume.earliest = earliest
    if (known && surgery) {
      const after = scheduledDoses(minutes as number[], surgery, addHours(earliest, 24))
      const first = after.find((at) => at.getTime() >= earliest.getTime())
      if (first) result.resume.firstDose = first
      result.resume.skippedAfter = after.filter((at) => at.getTime() > surgery.getTime() && (!first || at.getTime() < first.getTime()))
    }
  }
  result.pending = [...new Set(result.pending)]
  return result
}

/** How an input the plan still needs is named where it is asked for. */
export const PERIOP_FIELD_LABELS: Record<string, L> = {
  regimen: { zh: '目前 DOAC 處方', en: 'current DOAC' },
  procedure_kind: { zh: '處置分級', en: 'procedure tier' },
  neuraxial: { zh: '脊髓／硬膜外麻醉', en: 'neuraxial anaesthesia' },
  CrCl: { zh: 'CrCl（年齡、性別、體重、Cr）', en: 'CrCl (age, sex, weight, creatinine)' },
  dialysis: { zh: '透析', en: 'dialysis' },
  surgery_at: { zh: '手術時刻', en: 'procedure time' },
  dose_time_1: { zh: '服藥時刻 1', en: 'dose time 1' },
  dose_time_2: { zh: '服藥時刻 2', en: 'dose time 2' },
  catheter_removed_at: { zh: '拔管時刻', en: 'catheter removal time' },
  traumatic_puncture: { zh: '穿刺是否出血', en: 'traumatic puncture' },
  haemostasis: { zh: '止血', en: 'haemostasis' },
}

/** 「11-03 08:00」 in local time. */
export function formatLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
