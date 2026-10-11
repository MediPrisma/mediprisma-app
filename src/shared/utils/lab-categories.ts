// Lab category definitions for cumulative report view.
// Mirrors VGH 累積報告 categories: CBC, 生化, 血糖, 癌症指數, 尿液.
//
// Matching strategy — pure allowlist, tried in order:
//  1. Exact match against short codes (`codes`) — handles VGH/NHI bridge data
//     (e.g., "ALT", "Na", "ALK-P").
//  2. Stripped display-name match — strips parentheticals / "Serum" prefix
//     then checks against `codes` (e.g., "Serum TSH(ECLIA)" → "TSH").
//  3. Exact match against LOINC codes (`loincCodes`).
//  Anything not matched by these three passes is excluded from the pivot.
//  No denylist / exclusion regex needed — unrecognised tests simply fall
//  through to `return null`.

import { FHIR_SYSTEM_FRAGMENTS } from '@/src/shared/constants/fhir-systems.constants'

import { inferGroupFromObservation } from '@/src/shared/utils/report-grouping-helpers'
import { canonicalKeyFromLoinc, canonicalTestKeyFromString } from '@voho0000/clinical-lab-normalization/canonical'

export interface LabSubgroup {
  /** Stable id — matches a key under t.reports.cumulativeSubgroups for display. */
  id: string
  /** Canonical row keys (uppercase) that belong to this subgroup.
   *  Match against pickKey() result in useLabPivot. */
  members: string[]
}

export interface LabCategory {
  /** Stable id — matches a key under t.reports.cumulativeCategories for display. */
  id: string
  /** Short codes / abbreviations (matched against code.code / code.text / coding.display) */
  codes: string[]
  /** Standard LOINC codes (matched against code.coding[].code) */
  loincCodes?: string[]
  /** Preferred column order — codes appearing here render first in this order */
  preferredOrder?: string[]
  /** Clinically meaningful subgroups within this category (e.g., 腎功能/肝功能) */
  subgroups?: LabSubgroup[]
  /** Test keys that always appear as columns even when the patient has no data for them */
  pinnedColumns?: string[]
  /** When true this category is treated as a secondary sub-tab. It appears
   *  automatically when every category fits in the cumulative-report row, or
   *  through the 「查看更多」 picker when space is limited. For panels ordered on
   *  a minority of patients (e.g. arterial blood gas), this avoids crowding a
   *  narrow routine-outpatient view. */
  hiddenByDefault?: boolean
  /** 直式 (stacked) cumulative report only: split this category's single wide
   *  pivot into several side-by-side-free tables, each listing the subgroup
   *  ids it holds, in order. Rows whose subgroup is not listed anywhere join
   *  the LAST panel. A category without this renders one table. Exists so a
   *  wide panel (生化: 19+ columns) reads without horizontal scrolling. */
  stackedPanels?: string[][]
}

