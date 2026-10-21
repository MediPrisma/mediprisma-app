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
 * Scope: adults, by indication — NVAF, acute VTE treatment, extended
 * prevention of recurrent VTE, and prophylaxis after hip or knee replacement.
 * The VTE indications have their own dose rules (`vteDose`), never NVAF's
 * reductions; edoxaban and dabigatran share one table across NVAF and VTE in
 * their own SmPC, and say so. Peri-procedural interruption is
 * `doac-periop-model.ts`; paediatric dosing is not computed.
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
export const DOAC_RULES_VERSION = 'eu-smpc-nvaf-vte-2026-10-21'

export interface LabelCite {
  agent: DoacAgent
  section: string
  /** Physical page of the EMA product-information PDF. */
  page: number
  quote: string
  /**
   * The strength's SmPC inside that PDF, where it is not the one
   * `LABEL_SOURCES` names (Eliquis 2.5 mg for hip/knee prophylaxis, Xarelto
   * 10 mg for the same).
   */
  document?: string
}

const cite = (agent: DoacAgent, section: string, page: number, quote: string, document?: string): LabelCite => ({ agent, section, page, quote, ...(document ? { document } : {}) })

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

  // VTE treatment, extended prevention and hip/knee prophylaxis.
  apixabanMissed: cite('apixaban', '4.2', 37, 'A missed morning dose should be taken immediately when it is noticed, and it may be taken together with the evening dose. A missed evening dose can only be taken during the same evening, the patient should not take two doses the next morning.'),
  apixabanVteAcute: cite('apixaban', '4.2', 37, 'The recommended dose of apixaban for the treatment of acute DVT and treatment of PE is 10 mg taken orally twice daily for the first 7 days followed by 5 mg taken orally twice daily.'),
  apixabanVteExtended: cite('apixaban', '4.2', 37, 'the 2.5 mg twice daily dose should be initiated following completion of 6 months of treatment with apixaban 5 mg twice daily or with another anticoagulant'),
  apixabanVteNoAdjust: cite('apixaban', '4.2', 38, 'for the treatment of DVT, treatment of PE and prevention of recurrent DVT and PE (VTEt), no dose adjustment is necessary'),
  apixabanVteSevereRenal: cite('apixaban', '4.2', 38, 'for the treatment of DVT, treatment of PE and prevention of recurrent DVT and PE (VTEt) apixaban is to be used with caution;'),
  apixabanVteInducer: cite('apixaban', '4.4', 44, 'for the treatment of DVT and treatment of PE, apixaban should not be used since efficacy may be compromised.'),
  apixabanSwitch: cite('apixaban', '4.2', 37, 'Switching treatment from parenteral anticoagulants to Eliquis (and vice versa) can be done at the next scheduled dose (see section 4.5). These medicinal products should not be administered simultaneously.'),
  apixabanUnstablePe: cite('apixaban', '4.4', 43, 'Apixaban is not recommended as an alternative to unfractionated heparin in patients with pulmonary embolism who are haemodynamically unstable or may receive thrombolysis or pulmonary embolectomy'),
  apixabanVtepDose: cite('apixaban', '4.2', 2, 'The recommended dose of apixaban is 2.5 mg taken orally twice daily. The initial dose should be taken 12 to 24 hours after surgery.', 'Eliquis 2.5 mg'),
  apixabanVtepHip: cite('apixaban', '4.2', 2, 'The recommended duration of treatment is 32 to 38 days.', 'Eliquis 2.5 mg'),
  apixabanVtepKnee: cite('apixaban', '4.2', 3, 'The recommended duration of treatment is 10 to 14 days.', 'Eliquis 2.5 mg'),
  apixabanVtepSevereRenal: cite('apixaban', '4.2', 4, 'for the prevention of VTE in elective hip or knee replacement surgery (VTEp), for the treatment of DVT, treatment of PE and prevention of recurrent DVT and PE (VTEt) apixaban is to be used with caution;', 'Eliquis 2.5 mg'),
  apixabanVtepEsrd: cite('apixaban', '4.2', 5, 'In patients with creatinine clearance < 15 mL/min, or in patients undergoing dialysis, there is no clinical experience therefore apixaban is not recommended', 'Eliquis 2.5 mg'),
  apixabanVtepInducer: cite('apixaban', '4.4', 10, 'for the prevention of VTE in elective hip or knee replacement surgery, for the prevention of stroke and systemic embolism in patients with NVAF and for the prevention of recurrent DVT and PE, apixaban should be used with caution;', 'Eliquis 2.5 mg'),

  rivaroxabanMissed: cite('rivaroxaban', '4.2', 86, 'If a dose is missed the patient should take Xarelto immediately and continue on the following day with the once daily intake as recommended.'),
  rivaroxabanMissed10: cite('rivaroxaban', '4.2', 29, 'If a dose is missed the patient should take Xarelto immediately and then continue the following day with once daily intake as before.', 'Xarelto 10 mg'),
  rivaroxabanMissed15bid: cite('rivaroxaban', '4.2', 87, 'If a dose is missed during the 15 mg twice daily treatment phase (day 1 - 21), the patient should take Xarelto immediately to ensure intake of 30 mg Xarelto per day.'),
  rivaroxabanVteAcute: cite('rivaroxaban', '4.2', 86, 'The recommended dose for the initial treatment of acute DVT or PE is 15 mg twice daily for the first three weeks followed by 20 mg once daily for the continued treatment and prevention of recurrent DVT and PE.'),
  rivaroxabanVteExtended: cite('rivaroxaban', '4.2', 87, 'When extended prevention of recurrent DVT and PE is indicated (following completion of at least 6 months therapy for DVT or PE), the recommended dose is 10 mg once daily.'),
  rivaroxabanVteExtendedHigh: cite('rivaroxaban', '4.2', 87, 'a dose of Xarelto 20 mg once daily should be considered.'),
  rivaroxabanVteRenal: cite('rivaroxaban', '4.2', 89, 'a reduction of the dose from 20 mg once daily to 15 mg once daily should be considered if the patient’s assessed risk for bleeding outweighs the risk for recurrent DVT and PE.'),
  rivaroxabanVteRenalUnstudied: cite('rivaroxaban', '4.2', 89, 'The recommendation for the use of 15 mg is based on PK modelling and has not been studied in this clinical setting'),
  rivaroxabanVteRenal10: cite('rivaroxaban', '4.2', 89, 'When the recommended dose is 10 mg once daily, no dose adjustment from the recommended dose is necessary.'),
  rivaroxabanSwitch: cite('rivaroxaban', '4.2', 88, 'discontinue the parenteral anticoagulant and start Xarelto 0 to 2 hours before the time that the next scheduled administration of the parenteral medicinal product (e.g. low molecular weight heparins) would be due'),
  rivaroxabanSwitchUfh: cite('rivaroxaban', '4.2', 88, 'or at the time of discontinuation of a continuously administered parenteral medicinal product (e.g. intravenous unfractionated heparin).'),
  rivaroxabanUnstablePe: cite('rivaroxaban', '4.4', 92, 'Xarelto is not recommended as an alternative to unfractionated heparin in patients with pulmonary embolism who are haemodynamically unstable or may receive thrombolysis or pulmonary embolectomy'),
  rivaroxabanVtepDose: cite('rivaroxaban', '4.2', 29, 'The recommended dose is 10 mg rivaroxaban taken orally once daily. The initial dose should be taken 6 to 10 hours after surgery, provided that haemostasis has been established.', 'Xarelto 10 mg'),
  rivaroxabanVtepHip: cite('rivaroxaban', '4.2', 29, 'For patients undergoing major hip surgery, a treatment duration of 5 weeks is recommended.', 'Xarelto 10 mg'),
  rivaroxabanVtepKnee: cite('rivaroxaban', '4.2', 29, 'For patients undergoing major knee surgery, a treatment duration of 2 weeks is recommended.', 'Xarelto 10 mg'),
  rivaroxabanVtepRenal: cite('rivaroxaban', '4.2', 31, 'Therefore, Xarelto is to be used with caution in these patients. Use is not recommended in patients with creatinine clearance < 15 ml/min', 'Xarelto 10 mg'),

  edoxabanMissed: cite('edoxaban', '4.2', 3, 'If a dose of edoxaban is missed, the dose should be taken immediately and then be continued the following day with the once-daily intake as recommended.'),
  edoxabanVte: cite('edoxaban', '4.2', 3, 'The recommended dose is 60 mg edoxaban once daily following initial use of parenteral anticoagulant for at least 5 days'),
  edoxabanVteNoOverlap: cite('edoxaban', '4.2', 3, 'Edoxaban and initial parenteral anticoagulant should not be administered simultaneously.'),
  edoxabanSwitchSc: cite('edoxaban', '4.2 Table 2', 4, 'Discontinue subcutaneous anticoagulant and start edoxaban at the time of the next scheduled subcutaneous anticoagulant dose.'),
  edoxabanSwitchUfh: cite('edoxaban', '4.2 Table 2', 4, 'Discontinue the infusion and start edoxaban 4 hours later.'),
  edoxabanVteDuration: cite('edoxaban', '4.2', 3, 'The duration of therapy for treatment of DVT and PE (venous thromboembolism (VTE)), and prevention of recurrent VTE should be individualised after careful assessment of the treatment benefit against the risk for bleeding'),
  edoxabanUnstablePe: cite('edoxaban', '4.4', 9, 'Edoxaban is not recommended as an alternative to UFH in patients with pulmonary embolism who are haemodynamically unstable or may receive thrombolysis or pulmonary embolectomy'),
  edoxabanIndications: cite('edoxaban', '4.1', 2, 'Lixiana is indicated in treatment of deep vein thrombosis (DVT) and pulmonary embolism (PE), and for the prevention of recurrent DVT and PE in adults'),

  dabigatranVte: cite('dabigatran', '4.2 Table 2', 34, '300 mg dabigatran etexilate taken as one 150 mg capsule twice daily following treatment with a parenteral anticoagulant for at least 5 days'),
  dabigatranVte220: cite('dabigatran', '4.2', 34, 'For DVT/PE the recommendation for the use of 220 mg dabigatran etexilate taken as one 110 mg capsule twice daily is based on pharmacokinetic and pharmacodynamic analyses and has not been studied in this clinical setting.'),
  dabigatranSwitch: cite('dabigatran', '4.2', 33, 'The parenteral anticoagulant should be discontinued and dabigatran etexilate should be started 0-2 hours prior to the time that the next dose of the alternate therapy would be due'),
  dabigatranSwitchUfh: cite('dabigatran', '4.2', 33, 'or at the time of discontinuation in case of continuous treatment (e.g. intravenous Unfractionated Heparin (UFH))'),
  dabigatranMissed: cite('dabigatran', '4.2', 32, 'It is recommended to continue with the remaining daily doses of dabigatran etexilate at the same time of the next day. No double dose should be taken to make up for missed individual doses.'),
  dabigatranMissedBid: cite('dabigatran', '4.2', 35, 'A forgotten dabigatran etexilate dose may still be taken up to 6 hours prior to the next scheduled dose. From 6 hours prior to the next scheduled dose on, the missed dose should be omitted.'),
  dabigatranVtepTable: cite('dabigatran', '4.2 Table 1', 32, 'Dose recommendations and duration of therapy for primary prevention of VTE in orthopaedic surgery'),
  dabigatranVtepElderly: cite('dabigatran', '4.2 Table 1', 32, 'Patients aged 75 or above'),
  dabigatranVtepHaemostasis: cite('dabigatran', '4.2', 32, 'For both surgeries, if haemostasis is not secured, initiation of treatment should be delayed.'),
  dabigatranVtepRenal: cite('dabigatran', '4.2', 33, 'In patients with moderate renal impairment (CrCL 30-50 mL/min), a dose reduction is recommended'),
  dabigatranVtepPgp: cite('dabigatran', '4.2', 33, 'Dosing should be reduced as indicated in table 1'),
  dabigatranVtepVerapamilRenal: cite('dabigatran', '4.2', 33, 'In patients with moderate renal impairment and concomitantly treated with verapamil, a dose reduction of dabigatran etexilate to 75 mg daily should be considered'),

  // Surgery and procedures — read by the peri-procedural calculator beside EHRA and ASRA.
  apixabanSurgeryHigh: cite('apixaban', '4.4', 42, 'Apixaban should be discontinued at least 48 hours prior to elective surgery or invasive procedures with a moderate or high risk of bleeding.'),
  apixabanSurgeryLow: cite('apixaban', '4.4', 42, 'Apixaban should be discontinued at least 24 hours prior to elective surgery or invasive procedures with a low risk of bleeding.'),
  apixabanRestart: cite('apixaban', '4.4', 42, 'Apixaban should be restarted after the invasive procedure or surgical intervention as soon as possible provided the clinical situation allows and adequate haemostasis has been established'),
  apixabanAblation: cite('apixaban', '4.4', 42, 'For patients undergoing catheter ablation for atrial fibrillation, apixaban treatment does not need to be interrupted'),
  apixabanCatheter: cite('apixaban', '4.4', 42, 'The next dose of apixaban may be given at least 5 hours after catheter removal.'),
  apixabanAntiXa: cite('apixaban', '4.4', 40, 'a calibrated quantitative anti-Factor Xa assay may be useful in exceptional situations where knowledge of apixaban exposure may help to inform clinical decisions, e.g., overdose and emergency surgery'),
  rivaroxabanSurgery: cite('rivaroxaban', '4.4', 93, 'Xarelto 20 mg should be stopped at least 24 hours before the intervention, if possible and based on the clinical judgement of the physician.'),
  rivaroxabanRestart: cite('rivaroxaban', '4.4', 93, 'Xarelto should be restarted as soon as possible after the invasive procedure or surgical intervention provided the clinical situation allows and adequate haemostasis has been established as determined by the treating physician'),
  rivaroxabanCatheter: cite('rivaroxaban', '4.4', 93, 'Following removal of the catheter, at least 6 hours should elapse before the next rivaroxaban dose is administered.'),
  rivaroxabanTraumatic: cite('rivaroxaban', '4.4', 93, 'If traumatic puncture occurs the administration of rivaroxaban is to be delayed for 24 hours.'),
  rivaroxabanAntiXa: cite('rivaroxaban', '4.4', 91, 'rivaroxaban levels measured with a calibrated quantitative anti-factor Xa assay may be useful in exceptional situations'),
  edoxabanSurgery: cite('edoxaban', '4.4', 9, 'edoxaban should be stopped as soon as possible and preferably at least 24 hours before the procedure.'),
  edoxabanRestart: cite('edoxaban', '4.4', 9, 'Edoxaban should be restarted after the surgical or other procedures as soon as adequate haemostasis has been established'),
  edoxabanAntiXa: cite('edoxaban', '4.4', 10, 'the effect on anticoagulation can be estimated by a calibrated quantitative anti-Factor Xa (anti-FXa) assay'),
  dabigatranSurgery: cite('dabigatran', '4.4', 42, 'If possible, dabigatran etexilate should be discontinued at least 24 hours before invasive or surgical procedures.'),
  dabigatranSurgeryTable: cite('dabigatran', '4.4 Table 7', 42, 'Discontinuation rules before invasive or surgical procedures for adult patients'),
  // The sentence starts on p.42 (「After removal of a catheter, an interval of at least」).
  dabigatranCatheter: cite('dabigatran', '4.4', 43, '2 hours should elapse before the administration of the first dose of dabigatran etexilate.'),
  dabigatranRestart: cite('dabigatran', '4.4', 43, 'Dabigatran etexilate treatment should be resumed / started after the invasive procedure or surgical intervention as soon as possible provided the clinical situation allows and adequate haemostasis has been established.'),
  dabigatranDialysable: cite('dabigatran', '4.4', 42, 'Haemodialysis can remove dabigatran.'),
  dabigatranIdarucizumabRestart: cite('dabigatran', '4.4', 42, 'Dabigatran etexilate treatment can be re-initiated 24 hours after administration of idarucizumab, if the patient is clinically stable and adequate haemostasis has been achieved.'),
  dabigatranIdarucizumab: cite('dabigatran', '4.4', 42, 'When rapid reversal of the anticoagulation effect is required the specific reversal agent (idarucizumab) to dabigatran is available for adult patients.'),
  dabigatranAblation110: cite('dabigatran', '4.4', 41, 'There are no data available for 110 mg twice daily dabigatran etexilate treatment in patients undergoing catheter ablation for atrial fibrillation'),
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
export type DoacLevel = 'contraindicated' | 'not-recommended' | 'avoid' | 'review' | 'prerequisite' | 'caution' | 'dose'
const RANK: Record<DoacLevel, number> = { contraindicated: 6, 'not-recommended': 5, avoid: 4, review: 3, prerequisite: 2, caution: 1, dose: 0 }

