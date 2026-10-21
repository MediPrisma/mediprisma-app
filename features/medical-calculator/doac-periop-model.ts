/**
 * Stopping a DOAC before a procedure and restarting it after: EHRA 2021 for
 * the hours by bleeding risk and renal function, ASRA 2025 (fifth edition)
 * for neuraxial and deep plexus/peripheral blocks, and each agent's EU SmPC
 * beside them. Neither guideline is a label, so their quotations live in
 * `GUIDELINE_CITES` with their own source and page.
 *
 * Corrections to the 2026-10-20 specification, each from its source:
 * - AF ablation is not the general high-risk flow (EHRA Table 12 puts
 *   uncomplicated ablation in the minor tier; Figure 16 is its own plan). It
 *   and a minor-risk procedure keep the last scheduled dose before them: no
 *   dose is skipped, and a short interval is flagged for the team to adjust.
 * - Neuraxial anaesthesia is checked at every tier, the minimal one included,
 *   and is itself a high-risk intervention (Table 12). Deep plexus/peripheral
 *   blocks take the same ASRA intervals.
 * - ASRA reads the dose, not the indication: a high (therapeutic) or low
 *   (prophylactic) dose has its own interval before the block, and the first
 *   dose after needle placement or catheter removal waits 24 h after a high
 *   dose and 6 h after a low one. Dabigatran high dose is 72 h at CrCl ≥50
 *   and 120 h at 30–49.
 * - CrCl <15, dialysis, and dabigatran below 30 get no hours: Figure 14 gives
 *   none, and the 15–29 row is not borrowed for them.
 * - Restart is the latest of the procedure's own interval, the block's, and a
 *   traumatic puncture's delay; haemostasis is always a condition. The
 *   interval before is counted to the start (the puncture when there is
 *   one), the procedure's interval after from the end.
 * - Skipped doses need the times the patient actually takes them.
 * - ASRA names a residual level it finds acceptable (<30 ng/mL); it is
 *   quoted as the guideline says it, beside its own note that it was never
 *   clinically validated, and nothing here says a patient may proceed.
 * - Andexanet is not a general pre-operative reversal (EU approval is for
 *   life-threatening or uncontrolled bleeding; ANNEXA-4 had no surgery).
 *
 * A blank answer is unknown, never 「no」: an unknown that could change the
 * hours withholds them, or takes the longer of the two; one that moves the
 * restart withholds the earliest time.
 */
import type { CalcValues, L } from './types'
import { CITES, crclLabel, doacCrcl, parseRegimen, type DoacAgent, type DoacCrcl, type LabelCite } from './doac-dose-model'

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
    title: 'ASRA Pain Medicine Evidence-Based Guidelines (5th ed): regional anesthesia in the patient receiving antithrombotic or thrombolytic therapy',
    citation: 'Kopp SL, et al. Reg Anesth Pain Med 2025;0:1–29 (online first 29 January 2025). doi:10.1136/rapm-2024-105766',
    url: 'https://doi.org/10.1136/rapm-2024-105766',
  },
} as const satisfies Record<string, GuidelineSource>

export interface GuidelineCite {
  source: keyof typeof GUIDELINE_SOURCES
  section: string
  /** The page printed on it (ASRA's online-first pages run 1–29, as the PDF's). */
  page: number
  /** Physical page of the PDF the quotation was checked on. */
  pdfPage: number
  quote: string
  /** For a figure: what the image itself shows, read off it (its text is not extractable). */
  figure?: L
}

const ehra = (section: string, pdfPage: number, quote: string, figure?: L): GuidelineCite => ({ source: 'ehra', section, page: 1611 + pdfPage, pdfPage, quote, ...(figure ? { figure } : {}) })
const asra = (section: string, page: number, quote: string): GuidelineCite => ({ source: 'asra', section, page, pdfPage: page, quote })

/**
 * Checked with `pdftotext` page by page: EHRA 2021 against euab065.pdf
 * (physical page + 1611 = journal page; Figures 12, 14, 15 and 16 are
 * images, read off the rendered page) on 2026-10-21, and ASRA 2025 against
 * the publisher's PDF (online first, pages 1–29) on 2026-10-22. ASRA 2018
 * (fourth edition) is superseded and no longer quoted.
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
  ehraRecentEvent: ehra('Bridging', 34, 'the very few very high-risk situations in which bridging may be discussed include urgent surgery with a high bleeding risk in patients with a recent (≤3 months) thromboembolic event'),

  asraDoseNotIndication: asra('Direct oral anticoagulants', 6, 'the same ‘high’ dose of a DOAC is considered therapeutic when used in a patient for the treatment of DVT and inversely as prophylactic when used in another patient for the prevention of recurrent DVT'),
  asraThresholdUnvalidated: asra('Direct oral anticoagulants', 7, 'although never clinically validated'),
  asraTraumatic: asra('Direct oral anticoagulants', 8, 'in case of a traumatic neuraxial puncture the administration of the next dose of apixaban and rivaroxaban should be delayed for 48 hours and 24 hours, respectively.'),
  asraTraumaticNone: asra('Direct oral anticoagulants', 8, 'There is no such recommendation for dabigatran and edoxaban.'),

  asraApixabanHigh: asra('Apixaban, high dose', 8, 'We suggest that a high dose of apixaban be discontinued at least 72 hours prior to neuraxial block or deep plexus/peripheral block.'),
  asraApixabanHighLevel: asra('Apixaban, high dose', 8, 'We suggest that a residual apixaban plasma level <30 ng/mL or a residual aXa activity plasma level ≤0.1 IU/mL is acceptable prior to neuraxial block or deep plexus/peripheral block'),
  asraApixabanHighRestart: asra('Apixaban, high dose', 8, 'We suggest that needle placement/catheter removal occurs at least 24 hours prior to the first postoperative dose'),
  asraApixabanHighInSitu: asra('Apixaban, high dose', 8, 'With the unanticipated administration of high dose of apixaban with a neuraxial catheter in situ, we suggest that apixaban dosing be withheld for at least 72 hours'),
  asraApixabanLow: asra('Apixaban, low dose', 8, 'We suggest that a low dose of apixaban be discontinued for at least 36 hours prior to neuraxial block or deep plexus/peripheral block.'),
  asraApixabanLowLevel: asra('Apixaban, low dose', 8, 'We suggest that a residual apixaban plasma level <30 ng/mL or a residual aXa activity plasma level ≤0.1 IU/mL is acceptable prior to neuraxial block or deep plexus/peripheral block'),
  asraApixabanLowRestart: asra('Apixaban, low dose', 8, 'We suggest that needle placement/catheter removal occurs at least 6 hours prior to the first postoperative dose'),
  asraApixabanLowInSitu: asra('Apixaban, low dose', 8, 'With the unanticipated administration of low dose of apixaban with a neuraxial catheter in situ, we suggest that apixaban dosing be withheld for at least 36 hours'),

  asraEdoxabanHigh: asra('Edoxaban, high dose', 8, 'We suggest that a high dose of edoxaban be discontinued for at least 72 hours prior to neuraxial block or deep plexus/peripheral block.'),
  asraEdoxabanHighLevel: asra('Edoxaban, high dose', 8, 'We suggest that a residual edoxaban plasma level <30 ng/mL or a residual aXa activity plasma level ≤0.1 IU/mL is acceptable prior to neuraxial block or deep plexus/peripheral block'),
  asraEdoxabanHighRestart: asra('Edoxaban, high dose', 8, 'We suggest that needle placement/catheter removal occurs at least 24 hours prior to the first (postoperative) dose'),
  asraEdoxabanHighInSitu: asra('Edoxaban, high dose', 8, 'With the unanticipated administration of high dose of edoxaban with a neuraxial catheter in situ, we suggest that edoxaban dosing be withheld for at least 72 hours'),
  asraEdoxabanNoLow: asra('Edoxaban, low dose', 8, 'There is no FDA-approved medical indication for low-dose edoxaban.'),

  asraRivaroxabanHigh: asra('Rivaroxaban, high dose', 8, 'We suggest that a high dose of rivaroxaban be discontinued for at least 72 hours prior to neuraxial block or deep plexus/peripheral block.'),
  asraRivaroxabanHighLevel: asra('Rivaroxaban, high dose', 9, 'We suggest that a residual rivaroxaban plasma level <30 ng/mL or a residual aXa activity plasma level ≤0.1 IU/mL is acceptable prior to neuraxial block or deep plexus/peripheral block'),
  asraRivaroxabanHighRestart: asra('Rivaroxaban, high dose', 9, 'We suggest that needle placement/catheter removal occurs at least 24 hours prior to the first postoperative dose'),
  asraRivaroxabanHighInSitu: asra('Rivaroxaban, high dose', 9, 'With the unanticipated administration of high dose of rivaroxaban with a neuraxial catheter in situ, we suggest that rivaroxaban dosing be withheld for at least 72 hours'),
  asraRivaroxabanLow: asra('Rivaroxaban, low dose', 9, 'We suggest that a low dose of rivaroxaban be discontinued for at least 24 hours (30 hours if CrCl <30 mL/min) prior to neuraxial block or deep plexus/peripheral block.'),
  asraRivaroxabanLowLevel: asra('Rivaroxaban, low dose', 9, 'We suggest that a residual rivaroxaban plasma level <30 ng/mL or a residual aXa activity plasma level ≤0.1 IU/mL'),
  asraRivaroxabanLowRestart: asra('Rivaroxaban, low dose', 9, 'We suggest that needle placement/catheter removal occurs at least 6 hours prior to the first postoperative dose'),
  asraRivaroxabanLowInSitu: asra('Rivaroxaban, low dose', 9, 'With the unanticipated administration of low dose of rivaroxaban with a neuraxial catheter in situ, we suggest that rivaroxaban dosing be withheld for at least 24 hours (30 hours if CrCl <30 mL/min)'),

  asraDabigatranHigh50: asra('Dabigatran, high dose', 9, 'We suggest that a high dose of dabigatran be discontinued for at least 72 hours in patients with a CrCl ≥50 mL/min prior to neuraxial block or deep plexus/peripheral block.'),
  asraDabigatranHigh30: asra('Dabigatran, high dose', 9, 'We suggest that a high dose of dabigatran be discontinued for 120 hours in patients with a CrCl 30–49 mL/min prior to neuraxial block or deep plexus/peripheral block.'),
  asraDabigatranBelow30: asra('Dabigatran, high and low dose', 9, 'We suggest against the performance of neuraxial or deep plexus/peripheral blocks in patients with a CrCl <30 mL/min unless a dabigatran plasma level is obtained and <30 ng/mL'),
  asraDabigatranLevel: asra('Dabigatran, high and low dose', 9, 'we suggest that a residual dabigatran plasma level <30 ng/mL is acceptable'),
  asraDabigatranHighRestart: asra('Dabigatran, high dose', 9, 'We suggest that needle placement/catheter removal occurs at least 24 hours prior to the first postoperative dose'),
  asraDabigatranHighInSitu: asra('Dabigatran, high dose', 9, 'we suggest that dabigatran dosing be withheld for at least 72 hours (120 hours if CrCl 30–49 mL/min)'),
  asraDabigatranLow: asra('Dabigatran, low dose', 9, 'We suggest that a low dose of dabigatran be discontinued for at least 48 hours prior to neuraxial block or deep plexus/peripheral block.'),
  asraDabigatranLowRestart: asra('Dabigatran, low dose', 9, 'We suggest that needle placement/catheter removal occurs at least 6 hours prior to the first postoperative dose'),
  asraDabigatranLowInSitu: asra('Dabigatran, low dose', 10, 'we suggest that dabigatran dosing be withheld for at least 48 hours'),
} as const satisfies Record<string, GuidelineCite>

export type AnyCite = LabelCite | GuidelineCite
export const isLabelCite = (cite: AnyCite): cite is LabelCite => 'agent' in cite

export interface PeriopLine {
  text: L
  cites: AnyCite[]
}

export type ProcedureKind = 'af-ablation' | 'minimal' | 'low' | 'high' | 'emergency'
export type Tier = 'minimal' | 'low' | 'high'
/** ASRA's two dose classes: what the dose is, whatever it is prescribed for. */
export type DoseClass = 'high' | 'low'
/** Spinal/epidural or lumbar puncture, or a deep plexus/peripheral block; with or without a catheter. */
export type BlockKind = 'none' | 'single' | 'catheter' | 'plexus' | 'plexus-catheter'