export const LAB_CATEGORIES: LabCategory[] = [
  {
    id: 'cbc',
    // Differential order — clinical reading convention puts mature
    // neutrophils first (NEU, the bridge canonical that SEG / SEG. /
    // Segmented / 嗜中性白血球 all collapse to via TEST_ALIASES), then
    // immature band-form (BAND), then the other lineages in decreasing
    // frequency: LYM → MONO → EOS → BASO. The absolute counts (ANC, ALC,
    // AMC, AEC, ABC, Band#, …) tail as their own columns: a count and its
    // percentage share a source name but never a column (see
    // countFractionAwareKey in lab-pivot.utils).
    // Only canonical keys go here — variants like SEG / NEU. / LYM. are
    // dead entries because getAnalyteLabel always returns the canonical
    // (see memory/feedback_canonical_only_in_preferredorder.md).
    preferredOrder: ['WBC', 'RBC', 'HB', 'HCT', 'MCV', 'MCH', 'MCHC', 'RDW', 'PLT', 'MPV', 'NEU', 'BAND', 'LYM', 'MONO', 'EOS', 'BASO', 'ANC', 'ALC', 'AMC', 'AEC', 'ABC', 'BAND-ABS', 'BLAST', 'PROMYELOCYTE', 'MYELOCYTE', 'META-MYELOCYTE', 'NORMOBLAST', 'PLASMA-CELL', 'PS', 'BLAST-ABS', 'PROMYELOCYTE-ABS', 'MYELOCYTE-ABS', 'META-MYELOCYTE-ABS', 'NORMOBLAST-ABS', 'PLASMA-CELL-ABS'],
    // `codes` covers VGH short-form (WBC/RBC/…) AND long-form display
    // names (BASOPHIL/EOSINOPHIL/…) that bridge v0.9.9+ emits for the
    // differential cells. Long-form catches cases where the LOINC isn't
    // in `loincCodes` so categorisation doesn't depend solely on LOINC
    // accuracy.
    codes: ['WBC', 'RBC', 'HGB', 'HB', 'HCT', 'MCV', 'MCH', 'MCHC', 'RDW', 'RDW-CV', 'PLT', 'MPV', 'BAND', 'SEG', 'SEGMENT', 'NEU', 'NEU.', 'NEUTROPHIL', 'LYM', 'LYM.', 'LYMPHOCYTE', 'MONO', 'MONO.', 'MONOCYTE', 'EOS', 'EOS.', 'EOSINOPHIL', 'BASO', 'BASO.', 'BASOPHIL', 'ANC', 'BLAST', 'BLASTS', 'PROMYL', 'PROMYL.', 'PROMYELOCYTE', 'PROMYELOCYTES', 'MYELO', 'MYELO.', 'MYELOCYTE', 'MYELOCYTES', 'META', 'META.', 'METAMYELOCYTE', 'METAMYELOCYTES', 'META-MYELOCYTE', 'NORMOBL', 'NORMOBL.', 'NORMOBLAST', 'NORMOBLASTS', 'NRBC', 'PLASMACELL', 'PLASMACELLS', 'PLASMA CELL', 'PLASMA CELLS', 'PS', 'P/S', 'PS AUTO DC', 'PSAUTODC'],
    // Differential percent LOINCs added 2026-05-27: bridge v0.9.9 emits
    //   713-8  for Eosinophils/100 leukocytes
    //   5905-5 for Monocytes/100 leukocytes
    // and the (semantically wrong) panel LOINC 57021-8 for Segment.
    // Without these in the allowlist, those obs were silently dropped
    // from the cbc category — clinicians saw 累積報告 missing 3 of 5
    // differential cells.
    loincCodes: ['6690-2', '26464-8', '789-8', '26453-1', '718-7', '30350-3', '4544-3', '20570-8', '777-3', '26515-7', '787-2', '785-6', '786-4', '788-0', '32623-1', '770-8', '736-9', '731-0', '742-7', '706-2', '751-8', '4544-3', '751-8', '764-1', '32155-4', '713-8', '5905-5', '57021-8',
      // Differential #/volume and /100-leukocyte twins (verified tx.fhir.org,
      // 2026-10-09); the pivot splits count from percentage by this LOINC.
      '753-4', '26499-4', '768-2', '30451-9', '23761-0', '26511-6', '769-0',
      '763-3', '26507-4', '26508-2', '35332-6', '732-8', '26474-7', '737-7', '26478-8',
      '743-5', '26484-6', '744-3', '26485-3', '711-2', '712-0', '26449-9', '714-6', '26450-7',
      '704-7', '705-4', '26444-0', '707-0', '30180-4', '30376-8', '709-6', '771-6'],
    subgroups: [
      { id: 'counts',  members: ['WBC', 'RBC', 'HB', 'PLT', 'MPV'] },
      { id: 'diff',    members: ['NEU', 'BAND', 'LYM', 'MONO', 'EOS', 'BASO', 'ANC', 'ALC', 'AMC', 'AEC', 'ABC', 'BAND-ABS', 'BLAST', 'PROMYELOCYTE', 'MYELOCYTE', 'META-MYELOCYTE', 'NORMOBLAST', 'PLASMA-CELL', 'PS', 'BLAST-ABS', 'PROMYELOCYTE-ABS', 'MYELOCYTE-ABS', 'META-MYELOCYTE-ABS', 'NORMOBLAST-ABS', 'PLASMA-CELL-ABS'] },
      { id: 'indices', members: ['HCT', 'MCV', 'MCH', 'MCHC', 'RDW'] },
    ],
    pinnedColumns: ['WBC', 'RBC', 'HB', 'PLT', 'HCT', 'MCV', 'NEU', 'LYM', 'MONO', 'EOS', 'BASO'],
  },
  {
    id: 'coag',
    // Column order follows clinical reading habit:
    //   PT + INR are the same test in two forms (INR = (PT/control)^ISI),
    //   so they sit side-by-side. APTT then APTT-ratio next to each other
    //   for the same reason (ratio = APTT/control mean). D-DIMER stands
    //   alone. FDP/FIB tail-in if reported. APTT-RATIO is not pinned —
    //   hospitals that only report seconds shouldn't see an empty stub.
    preferredOrder: ['PT', 'INR', 'APTT', 'APTT-RATIO', 'D-DIMER', 'FDP', 'FIB'],
    codes: ['PT', 'PROTHROMBIN TIME', 'APTT', 'APTT-RATIO', 'INR', 'D-DIMER', 'DDIMER', 'D DIMER', 'FDP', 'FIBRINOGEN', 'FIB'],
    // 63561-5 = aPTT --actual/normal (ratio variant of 14979-9). NOT added
    // to LOINC_TO_CANONICAL because we resolve APTT/APTT-RATIO via display
    // text — keeps bridge LOINC mis-tags visible.
    loincCodes: ['5902-2', '6300-8', '14979-9', '63561-5', '3173-2', '6301-6', '34714-6', '30240-9', '48067-3', '7799-0', '48065-7', '3255-7', '30903-2', '13990-7', '4530-2'],
    pinnedColumns: ['PT', 'INR', 'APTT', 'D-DIMER'],
  },
  {
    id: 'chem',
    // Column order: …liver → 發炎/感染(inflam) → 心肌酵素(cardiac). Inflammation
    // group (CRP → PCT → ESR → LACTATE → FIB-4) reads acute-phase reactants
    // first (CRP/PCT for bacterial vs viral), then ESR (sub-acute/autoimmune),
    // then LACTATE (sepsis/shock); FIB-4 (derived liver fibrosis index) tails.
    // Cardiac (TROP → CK → CK-MB) is grouped here per Taiwan convention —
    // 生化室 owns the assay even though clinically they're cardiac markers.
    // A/G (LOINC 1759-0) was removed from loincCodes: it has no subgroup home
    // and surfaced as an orphan in the "其他" column; not wanted in 累積報告.
    // CO2 (total CO2 / TCO2) + MG sit with the electrolytes (the classic BMP
    // NA·K·CL·CO2 set + magnesium); NT-PROBNP tails with the cardiac markers
    // (heart-failure marker, 生化室 assay). Canonical keys only here — text
    // variants live in `codes` — per feedback_canonical_only_in_preferredorder.
    preferredOrder: ['BUN', 'CREA', 'EGFR(EPI)', 'EGFR(M)', 'EGFR', 'UA', 'NA', 'K', 'CL', 'CO2', 'CA', 'IP', 'MG', 'AST', 'ALT', 'T.BILI', 'D.BILI', 'ALK-P', 'GGT', 'LDH', 'TP', 'ALB', 'AMMONIA', 'CRP', 'PCT', 'ESR', 'LACTATE', 'FIB-4', 'TROP', 'HS-TROPONIN I', 'HS-TROPONIN T', 'CK', 'CKMB', 'NT-PROBNP'],
    // CO2 variants stay TCO2-specific — NOT 'BICARBONATE'/'HCO3', which is the
    // arterial blood-gas analyte (own category). NT-proBNP variants kept
    // distinct from BNP (a different assay we don't fold in here).
    codes: ['TP', 'TOTAL PROTEIN', 'PROTEIN,TOTAL', 'PROTEIN, TOTAL', '總蛋白', '血清總蛋白', '總蛋白質', 'ALB', 'AMMONIA', 'NH3', '血氨', '氨', '09037C', 'BUN', 'CREA', 'CREAT', 'CREAT.', 'CRE', 'EGFR(EPI)', 'EGFR(M)', 'EGFR', 'NA', 'K', 'CL', 'CHLORIDE', 'CO2', 'TCO2', 'T-CO2', 'TOTAL CO2', '二氧化碳', '二氧化碳總量', 'CA', 'CACAL', 'IP', 'MG', 'MAGNESIUM', '鎂', 'UA', 'AST', 'ALT', 'ALK-P', 'ALKP', 'GGT', 'G-GT', 'LDH', 'T.BILI', 'T.BILI.', 'TBILI', 'BILIT', 'BILI', 'D.BILI', 'DBILI', 'TROP', 'TROPONIN', 'TROPONIN I', 'TROPONIN T', 'HS-TROPONIN I', 'HS-TROPONIN T', 'HS-CTNI', 'HS-CTNT', '09099C', 'CK', 'CK-MB', 'CKMB', 'CREATINE KINASE', 'CPK', '肌酸激酶', 'CRP', 'FIB-4', 'PCT', 'PROCALCITONIN', 'ESR', 'LACTATE', 'NT-PROBNP', 'NT-PRO-BNP', 'NTPROBNP', 'PROBNP'],
    // 2075-0 = Chloride Moles/vol S/P — verified at loinc.org (2026-06-02).
    // 10839-9 = Troponin I.cardiac [Mass/volume] in Serum or Plasma — bridge
    // ships this for NHI 09099C 心肌旋轉蛋白Ｉ.
    // 89579-7 = Troponin I.cardiac [Mass/volume] in Serum or Plasma by High
    // sensitivity method — verified at loinc.org (2026-09-10). This is the
    // real bridge bundle the note below was waiting for: a 2026-09 medcloud
    // capture ships code.text "hs-Troponin I" with coding 89579-7 + NHI
    // 09099C, and without this the result fell through to 其他 instead of 生化.
    // It is deliberately NOT folded into the TROP canonical row: LOINC's own
    // guidance is that quantitative results from different troponin assays
    // must not be compared, so hs-cTnI keeps its own row and its own range.
    // The remaining high-sensitivity LOINCs (49563-0 hs-cTnI, 67151-1 hs-cTnT)
    // stay omitted on the same rule — add each when a real bundle uses it, so
    // LOINC_TO_CANONICAL stays in lock-step.
    // 2157-6 = Creatine kinase [Enzymatic activity/volume] in Serum or Plasma
    // (CK total) and 13969-1 = Creatine kinase.MB [Mass/volume] in Serum or
    // Plasma (CK-MB) — both verified at loinc.org (2026-06-16).
    // 2028-9 = Carbon dioxide, total [Moles/volume] S/P (TCO2), 19123-9 =
    // Magnesium [Mass/volume] S/P, 33762-6 = NT-proBNP [Mass/volume] S/P —
    // all three already mapped + cited in clinical-lab-normalization LOINC_TO_CANONICAL
    // (CO2 / MG / NT-PROBNP); added here so they categorise into 生化 instead
    // of falling to 其他 (user report 2026-07-07; live loinc.org re-check was
    // classifier-blocked, mappings reused from the verified in-repo table).
    loincCodes: ['2951-2', '2947-0', '2823-3', '6298-4', '2075-0', '3094-0', '6299-2', '2160-0', '38483-4', '33914-3', '48642-3', '48643-1', '62238-1', '69405-9', '77147-7', '1742-6', '1920-8', '6768-6', '2324-2', '14804-9', '1975-2', '1968-7', '1971-1', '2885-2', '1751-7', '17861-6', '2000-8', '49765-1', '2777-1', '14879-1', '3084-1', '10839-9', '2157-6', '13969-1', '1988-5', '30522-7', '2532-0', '75241-0', '4537-7', '30341-2', '14338-8', '2028-9', '19123-9', '2601-3', '33762-6', '89579-7', '67151-1', '22763-7'],
    subgroups: [
      { id: 'renal',       members: ['BUN', 'CREA', 'EGFR(EPI)', 'EGFR(M)', 'EGFR', 'UA'] },
      { id: 'electrolyte', members: ['NA', 'K', 'CL', 'CO2', 'CA', 'IP', 'MG'] },
      { id: 'liver',       members: ['AST', 'ALT', 'T.BILI', 'D.BILI', 'ALK-P', 'GGT', 'LDH', 'TP', 'ALB', 'AMMONIA'] },
      // 發炎/感染 sits to the LEFT of 心肌酵素 (inflam before cardiac) per the
      // user's reading order. CK + CK-MB join TROP under 心肌酵素; NT-proBNP
      // (heart-failure marker) tails the cardiac group.
      { id: 'inflam',      members: ['CRP', 'PROCALCITONIN', 'PCT', 'ESR', 'FIB-4', 'LACTATE'] },
      // 'HS-TROPONIN I' is the canonical key the normalization package returns
      // for the source name (canonicalKeyFromLoinc has no entry for 89579-7),
      // so it sits BESIDE TROP rather than inside it — same panel, adjacent
      // row, separate assay and separate reference range.
      { id: 'cardiac',     members: ['TROP', 'HS-TROPONIN I', 'HS-TROPONIN T', 'CK', 'CKMB', 'NT-PROBNP'] },
    ],
    // 直式 splits 生化 in two so neither table needs a horizontal scroll on a
    // half-width panel: 腎功能＋電解質 (the routine renal/lyte draw) and
    // 肝功能＋發炎/感染＋心肌酵素 (user request 2026-09-05).
    stackedPanels: [['renal', 'electrolyte'], ['liver', 'inflam', 'cardiac']],
    // CL deliberately not pinned — most ambulatory chem panels don't include
    // chloride, so pinning would create persistent empty columns. When a
    // hospital does report it, the data-presence rule will surface the column.
    // TROP also intentionally NOT pinned — only ordered for acute MI workup,
    // pinning would create a persistent empty column on routine outpatient labs.
    // Pin EGFR(M) — the key NHI eGFR resolves to (bare / MDRD, per Taiwan
    // convention). Pinning bare 'EGFR' created a permanently-empty
    // "腎絲球過濾率 EGFR" stub column beside the populated one, since real data
    // never lands on the bare key. CKD-EPI (EGFR(EPI)) surfaces as its own
    // column on data presence, so it isn't pinned.
    pinnedColumns: ['BUN', 'CREA', 'EGFR(M)', 'UA', 'NA', 'K', 'CA', 'IP', 'AST', 'ALT', 'T.BILI', 'D.BILI', 'ALK-P', 'GGT', 'TP', 'ALB'],
  },
  {
    id: 'endocrine',
    preferredOrder: [
      // Thyroid
      'TSH', 'FREE T4', 'FREE T3', 'T4', 'T3', 'RT3', 'ANTI-TPO', 'ANTI-TG', 'THYROGLOBULIN',
      // Parathyroid / Bone
      'IPTH', 'PTH', 'VITAMIN D', '25-OH VITAMIN D', 'CALCITONIN',
      // Adrenal
      'CORTISOL', 'ACTH', 'ALDOSTERONE', 'RENIN', 'DHEA-S',
      // Sex hormones — PRL is the canonical that PROLACTIN aliases to in
      // TEST_ALIASES; using 'PROLACTIN' here would never match a sorted
      // label (getAnalyteLabel always returns PRL), per
      // memory/feedback_canonical_only_in_preferredorder.md.
      'LH', 'FSH', '濾泡刺激素', '促濾泡成熟激素', 'E2', 'PROGESTERONE', 'TESTOSTERONE', 'PRL', 'AMH', 'SHBG',
      // Diabetes
      'INSULIN', 'C-PEPTIDE',
      // Growth
      'GH', 'IGF-1',
    ],
    codes: [
      // Thyroid
      'TSH', 'T3', 'T4', 'FT3', 'FT4', 'FREE T3', 'FREE T4', 'FREE-T3', 'FREE-T4', 'RT3', 'REVERSE T3',
      'ANTI-TPO', 'ANTI-TG', 'THYROGLOBULIN', 'TRAB', 'TBII',
      // Parathyroid / Bone
      'PTH', 'PTH-I', 'IPTH', 'I-PTH', 'INTACT PTH', '副甲狀腺素', 'VITAMIN D', '25-OH-D', '25(OH)D', '25-OH VITAMIN D',
      // Adrenal
      'CORTISOL', 'ACTH', 'ALDOSTERONE', 'RENIN', 'PRA', 'DHEA', 'DHEA-S', 'DHEAS',
      // Sex hormones
      'LH', 'FSH', 'E2', 'ESTRADIOL', 'PROGESTERONE', 'TESTOSTERONE', 'FREE TESTOSTERONE',
      'PROLACTIN', 'PRL', 'AMH', 'SHBG',
      // Diabetes / Pancreas
      'INSULIN', 'C-PEPTIDE',
      // Growth / Pituitary
      'GH', 'IGF-1', 'IGF1',
    ],
    loincCodes: [
      // Thyroid: TSH, T4, T3, FT4, FT3
      '3016-3', '11580-8', '14999-7', '3024-7', '3026-2', '3051-0', '14920-3', '14998-9',
      // Anti-TPO, Anti-Tg, Thyroglobulin
      '8099-6', '8100-2', '11572-5',
      // PTH (intact), Calcium-regulating
      '2731-8', '14866-8',
      // Vitamin D
      '1989-3', '14635-7', '62292-8', '49054-0',
      // Cortisol, ACTH
      '2143-6', '2141-0',
      // Sex hormones
      '2986-8', '2243-4', '15067-2', '15083-9', '2839-9', '2842-3', '2243-4',
      // E2, FSH, LH, Progesterone, Testosterone, Prolactin
      '2243-4', '15067-2', '10501-5', '2991-8', '2986-8', '2842-3',
      // Insulin, C-Peptide
      '20448-7', '1986-9',
      // IGF-1, GH
      '2484-4', '2963-7',
    ],
    subgroups: [
      { id: 'thyroid',  members: ['TSH', 'FREE T4', 'FREE T3', 'T4', 'T3', 'RT3', 'ANTI-TPO', 'ANTI-TG', 'THYROGLOBULIN', 'TRAB', 'TBII'] },
      { id: 'parathy',  members: ['IPTH', 'PTH', 'I-PTH', 'INTACT PTH', 'VITAMIN D', '25-OH-D', '25(OH)D', '25-OH VITAMIN D', 'CALCITONIN'] },
      { id: 'adrenal',  members: ['CORTISOL', 'ACTH', 'ALDOSTERONE', 'RENIN', 'PRA', 'DHEA', 'DHEA-S', 'DHEAS'] },
      { id: 'sexhorm',  members: ['LH', 'FSH', 'E2', 'PROGESTERONE', 'TESTOSTERONE', 'FREE TESTOSTERONE', 'PRL', 'AMH', 'SHBG'] },
      { id: 'pancreas', members: ['INSULIN', 'C-PEPTIDE'] },
      { id: 'pituitary',members: ['GH', 'IGF-1', 'IGF1'] },
    ],
    pinnedColumns: ['TSH', 'FREE T4', 'FREE T3', 'CORTISOL'],
  },
  {
    id: 'lipid',
    preferredOrder: ['CHOL', 'TG', 'HDL', 'LDL', 'LDL(計算值)', 'RISKF', 'TC/HDL RATIO', 'VLDL', 'NON-HDL', 'APO-A1', 'APO-B', 'LP(A)'],
    codes: ['CHOL', 'CHOL.', 'CHOLESTEROL', 'TG', 'TRIG', 'TRIGLYCERIDE', 'HDLC', 'HDL', 'HDL-C', 'HDLC.', 'LDLC', 'LDL', 'LDL-C', 'LDLC.', 'LDL(計算值)', 'RISKF', 'VLDL', 'VLDLC', 'VLDL-C', 'NON-HDLC', 'NON-HDL', 'NON-HDL-C', 'APO-A', 'APO-A1', 'APOA1', 'APO-B', 'APOB', 'LP(A)'],
    loincCodes: ['2093-3', '14647-2', '14646-4', '2571-8', '3043-7', '2085-9', '2086-7', '14646-4', '2089-1', '13457-7', '2090-9', '13457-7', '43396-1', '13458-5', '11054-4', '2089-1', '13457-7', '18261-8', '18262-6', '10835-7',
      // 9830-1 = Cholesterol.total/Cholesterol in HDL [Mass Ratio] in Serum or
      // Plasma (NLM Clinical Table Search, 2026-09-27) — fell to 其他 before.
      '9830-1'],
    pinnedColumns: ['CHOL', 'TG', 'HDL', 'LDL'],
  },
  {
    id: 'glucose',
    preferredOrder: ['GLUCOSE-AC', 'GLUCOSE', 'GLUCOSE-FS', 'GLU,1HRPC', 'GLU,2HRPC', 'GLU,3HRPC', 'HBA1C', 'C-PEPTIDE'],
    // SUGAR / FINGER SUGAR: some Taiwan clinics use these for blood glucose.
    // Urine dipstick "Sugar" with qualitative value (+, ++, 4+, negative)
    // is routed to urine via the qualitative-value heuristic earlier.
    // 'GLUCOSE-AC' lived in preferredOrder/pinnedColumns but never here, so a
    // source emitting that exact name fell out of 血糖 entirely. Chinese names
    // added alongside it — 健保存摺 and hospital feeds both send them.
    codes: ['GLUCOSE', 'GLU', 'GLU-AC', 'GLU(AC)', 'GLUCOSE(AC)', 'GLUCOSE AC', 'GLUCOSE-AC', 'GLUCOSE-PC', 'GLU-PC', 'GLUCOSE PC', 'GLUCOSE P.C', 'GLUCOSE P.C.', 'GLUCOSE RANDOM', 'AC-SUG', 'PC-SUG', 'GLUCOSE-FS', 'SUGAR', 'FINGER SUGAR', 'AC SUGAR', 'PC SUGAR', 'GLU,1HRPC', 'GLU,2HRPC', 'GLU,3HRPC', 'HBA1C', 'HBA1', 'A1C', 'HB-A1C', 'C-PEPTIDE', '葡萄糖', '血糖', '飯前血糖', '飯後血糖', '空腹血糖', '隨機血糖', '糖化血色素'],
    loincCodes: ['2345-7', '2339-0', '14749-6', '15074-8', '41653-7', '4548-4', '17856-6', '4549-2', '1986-9'],
    pinnedColumns: ['GLUCOSE-AC', 'GLUCOSE', 'HBA1C'],
  },
  {
    id: 'hep',
    // Routine B 肝 screen = HBsAg + Anti-HBs + Anti-HBc (distinguishes vaccine
    // vs natural immunity). HBeAg/Anti-HBe only ordered for known HBsAg(+)
    // carriers; HBcAg not routinely tested in serum. Anti-HCV for C 肝 — tails
    // at the end so the full B 肝 panel reads contiguously before the
    // clinician's eye jumps to a different virus.
    preferredOrder: ['HBSAG', 'ANTI-HBS', 'ANTI-HBC', 'HBEAG', 'ANTI-HBE', 'HBCAG', 'ANTI-HCV'],
    codes: ['HBSAG', 'HBS AG', 'HBS-AG', 'ANTI-HBS', 'HBCAG', 'HBC AG', 'HBC-AG', 'ANTI-HBC', 'HBEAG', 'HBE AG', 'HBE-AG', 'ANTI-HBE', 'ANTI-HCV', 'B型肝炎表面抗原', 'C型肝炎抗體'],
    // HBsAg has 3 LOINCs — Presence(5195-3) / quantitative Units-vol(5196-1) /
    // RIA(5197-9); all three already resolve to HBSAG in LOINC_TO_CANONICAL, so
    // this loincCodes list must carry them all or a quantitative-HBsAg result
    // (NHI 14032C → 5196-1, COI value) falls through to 「其他」 (drift found
    // 2026-07-08 on a real 健保存摺 bundle).
    // Anti-HBc ships as a qual/quant PAIR: 13952-7 (core Ab [Presence] →
    // "Reactive") + 22316-4 (core Ab [Units/volume] → COI number). Both resolve
    // to ANTI-HBC, so the pivot merges them into one cell "Reactive (0.012)"
    // (see useLabPivot qual+quant merge). Both LOINCs must sit here or the
    // 定性/定量 halves split into 其他.
    loincCodes: ['5195-3', '5196-1', '5197-9', '5193-8', '13952-7', '22316-4', '13954-3', '13955-0', '13499-9', '22322-2', '16934-2'],
    pinnedColumns: ['HBSAG', 'ANTI-HBS', 'ANTI-HBC', 'ANTI-HCV'],
  },
  {
    id: 'tumor',
    // F-PSA is the canonical that FPSA / PSA-F / FREE PSA all alias to in
    // TEST_ALIASES — using 'FPSA' here would never match a sorted label
    // (see memory/feedback_canonical_only_in_preferredorder.md). CA-125 /
    // CA-153 / CA-199 are likewise canonical for the various hyphen / space
    // variants their aliases collapse to.
    preferredOrder: ['AFP', 'CEA', 'CA-125', 'CA-153', 'CA-199', 'PSA', 'FPSA/PSA', 'F-PSA', 'FERRITIN', 'B2M', 'SCC', 'HCG', 'FB_HCG', 'HTG', 'CALCITONIN', 'CA72_4', 'CA72-4', 'CYF21_1', 'CYFRA21-1', 'NSE', 'TPA', 'PIVKA-II', 'PIVKA'],
    codes: ['AFP', 'CEA', 'CA-125', 'CA125', 'CA-153', 'CA153', 'CA-199', 'CA199', 'CA19-9', 'PSA', 'TPSA', 'T-PSA', 'PSA(T)', 'PSA-T', 'FPSA/PSA', 'FPSA', 'F-PSA', 'PSA-F', 'FERRITIN', 'B2M', 'SCC', 'HCG', 'B-HCG', 'BETA-HCG', 'FB_HCG', 'HTG', 'CALCITONIN', 'CA72_4', 'CA72-4', 'CYF21_1', 'CYFRA21-1', 'NSE', 'TPA', 'PIVKA-II', 'PIVKA'],
    loincCodes: ['1834-1', '2039-6', '10334-1', '24108-3', '2857-1', '10886-0', '24467-3', '47238-1', '83112-3', '19201-2', '53764-7', '15067-2', '15083-9', '47239-9'],
    pinnedColumns: ['AFP', 'CEA', 'CA-199', 'CA-125', 'CA-153', 'PSA', 'FERRITIN'],
  },
  {
    id: 'urine',
    // Column order — clinical urinalysis report convention, left to right:
    //   1. Physical inspection  (COLOR → APPEARANCE/TURBIDITY → GRAVIT → PH)
    //   2. Chemistry dipstick   (PROT → GLUCOSE → KETONE → BILI → UROBI →
    //                            NITRITE → LE → OCCULT) — metabolic markers
    //                            first, infection markers after
    //   3. Microscopy           (WBC → RBC → EPITH CELL → CASTS → CRYSTALS)
    //   4. Quantitative ratios  (MALB → CREA → ACR; PROT(SPOT) → CR(SPOT) →
    //                            PROT/CR RATIO; CALB(SPOT) → ALB/CR RATIO)
    // Within each section: clinically-frequent items first, rarer at tail.
    // Each canonical key listed here is normalize()d at sort time, so case +
    // punctuation variants (e.g. 'GRAVIT' vs 'GRAVITY' vs 'SP.GRAVITY') don't
    // need explicit duplicate entries when they collapse to the same key.
    preferredOrder: [
      // ── Physical ────────────────────────────────────────────
      'COLOR', 'APPEARANCE', 'TURBIDITY', 'TRANS', 'TRANSPARENT',
      'GRAVIT', 'GRAVITY', 'SP.GRAVITY',
      'PH',
      // ── Chemistry (dipstick) ────────────────────────────────
      'PROT', 'PROTEIN',
      'GLUCOSE', 'SUGAR',
      'KETONE', 'KETON',
      'BILI', 'BILIRUBIN',
      'UROBI', 'UROBILINOGEN',
      'NITRITE', 'NITRIT',
      'LE',
      'OCCULT', 'OCCULT BLOOD', 'BLOOD',
      // ── Microscopic ─────────────────────────────────────────
      'WBC', 'WBCPUS', 'WBC/HPF',
      'RBC', 'RBC/HPF',
      'EPITH', 'EPITH CELL', 'EPITHELIAL CELL',
      'SQUAMOUS EPI', 'UROTHELIUM EPI', 'RTE-RENAL TUBE',
      'CAST1', 'CAST2', 'CAST3', 'CASTS',
      'CRYS1', 'CRYS2', 'CRYS3', 'CRYSTAL', 'BACTERIA', 'MUCUS',
      // ── Quantitative / ratio ────────────────────────────────
      'MALB', 'MALB(U)',
      'PROT(SPOT)', 'CALB(SPOT)', 'CR(SPOT)', 'CREA',
      'PROT/CR RATIO', 'ALB/CR RATIO', 'ACR', 'UACR',
      '微白蛋白/肌酐酸比值', '微白蛋白/肌酸酐比值',
    ],
    // Note: SUGAR is NOT in urine codes — some clinics report blood glucose as
    // "Sugar". Urine dipstick sugar is detected via the qualitative-value
    // heuristic (Negative/+/++/etc.) earlier in categorizeObservation.
    codes: ['COLOR', 'TRANS', 'TRANSPARENT', 'TURBIDITY', 'APPEARANCE', 'GRAVIT', 'GRAVITY', 'SP.GRAVITY', 'PROTEIN', 'PROT', 'KETON', 'KETONE', 'UROBI', 'UROBILINOGEN', 'NITRIT', 'NITRITE', 'OCCULT', 'OCCULT BLOOD', 'BLOOD', 'EPITH', 'EPITH CELL', 'EPITHELIAL CELL', 'WBCPUS', 'WBC/HPF', 'RBC/HPF', 'CAST1', 'CAST2', 'CAST3', 'CRYS1', 'CRYS2', 'CRYS3', 'CASTS', 'CRYSTAL', 'BACTERIA', 'MUCUS', 'PROT(SPOT)', 'CALB(SPOT)', 'CR(SPOT)', 'PROT/CR RATIO', 'ALB/CR RATIO', 'ACR', 'UACR', '微白蛋白/肌酐酸比值', '微白蛋白/肌酸酐比值', '白蛋白/肌酐酸比值', '白蛋白/肌酸酐比值', 'MALB', 'MALB(U)', 'LE'],
    // 2026-05-29 additions (verified at loinc.org): 5792-7 Urine glucose,
    // 5818-0 Urobilinogen urine, 5770-3 Bilirubin urine, 14957-5 Microalbumin
    // urine, 14959-1 Microalbumin/Creatinine ratio. These were previously
    // routed to urine only via the qualitative-result heuristic; now that
    // LOINC check runs before text-based passes, they need to be in this
    // allowlist directly.
    // 2026-06-14 additions (verified at loinc.org): 5787-7 Epithelial cells,
    // 25145-4 Bacteria, 5783-6 Crystals, 8247-9 Mucus [Presence] by Light
    // microscopy — all "Urine sed" microscopy. Added so the sediment rows
    // categorise into urine via LOINC (they were absent and would only catch
    // via the qualitative-result text heuristic). 8247-9 is the corrected code
    // the bridge now emits for the mucus row (was panel code 24356-8).
    loincCodes: ['5778-6', '5803-2', '5774-5', '5767-9', '5797-6', '5804-0', '5802-4', '5794-3', '5811-5', '5799-2', '20454-5', '5821-4', '5808-1', '5792-7', '5818-0', '5770-3', '14957-5', '14959-1', '2161-8', '5787-7', '25145-4', '5783-6', '8247-9',
      // 2026-09-27 (verified, NLM Clinical Table Search): test-strip glucose /
      // ketones / urobilinogen, quantitative urine protein and sediment casts
      // — real bundles carry these codes and they must categorise into 尿液
      // by LOINC, not by whichever name the hospital printed.
      '25428-4', '2514-8', '19161-9', '2888-6', '24124-0'],
    subgroups: [
      { id: 'physical',  members: ['COLOR', 'APPEARANCE', 'TURBIDITY', 'TRANS', 'TRANSPARENT', 'GRAVIT', 'GRAVITY', 'SP.GRAVITY', 'PH'] },
      { id: 'chemical',  members: ['PROT', 'PROTEIN', 'GLUCOSE', 'SUGAR', 'KETONE', 'KETON', 'BILI', 'BILIRUBIN', 'UROBI', 'UROBILINOGEN', 'NITRITE', 'NITRIT', 'LE', 'OCCULT', 'BLOOD'] },
      { id: 'micro',     members: ['WBC', 'WBCPUS', 'WBC/HPF', 'RBC', 'RBC/HPF', 'EPITH', 'EPITH CELL', 'SQUAMOUS EPI', 'UROTHELIUM EPI', 'RTE-RENAL TUBE', 'CAST1', 'CAST2', 'CAST3', 'CASTS', 'CRYS1', 'CRYS2', 'CRYS3', 'CRYSTAL', 'BACTERIA', 'MUCUS'] },
      { id: 'ratio',     members: ['MALB', 'MALB(U)', 'CREA', 'PROT(SPOT)', 'CALB(SPOT)', 'CR(SPOT)', 'PROT/CR RATIO', 'ALB/CR RATIO', 'ACR', 'UACR'] },
    ],
    stackedPanels: [['physical', 'chemical'], ['micro', 'ratio']],
    pinnedColumns: ['COLOR', 'PH', 'GRAVIT', 'PROT', 'GLUCOSE', 'KETONE', 'BILI', 'UROBI', 'NITRITE', 'OCCULT'],
  },
  {
    id: 'bloodgas',
    // Blood gas (ABG / VBG / CBG). hiddenByDefault → shown directly when the
    // category row has room, otherwise surfaced via 「查看更多」; blood gas is
    // ordered for a minority of (usually critically-ill) patients.
    //
    // MULTI-SPECIMEN, ONE COLUMN by design: arterial, venous AND capillary
    // LOINCs for each analyte map to the same canonical key (see
    // LOINC_TO_CANONICAL) so they collapse into a single pH / pCO2 / pO2 / SO2
    // column — the clinician tells arterial from venous by reading the O2
    // saturation / pO2 themselves, rather than the table splitting into
    // pO2 + pO2(V). Because a column mixes specimens, blood-gas analytes carry
    // NO hardcoded reference range (arterial vs venous ranges differ materially,
    // esp. pO2 / SO2); colouring comes only from each obs's own FHIR
    // referenceRange. All codes verified at loinc.org (2026-07-06) against the
    // official gas panels 24336-0 (Arterial) and 24339-4 (Venous); 3150-0 FiO2
    // is a ventilator setting with NO specimen, caught by the LOINC pass.
    // Reading order: gas tensions → acid-base → oxygenation → FiO2 (context).
    hiddenByDefault: true,
    preferredOrder: ['PH', 'PCO2', 'PO2', 'HCO3', 'BE', 'SO2', 'FIO2'],
    // Bare 'PH' is deliberately NOT in codes[] — it collides with urinalysis
    // pH; blood-gas pH is resolved via LOINC (Pass 2) + blood specimen (Pass 1).
    // Short codes stay specimen-neutral where possible, with a few arterial/
    // venous text variants for bridges that ship short names without a LOINC.
    codes: ['PCO2', 'PACO2', 'PVCO2', 'PO2', 'PAO2', 'PVO2', 'HCO3', 'BE', 'SO2', 'SAO2', 'SVO2', 'FIO2'],
    loincCodes: [
      // pH: arterial / venous / capillary
      '2744-1', '2746-6', '2745-8',
      // pCO2: arterial / venous / capillary
      '2019-8', '2021-4', '2020-6',
      // pO2: arterial / venous / capillary
      '2703-7', '2705-2', '2704-5',
      // Bicarbonate: arterial / venous
      '1960-4', '14627-4',
      // Base excess: arterial / venous
      '1925-7', '1927-3',
      // O2 saturation: arterial / venous
      '2708-6', '2711-0',
      // Generic "Blood" (unspecified vessel): pH / pCO2 / pO2 / bicarbonate /
      // base excess / O2 saturation — verified loinc.org 2026-07-06.
      '11558-4', '11557-6', '11556-8', '1959-6', '11555-0', '20564-1',
      // FiO2
      '3150-0',
    ],
    pinnedColumns: ['PH', 'PCO2', 'PO2', 'HCO3', 'BE', 'SO2', 'FIO2'],
  },
  {
    id: 'serology',
    // Viral antigen / serology ordered on a respiratory / infection workup
    // (流感 A/B、新冠抗原、黴漿菌 IgM). 健保存摺 ships these WITHOUT LOINC, so
    // categorise by NHI 醫令 code (14065C/14066C/14084C/12020C) — the reliable
    // identifier (code.text is inconsistent). Analyte canonicalisation +
    // display labels live in clinical-lab-normalization (TEST_ALIASES / CANONICAL_DISPLAY).
    // hiddenByDefault: a minority panel — shown directly when space permits,
    // otherwise surfaced via 「查看更多」 without crowding routine labs.
    // When revealed manually, pinnedColumns still show the expected column
    // headers even when there are no rows in the selected time range — same
    // behaviour as blood gas, and less confusing than a blank empty-state.
    preferredOrder: ['FLU-A-AG', 'FLU-B-AG', 'COVID-AG', 'MYCOPLASMA-IGM'],
    codes: ['FLU-A-AG', 'FLU-B-AG', 'COVID-AG', 'MYCOPLASMA-IGM', '14065C', '14066C', '14084C', '12020C'],
    pinnedColumns: ['FLU-A-AG', 'FLU-B-AG', 'COVID-AG'],
    hiddenByDefault: true,
  },
  {
    // 微生物 — cultures, stains and susceptibilities. Unlike every category
    // above, membership is decided by the TEST, not the specimen: a blood, a
    // urine and a sputum culture are all microbiology, so this is matched in
    // its own pass BEFORE specimen routing (which would otherwise file a urine
    // culture under 尿液 and drop a sputum one entirely).
    //
    // Most microbiology rows still rely on text aliases because 健保存摺 often
    // omits LOINC. The two verified mycobacterial members are the narrow
    // exception listed below; unknown codes continue to fail closed.
    id: 'microbio',
    // Within each family, follow the clinical result workflow: direct exam,
    // specimen-specific cultures, generic culture, then susceptibility.
    // Subgroups below keep the three organism families from interleaving.
    preferredOrder: [
      'GRAM STAIN',
      'BLOOD-CULTURE', 'CSF CULTURE', 'SPUTUM CULTURE', 'URINE CULTURE',
      'STOOL CULTURE', 'WOUND CULTURE', 'PUS CULTURE',
      'AEROBIC-CULTURE', 'ANAEROBIC CULTURE', 'CULTURE',
      'ANTIBIOTIC SUSCEPTIBILITY', '抗生素敏感性試驗', '藥物敏感試驗',
      'ACID-FAST-STAIN', 'MYCOBACTERIAL-CULTURE', 'TB CULTURE',
      'AFB CULTURE', '抗酸菌培養',
      'KOH', 'INDIA INK', 'FUNGAL CULTURE', 'FUNGUS CULTURE',
      '黴菌培養', '真菌培養',
    ],
    codes: [
      'CULTURE', 'BLOOD CULTURE', 'URINE CULTURE', 'SPUTUM CULTURE', 'STOOL CULTURE',
      'WOUND CULTURE', 'PUS CULTURE', 'CSF CULTURE', 'FUNGUS CULTURE', 'FUNGAL CULTURE',
      'MYCOBACTERIAL CULTURE', 'TB CULTURE', 'GRAM STAIN', 'ACID-FAST STAIN',
      'ACID FAST STAIN', 'AFB', 'AFB STAIN', 'INDIA INK', 'KOH',
      '培養', '細菌培養', '血液培養', '細菌血液培養', '尿液培養', '痰液培養', '糞便培養',
      '傷口培養', '黴菌培養', '真菌培養', '結核菌培養', '分枝桿菌培養',
      '革蘭氏染色', '抗酸菌染色', '抗酸性染色', '藥物敏感試驗', '抗生素敏感性試驗',
      '細菌最低抑制濃度快速試驗', 'MINIMUM INHIBITORY CONCENTRATION',
    ],
    // Pass 0 below checks these before specimen routing so a urine- or
    // sputum-sourced culture cannot be misfiled as routine urinalysis/other.
    loincCodes: ['600-7', '634-6', '664-3', '50941-4', '11545-1'],
    subgroups: [
      {
        id: 'bacteriology',
        members: [
          'GRAM STAIN', 'BLOOD-CULTURE', 'CSF CULTURE', 'SPUTUM CULTURE',
          'URINE CULTURE', 'STOOL CULTURE', 'WOUND CULTURE', 'PUS CULTURE',
          'AEROBIC-CULTURE', 'ANAEROBIC CULTURE', 'CULTURE', '培養', '細菌培養',
          'ANTIBIOTIC SUSCEPTIBILITY', 'SUSCEPTIBILITY', '藥物敏感試驗',
          '抗生素敏感性試驗', '藥敏',
        ],
      },
      {
        id: 'mycobacteriology',
        members: [
          'ACID-FAST-STAIN', 'MYCOBACTERIAL-CULTURE', 'TB CULTURE',
          'AFB CULTURE', '抗酸菌培養', '分枝桿菌培養', '結核菌培養',
          '抗酸菌鑑定檢查', '分枝桿菌鑑定',
        ],
      },
      {
        id: 'mycology',
        members: [
          'KOH', 'INDIA INK', 'FUNGAL CULTURE', 'FUNGUS CULTURE',
          '黴菌培養', '真菌培養',
        ],
      },
    ],
  },
  {
    // 其他 — the catch-all. The panels above are an allowlist of the routinely
    // ordered ones, so anything else the SOURCE itself calls a laboratory
    // result used to be dropped on the floor and disappear from the cumulative
    // report, the AI context and the exports. It now lands here instead.
    //
    // `codes` is intentionally EMPTY: nothing is matched into 其他 by name. It
    // is only ever reached as the last-resort fallback, and only for
    // observations the source labelled as laboratory — never by guessing.
    id: 'other',
    codes: [],
  },
]