/** What the dose is for. Blank reads as NVAF, the calculator's original and the AF dose point's. */
export type DoacIndication = 'nvaf' | 'vte-acute' | 'vte-extended' | 'vtep-hip' | 'vtep-knee'
export const DOAC_INDICATIONS: readonly DoacIndication[] = ['nvaf', 'vte-acute', 'vte-extended', 'vtep-hip', 'vtep-knee']
export function doacIndication(values: CalcValues): DoacIndication {
  const value = values.indication ?? ''
  return (DOAC_INDICATIONS as readonly string[]).includes(value) ? value as DoacIndication : 'nvaf'
}

export interface DoacRuleHit {
  level: DoacLevel
  text: L
  cite: LabelCite
}

export interface DoacRegimen {
  mg: number
  perDay: 1 | 2
}

/**
 * One step of a schedule that changes over time: a loading phase, the dose it
 * steps down to, a parenteral lead-in. `fromDay`/`toDay` count days of oral
 * treatment from 1 (acute VTE), or days after surgery from 0, the day of
 * surgery (hip/knee prophylaxis) — see `regimenDay`.
 */
export interface DoacStep {
  text: L
  regimen?: DoacRegimen
  fromDay?: number
  toDay?: number
  cite: LabelCite
}

/** A dose the label offers under a stated condition. */
export interface DoacOption {
  regimen: DoacRegimen
  condition: L
  cite: LabelCite
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
  /** The label does not list this indication for the agent (edoxaban after hip/knee replacement). */
  | 'not-indicated'
  /** The dose is the label's, but only once a step before it is done (≥5 days of parenteral anticoagulation). */
  | 'prerequisite'

export interface DoacAgentResult {
  agent: DoacAgent
  indication: DoacIndication
  verdict: DoacVerdict
  /** The label dose; more than one where the label offers a choice. For a phased schedule, the dose it settles on. */
  doses: DoacRegimen[]
  /** The phases, in order, where the label's dose changes with time or waits on a lead-in. */
  schedule: DoacStep[]
  /**
   * Doses the label offers only under a condition the calculator cannot
   * read (a bleeding risk above the recurrence risk, a high recurrence risk):
   * never the label dose, and a prescription at one is 「可考慮，需確認」.
   */
  options: DoacOption[]
  /** How long, where the label says (hip/knee prophylaxis). */
  duration?: { text: L; cite: LabelCite }
  /** Whether the dose given is the agent's reduced one. */
  reduced: boolean
  /** What decided the dose or the verdict, strongest first. */
  hits: DoacRuleHit[]
  /** Inputs the agent's rules still need. */
  missing: string[]
}

export type DoacInputKey =
  | 'indication' | 'age' | 'sex' | 'weight' | 'scr' | 'crcl_manual' | 'dialysis' | 'liver' | 'liver_enzymes' | 'bilirubin_high' | 'regimen' | 'gi_risk' | 'pregnancy'
  | 'parenteral_lead_in' | 'anticoagulant_switch' | 'pe_unstable' | 'vte_day' | 'postop_day'
  | 'ddi_ketoconazole' | 'ddi_itraconazole' | 'ddi_vori_posaconazole' | 'ddi_hiv_pi' | 'ddi_ciclosporin' | 'ddi_tacrolimus'
  | 'ddi_dronedarone' | 'ddi_verapamil' | 'ddi_amiodarone' | 'ddi_quinidine' | 'ddi_erythromycin' | 'ddi_clarithromycin' | 'ddi_glecaprevir' | 'ddi_inducer' | 'ddi_anticoagulant'

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
  const bands = [15, 30, 50, 80]
  const same = bands.every((band) => (shown < band) === (value < band) && (shown <= band) === (value <= band))
  return same ? shown.toFixed(1) : value.toFixed(2)
}