export interface PeriopResult {
  agent?: DoacAgent
  perDay?: number
  crcl: DoacCrcl | null
  /**
   * - `missing`: an input the hours depend on is blank.
   * - `no-hours`: the sources give no interval for this patient (CrCl <15,
   *   dialysis, dabigatran below 30).
   * - `timed`: hours from the tier (and the block's rules).
   * - `ablation`: EHRA Figure 16's own plan.
   * - `emergency`: Figure 12; no interval.
   */
  state: 'missing' | 'no-hours' | 'timed' | 'ablation' | 'emergency'
  /** The tier the hours were read at (neuraxial makes it high). */
  tier?: Tier
  /** ASRA's dose class of the prescription; a blank where it is ambiguous is read as high. */
  doseClass?: DoseClass
  /**
   * The interval between the last dose and the procedure: a minimum to stop
   * for (`timed`, or any block), or the trough the last scheduled dose is
   * checked against (AF ablation, minor risk).
   */
  holdHours?: number
  /** True where `holdHours` is a trough to check, not a minimum to stop for: no dose is skipped. */
  troughOnly?: boolean
  /** Where the interval came from, and what the label says beside it. */
  basis: PeriopLine[]
  /** What the prescription itself calls for first: a VTE loading dose, a prophylactic dose. */
  cautions: PeriopLine[]
  /** The start (`surgery_at`, the puncture when there is one) less `holdHours`: the latest a last dose may be taken. */
  lastDoseBy?: Date
  /** The last scheduled dose to take, from the patient's own dose times. */
  lastDose?: Date
  /** Hours from `lastDose` to the start. */
  hoursFromLastDose?: number
  /** Scheduled doses after `lastDose`, up to and including the start. */
  skippedBefore: Date[]
  /** Minor risk: the scheduled dose too close before the start to reach trough, not taken before; the restart's missed-dose rule decides it. */
  heldBefore?: Date
  resume: {
    lines: PeriopLine[]
    /** The latest of every timed condition; absent while any is unknown. */
    earliest?: Date
    /** The first scheduled dose at or after `earliest`. */
    firstDose?: Date
    /** Scheduled doses after the start (from the start itself when nothing is skipped before) and before `firstDose`. */
    skippedAfter: Date[]
    /** Minor risk, once daily: the dose due at the procedure, taken instead at `firstDose` (the restart). */
    delayed?: Date
    /** What is restarted, by the prescription: the loading phase's own decision, prophylaxis, or the same therapeutic dose. */
    dose?: L
  }
  notes: PeriopLine[]
  /** Inputs the hours still need. */
  missing: string[]
  /** Inputs the clock times or the restart still need. */
  pending: string[]
}

export type PeriopInputKey =
  | 'regimen' | 'dose_intent' | 'age' | 'sex' | 'weight' | 'scr' | 'crcl_manual' | 'dialysis'
  | 'procedure_kind' | 'neuraxial' | 'surgery_at' | 'surgery_end_at' | 'dose_time_1' | 'dose_time_2'
  | 'haemostasis' | 'catheter_removed_at' | 'sheath_removed_at' | 'traumatic_puncture'

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
/** 「12」 or 「11.5」: hours as the plan writes them. */
export const hoursText = (hours: number) => (Number.isInteger(hours) ? String(hours) : hours.toFixed(1))

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

/** The regimens of a VTE loading phase (apixaban 7 days, rivaroxaban 21 days). */
const LOADING = new Set(['apixaban:10:2', 'rivaroxaban:15:2'])

/**
 * ASRA's dose class (its Table 1). Every once-daily dabigatran and
 * rivaroxaban 10 mg are prophylaxis (low); apixaban 2.5 mg bid is low for
 * prophylaxis or extended VTE prevention but high as NVAF's reduced dose, so
 * it is asked. Everything else is a therapeutic (high) dose.
 */