/**
 * Microbiology is identified by the test itself, so these run before specimen
 * routing. Kept as patterns rather than exact codes because lab names arrive
 * in many shapes ("Culture, Blood (Aerobic)", "痰液細菌培養", "AFB stain").
 */
const MICROBIOLOGY_NAME_PATTERNS: RegExp[] = [
  /\bCULTURES?\b/,
  /ACID[- ]?FAST/,
  /GRAM[- ]?STAIN/,
  /MYCOBACTERI/,
  /FUNGUS|FUNGAL/,
  /SUSCEPTIBILIT/,
  /INDIA INK/,
  /\bAFB\b/,
  /\bKOH\b/,
  /培養/,
  /抗酸/,
  /革蘭/,
  /分枝桿菌|結核菌/,
  /黴菌|真菌/,
  /藥敏|抗生素敏感/,
  /最低抑制濃度|MINIMUM INHIBITORY CONCENTRATION|\bMIC\b/,
]

// Known NHI microbiology orders. Component rows flattened from these reports
// may be named only "Neutrophil" or "W.B.C.-Sputum", so text matching alone
// cannot identify them as microbiology. Keep this list narrow instead of
// treating the entire 13xxx pathology section as culture data.
const MICROBIOLOGY_NHI_ORDER_CODES = new Set([
  '13006C', // bacterial microscopy / Gram-stain components
  '13007C', // general culture and identification
  '13008C', // combined aerobic/anaerobic culture add-on
  '13012C', // legacy mycobacterial culture order
  '13013C', // acid-fast organism identification
  '13016B', // blood culture
  '13023C', // rapid minimum inhibitory concentration
  '13025C', // concentrated acid-fast smear
  '13026C', // mycobacterial culture
])