/**
 * How each label starts the oral agent from the parenteral one: a
 * subcutaneous injection and an intravenous UFH infusion are not the same
 * switch (edoxaban waits 4 h after the infusion stops).
 */
const SWITCH_RULES: Record<DoacAgent, { text: L; cite: LabelCite }[]> = {
  apixaban: [{ text: { zh: '轉換：停用注射劑，於下一次預定給藥時間開始口服，兩者不可同時給（仿單未另分 UFH 輸注）', en: 'Switch: stop the parenteral agent and start at its next scheduled time, never both (the label does not separate a UFH infusion)' }, cite: CITES.apixabanSwitch }],
  rivaroxaban: [
    { text: { zh: '由 LMWH 轉換：於下一次注射預定時間前 0–2 小時開始，兩者不可同時給', en: 'From LMWH: start 0–2 h before the next scheduled injection, never both' }, cite: CITES.rivaroxabanSwitch },
    { text: { zh: '由 UFH 持續輸注轉換：停止輸注時開始', en: 'From a continuous UFH infusion: start when it is stopped' }, cite: CITES.rivaroxabanSwitchUfh },
  ],
  edoxaban: [
    { text: { zh: '由皮下注射劑（LMWH、fondaparinux）轉換：於下一次皮下注射預定時間開始', en: 'From a subcutaneous agent (LMWH, fondaparinux): start at the time of its next scheduled dose' }, cite: CITES.edoxabanSwitchSc },
    { text: { zh: '由 UFH 靜脈輸注轉換：停止輸注 4 小時後開始', en: 'From an intravenous UFH infusion: start 4 h after stopping it' }, cite: CITES.edoxabanSwitchUfh },
  ],
  dabigatran: [
    { text: { zh: '由 LMWH 轉換：於下一次注射預定時間前 0–2 小時開始，兩者不可同時給', en: 'From LMWH: start 0–2 h before the next scheduled injection, never both' }, cite: CITES.dabigatranSwitch },
    { text: { zh: '由 UFH 持續輸注轉換：停止輸注時開始', en: 'From a continuous UFH infusion: start when it is stopped' }, cite: CITES.dabigatranSwitchUfh },
  ],
}