export function asraDoseClass(regimenValue: string | undefined, intent: string | undefined): { doseClass: DoseClass; ambiguous: boolean } {
  const regimen = parseRegimen(regimenValue)
  if (!regimen) return { doseClass: 'high', ambiguous: false }
  if ((regimen.agent === 'dabigatran' && regimen.perDay === 1) || (regimen.agent === 'rivaroxaban' && regimen.mg === 10)) return { doseClass: 'low', ambiguous: false }
  if (regimen.agent === 'apixaban' && regimen.mg === 2.5) {
    return intent === 'low' ? { doseClass: 'low', ambiguous: false } : { doseClass: 'high', ambiguous: intent !== 'high' }
  }
  return { doseClass: 'high', ambiguous: false }
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

/** After a traumatic neuraxial puncture (ASRA 2025, from the labels): apixaban 48 h, rivaroxaban 24 h; none stated for the other two. */
function traumaticDelay(agent: DoacAgent): number | undefined {
  return agent === 'apixaban' ? 48 : agent === 'rivaroxaban' ? 24 : undefined
}

const sameDay = (x: Date, y: Date) => x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()

/**
 * What happens to a dose that falls between the procedure and the restart.
 * EHRA Figure 15 draws minor and low risk dose by dose: twice daily, the dose
 * at the procedure is the star and the next one is optional. The calculator
 * applies that to a minor procedure (`procedureDose`: the dose held before the
 * start, or the first one at or after it that day) and names it only where it
 * is actually omitted; low risk restarts 24 h after the end (Figure 14), which
 * leaves out the optional evening dose. On every other restart day (low and
 * high risk, an ablation, whose figures draw the restart only) the label's
 * missed-dose rule decides whether the last dose before the restart is taken
 * at it, and twice daily never within 6 h (half the interval) of the next
 * one. The calculator never doubles up an earlier one, though two labels would
 * allow it the same day: the line says so and the team decides.
 */
function missedDoseRule(agent: DoacAgent, regimen: { agent: DoacAgent; mg: number; perDay: number }, procedureDose?: Date): { takeAtRestart: (dose: Date, restart: Date, next?: Date) => boolean; line: PeriopLine; procedureMorning: (dose: Date) => boolean } {
  const team = t('計算機只把恢復前最後一劑列為在恢復時服用，不加倍補服更早的劑量；由團隊決定。', 'The calculator moves only the last dose before the restart to it and never doubles up an earlier one; the team decides.')
  if (regimen.perDay === 1) {
    if (agent === 'dabigatran') {
      return { takeAtRestart: () => false, procedureMorning: () => false, line: line(t('處置到恢復之間的那一劑不補服，隔天同一時間繼續（dabigatran 仿單的漏服規則）。', 'A dose between the procedure and the restart is not made up; continue at the same time the next day (the dabigatran label’s missed-dose rule).'), CITES.dabigatranMissed) }
    }
    return {
      takeAtRestart: (dose, restart) => sameDay(dose, restart),
      procedureMorning: () => false,
      line: line(
        t(`處置到恢復之間的那一劑：恢復仍在同一天就延到恢復時服用；已跨日則不補服，隔天照原時間（${agent} 仿單的漏服規則：不在同一天服兩劑）。`, `A dose between the procedure and the restart: taken at the restart when that is the same day; past midnight it is not made up and the usual time follows (the ${agent} label’s missed-dose rule: never two doses in one day).`),
        ...(procedureDose ? [G.ehraFig15] : []), agent === 'edoxaban' ? CITES.edoxabanMissed : regimen.mg === 10 ? CITES.rivaroxabanMissed10 : CITES.rivaroxabanMissed,
      ),
    }
  }
  // EHRA Figure 15, minor risk: the dose at the procedure is not drawn.
  const procedureMorning = (dose: Date) => !!procedureDose && dose.getTime() === procedureDose.getTime()
  // Twice daily, a dose moved to the restart stays ≥6 h (half the interval) from the next: no two doses close together.
  const spaced = (restart: Date, next?: Date) => !!next && (next.getTime() - restart.getTime()) / HOUR >= 6
  if (agent === 'dabigatran') {
    return {
      takeAtRestart: (dose, restart, next) => !procedureMorning(dose) && spaced(restart, next),
      procedureMorning,
      line: line(t('處置到恢復之間：恢復前最後一劑若恢復時距下一劑仍 ≥6 小時，可在恢復時服用，否則不補服（dabigatran 仿單的漏服規則，不服雙倍劑量）。', 'Between the procedure and the restart, the last dose before the restart may be taken at it if the next dose is still ≥6 h away, otherwise it is omitted (the dabigatran label’s missed-dose rule; no double dose).'), CITES.dabigatranMissedBid),
    }
  }
  return {
    takeAtRestart: (dose, restart, next) => !procedureMorning(dose) && sameDay(dose, restart) && spaced(restart, next),
    procedureMorning,
    line: line(
      agent === 'apixaban'
        ? t(`處置到恢復之間：恢復前最後一劑若恢復仍在同一天、且距下一劑仍 ≥6 小時（半個給藥間隔），可在恢復時服用，否則不補服，從下一劑開始。apixaban 仿單另允許早上漏服的那一劑與晚上那一劑一起服；${team.zh}`, `Between the procedure and the restart, the last dose before the restart may be taken at it when that is the same day and the next dose is still ≥6 h (half the interval) away; otherwise it is not made up and the next dose starts. The apixaban label also allows a missed morning dose together with the evening one; ${team.en}`)
        : t(`處置到恢復之間：恢復前最後一劑若恢復仍在同一天、且距下一劑仍 ≥6 小時（半個給藥間隔），可在恢復時服用，否則不補服，從下一劑開始。rivaroxaban 仿單另允許 15 mg bid 期一次服兩顆以補足每天 30 mg；${team.zh}`, `Between the procedure and the restart, the last dose before the restart may be taken at it when that is the same day and the next dose is still ≥6 h (half the interval) away; otherwise it is not made up and the next dose starts. The rivaroxaban label also allows two 15 mg tablets at once in the bid phase to reach 30 mg a day; ${team.en}`),
      agent === 'apixaban' ? CITES.apixabanMissed : CITES.rivaroxabanMissed15bid,
    ),
  }
}

/** EHRA Figure 15's minor-risk row, for the one dose it actually omits. */
const procedureMorningLine = (dose: Date, nextSkipped?: Date): PeriopLine => line(
  nextSkipped
    ? t(`極低風險處置時刻那一劑（${formatLocal(dose)}）不服用、不補服（EHRA Fig 15 的極低風險列）；圖上下一劑可選，但本例恢復時間未到，${formatLocal(nextSkipped)} 那一劑也不服。`, `The dose at the minor procedure (${formatLocal(dose)}) is not taken nor made up (EHRA Figure 15, minor-risk row); the figure makes the next dose optional, but here the restart is later, so the ${formatLocal(nextSkipped)} dose is not taken either.`)
    : t(`極低風險處置時刻那一劑（${formatLocal(dose)}）不服用、不補服，下一劑可選（EHRA Fig 15 的極低風險列）。`, `The dose at the minor procedure (${formatLocal(dose)}) is not taken nor made up; the next dose is optional (EHRA Figure 15, minor-risk row).`),
  G.ehraFig15,
)

interface AsraRule {
  /** Hours before the block; undefined where ASRA advises against it (dabigatran CrCl <30). */
  hours?: number
  hold: GuidelineCite
  /** Hours from needle placement or catheter removal to the first dose. */
  restartHours: 6 | 24
  restart: GuidelineCite
  level: GuidelineCite
  inSitu: GuidelineCite
}

/** ASRA 2025's block rules for one agent at one dose class. */
function asraRule(agent: DoacAgent, doseClass: DoseClass, crcl: number): AsraRule {
  if (agent === 'apixaban') {
    return doseClass === 'high'
      ? { hours: 72, hold: G.asraApixabanHigh, restartHours: 24, restart: G.asraApixabanHighRestart, level: G.asraApixabanHighLevel, inSitu: G.asraApixabanHighInSitu }
      : { hours: 36, hold: G.asraApixabanLow, restartHours: 6, restart: G.asraApixabanLowRestart, level: G.asraApixabanLowLevel, inSitu: G.asraApixabanLowInSitu }
  }
  if (agent === 'rivaroxaban') {
    return doseClass === 'high'
      ? { hours: 72, hold: G.asraRivaroxabanHigh, restartHours: 24, restart: G.asraRivaroxabanHighRestart, level: G.asraRivaroxabanHighLevel, inSitu: G.asraRivaroxabanHighInSitu }
      : { hours: crcl < 30 ? 30 : 24, hold: G.asraRivaroxabanLow, restartHours: 6, restart: G.asraRivaroxabanLowRestart, level: G.asraRivaroxabanLowLevel, inSitu: G.asraRivaroxabanLowInSitu }
  }
  if (agent === 'edoxaban') {
    // ASRA has no low dose of edoxaban: every dose is read as high.
    return { hours: 72, hold: G.asraEdoxabanHigh, restartHours: 24, restart: G.asraEdoxabanHighRestart, level: G.asraEdoxabanHighLevel, inSitu: G.asraEdoxabanHighInSitu }
  }
  if (doseClass === 'low') {
    return { hours: crcl < 30 ? undefined : 48, hold: crcl < 30 ? G.asraDabigatranBelow30 : G.asraDabigatranLow, restartHours: 6, restart: G.asraDabigatranLowRestart, level: G.asraDabigatranLevel, inSitu: G.asraDabigatranLowInSitu }
  }
  return {
    hours: crcl >= 50 ? 72 : crcl >= 30 ? 120 : undefined,
    hold: crcl >= 50 ? G.asraDabigatranHigh50 : crcl >= 30 ? G.asraDabigatranHigh30 : G.asraDabigatranBelow30,
    restartHours: 24, restart: G.asraDabigatranHighRestart, level: G.asraDabigatranLevel, inSitu: G.asraDabigatranHighInSitu,
  }
}

/**
 * The residual-level line. ASRA 2025 names <30 ng/mL (or anti-Xa ≤0.1 IU/mL)
 * as acceptable before a block; it is quoted as written, beside ASRA's own
 * remark that the threshold was never clinically validated and EHRA's that
 * timing by level lacks prospective evidence. No result here clears a patient.
 */
function levelNote(agent: DoacAgent, block: boolean, doseClass: DoseClass, crcl: number | undefined): PeriopLine {
  const assay = agent === 'dabigatran' ? t('dTT', 'dTT') : t(`以 ${agent} 校正的 anti-Xa`, `an anti-Xa assay calibrated to ${agent}`)
  if (!block) {
    return line(
      t(`殘餘藥效：${assay.zh}可估計藥物濃度。依濃度調整停藥時間沒有前瞻性證據；計算機不據以判定可否處置，由手術與麻醉團隊判斷。`, `Residual effect: ${assay.en} estimates the drug level. Timing by level has no prospective evidence; nothing here clears the procedure — the surgical and anaesthetic team decides.`),
      ...(agent === 'dabigatran' ? [] : [ANTI_XA_LABEL[agent]]), G.ehraLevels,
    )
  }
  const level = asraRule(agent, doseClass, crcl ?? 60).level
  return line(
    agent === 'dabigatran'
      ? t('ASRA 2025：阻斷前殘餘 dabigatran 濃度 <30 ng/mL 為「可接受」（原文）。ASRA 註明此閾值未經臨床驗證，EHRA 指出依濃度調整停藥沒有前瞻性證據；計算機只列出原文，不據以判定可否處置，由麻醉與手術團隊判斷。', 'ASRA 2025: a residual dabigatran level <30 ng/mL is “acceptable” before a block (its words). ASRA notes the threshold was never clinically validated, and EHRA that timing by level lacks prospective evidence; this calculator quotes it and clears no one — the anaesthetic and surgical team decides.')
      : t(`ASRA 2025：阻斷前殘餘 ${agent} 濃度 <30 ng/mL，或 anti-Xa 活性 ≤0.1 IU/mL，為「可接受」（原文）。ASRA 註明此閾值未經臨床驗證，EHRA 指出依濃度調整停藥沒有前瞻性證據；計算機只列出原文，不據以判定可否處置，由麻醉與手術團隊判斷。`, `ASRA 2025: a residual ${agent} level <30 ng/mL, or anti-Xa activity ≤0.1 IU/mL, is “acceptable” before a block (its words). ASRA notes the threshold was never clinically validated, and EHRA that timing by level lacks prospective evidence; this calculator quotes it and clears no one — the anaesthetic and surgical team decides.`),
    level, G.asraThresholdUnvalidated, G.ehraLevels,
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
  const block = (values.neuraxial ?? '') as BlockKind | ''
  const dialysis = values.dialysis ?? ''
  const result: PeriopResult = { crcl, state: 'missing', basis: [], cautions: [], skippedBefore: [], resume: { lines: [], skippedAfter: [] }, notes: [], missing: [], pending: [] }
  if (!regimen) result.missing.push('regimen')
  if (kind === '') result.missing.push('procedure_kind')
  if (!regimen) return result
  const agent = regimen.agent
  result.agent = agent
  result.perDay = regimen.perDay

  // What the prescription itself calls for first.
  const { doseClass, ambiguous } = asraDoseClass(values.regimen, values.dose_intent)
  result.doseClass = doseClass
  const loading = LOADING.has(values.regimen ?? '')
  if (loading) {
    result.cautions.push(line(
      t('目前是急性 VTE 的起始劑量（apixaban 前 7 天、rivaroxaban 前 21 天）：擇期處置宜延後。EHRA 的停藥時數以 AF 的治療劑量為準；近 3 個月內的血栓事件是少數可討論橋接的情況，需多科討論。以下時數僅供參考。', 'This is an acute-VTE loading dose (apixaban days 1–7, rivaroxaban days 1–21): an elective procedure is better deferred. EHRA’s hours are for AF’s therapeutic dose; a thromboembolic event within 3 months is one of the few situations where bridging may be discussed, by a multidisciplinary team. The hours below are for reference only.'),
      G.ehraRecentEvent, G.ehraFig14,
    ))
  } else if (doseClass === 'low') {
    result.cautions.push(line(
      t('目前是預防劑量（ASRA 的低劑量）：EHRA 的停藥時數以治療劑量為準；有脊髓／硬膜外或深部阻斷時，術前取 EHRA 與 ASRA 低劑量規則的較長者。', 'This is a prophylactic (ASRA low) dose: EHRA’s hours are for a therapeutic dose; with a spinal/epidural or deep block, the longer of EHRA’s and ASRA’s low-dose interval applies before it.'),
      G.asraDoseNotIndication, G.ehraFig14,
    ))
  }
  if (ambiguous) {
    result.pending.push('dose_intent')
    result.cautions.push(line(
      t('apixaban 2.5 mg bid 在 NVAF 是減量的治療劑量（ASRA 高劑量），在 VTE 延長期或術後預防是低劑量；未填用途，以高劑量（較長間隔）計。', 'Apixaban 2.5 mg bid is NVAF’s reduced therapeutic dose (ASRA high) but a low dose for extended VTE prevention or post-operative prophylaxis; with the use unanswered, the high-dose (longer) intervals apply.'),
      G.asraDoseNotIndication,
    ))
  }

  if (kind === 'emergency') {
    result.state = 'emergency'
    result.notes.push(line(t('立即停藥。', 'Stop the DOAC now.'), G.ehraEmergency))
    result.notes.push(line(t('抽完整凝血檢查（PT、aPTT、anti-FXa、dTT…）。可安全延後 12–24 小時就延後並重抽；不能延後才考慮逆轉（若必要、可取得、已核准）。', 'Draw a full coagulation panel (PT, aPTT, anti-FXa, dTT…). If 12–24 h of delay is safe, delay and repeat it; reversal only if surgery cannot wait (if necessary, available and approved).'), G.ehraFig12))
    if (agent === 'dabigatran') {
      result.notes.push(line(t('需要快速逆轉時：idarucizumab；血液透析也可移除 dabigatran。', 'When rapid reversal is needed: idarucizumab; haemodialysis also removes dabigatran.'), CITES.dabigatranIdarucizumab, CITES.dabigatranDialysable))
      result.notes.push(line(t('恢復 dabigatran 最早在給 idarucizumab 後 24 小時，且需臨床穩定、已止血；這只是條件之一，仍要同時符合手術本身與麻醉阻斷的恢復時間。', 'Dabigatran restarts no earlier than 24 h after idarucizumab, once stable with haemostasis — one condition among others: the procedure’s and any block’s restart times still apply.'), CITES.dabigatranIdarucizumabRestart))
    } else {
      result.notes.push(line(
        t('Xa 抑制劑：andexanet 不作為術前通用逆轉——EU 只核准用於危及生命或無法控制的出血，ANNEXA-4 也未納入緊急手術病人。是否給止血製劑依院內流程。', 'FXa inhibitors: andexanet is not a general pre-operative reversal — EU approval covers life-threatening or uncontrolled bleeding only, and ANNEXA-4 enrolled no emergency surgery. Haemostatic agents per hospital protocol.'),
        G.ehraAndexanet, G.ehraAnnexa,
      ))
    }
    // A block's restart rule holds after an emergency too: never resume past a catheter.
    const emergencyBlock = (values.neuraxial ?? '') as BlockKind | ''
    if (emergencyBlock !== 'none') {
      const rule = asraRule(agent, doseClass, c ?? 60)
      const removal = emergencyBlock === 'catheter' || emergencyBlock === 'plexus-catheter'
      result.notes.push(line(
        emergencyBlock === ''
          ? t(`若有脊髓／硬膜外或深部阻斷：第一劑需在穿刺或拔管後 ≥${rule.restartHours} 小時（ASRA 2025，${doseClass === 'high' ? '高' : '低'}劑量），導管未拔前不恢復。`, `If there is a spinal/epidural or deep block: the first dose waits ≥${rule.restartHours} h after the puncture or catheter removal (ASRA 2025, ${doseClass} dose); no restart with a catheter in place.`)
          : t(`有${removal ? '留置導管' : '阻斷'}：第一劑需在穿刺${removal ? '與拔管' : ''}後 ≥${rule.restartHours} 小時（ASRA 2025，${doseClass === 'high' ? '高' : '低'}劑量）${removal ? '，導管未拔前不恢復' : ''}。`, `With a ${removal ? 'catheter' : 'block'}: the first dose waits ≥${rule.restartHours} h after the puncture${removal ? ' and the catheter removal' : ''} (ASRA 2025, ${doseClass} dose)${removal ? '; no restart with the catheter in place' : ''}.`),
        rule.restart,
      ))
      // A traumatic neuraxial puncture delays the restart further, here as anywhere.
      if (emergencyBlock === '' || emergencyBlock === 'single' || emergencyBlock === 'catheter') {
        const delay = traumaticDelay(agent)
        const traumatic = values.traumatic_puncture ?? ''
        if (traumatic === 'yes') {
          result.notes.push(delay === undefined
            ? line(t(`脊髓／硬膜外穿刺出血：${agent} 的仿單與 ASRA 都沒有給延後時數，恢復時間請與麻醉科確認。`, `Traumatic neuraxial puncture: neither the ${agent} label nor ASRA gives a delay; agree the restart with anaesthesia.`), G.asraTraumaticNone)
            : line(t(`脊髓／硬膜外穿刺出血：自穿刺起延後 ${delay} 小時，與上述條件取最晚者。`, `Traumatic neuraxial puncture: delay ${delay} h from the puncture, whichever is latest of the conditions above.`), G.asraTraumatic, ...(agent === 'rivaroxaban' ? [CITES.rivaroxabanTraumatic] : [])))
        } else if (traumatic === '') {
          result.notes.push(line(t('若脊髓／硬膜外穿刺出血：apixaban 自穿刺起延後 48 小時、rivaroxaban 24 小時；dabigatran、edoxaban 沒有給時數，需與麻醉科確認。', 'If the neuraxial puncture was traumatic: apixaban waits 48 h and rivaroxaban 24 h from it; dabigatran and edoxaban have no stated delay — agree it with anaesthesia.'), G.asraTraumatic, G.asraTraumaticNone))
        }
      }
    }
    result.notes.push(levelNote(agent, false, doseClass, c))
    return result
  }

  if (block === '') result.missing.push('neuraxial')
  if (c === undefined) result.missing.push('CrCl')
  if (dialysis === '') result.missing.push('dialysis')
  const blockUsed = block !== '' && block !== 'none'
  const neuraxialUsed = block === 'single' || block === 'catheter'
  const catheter = block === 'catheter' || block === 'plexus-catheter'

  // No interval exists for these; the 15–29 row is not borrowed.
  const noIndication = dialysis === 'yes' || (c !== undefined && c < 15)
  const dabigatranOff = agent === 'dabigatran' && c !== undefined && c < 30
  if (noIndication || dabigatranOff) {
    result.state = 'no-hours'
    result.missing = result.missing.filter((key) => key !== 'CrCl' && key !== 'dialysis')
    result.basis.push(noIndication
      ? line(t(`${dialysis === 'yes' ? '透析' : `CrCl ${crclLabel(c!)} <15`}：EHRA 無正式停藥時數（No official indication for use），需個別評估，建議會診。`, `${dialysis === 'yes' ? 'Dialysis' : `CrCl ${crclLabel(c!)} <15`}: EHRA gives no interval (no official indication for use); individual assessment, consult.`), G.ehraFig14)
      : line(t(`dabigatran CrCl ${crclLabel(c!)} <30：仿單禁忌，EHRA 列為 Not indicated，不給停藥時數。`, `Dabigatran, CrCl ${crclLabel(c!)} <30: contraindicated in the label, not indicated in EHRA; no interval given.`), CITES.dabigatranRenal, G.ehraFig14))
    if (agent === 'dabigatran' && c !== undefined && c < 30 && block !== 'none') {
      result.basis.push(line(block === ''
        ? t('若有脊髓／硬膜外或深部神經叢／周邊阻斷：ASRA 2025 建議 CrCl <30 不做，除非已測 dabigatran 濃度且 <30 ng/mL。', 'If a spinal/epidural or deep plexus/peripheral block is planned: ASRA 2025 advises against it at CrCl <30 unless a dabigatran level is obtained and <30 ng/mL.')
        : t('ASRA 2025：CrCl <30 建議不做神經軸或深部阻斷，除非已測 dabigatran 濃度且 <30 ng/mL。', 'ASRA 2025: no neuraxial or deep block at CrCl <30 unless a dabigatran level is obtained and <30 ng/mL.'), G.asraDabigatranBelow30))
    }
    result.notes.push(levelNote(agent, blockUsed, doseClass, c), line(t('不以 LMWH／UFH 橋接。', 'No LMWH/UFH bridging.'), G.ehraBridging))
    return result
  }
  if (result.missing.length) return result

  const crclValue = c!
  let hours: number
  let tier: Tier | undefined
  if (kind === 'af-ablation') {
    result.state = 'ablation'
    hours = 12
    if (blockUsed) {
      // A block's ASRA interval replaces the ablation's minimal interruption: never both.
      result.basis.push(line(t('AF 導管消融合併脊髓／硬膜外或深部阻斷：改依下方 ASRA 的停藥時數，不適用消融的「不中斷或最小中斷」。', 'AF catheter ablation with a spinal/epidural or deep block: ASRA’s interval below applies instead of the ablation’s “uninterrupted or minimally interrupted”.'), G.ehraFig16))
    } else {
      result.basis.push(line(t('AF 導管消融：不中斷或最小中斷；最後一劑預設術前 12 小時（可至 24 小時），不套一般高風險流程。', 'AF catheter ablation: uninterrupted or minimally interrupted; last dose 12 h before by default (up to 24 h), not the general high-risk flow.'), G.ehraFig16, G.ehraAblation, G.ehraTable12Minor))
      if (agent === 'apixaban') result.basis.push(line(t('仿單：AF 消融時 apixaban 不需中斷。', 'Label: apixaban need not be interrupted for AF ablation.'), CITES.apixabanAblation))
    }
    if (agent === 'dabigatran' && regimen.mg === 110) result.notes.push(line(t('仿單：dabigatran 110 mg bid 用於 AF 消融沒有資料。', 'Label: no data for dabigatran 110 mg bid in AF ablation.'), CITES.dabigatranAblation110))
  } else {
    result.state = 'timed'
    tier = neuraxialUsed ? 'high' : kind as Tier
    if (neuraxialUsed && kind !== 'high') {
      result.basis.push(line(t('有脊髓／硬膜外麻醉或穿刺：屬高出血風險處置，不論手術本身分級。', 'Spinal/epidural anaesthesia or puncture: a high-risk intervention whatever the procedure’s own tier.'), G.ehraTable12Neuraxial))
    }
    if (tier === 'minimal') {
      hours = regimen.perDay === 2 ? 12 : 24
      // With a deep block, ASRA's interval replaces the trough: no 「不提前停藥」 beside it.
      result.basis.push(blockUsed
        ? line(t('極低風險，但有深部神經叢／周邊阻斷：改依下方 ASRA 的停藥時數，不適用「在谷底做、不提前停藥」。', 'Minor risk, but with a deep plexus/peripheral block: ASRA’s interval below applies instead of “at trough, not stopped early”.'), G.ehraFig14)
        : line(regimen.perDay === 1
          ? t(`極低風險：在谷底濃度做（最後一劑後約 ${hours} 小時）；不提前停藥；距開始不到谷底一半間隔的那一劑不在處置前服用。處置前未服及處置到恢復之間的那一劑，依下方恢復段落的漏服規則處理。`, `Minor risk: at trough (about ${hours} h after the last dose); nothing stopped early, but a dose due too close before the start is not taken before it. That dose and any dose falling between the procedure and the restart follow the missed-dose rule in the restart section below.`)
          : t(`極低風險：在谷底濃度做（最後一劑後約 ${hours} 小時）；不提前停藥；距開始不到谷底一半間隔的那一劑不在處置前服用。處置前未服及處置到恢復之間的劑量，依下方恢復段落的規則處理。`, `Minor risk: at trough (about ${hours} h after the last dose); nothing stopped early, but a dose due too close before the start is not taken before it. That dose and any doses between the procedure and the restart follow the rule in the restart section below.`),
          G.ehraFig14, G.ehraFig15))
    } else {
      const pair = ehraHours(agent, crclValue)!
      hours = tier === 'high' ? pair[1] : pair[0]
      result.basis.push(line(t(`EHRA：${tier === 'high' ? '高' : '低'}出血風險、CrCl ${crclLabel(crclValue)}，最後一劑距手術 ≥${hours} 小時`, `EHRA: ${tier} bleeding risk, CrCl ${crclLabel(crclValue)}: last dose ≥${hours} h before`), G.ehraFig14))
      result.basis.push(labelInterval(agent, tier, crclValue))
    }
    result.tier = tier
  }

  // A block: ASRA 2025 by dose class, the longer of it and the tier's.
  const rule = blockUsed ? asraRule(agent, doseClass, crclValue) : undefined
  if (rule) {
    const what = neuraxialUsed ? t('脊髓／硬膜外麻醉或腰椎穿刺', 'spinal/epidural or lumbar puncture') : t('深部神經叢／周邊神經阻斷', 'deep plexus/peripheral block')
    const dose = doseClass === 'high' ? t('高劑量（治療）', 'high (therapeutic) dose') : t('低劑量（預防）', 'low (prophylactic) dose')
    // Dabigatran below 30, the only case ASRA gives no hours, has already returned as 「no-hours」.
    if (rule.hours !== undefined) {
      result.basis.push(line(t(`ASRA 2025，${dose.zh}：${what.zh}前停 ≥${rule.hours} 小時`, `ASRA 2025, ${dose.en}: ≥${rule.hours} h before the ${what.en}`), rule.hold, ...(agent === 'edoxaban' && doseClass === 'low' ? [G.asraEdoxabanNoLow] : [])))
      if (rule.hours > hours) {
        result.basis.push(line(t(`取較長者：${rule.hours} 小時（ASRA）`, `The longer applies: ${rule.hours} h (ASRA)`)))
        hours = rule.hours
      } else {
        const ehraWhat = result.state === 'ablation' ? t('AF 消融', 'AF ablation') : tier === 'high' ? t('高風險', 'high risk') : tier === 'low' ? t('低風險', 'low risk') : t('極低風險', 'minor risk')
        result.basis.push(line(t(`取較長者：${hours} 小時（EHRA ${ehraWhat.zh}）${rule.hours === hours ? '，與 ASRA 相同' : ''}`, `The longer applies: ${hours} h (EHRA, ${ehraWhat.en})${rule.hours === hours ? ', the same as ASRA' : ''}`), result.state === 'ablation' ? G.ehraFig16 : G.ehraFig14))
      }
    }
  }
  result.holdHours = hours
  // AF ablation and a minor-risk procedure keep the last scheduled dose: the
  // hours are the trough it is checked against, not a minimum to stop for.
  const troughOnly = !blockUsed && (result.state === 'ablation' || tier === 'minimal')
  if (troughOnly) result.troughOnly = true

  if (result.state === 'timed' && !troughOnly) {
    const weight = Number(values.weight)
    result.notes.push(line(
      t(`考慮再延長（不自動加入）：有累積風險（腎功能不全、高齡、併用藥）時可提早 12–24 小時停藥；體重 <50 kg 或顯著交互作用時考慮多停 24 小時${values.weight && weight < 50 ? `。本例體重 ${weight} kg <50。` : '。'}`, `Consider longer (not added automatically): with a risk of accumulation (renal insufficiency, older age, co-medication) stop 12–24 h earlier; with body weight <50 kg or significant interactions consider +24 h${values.weight && weight < 50 ? `. Weight here ${weight} kg <50.` : '.'}`),
      G.ehraFig14, G.ehraFig15,
    ))
  }
  if (rule && catheter && rule.hours !== undefined) {
    result.notes.push(line(
      t(`留置導管期間若意外給了藥：拔管前需停藥 ≥${rule.hours} 小時，或殘餘濃度 <30 ng/mL${agent === 'dabigatran' ? '' : '（或 anti-Xa ≤0.1 IU/mL）'}（ASRA 2025 原文）。`, `If a dose is given unexpectedly with the catheter in place: withhold ≥${rule.hours} h before removing it, or a residual level <30 ng/mL${agent === 'dabigatran' ? '' : ' (or anti-Xa ≤0.1 IU/mL)'} (ASRA 2025).`),
      rule.inSitu,
    ))
  }
  result.notes.push(levelNote(agent, blockUsed, doseClass, crclValue), line(t('不以 LMWH／UFH 橋接。', 'No LMWH/UFH bridging.'), G.ehraBridging))

  // Clock times: the start (the puncture, if any) for the interval before, the
  // end for the interval after, and the patient's own dose times.
  const surgery = parseLocalDateTime(values.surgery_at)
  // An end before the start is a typing error, not an early restart.
  const endedAt = parseLocalDateTime(values.surgery_end_at)
  const endBeforeStart = !!(endedAt && surgery && endedAt.getTime() < surgery.getTime())
  const ended = endBeforeStart ? undefined : endedAt
  if (!surgery) result.pending.push('surgery_at')
  const timeKeys = (['dose_time_1', 'dose_time_2'] as const).slice(0, regimen.perDay)
  const minutes = timeKeys.map((key) => parseClock(values[key]))
  // Two equal dose times are a typing error: no dose is counted from them until corrected.
  const sameTimes = minutes.length === 2 && minutes[0] !== undefined && minutes[0] === minutes[1]
  const known = !sameTimes && minutes.every((m): m is number => m !== undefined)
  if (sameTimes) {
    result.cautions.push(line(t('兩個服藥時刻相同：請更正，未更正前不列劑次。', 'The two dose times are the same: correct them; no doses are listed until then.')))
    result.pending.push('dose_time_2')
  } else if (!known) result.pending.push(...timeKeys.filter((_, index) => minutes[index] === undefined))
  if (surgery && troughOnly) {
    if (known) {
      // The last scheduled dose before the start; one so close that the start is nearer its peak than
      // its trough (more than half a dosing interval short) is not taken before the procedure.
      const interval = 24 / regimen.perDay
      const before = scheduledDoses(minutes, addHours(surgery, -72), surgery).filter((at) => at.getTime() < surgery.getTime())
      let last = before[before.length - 1]
      const gapOf = (at: Date) => (surgery.getTime() - at.getTime()) / HOUR
      if (last && result.state !== 'ablation' && hours - gapOf(last) > interval / 2) {
        result.heldBefore = last
        result.skippedBefore = [last]
        last = before[before.length - 2]
      }
      if (last) {
        result.lastDose = last
        const gap = gapOf(last)
        result.hoursFromLastDose = gap
        if (result.heldBefore) {
          result.cautions.push(line(
            t(`${formatLocal(result.heldBefore)} 那一劑距開始只有 ${hoursText(gapOf(result.heldBefore))} 小時，未到谷底：處置前不服，改依恢復段落的漏服規則；上一劑 ${formatLocal(last)} 距開始 ${hoursText(gap)} 小時。也可把處置排到該劑後約 ${hours} 小時，由團隊決定。`, `The ${formatLocal(result.heldBefore)} dose is only ${hoursText(gapOf(result.heldBefore))} h before the start, short of trough: not taken before the procedure, but per the restart section’s missed-dose rule; the dose before, at ${formatLocal(last)}, is ${hoursText(gap)} h before the start. Or schedule the procedure about ${hours} h after that dose; the team decides.`),
            G.ehraFig14, G.ehraFig15,
          ))
        } else if (gap < hours) {
          result.cautions.push(line(
            result.state === 'ablation'
              ? t(`最後一劑 ${formatLocal(last)} 距消融 ${hoursText(gap)} 小時，短於 EHRA 預設的 12 小時：可與團隊確認是否照常（EHRA 也接受不中斷），或調整服藥或消融時間；計算機不替你跳過這一劑。`, `The last dose at ${formatLocal(last)} is ${hoursText(gap)} h before the ablation, under EHRA’s default 12 h: confirm with the team whether to keep it (EHRA also accepts no interruption), or move the dose or the procedure; the calculator does not skip it for you.`)
              : t(`最後一劑 ${formatLocal(last)} 距處置 ${hoursText(gap)} 小時，短於谷底的 ${hours} 小時（差距不到半個給藥間隔，照常服用）：可將處置延後 ${hoursText(hours - gap)} 小時，由團隊決定。`, `The last dose at ${formatLocal(last)} is ${hoursText(gap)} h before the procedure, short of the ${hours} h trough (by less than half a dosing interval, so it is taken): the procedure may move ${hoursText(hours - gap)} h later; the team decides.`),
            result.state === 'ablation' ? G.ehraFig16 : G.ehraFig14,
          ))
        }
      }
    }
  } else if (surgery) {
    result.lastDoseBy = addHours(surgery, -hours)
    if (known) {
      const before = scheduledDoses(minutes, addHours(result.lastDoseBy, -48), surgery)
      const last = [...before].reverse().find((at) => at.getTime() <= result.lastDoseBy!.getTime())
      if (last) {
        result.lastDose = last
        result.hoursFromLastDose = (surgery.getTime() - last.getTime()) / HOUR
      }
      result.skippedBefore = before.filter((at) => at.getTime() > (last ?? result.lastDoseBy!).getTime())
      // A dose just short of the interval should not silently cost a whole extra dosing interval
      // (EHRA Figure 15 draws the morning taker's Day −1 dose as optional): say how to keep it.
      const firstSkipped = result.skippedBefore[0]
      const interval = 24 / regimen.perDay
      if (last && firstSkipped && result.hoursFromLastDose! - hours >= interval / 2) {
        // Only a later procedure keeps that dose: taking it early would crowd the dose before it.
        const short = hours - (surgery.getTime() - firstSkipped.getTime()) / HOUR
        result.cautions.push(line(
          t(`依實際服藥時刻，最後一劑是 ${formatLocal(last)}，停藥 ${hoursText(result.hoursFromLastDose!)} 小時，比所需 ${hours} 小時多約一次給藥間隔：若處置延後 ${hoursText(short)} 小時，${formatLocal(firstSkipped)} 那一劑就可照常服用；不建議提前服藥。由團隊決定。`, `By the actual dose times the last dose is ${formatLocal(last)}, ${hoursText(result.hoursFromLastDose!)} h off against the ${hours} h needed — about one dosing interval more: moving the procedure ${hoursText(short)} h later keeps the ${formatLocal(firstSkipped)} dose; taking a dose early is not advised. The team decides.`),
          G.ehraFig14,
        ))
      }
    }
  }

  // Restart: the latest of every timed condition; haemostasis always.
  const restart: { at?: Date; line: PeriopLine; key?: string }[] = []
  if (result.state === 'ablation') {
    // EHRA Figure 16: 3–5 h after sheath removal; the earliest is its 3 h, the rest is the team's.
    const sheathAt = parseLocalDateTime(values.sheath_removed_at)
    const sheathBeforeStart = !!(sheathAt && surgery && sheathAt.getTime() < surgery.getTime())
    const sheathBeforeEnd = !sheathBeforeStart && !!(sheathAt && ended && sheathAt.getTime() < ended.getTime())
    const sheath = sheathBeforeStart || sheathBeforeEnd ? undefined : sheathAt
    if (sheathBeforeStart) restart.push({ line: line(t('拔 sheath 時刻早於開始時刻：請更正', 'Sheath removal is before the start: correct it')), key: 'sheath_removed_at' })
    if (sheathBeforeEnd) restart.push({ line: line(t('拔 sheath 時刻早於處置結束時刻：請更正，未更正前不算恢復時間', 'Sheath removal is before the end of the procedure: correct it; no restart time until then')), key: 'sheath_removed_at' })
    restart.push({
      at: sheath ? addHours(sheath, 3) : undefined,
      line: line(t(sheath ? '拔除 sheath 後 3–5 小時恢復（最早 3 小時），恢復前排除心包填塞與其他大出血。' : '拔除 sheath 後 3–5 小時恢復，恢復前排除心包填塞與其他大出血；填入拔 sheath 時刻才算恢復時間。', sheath ? 'Resume 3–5 h after sheath removal (3 h at the earliest), once tamponade and other major bleeding are ruled out.' : 'Resume 3–5 h after sheath removal, once tamponade and other major bleeding are ruled out; enter the removal time for a restart time.'), G.ehraFig16),
      key: sheath ? undefined : 'sheath_removed_at',
    })
  } else {
    const after = tier === 'minimal' ? 6 : tier === 'low' ? 24 : 48
    restart.push({
      at: ended ? addHours(ended, after) : undefined,
      line: line(t(
        tier === 'minimal' ? '極低風險：手術結束後 ≥6 小時恢復' : tier === 'low' ? '低風險：手術結束後 24 小時恢復（EHRA Fig 15 低風險列另把處置當晚一劑畫為可選；計算機不列入，由團隊決定）' : '高風險：手術結束後 48（–72）小時恢復；其間依院內流程考慮預防劑量 heparin',
        tier === 'minimal' ? 'Minor risk: restart ≥6 h after the end' : tier === 'low' ? 'Low risk: restart 24 h after the end (Figure 15’s low-risk row also draws an optional dose that evening; the calculator leaves it out, the team decides)' : 'High risk: restart 48 (–72) h after the end; prophylactic-dose heparin per hospital protocol meanwhile',
      ), G.ehraFig14, G.ehraFig15),
      key: ended ? undefined : 'surgery_end_at',
    })
    if (endBeforeStart) restart.push({ line: line(t('結束時刻早於開始時刻：請更正，未更正前不算恢復時間', 'The end is before the start: correct it; no restart time until then')), key: 'surgery_end_at' })
  }
  if (rule) {
    // ASRA: the first dose waits after needle placement (the start) and after catheter removal.
    const dose = doseClass === 'high' ? t('高劑量', 'high dose') : t('低劑量', 'low dose')
    restart.push({
      at: surgery ? addHours(surgery, rule.restartHours) : undefined,
      line: line(t(`ASRA 2025（${dose.zh}）：穿刺後 ≥${rule.restartHours} 小時才給第一劑`, `ASRA 2025 (${dose.en}): first dose ≥${rule.restartHours} h after needle placement`), rule.restart),
      key: surgery ? undefined : 'surgery_at',
    })
    if (catheter) {
      const removedAt = parseLocalDateTime(values.catheter_removed_at)
      const removedBeforeStart = !!(removedAt && surgery && removedAt.getTime() < surgery.getTime())
      const removed = removedBeforeStart ? undefined : removedAt
      if (removedBeforeStart) restart.push({ line: line(t('拔管時刻早於開始時刻：請更正', 'Catheter removal is before the start: correct it')), key: 'catheter_removed_at' })
      const labelCatheter = agent === 'apixaban' ? [t('仿單 ≥5 小時', 'label ≥5 h'), CITES.apixabanCatheter] as const
        : agent === 'rivaroxaban' ? [t('仿單 ≥6 小時', 'label ≥6 h'), CITES.rivaroxabanCatheter] as const
          : agent === 'dabigatran' ? [t('仿單 ≥2 小時', 'label ≥2 h'), CITES.dabigatranCatheter] as const
            : [t('仿單未述', 'label silent'), undefined] as const
      restart.push({
        at: removed ? addHours(removed, rule.restartHours) : undefined,
        line: line(
          t(`拔管後 ≥${rule.restartHours} 小時才給下一劑（ASRA 2025，${dose.zh}；${labelCatheter[0].zh}，取較長的 ${rule.restartHours} 小時）`, `Next dose ≥${rule.restartHours} h after catheter removal (ASRA 2025, ${dose.en}; ${labelCatheter[0].en}; the longer ${rule.restartHours} h applies)`),
          rule.restart, ...(labelCatheter[1] ? [labelCatheter[1]] : []),
        ),
        key: removed ? undefined : 'catheter_removed_at',
      })
    }
  }
  if (neuraxialUsed) {
    const traumatic = values.traumatic_puncture ?? ''
    const delay = traumaticDelay(agent)
    if (traumatic === '') {
      restart.push({ line: line(t('穿刺是否出血未填：若出血，apixaban 延後 48 小時、rivaroxaban 延後 24 小時', 'Traumatic puncture unanswered: if so, apixaban waits 48 h and rivaroxaban 24 h'), G.asraTraumatic), key: 'traumatic_puncture' })
    } else if (traumatic === 'yes') {
      restart.push(delay === undefined
        ? { line: line(t(`穿刺出血：${agent} 的仿單與 ASRA 都沒有給延後時數，請與麻醉科確認後再定恢復時間`, `Traumatic puncture: neither the ${agent} label nor ASRA gives a delay; agree the restart with anaesthesia`), G.asraTraumaticNone), key: 'anaesthesia' }
        : {
          at: surgery ? addHours(surgery, delay) : undefined,
          line: line(t(`穿刺出血：自穿刺起延後 ${delay} 小時`, `Traumatic puncture: delay ${delay} h from the puncture`), G.asraTraumatic, ...(agent === 'rivaroxaban' ? [CITES.rivaroxabanTraumatic] : [])),
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
  // What is restarted depends on the prescription; the results show this one wording.
  result.resume.dose = loading
    ? t('劑量依 VTE 治療進度確認（起始期是否已完成），不自動接回起始劑量', 'dose per where VTE treatment stands (whether the loading phase is complete); the loading dose is not resumed automatically')
    : doseClass === 'low'
      ? t('給回預防劑量，療程依原本的預防計畫', 'the prophylactic dose; the course follows the original prophylaxis plan')
      : t('給回術前的治療劑量，不需起始負荷', 'the pre-procedure therapeutic dose; no loading dose')
  restart.push({ line: line(t(`恢復時：${result.resume.dose.zh}。`, `On restart: ${result.resume.dose.en}.`)) })
  result.resume.lines = restart.map((item) => item.line)
  const open = restart.filter((item) => item.key).map((item) => item.key!)
  result.pending.push(...open)
  // EHRA Figure 15's minor-risk row omits the dose at the procedure: the one held before it, or the first at or after it that day.
  const procedureDose = known && surgery && troughOnly && result.state !== 'ablation' && regimen.perDay === 2
    ? result.heldBefore ?? scheduledDoses(minutes as number[], surgery, addHours(surgery, 24)).find((at) => at.getTime() >= surgery.getTime() && sameDay(at, surgery))
    : undefined
  if (!open.length && restart.some((item) => item.at)) {
    const earliest = new Date(Math.max(...restart.filter((item) => item.at).map((item) => item.at!.getTime())))
    result.resume.earliest = earliest
    if (known && surgery) {
      const after = scheduledDoses(minutes as number[], surgery, addHours(earliest, 24))
      const first = after.find((at) => at.getTime() >= earliest.getTime())
      // With nothing skipped before, a dose due at the start itself is not lost between the two lists.
      const between = [
        ...(result.heldBefore ? [result.heldBefore] : []),
        ...after.filter((at) => (troughOnly ? at.getTime() >= surgery.getTime() : at.getTime() > surgery.getTime()) && (!first || at.getTime() < first.getTime())),
      ]
      const rule = missedDoseRule(agent, regimen, procedureDose)
      // Only the last dose before the restart can still be taken at it; every earlier one is not made up.
      const candidate = between[between.length - 1]
      if (candidate && rule.takeAtRestart(candidate, earliest, first)) {
        result.resume.delayed = candidate
        result.resume.firstDose = earliest
        result.resume.skippedAfter = between.slice(0, -1)
      } else {
        if (first) result.resume.firstDose = first
        result.resume.skippedAfter = between
      }
      if (between.length) result.resume.lines.push(rule.line)
      // The held dose is listed once: where it is skipped before, or as the dose taken at the restart.
      if (result.heldBefore) {
        result.resume.skippedAfter = result.resume.skippedAfter.filter((at) => at !== result.heldBefore)
        if (result.resume.delayed === result.heldBefore) result.skippedBefore = []
      }
      const omitted = [...result.skippedBefore.filter((at) => at === result.heldBefore), ...result.resume.skippedAfter].find(rule.procedureMorning)
      if (omitted) result.resume.lines.push(procedureMorningLine(omitted, result.resume.skippedAfter.find((at) => at.getTime() > omitted.getTime() && sameDay(at, omitted))))
    }
  } else if (known && surgery && (result.state === 'timed' || result.state === 'ablation')) {
    // No restart time yet: still say which doses wait for it, so none is taken at the procedure by habit.
    const next = scheduledDoses(minutes as number[], surgery, addHours(surgery, 24)).find((at) => troughOnly ? at.getTime() >= surgery.getTime() : at.getTime() > surgery.getTime())
    if (next || result.heldBefore) {
      const from = result.heldBefore ?? next!
      result.resume.lines.push(line(t(`恢復時間未定：${formatLocal(from)} 起的劑量先不服，恢復時間確定後依漏服規則處理。`, `Restart not yet known: doses from ${formatLocal(from)} wait, then follow the missed-dose rule once the restart is set.`)))
      result.resume.lines.push(missedDoseRule(agent, regimen, procedureDose).line)
      if (procedureDose) result.resume.lines.push(procedureMorningLine(procedureDose))
    }
  }
  result.pending = [...new Set(result.pending)]
  return result
}

/** How an input the plan still needs is named where it is asked for. */
export const PERIOP_FIELD_LABELS: Record<string, L> = {
  regimen: { zh: '目前 DOAC 處方', en: 'current DOAC' },
  dose_intent: { zh: '劑量用途（治療或預防）', en: 'dose use (therapeutic or prophylactic)' },
  procedure_kind: { zh: '處置分級', en: 'procedure tier' },
  neuraxial: { zh: '脊髓／硬膜外或深部阻斷', en: 'neuraxial or deep block' },
  CrCl: { zh: 'CrCl（年齡、性別、體重、Cr）', en: 'CrCl (age, sex, weight, creatinine)' },
  dialysis: { zh: '透析', en: 'dialysis' },
  surgery_at: { zh: '開始時刻（穿刺）', en: 'start (puncture) time' },
  surgery_end_at: { zh: '手術結束時刻', en: 'end time' },
  dose_time_1: { zh: '服藥時刻 1', en: 'dose time 1' },
  dose_time_2: { zh: '服藥時刻 2', en: 'dose time 2' },
  catheter_removed_at: { zh: '拔管時刻', en: 'catheter removal time' },
  sheath_removed_at: { zh: '拔 sheath 時刻', en: 'sheath removal time' },
  traumatic_puncture: { zh: '穿刺是否出血', en: 'traumatic puncture' },
  haemostasis: { zh: '止血', en: 'haemostasis' },
  // Not an input: the restart waits on anaesthesia's word (a traumatic puncture with no stated delay).
  anaesthesia: { zh: '需與麻醉科確認', en: 'agree with anaesthesia' },
}

/** 「11-03 08:00」 in local time. */
export function formatLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