function normalize(s: string): string {
  return s.normalize('NFKC').trim().toUpperCase()
}

// Compile the fixed vocabulary once, not once per observation per matching
// pass. A document toggle can re-scope thousands of labs in several consumers;
// rebuilding these sets dominated that interaction's CPU time. Only static
// terminology is cached here — never patient observations or their results.
// Keep category order intact because the first matching category still wins.
const CATEGORY_MATCHERS = LAB_CATEGORIES.map((category) => ({
  category,
  loincCodes: new Set((category.loincCodes ?? []).map(normalize)),
  codes: new Set(category.codes.map(normalize)),
  canonicalKeys: new Set([...(category.preferredOrder ?? []), ...category.codes].map(normalize)),
}))
const MICROBIOLOGY_MATCHER = CATEGORY_MATCHERS.find(({ category }) => category.id === 'microbio')
const NON_MICROBIOLOGY_LOINCS = new Set(CATEGORY_MATCHERS
  .filter(({ category }) => category.id !== 'microbio')
  .flatMap(({ loincCodes }) => [...loincCodes]))

/**
 * Determine which category a lab observation belongs to.
 * Returns null if it doesn't match any defined category.
 *
 * Looks at ALL coding entries (not just [0]) since HAPI / SMART sandbox often
 * fills LOINC in coding[1] with a local code in coding[0].
 *
 * Keyword matching picks the LONGEST match across all categories so specific
 * keywords win generic ones (e.g., "HEMOGLOBIN A1C" → glucose beats
 * "HEMOGLOBIN" → cbc).
 */