/**
 * The four agents for these inputs, each by its own label and for the chosen
 * indication. Pure; every threshold compares the unrounded CrCl. An answer
 * left blank is unknown, never 「no」: it is listed in `missing` where a rule
 * needs it.
 */
export function calculateDoacDoses(values: CalcValues): { crcl: DoacCrcl | null; indication: DoacIndication; results: DoacAgentResult[] } {
  const indication = doacIndication(values)
  const nvaf = indication === 'nvaf'
  const acute = indication === 'vte-acute'
  const extended = indication === 'vte-extended'
  const vtep = indication === 'vtep-hip' || indication === 'vtep-knee'
  const hip = indication === 'vtep-hip'
  const crcl = doacCrcl(values)
  const age = num(values, 'age')
  const weight = num(values, 'weight')
  const scr = num(values, 'scr')
  const c = crcl?.value
  const t = (zh: string, en: string): L => ({ zh, en })
  const crclText = c === undefined ? '' : crclLabel(c)
  const liver = values.liver ?? ''
  const dialysis = values.dialysis ?? ''
  const leadIn = values.parenteral_lead_in ?? ''

  const results = DOAC_AGENTS.map((agent): DoacAgentResult => {
    const hits: DoacRuleHit[] = []
    const missing: string[] = []
    const hit = (level: DoacLevel, text: L, ref: LabelCite) => hits.push({ level, text, cite: ref })
    // A blank answer a rule of this agent reads is unknown, never 「no」: listed
    // to fill, and while any is open the prescription is not called 「一致」.
    const ask = (...keys: DoacInputKey[]) => { for (const key of keys) if ((values[key] ?? '') === '') missing.push(key) }
    let doses: DoacRegimen[] = []
    const schedule: DoacStep[] = []
    let duration: DoacAgentResult['duration']
    const options: DoacOption[] = []
    let reduced = false
    /** An unknown that could change the dose itself: no dose is given. */
    let doseUnknown = false

    if (agent === 'edoxaban' && vtep) {
      // EU SmPC §4.1 lists NVAF and DVT/PE only.
      return {
        agent, indication, verdict: 'not-indicated', doses: [], schedule: [], options: [], reduced: false, missing: [],
        hits: [{ level: 'not-recommended', text: t('EU SmPC 未核准髖／膝關節置換後的 VTE 預防', 'The EU SmPC has no hip/knee replacement prophylaxis indication'), cite: CITES.edoxabanIndications }],
      }
    }

    ask('ddi_anticoagulant', 'liver', 'pregnancy')
    if (c === undefined) missing.push('CrCl')
    if (dialysis === '') missing.push('dialysis')
    if (yes(values, 'ddi_anticoagulant')) {
      // Acute VTE starts on a parenteral anticoagulant (edoxaban and dabigatran
      // after ≥5 days of it): that is the label's own switch, not co-therapy —
      // but only when it is the only other anticoagulant and stops as the oral
      // one starts. 「Another anticoagulant」 also covers warfarin and a second
      // DOAC, so that is asked, never inferred from the lead-in.
      const switching = values.anticoagulant_switch ?? ''
      if (acute && switching === 'yes') {
        for (const rule of SWITCH_RULES[agent]) hit('caution', rule.text, rule.cite)
      } else if (acute && switching === '') {
        hit('review', t('併用其他抗凝血劑：若只有急性 VTE 的注射劑且開始口服時停用，依轉換規則；否則禁忌。請填「是否只是注射劑轉換」', 'Another anticoagulant: if it is only the acute-VTE parenteral agent, stopped as the oral one starts, the switch rules apply; otherwise contraindicated. Answer 「only the parenteral switch」'), CITES[`${agent}Anticoagulant`])
        missing.push('anticoagulant_switch')
      } else {
        hit('contraindicated', t('併用其他抗凝血劑（轉換、維持導管或消融時的 UFH 除外）', 'Another anticoagulant (except switching, catheter-patency or ablation UFH)'), CITES[`${agent}Anticoagulant`])
      }
    }
    if (acute) {
      ask('pe_unstable')
      if (yes(values, 'pe_unstable')) {
        if (agent === 'dabigatran') hit('review', t('血行動力學不穩定 PE 或可能溶栓／取栓：dabigatran 仿單未述，需個別判斷', 'Haemodynamically unstable PE or possible thrombolysis/embolectomy: not addressed in the dabigatran label; individual review'), CITES.dabigatranVte)
        else hit('not-recommended', t('血行動力學不穩定 PE 或可能溶栓／取栓：不建議取代 UFH', 'Haemodynamically unstable PE or possible thrombolysis/embolectomy: not recommended in place of UFH'), CITES[`${agent}UnstablePe`])
      }
      if (agent === 'edoxaban' || agent === 'dabigatran') {
        const lead = agent === 'edoxaban' ? CITES.edoxabanVte : CITES.dabigatranVte
        if (leadIn === '') missing.push('parenteral_lead_in')
        else if (leadIn !== 'done') hit('prerequisite', t('需先完成 ≥5 天注射抗凝，才開始口服', 'Start only after ≥5 days of parenteral anticoagulation'), lead)
        schedule.push({ text: t('先用注射抗凝（LMWH 或 UFH）≥5 天', 'Parenteral anticoagulant (LMWH or UFH) for ≥5 days first'), cite: lead })
      }
    }

    if (agent === 'apixaban') {
      const esrd = vtep ? CITES.apixabanVtepEsrd : CITES.apixabanEsrd
      if (dialysis === 'yes') hit('not-recommended', t('透析', 'On dialysis'), esrd)
      if (c !== undefined && c < 15) hit('not-recommended', t(`CrCl ${crclText} <15`, `CrCl ${crclText} <15`), esrd)
      if (liver === 'coag') hit('contraindicated', t('肝病合併凝血異常與臨床出血風險', 'Hepatic disease with coagulopathy and bleeding risk'), CITES.apixabanLiverCoag)
      if (liver === 'C') hit('not-recommended', t('Child-Pugh C（以 severe hepatic impairment 對應）', 'Child-Pugh C (read as severe hepatic impairment)'), CITES.apixabanLiverSevere)
      if (liver === 'A' || liver === 'B') hit('caution', t(`Child-Pugh ${liver}：謹慎使用，不調整劑量`, `Child-Pugh ${liver}: caution, no dose adjustment`), CITES.apixabanLiverMild)
      if (yes(values, 'liver_enzymes') || yes(values, 'bilirubin_high')) hit('caution', t('ALT/AST >2×ULN 或總膽紅素 ≥1.5×ULN：試驗排除，謹慎使用', 'ALT/AST >2×ULN or bilirubin ≥1.5×ULN: excluded from trials, caution'), CITES.apixabanEnzymes)
      ask('ddi_ketoconazole', 'ddi_itraconazole', 'ddi_vori_posaconazole', 'ddi_hiv_pi')
      const dual = (['ddi_ketoconazole', 'ddi_itraconazole', 'ddi_vori_posaconazole', 'ddi_hiv_pi'] as const).filter((key) => yes(values, key))
      if (dual.length) hit('not-recommended', t(`併用強效 CYP3A4＋P-gp 雙重抑制劑（${dual.map(drugName).join('、')}）`, `Strong dual CYP3A4 + P-gp inhibitor (${dual.map(drugName).join(', ')})`), CITES.apixabanDualInhibitor)
      const lesser = (['ddi_clarithromycin', 'ddi_verapamil'] as const).filter((key) => yes(values, key))
      if (lesser.length) hit('caution', t(`${lesser.map(drugName).join('、')}：非強效雙重抑制劑，不調整劑量`, `${lesser.map(drugName).join(', ')}: not a strong dual inhibitor, no dose adjustment`), CITES.apixabanLessPotent)
      if (yes(values, 'ddi_inducer')) {
        if (acute) hit('not-recommended', t('併用強效 CYP3A4＋P-gp 誘導劑：DVT／PE 治療不應使用（療效可能不足）', 'Strong CYP3A4 + P-gp inducer: not to be used for DVT/PE treatment (efficacy may be compromised)'), CITES.apixabanVteInducer)
        else if (vtep) hit('caution', t('併用強效 CYP3A4＋P-gp 誘導劑：髖膝置換後預防謹慎使用', 'Strong CYP3A4 + P-gp inducer: caution in hip/knee prophylaxis'), CITES.apixabanVtepInducer)
        else hit('caution', t('併用強效 CYP3A4＋P-gp 誘導劑：NVAF 與預防 VTE 復發謹慎使用', 'Strong CYP3A4 + P-gp inducer: caution in NVAF and in preventing recurrent VTE'), CITES.apixabanInducer)
      }
      if (values.pregnancy === 'yes') hit('avoid', t('懷孕／哺乳：懷孕時宜避免；哺乳需擇一', 'Pregnancy/breast-feeding: preferably avoided in pregnancy; choose between breast-feeding and therapy'), CITES.apixabanPregnancy)
      if (!nvaf) {
        // No age, weight or creatinine reduction outside NVAF.
        if (c !== undefined && c >= 15) {
          if (c < 30) hit('caution', t(`CrCl ${crclText}（15–29）：謹慎使用，不調整劑量`, `CrCl ${crclText} (15–29): caution, no dose adjustment`), vtep ? CITES.apixabanVtepSevereRenal : CITES.apixabanVteSevereRenal)
          if (acute) {
            doses = [{ mg: 5, perDay: 2 }]
            schedule.push(
              { text: t('第 1–7 天：10 mg bid', 'Days 1–7: 10 mg bid'), regimen: { mg: 10, perDay: 2 }, fromDay: 1, toDay: 7, cite: CITES.apixabanVteAcute },
              { text: t('第 8 天起：5 mg bid', 'Day 8 on: 5 mg bid'), regimen: { mg: 5, perDay: 2 }, fromDay: 8, cite: CITES.apixabanVteAcute },
            )
            hit('dose', t('急性 VTE 不依年齡、體重、Cr 減量（NVAF 的減量條件不適用）', 'Acute VTE: no reduction for age, weight or creatinine (the NVAF criteria do not apply)'), CITES.apixabanVteNoAdjust)
          } else if (extended) {
            doses = [{ mg: 2.5, perDay: 2 }]
            hit('dose', t('完成 6 個月治療後預防復發：2.5 mg bid', 'After 6 months of treatment, to prevent recurrence: 2.5 mg bid'), CITES.apixabanVteExtended)
          } else {
            doses = [{ mg: 2.5, perDay: 2 }]
            hit('dose', t('術後 12–24 小時開始 2.5 mg bid', '2.5 mg bid, first dose 12–24 h after surgery'), CITES.apixabanVtepDose)
            duration = hip ? { text: t('髖關節置換：32–38 天', 'Hip replacement: 32–38 days'), cite: CITES.apixabanVtepHip } : { text: t('膝關節置換：10–14 天', 'Knee replacement: 10–14 days'), cite: CITES.apixabanVtepKnee }
          }
        }
      } else if (c !== undefined && c >= 15 && c < 30) {
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
      if (c !== undefined && c < 15) hit('not-recommended', t(`CrCl ${crclText} <15`, `CrCl ${crclText} <15`), vtep ? CITES.rivaroxabanVtepRenal : CITES.rivaroxabanSevereRenal)
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
        if (nvaf) {
          if (c < 50) {
            doses = [{ mg: 15, perDay: 1 }]
            reduced = true
            hit('dose', t(`CrCl ${crclText}（15–49）：15 mg qd，隨餐`, `CrCl ${crclText} (15–49): 15 mg qd with food`), CITES.rivaroxabanRenal)
            if (c < 30) hit('caution', t(`CrCl ${crclText}（15–29）：謹慎使用`, `CrCl ${crclText} (15–29): use with caution`), CITES.rivaroxabanSevereRenal)
          } else {
            doses = [{ mg: 20, perDay: 1 }]
            hit('dose', t('20 mg qd，隨餐', '20 mg qd with food'), CITES.rivaroxabanFood)
          }
        } else {
          if (c < 30) hit('caution', t(`CrCl ${crclText}（15–29）：謹慎使用`, `CrCl ${crclText} (15–29): use with caution`), vtep ? CITES.rivaroxabanVtepRenal : CITES.rivaroxabanSevereRenal)
          if (acute) {
            doses = [{ mg: 20, perDay: 1 }]
            schedule.push(
              { text: t('第 1–21 天：15 mg bid，隨餐', 'Days 1–21: 15 mg bid with food'), regimen: { mg: 15, perDay: 2 }, fromDay: 1, toDay: 21, cite: CITES.rivaroxabanVteAcute },
              { text: t('第 22 天起：20 mg qd，隨餐', 'Day 22 on: 20 mg qd with food'), regimen: { mg: 20, perDay: 1 }, fromDay: 22, cite: CITES.rivaroxabanVteAcute },
            )
            hit('dose', t('15 mg bid ×21 天，之後 20 mg qd（急性期不依腎功能減量）', '15 mg bid for 21 days, then 20 mg qd (no renal reduction in the initial phase)'), CITES.rivaroxabanVteAcute)
          } else if (extended) {
            doses = [{ mg: 10, perDay: 1 }]
            options.push({ regimen: { mg: 20, perDay: 1 }, condition: t('復發風險高（合併症複雜，或在 10 mg 期間復發）', 'high recurrence risk (complicated comorbidities, or recurrence on 10 mg)'), cite: CITES.rivaroxabanVteExtendedHigh })
            hit('dose', t('完成 ≥6 個月治療後：10 mg qd', 'After ≥6 months of treatment: 10 mg qd'), CITES.rivaroxabanVteExtended)
            hit('dose', t('復發風險高（合併症複雜，或在 10 mg 期間復發）：考慮 20 mg qd', 'High recurrence risk (complicated comorbidities, or recurrence on 10 mg): consider 20 mg qd'), CITES.rivaroxabanVteExtendedHigh)
            if (c < 50) hit('dose', t('10 mg qd 不因腎功能調整', '10 mg qd: no renal adjustment'), CITES.rivaroxabanVteRenal10)
          } else {
            doses = [{ mg: 10, perDay: 1 }]
            hit('dose', t('術後 6–10 小時、已止血後開始 10 mg qd', '10 mg qd, first dose 6–10 h after surgery once haemostasis is established'), CITES.rivaroxabanVtepDose)
            duration = hip ? { text: t('髖關節置換：5 週', 'Hip replacement: 5 weeks'), cite: CITES.rivaroxabanVtepHip } : { text: t('膝關節置換：2 週', 'Knee replacement: 2 weeks'), cite: CITES.rivaroxabanVtepKnee }
          }
          if ((acute || extended) && c < 50) {
            options.push({ regimen: { mg: 15, perDay: 1 }, condition: t(`CrCl ${crclText}（15–49），在 20 mg qd 階段且出血風險高於復發風險`, `CrCl ${crclText} (15–49), in the 20 mg qd phase, with bleeding risk above recurrence risk`), cite: CITES.rivaroxabanVteRenal })
            hit('dose', t(`CrCl ${crclText}（15–49）：20 mg qd 階段，出血風險高於復發風險時可考慮 15 mg qd`, `CrCl ${crclText} (15–49): in the 20 mg qd phase, consider 15 mg qd if bleeding risk outweighs recurrence risk`), CITES.rivaroxabanVteRenal)
            hit('caution', t('15 mg qd 依 PK 模擬推論，未經臨床試驗', '15 mg qd rests on PK modelling, not on a trial'), CITES.rivaroxabanVteRenalUnstudied)
          }
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
        // The SmPC's Table 1 is one table for NVAF and VTE: the same three factors.
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
          hit('dose', t('未達 30 mg 條件', 'No 30 mg factor'), nvaf ? CITES.edoxabanDose : CITES.edoxabanVte)
        }
        // §4.4 gives no number and speaks of NVAF only; §5.1 (p.23) defines high CrCl as >100 mL/min.
        if (nvaf && c > 100) hit('caution', t(`CrCl ${crclText} >100：療效隨 CrCl 升高有下降趨勢，需個別評估`, `CrCl ${crclText} >100: efficacy trends down with rising CrCl; individual evaluation`), CITES.edoxabanHighCrcl)
        if (extended) hit('dose', t('SmPC 未另訂延長期劑量：預防復發沿用同一劑量，療程個別評估', 'No separate extended dose in the SmPC: the same dose continues; duration individualised'), CITES.edoxabanVteDuration)
        if (acute && doses[0]) schedule.push({ text: t(`再轉口服 ${doses[0].mg} mg qd（與注射劑不可同時給）`, `Then ${doses[0].mg} mg qd orally (never together with the parenteral agent)`), regimen: doses[0], cite: CITES.edoxabanVteNoOverlap })
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
      if (vtep && c !== undefined && c >= 30) {
        // Table 1: one reduced regimen for CrCl 30–50, age ≥75, or verapamil, amiodarone or quinidine.
        ask('ddi_verapamil', 'ddi_amiodarone', 'ddi_quinidine')
        const pgp = (['ddi_verapamil', 'ddi_amiodarone', 'ddi_quinidine'] as const).filter((key) => yes(values, key))
        const reduce = [
          ...(c <= 50 ? [{ text: t(`CrCl ${crclText}（30–50）`, `CrCl ${crclText} (30–50)`), cite: CITES.dabigatranVtepRenal }] : []),
          ...(age !== undefined && age >= 75 ? [{ text: t(`年齡 ${age} ≥75`, `age ${age} ≥75`), cite: CITES.dabigatranVtepElderly }] : []),
          ...(pgp.length ? [{ text: t(`併用 ${pgp.map(drugName).join('、')}（同時服用）`, `with ${pgp.map(drugName).join(', ')} (taken together)`), cite: CITES.dabigatranVtepPgp }] : []),
        ]
        const pgpUnknown = (['ddi_verapamil', 'ddi_amiodarone', 'ddi_quinidine'] as const).filter((key) => (values[key] ?? '') === '')
        if (reduce.length) {
          reduced = true
          doses = [{ mg: 150, perDay: 1 }]
          schedule.push(
            { text: t('手術當天、術後 1–4 小時：75 mg 一粒', 'Day of surgery, 1–4 h after: one 75 mg capsule'), regimen: { mg: 75, perDay: 1 }, fromDay: 0, toDay: 0, cite: CITES.dabigatranVtepTable },
            { text: t('術後第 1 天起：150 mg qd（75 mg 兩粒）', 'From the day after surgery: 150 mg qd (two 75 mg capsules)'), regimen: { mg: 150, perDay: 1 }, fromDay: 1, cite: CITES.dabigatranVtepTable },
          )
          for (const item of reduce) hit('dose', t(`建議減量：${item.text.zh}`, `Reduction recommended: ${item.text.en}`), item.cite)
          if (c <= 50 && yes(values, 'ddi_verapamil')) {
            doses.push({ mg: 75, perDay: 1 })
            hit('dose', t('CrCl 30–50 且併用 verapamil：考慮 75 mg qd', 'CrCl 30–50 with verapamil: consider 75 mg qd'), CITES.dabigatranVtepVerapamilRenal)
          }
        } else if (age === undefined || pgpUnknown.length) {
          doseUnknown = true
          missing.push(...(age === undefined ? ['age'] : []), ...pgpUnknown)
        } else {
          doses = [{ mg: 220, perDay: 1 }]
          schedule.push(
            { text: t('手術當天、術後 1–4 小時：110 mg 一粒', 'Day of surgery, 1–4 h after: one 110 mg capsule'), regimen: { mg: 110, perDay: 1 }, fromDay: 0, toDay: 0, cite: CITES.dabigatranVtepTable },
            { text: t('術後第 1 天起：220 mg qd（110 mg 兩粒）', 'From the day after surgery: 220 mg qd (two 110 mg capsules)'), regimen: { mg: 220, perDay: 1 }, fromDay: 1, cite: CITES.dabigatranVtepTable },
          )
          hit('dose', t('未達減量條件', 'No reduction criterion'), CITES.dabigatranVtepTable)
        }
        hit('caution', t('未確定止血時延後開始', 'Delay the start while haemostasis is not secured'), CITES.dabigatranVtepHaemostasis)
        duration = { text: hip ? t('髖關節置換：28–35 天', 'Hip replacement: 28–35 days') : t('膝關節置換：10 天', 'Knee replacement: 10 days'), cite: CITES.dabigatranVtepTable }
      } else if (!vtep && c !== undefined && c >= 30) {
        // Table 2 is one table for SPAF and DVT/PE.
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
          hit('dose', t('未達減量條件', 'No reduction criterion'), nvaf ? CITES.dabigatranDose : CITES.dabigatranVte)
        }
        if (!nvaf && doses.some((dose) => dose.mg === 110)) hit('caution', t('110 mg bid 用於 DVT／PE 依藥動／藥效學推論，未經臨床試驗', '110 mg bid for DVT/PE rests on PK/PD analyses, not on a trial'), CITES.dabigatranVte220)
        if (yes(values, 'ddi_verapamil') || yes(values, 'ddi_clarithromycin')) hit('caution', t('P-gp 抑制劑：密切觀察出血，腎功能不佳者尤甚', 'P-gp inhibitor: watch for bleeding, especially with reduced renal function'), CITES.dabigatranCaution)
        if (acute && doses.length) schedule.push({ text: t(`再轉口服 ${doses.map((d) => `${d.mg} mg bid`).join(' 或 ')}`, `Then ${doses.map((d) => `${d.mg} mg bid`).join(' or ')} orally`), regimen: doses[0], cite: CITES.dabigatranSwitch })
      }
    }

    hits.sort((a, b) => RANK[b.level] - RANK[a.level])
    const levels = new Set(hits.map((item) => item.level))
    // A rule that takes the agent off the table or leaves its dose to the
    // clinician outranks any dose; 「avoid」 and an unfinished lead-in keep a
    // dose only once it is settled.
    const verdict: DoacVerdict = levels.has('contraindicated')
      ? 'contraindicated'
      : levels.has('not-recommended')
        ? 'not-recommended'
        : levels.has('review')
          ? 'review'
          : c === undefined || doseUnknown || !doses.length
            ? 'missing'
            : levels.has('avoid') ? 'avoid' : levels.has('prerequisite') ? 'prerequisite' : 'dose'
    const shown = verdict === 'dose' || verdict === 'avoid' || verdict === 'prerequisite'
    return {
      agent, indication, verdict, doses: shown ? doses : [], schedule: shown ? schedule : [], options: shown ? options : [], ...(shown && duration ? { duration } : {}),
      reduced, hits, missing: [...new Set(missing)],
    }
  })
  return { crcl, indication, results }
}