// Qualitative dipstick results (Negative/Positive/Trace/+1...) are almost
// always urinalysis tests. Pattern allows trailing content like "4+ (2000)".
// Uses (?!\w) instead of \b so "4+" and "3+" match ('+' is non-word, has no \b).
const QUALITATIVE_RE = /^(negative|positive|trace|few|occasional|moderate|many|\d?\+|\+{1,4}|none|nil)(?!\w)/i

function isQualitativeResult(obs: any): boolean {
  if (obs.valueQuantity?.value !== undefined && obs.valueQuantity?.value !== null) return false
  const v = String(obs.valueString || obs.valueCodeableConcept?.text || '').trim()
  return !!v && QUALITATIVE_RE.test(v)
}

// ── NHI 醫令章節閘 (name-collision gate) ──────────────────────────────────
// The 08 section is 血液學檢查 (hematology + coagulation, NHI 08001–08134, per
// the 健保給付標準 — verified against NHI-FHIR-Bridge's NHI↔LOINC table). CBC
// differential names like "Neutrophil" / "嗜中性白血球" collide with non-blood
// microscopy rows — e.g. 13006C 細菌顯微鏡檢查 reports pus cells as "Neutrophil
// 1+(>25/LPF)" with NO LOINC and NO specimen, which the name-based passes below
// would otherwise mis-route into the blood CBC NEU column. Pass 1 already blocks
// non-blood SPECIMENS; this blocks non-blood NHI CODES so a NAME match into
// cbc/coag is rejected when the obs carries an NHI code from another section.
// LOINC matches (Pass 2) are deliberately NOT gated — bridge LOINC is the
// authoritative identifier and its errors must stay visible (no-masking policy).
// Each cleanly-single-section category → the NHI 醫令 section prefix(es) it
// legitimately comes from. Only categories with a CLEAN section boundary are
// listed:
//   • cbc / coag → 08  血液學檢查 (08001–08134; verified vs 健保給付標準)
//   • urine      → 06  尿液一般 / 尿生化檢查
// chem is deliberately ABSENT: its inflammation markers span sections (CRP & PCT
// are 12 免疫, ESR is 08), so a 09-only gate would wrongly drop them. Sections
// confirmed empirically against NHI-FHIR-Bridge's NHI↔LOINC table
// (06 尿, 07 糞便, 08 血液/凝血, 09 生化, 11 血庫, 12 免疫/腫瘤, 13 微生物, 14 血清).
const CATEGORY_NHI_SECTIONS: Record<string, string[]> = {
  cbc: ['08'],
  coag: ['08'],
  urine: ['06'],
}

function nhiOrderCode(obs: any): string | null {
  const codings: any[] = Array.isArray(obs?.code?.coding) ? obs.code.coding : []
  for (const c of codings) {
    const system = typeof c?.system === 'string' ? c.system : ''
    if (system.includes(FHIR_SYSTEM_FRAGMENTS.NHI_MEDICAL_ORDER_CODE)) {
      const code = typeof c?.code === 'string' ? c.code.trim().toUpperCase() : ''
      if (code) return code
    }
  }
  return null
}

// A NAME-based category match is rejected when the obs carries an NHI code from
// a section incompatible with that category — so a 13xxx microbiology row can't
// ride a CBC name into 血液 nor a "Bacteria" name into 尿液. obs WITHOUT an NHI
// code fall through unchanged (most non-NHI FHIR data; specimen routing in Pass 1
// handles those when a specimen is present). Categories absent from the map are
// never gated.
function nameMatchAllowedForCategory(cat: LabCategory, obs: any): boolean {
  // A dipstick value ("4+", "Negative", "Trace") under a glucose NAME is a
  // urinalysis row, not a serum sugar. Urine-specimen rows are already routed
  // before any name match; this covers the specimen-less ones that would
  // otherwise ride 葡萄糖 / SUGAR into the 血糖 trend.
  if (cat.id === 'glucose' && isQualitativeResult(obs)) return false

  const sections = CATEGORY_NHI_SECTIONS[cat.id]
  if (!sections) return true
  const nhi = nhiOrderCode(obs)
  return !nhi || sections.some((p) => nhi.startsWith(p))
}