const DRUG_NAMES: Record<string, string> = {
  ddi_ketoconazole: 'ketoconazole', ddi_itraconazole: 'itraconazole', ddi_vori_posaconazole: 'voriconazole／posaconazole',
  ddi_hiv_pi: 'HIV protease inhibitor（ritonavir 等）', ddi_ciclosporin: 'ciclosporin', ddi_tacrolimus: 'tacrolimus',
  ddi_dronedarone: 'dronedarone', ddi_verapamil: 'verapamil', ddi_amiodarone: 'amiodarone', ddi_quinidine: 'quinidine',
  ddi_erythromycin: 'erythromycin', ddi_clarithromycin: 'clarithromycin', ddi_glecaprevir: 'glecaprevir/pibrentasvir',
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
  parenteral_lead_in: { zh: '注射抗凝', en: 'parenteral anticoagulation' },
  anticoagulant_switch: { zh: '是否只是注射劑轉換', en: 'only the parenteral switch' },
  postop_day: { zh: '術後第幾天', en: 'day after surgery' },
  pe_unstable: { zh: '不穩定 PE', en: 'unstable PE' },
  vte_day: { zh: '治療第幾天', en: 'treatment day' },
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

/**
 * The day the prescription is read on, where the label's dose changes with
 * time: the day of oral treatment for acute VTE (`vte_day`, from 1), the day
 * after surgery for hip/knee prophylaxis (`postop_day`, 0 = the day of surgery).
 */
export function regimenDay(values: CalcValues): number | undefined {
  const indication = doacIndication(values)
  const raw = indication === 'vtep-hip' || indication === 'vtep-knee' ? values.postop_day : indication === 'vte-acute' ? values.vte_day : undefined
  if (raw === undefined || raw === '') return undefined
  const day = Number(raw)
  return Number.isInteger(day) ? day : undefined
}

const freq = (perDay: number) => (perDay === 2 ? 'bid' : 'qd')
const regimenText = (dose: DoacRegimen) => `${dose.mg} mg ${freq(dose.perDay)}`

/**
 * The prescription beside its agent's label dose. `day` is the day of oral
 * treatment (from `vte_day`): where the label's dose changes with time, a
 * prescription is read against the phase that day falls in, and without the
 * day it is never called 「一致」.
 */
export function checkRegimen(regimenValue: string | undefined, results: readonly DoacAgentResult[], day?: number): RegimenCheck | undefined {
  const regimen = parseRegimen(regimenValue)
  if (!regimen) return undefined
  const result = results.find((item) => item.agent === regimen.agent)!
  const prescribed = `${regimen.agent} ${regimen.mg} mg ${freq(regimen.perDay)}`
  const same = (dose: DoacRegimen) => dose.mg === regimen.mg && dose.perDay === regimen.perDay
  if (result.verdict === 'not-indicated') {
    return { state: 'label-against', text: { zh: `${prescribed}：仿單未核准此適應症（${result.hits[0]!.text.zh}）`, en: `${prescribed}: not an indication in the label (${result.hits[0]!.text.en})` } }
  }
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
  if (result.verdict === 'prerequisite') {
    return { state: 'unsettled', text: { zh: `${prescribed}：需先完成 ≥5 天注射抗凝，才開始口服`, en: `${prescribed}: only after ≥5 days of parenteral anticoagulation` } }
  }
  // A dose that changes with time: the phase decides which number is the label's.
  let labelDoses = result.doses
  const phased = result.schedule.filter((step): step is DoacStep & { regimen: DoacRegimen; fromDay: number } => !!step.regimen && step.fromDay !== undefined)
  const firstDay = Math.min(...phased.map((step) => step.fromDay))
  const known = phased.length > 0 && day !== undefined && Number.isFinite(day) && day >= firstDay
  if (phased.length) {
    if (!known) {
      const step = phased.find((item) => same(item.regimen))
      if (step || result.doses.some(same) || result.options.some((option) => same(option.regimen))) {
        const which = firstDay === 0 ? ['術後第幾天', 'the day after surgery'] : ['治療第幾天', 'the treatment day']
        return { state: 'unsettled', text: { zh: `${prescribed}：為${step ? `「${step.text.zh}」` : '維持期'}的劑量，需確認目前是${which[0]}`, en: `${prescribed}: the dose of ${step ? `「${step.text.en}」` : 'the maintenance phase'}; confirm ${which[1]}` } }
      }
    } else {
      const due = phased.find((item) => day! >= item.fromDay && (item.toDay === undefined || day! <= item.toDay))
      // In a loading phase only its own dose is the label's; after it, the maintenance choices are.
      if (due && due.toDay !== undefined) labelDoses = [due.regimen]
    }
  }
  // A conditional dose: never 「一致」 while its condition is the clinician's.
  const option = labelDoses === result.doses ? result.options.find((item) => same(item.regimen)) : undefined
  if (option && !labelDoses.some(same)) {
    return { state: 'unsettled', text: { zh: `${prescribed}：仿單「可考慮」的劑量，需確認：${option.condition.zh}`, en: `${prescribed}: a dose the label offers for consideration; confirm ${option.condition.en}` } }
  }
  if (labelDoses.some(same)) {
    // The number agrees, but an unanswered rule could still turn it against.
    if (result.missing.length) {
      const open = result.missing.map((key) => DOAC_FIELD_LABELS[key]?.zh ?? key)
      const openEn = result.missing.map((key) => DOAC_FIELD_LABELS[key]?.en ?? key)
      return { state: 'unsettled', text: { zh: `${prescribed}：劑量數字與仿單相同，尚待確認 ${open.join('、')}`, en: `${prescribed}: the number agrees; still to confirm ${openEn.join(', ')}` } }
    }
    return { state: 'matches', text: { zh: `${prescribed}：與仿單劑量一致`, en: `${prescribed}: matches the label dose` } }
  }
  // Without the day, name every phase's dose rather than the maintenance one alone.
  const named = phased.length && !known ? [...phased.map((step) => step.regimen), ...result.doses] : labelDoses
  const label = [...new Set(named.map(regimenText))].join(' 或 ')
  const dayText = known ? (firstDay === 0 ? `術後第 ${day} 天` : `第 ${day} 天`) : ''
  const extra = regimen.agent === 'edoxaban' && regimen.mg === 15
    ? CITES.edoxaban15
    : regimen.agent === 'dabigatran' && regimen.mg === 75 && regimen.perDay === 2
      ? CITES.dabigatran75
      : undefined
  return {
    state: 'differs',
    text: { zh: `${prescribed}：${dayText}仿單劑量為 ${label}`, en: `${prescribed}: ${dayText ? `on day ${day} ` : ''}the label dose is ${label.replace(/ 或 /g, ' or ')}` },
    ...(extra ? { cite: extra } : {}),
  }
}