/**
 * Which step of categorizeObservation placed an observation. Reported by the
 * clinician-initiated lab-data problem report so a mis-filed row says WHY it
 * landed where it did (e.g. `text-urine` = Pass 5 matched 「尿」 in a name).
 */
export type LabCategoryDecision =
  | 'microbiology'        // Pass 0
  | 'specimen-urine'      // Pass 1, specimen says urine
  | 'specimen-non-blood'  // Pass 1, non-blood specimen → 其他 catch-all (or none)
  | 'loinc'               // Pass 2
  | 'code'                // Pass 3
  | 'display'             // Pass 4
  | 'canonical'           // Pass 4.5
  | 'text-urine'          // Pass 5
  | 'qualitative'         // Pass 6
  | 'fallback'            // no pass matched → 其他 catch-all (or none)
  | 'none'                // no observation

export interface LabCategoryResult {
  category: LabCategory | null
  decidedBy: LabCategoryDecision
}

export function categorizeObservation(obs: any): LabCategory | null {
  return categorizeObservationWithReason(obs).category
}

/**
 * categorizeObservation plus the pass that decided it. The routing itself
 * lives here; categorizeObservation only drops the reason.
 */
export function categorizeObservationWithReason(obs: any): LabCategoryResult {
  if (!obs) return { category: null, decidedBy: 'none' }

  const codings: any[] = Array.isArray(obs.code?.coding) ? obs.code.coding : []
  const codeNorms = codings.map((c: any) => (c?.code ? normalize(c.code) : '')).filter(Boolean)
  const displayNorms = codings.map((c: any) => (c?.display ? normalize(c.display) : '')).filter(Boolean)
  const textNorm = obs.code?.text ? normalize(obs.code.text) : ''

  const exactCandidates = [...codeNorms, textNorm, ...displayNorms].filter(Boolean)
  const fullText = [textNorm, ...displayNorms].filter(Boolean).join(' ')

  // ── Early special cases ──────────────────────────────────────────────────
  // (Previously: 溶血/脂血/icterus filter removed 2026-05-29.) Bridge still
  // emits these specimen-quality flags as 0-value obs borrowing real analyte
  // LOINCs (BUN 3094-0, Cholesterol 2093-3 etc.) in v0.12.1. We intentionally
  // do NOT filter them so the bridge bug stays visible in the UI — the
  // cumulative report will show 0-value BUN/Cholesterol cells until bridge
  // fixes its end. See memory/feedback_no_masking_bridge_bugs.md.

  // Pass ordering — refactored 2026-05-29 (v0.13.0 audit):
  //   1. Specimen-based routing      (authoritative boundary between blood/urine/other)
  //   2. LOINC against cat.loincCodes (authoritative analyte identifier)
  //   3. Exact short-code match against cat.codes (VGH/local short codes)
  //   4. Stripped-display match  (handles "Serum TSH(ECLIA)" → "TSH")
  //   5. Text-based urine fallback (only when 1–4 missed)
  //   6. Qualitative-result fallback (only when 1–5 missed)
  //
  // Previous version ran text-based routing BEFORE LOINC, which caused the
  // Chinese single-char `尿` substring to incorrectly capture blood analytes
  // 尿酸 (UA) and 尿素氮 (BUN) before LOINC had a chance to route them to
  // chem. Bridge v0.13.0 correctly sets specimen=Blood for those rows, so
  // even with specimen ordering alone the UA bug would be fixable — but the
  // wider issue (LOINC is the authoritative identifier, deserves priority)
  // is what this reordering addresses. Also removes the now-redundant
  // HbA1c text override: LOINC 4548-4 in glucose.loincCodes catches it,
  // and the text 'HbA1c' / 'HB-A1C' / 'GLYCATED' all match glucose.codes
  // entries via Pass 3/4 below.

  // ── Pass 0: microbiology, by TEST rather than specimen ─────────────────
  // Runs first on purpose. A culture is microbiology whatever it was grown
  // from, so specimen routing below must not claim a urine culture for 尿液 or
  // drop a sputum one for being neither blood nor urine.
  const microbiology = MICROBIOLOGY_MATCHER?.category
  const isMicrobiologyLoinc = codeNorms.some((code) => MICROBIOLOGY_MATCHER?.loincCodes.has(code))
  const hasKnownNonMicrobiologyLoinc = codeNorms.some((code) => NON_MICROBIOLOGY_LOINCS.has(code))
  // Name-only matching is allowed for uncoded data and NHI section 13
  // (microbiology). A known non-microbiology order must not be promoted merely
  // because an allergen name contains 「黴菌」— e.g. 30022C Alternaria /
  // Penicillium specific-IgE belongs outside the microbiology report.
  const nhiCode = nhiOrderCode(obs)
  const isMicrobiologyNhiOrder = !!nhiCode && MICROBIOLOGY_NHI_ORDER_CODES.has(nhiCode)
  const allowsMicrobiologyNameMatch = !nhiCode || nhiCode.startsWith('13')
  const isMicrobiologyName = allowsMicrobiologyNameMatch &&
    MICROBIOLOGY_NAME_PATTERNS.some((pattern) => pattern.test(fullText) || pattern.test(textNorm))
  if (
    isMicrobiologyLoinc
    || (!hasKnownNonMicrobiologyLoinc && isMicrobiologyNhiOrder)
    || isMicrobiologyName
  ) {
    return { category: microbiology || null, decidedBy: 'microbiology' }
  }

  // ── Pass 1: specimen-based routing ─────────────────────────────────────
  const specimenText = String(obs.specimen?.display || obs.category?.[1]?.text || '')
  const specimenSaysBlood = !!specimenText &&
    /blood|serum|plasma|whole\s*blood|venous|capillary|血/i.test(specimenText)
  // Non-blood/serum/plasma specimens (stool, CSF, pleural fluid, ascites,
  // smear, synovial fluid, amniotic, bone marrow…) must NOT be measured
  // against the blood panels — a pleural-fluid glucose in the 血糖 trend would
  // be a clinical error. They still fall through to the 其他 catch-all rather
  // than being dropped.
  let specimenBlocksPanels = false
  if (specimenText) {
    if (/urine|urinaly|尿/i.test(specimenText)) {
      return { category: LAB_CATEGORIES.find((c) => c.id === 'urine') || null, decidedBy: 'specimen-urine' }
    }
    specimenBlocksPanels = !specimenSaysBlood
  }

  if (specimenBlocksPanels) return { category: fallbackCategory(obs), decidedBy: 'specimen-non-blood' }

  // ── Pass 2: LOINC against cat.loincCodes (authoritative) ───────────────
  for (const { category: cat, loincCodes: loincSet } of CATEGORY_MATCHERS) {
    for (const cand of codeNorms) {
      if (loincSet.has(cand)) return { category: cat, decidedBy: 'loinc' }
    }
  }

  // ── Pass 3: exact short-code match against cat.codes ───────────────────
  for (const { category: cat, codes: codeSet } of CATEGORY_MATCHERS) {
    for (const candidate of exactCandidates) {
      if (codeSet.has(candidate) && nameMatchAllowedForCategory(cat, obs)) return { category: cat, decidedBy: 'code' }
    }
  }

  // ── Pass 4: stripped display-name match ────────────────────────────────
  // Handles verbose names like "Serum TSH(ECLIA ...)" where stripping the
  // prefix/parenthetical yields a short code ("TSH") that IS in codes[].
  const strippedDisplays = [textNorm, ...displayNorms]
    .map(n =>
      n.replace(/\s*[\(\[（［].*$/, '')  // strip parenthetical and everything after
       .replace(/^SERUM\s+/, '')          // strip "Serum " / "SERUM " prefix
       .replace(/[.…]+$/, '')             // strip trailing dots
       .trim()
    )
    .filter(Boolean)
  for (const { category: cat, codes: codeSet } of CATEGORY_MATCHERS) {
    for (const candidate of strippedDisplays) {
      if (codeSet.has(candidate) && nameMatchAllowedForCategory(cat, obs)) return { category: cat, decidedBy: 'display' }
    }
  }

  // ── Pass 4.5: canonical-analyte match ──────────────────────────────────
  // clinical-lab-normalization already knows which source names mean which analyte — that
  // is how a row can be HEADED "GLUCOSE-AC" when the source said 飯前血糖.
  // Categorisation used to consult only the raw text against `codes`, so an
  // analyte the alias table recognised could still fail every pass above and
  // fall out of its panel: "GLUCOSE-AC" is listed in glucose's preferredOrder
  // and pinnedColumns but was never added to its `codes`, so a source emitting
  // that exact name was silently dropped from 血糖.
  //
  // Matching the CANONICAL key against each category's code + column lists
  // keeps categorisation and display from drifting apart, instead of asking
  // every future alias to be hand-copied into a second list.
  const canonicalKeys = [
    canonicalKeyFromLoinc(obs),
    ...exactCandidates.map((candidate) => canonicalTestKeyFromString(candidate)),
  ].filter((key): key is string => !!key && key !== 'UNKNOWN').map(normalize)
  for (const { category: cat, canonicalKeys: keySet } of CATEGORY_MATCHERS) {
    for (const key of canonicalKeys) {
      if (keySet.has(key) && nameMatchAllowedForCategory(cat, obs)) return { category: cat, decidedBy: 'canonical' }
    }
  }

  // ── Pass 5: text-based urine fallback (only when nothing above matched) ─
  // Skip when bridge declared specimen=Blood — see big comment above for
  // the 尿酸 / 尿素氮 substring trap this guard avoids.
  if (!specimenSaysBlood && /\bURINE\b|尿/.test(fullText)) {
    return { category: LAB_CATEGORIES.find((c) => c.id === 'urine') || null, decidedBy: 'text-urine' }
  }

  // ── Pass 6: qualitative-result fallback ────────────────────────────────
  // Dipstick-style results ("4+", "Negative", "trace") are typical of
  // urinalysis. Skip when specimen=Blood so qualitative blood results
  // (ABO typing, antibody screens) don't get mis-routed. ALSO skip when the
  // obs carries an NHI 醫令碼 — coded data's category comes from the code
  // (LOINC / 08 section / …), not a value-shape guess. Without this a
  // microbiology microscopy row like 13006C "Neutrophil 1+(>25/LPF)" — already
  // blocked from CBC by the section gate above — would bounce into 尿液 on the
  // leading "1+". Uncoded sandbox/orphan dipstick rows (no NHI code) still fall
  // through here as before.
  if (!specimenSaysBlood && !nhiOrderCode(obs) && isQualitativeResult(obs)) {
    return { category: LAB_CATEGORIES.find((c) => c.id === 'urine') || null, decidedBy: 'qualitative' }
  }

  return { category: fallbackCategory(obs), decidedBy: 'fallback' }
}

/**
 * Last resort. The panels above are an allowlist of the routinely-ordered
 * ones; a lab outside all of them used to be dropped, so it vanished from the
 * cumulative report, the AI context and every export.
 *
 * It now lands in 其他 — but ONLY when the SOURCE itself labelled the
 * observation a laboratory result. We never promote by guessing: vital signs,
 * imaging-derived measurements and survey answers keep their own homes and
 * still return null here.
 */
function fallbackCategory(obs: any): LabCategory | null {
  if (inferGroupFromObservation(obs) !== 'lab') return null
  return LAB_CATEGORIES.find((c) => c.id === 'other') || null
}

/**
 * Return the display name to show as the test column header.
 */
export function getTestDisplayName(obs: any): string {
  return (
    obs?.code?.text ||
    obs?.code?.coding?.[0]?.display ||
    obs?.code?.coding?.[0]?.code ||
    'Unknown'
  )
}

/**
 * Sort comparator using a category's preferredOrder, with fallback to alphabetical.
 */
export function compareTestsByPreferred(category: LabCategory): (a: string, b: string) => number {
  const order = (category.preferredOrder || []).map(normalize)
  return (a: string, b: string) => {
    const ai = order.indexOf(normalize(a))
    const bi = order.indexOf(normalize(b))
    if (ai !== -1 && bi !== -1) return ai - bi
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return a.localeCompare(b)
  }
}

// canonical analyte key (normalized) → owning LabCategory, derived from each
// category's preferredOrder. Lets a canonical short code (resolved via
// getAnalyteLabel) be mapped to a category WITHOUT re-running the LOINC/code
// allowlist in categorizeObservation — which matters for bridge data that
// sends Chinese display text with no LOINC ("白血球計數" → WBC via
// TEST_ALIASES): categorizeObservation can't match those English-only codes,
// but the canonical key still lands in the right category here.
export const CANONICAL_TO_CATEGORY: Map<string, LabCategory> = (() => {
  const m = new Map<string, LabCategory>()
  for (const cat of LAB_CATEGORIES) {
    for (const k of cat.preferredOrder || []) {
      const norm = normalize(k)
      if (!m.has(norm)) m.set(norm, cat)
    }
  }
  return m
})()
