// 免疫 (immunology) analytes for the cumulative report: immunoglobulins and
// complement, and autoantibodies. Specific-allergen IgE (30022C) is kept OUT
// of the cumulative report altogether for now (owner decision 2026-10-08).
//
// Field report LDR-20261008-28256AA6 (臺北榮總 via 雲端病歷): IgG, IgA, IgM,
// C3, C4 and RF had no panel and fell to 「其他」; line-blot autoantibodies
// whose value is "Negative" (Ro52, Mi-2α/β, Jo-1, Ku) were read as urine
// dipstick results; and the 30022C allergen 混合黴菌 was filed as a fungal
// culture.
//
// Several NHI orders bill MORE THAN ONE analyte (12064B = SS-A + SS-B + Ro52,
// 12173B = Sm + RNP, 12137B = a myositis line blot). The order code therefore
// decides only the CATEGORY; the column always comes from the analyte — its
// LOINC, or its own item name. A name alone is enough when it is unambiguous
// ("IgG1", "SS-A/Ro Ab"), whatever order code the hospital billed it under.
//
// Every LOINC below was looked up on 2026-10-08 in the NLM Clinical Table
// Search LOINC index (clinicaltables.nlm.nih.gov/api/loinc_items, LOINC_NUM
// and LONG_COMMON_NAME quoted in the comment).

/** Canonical column key → column header (same text in zh-TW and en). */
export const IMMUNOLOGY_DISPLAY: Readonly<Record<string, string>> = {
  IGE: 'IgE',
  IGG1: 'IgG1',
  IGG2: 'IgG2',
  IGG3: 'IgG3',
  IGG4: 'IgG4',
  C3: 'C3',
  C4: 'C4',
  RF: 'RF',
  'ANTI-DSDNA': 'Anti-dsDNA',
  'ANTI-SM': 'Sm',
  'ANTI-RNP': 'RNP',
  'ANTI-SSA': 'SS-A/Ro',
  'ANTI-RO52': 'Ro52',
  'ANTI-SSB': 'SS-B/La',
  'ANTI-JO-1': 'Jo-1',
  'ANTI-PL-7': 'PL-7',
  'ANTI-PL-12': 'PL-12',
  'ANTI-EJ': 'EJ',
  'ANTI-OJ': 'OJ',
  'ANTI-SRP': 'SRP',
  'ANTI-MI-2A': 'Mi-2α',
  'ANTI-MI-2B': 'Mi-2β',
  'ANTI-MDA5': 'MDA5',
  'ANTI-TIF1G': 'TIF1γ',
  'ANTI-NXP2': 'NXP2',
  'ANTI-SAE1': 'SAE1',
  'ANTI-KU': 'Ku',
  'ANTI-KI': 'Ki',
  'ANTI-PM-SCL100': 'PM-Scl100',
  'ANTI-PM-SCL75': 'PM-Scl75',
  AMA: 'AMA',
}

export const IMMUNOGLOBULIN_KEYS = ['IGG', 'IGA', 'IGM', 'IGE', 'IGG1', 'IGG2', 'IGG3', 'IGG4', 'C3', 'C4']

// Reading order: screen (ANA) → SLE-specific (dsDNA, Sm, RNP) → Sjögren
// (SS-A, Ro52, SS-B) → RF → the myositis line blot (synthetase antibodies,
// then the dermatomyositis / necrotising / overlap members) → AMA.
export const AUTOANTIBODY_KEYS = [
  'ANA', 'ANTI-DSDNA', 'ANTI-SM', 'ANTI-RNP', 'ANTI-SSA', 'ANTI-RO52', 'ANTI-SSB', 'RF',
  'ANTI-JO-1', 'ANTI-PL-7', 'ANTI-PL-12', 'ANTI-EJ', 'ANTI-OJ', 'ANTI-SRP',
  'ANTI-MI-2A', 'ANTI-MI-2B', 'ANTI-MDA5', 'ANTI-TIF1G', 'ANTI-NXP2', 'ANTI-SAE1',
  'ANTI-KU', 'ANTI-KI', 'ANTI-PM-SCL100', 'ANTI-PM-SCL75', 'AMA',
]

/** 30022C allergen item names as hospitals print them, used only to keep an
 *  allergen row that arrives WITHOUT its 30022C code out of the cumulative
 *  report (and out of 微生物: 混合黴菌 is not a fungal culture). 「屋塵璊」 is
 *  the source's own spelling. */
export const ALLERGEN_NAMES = [
  '混合花粉', '屋塵璊', '屋塵蟎', '塵蟎', '德國蟑螂', '美國蟑螂', '蟑螂', '混合動物皮毛',
  '貓毛', '貓皮屑', '狗毛', '狗皮屑', '混合黴菌',
  // Deliberately NOT here: food allergens such as 蛋白 (egg white), whose
  // bare name is also 「protein」. Those rows are recognised by their 30022C code.
]

/** Analyte LOINC → canonical key. IgG 2465-3, IgA 2458-8, IgM 2472-9 and ANA
 *  5048-4 resolve in clinical-lab-normalization already and are only listed
 *  in the category allowlist. */
export const IMMUNOLOGY_LOINC_TO_KEY: Readonly<Record<string, string>> = {
  '19113-0': 'IGE',        // IgE [Units/volume] in Serum or Plasma
  '2466-1': 'IGG1',        // IgG subclass 1 [Mass/volume] in Serum
  '2467-9': 'IGG2',        // IgG subclass 2 [Mass/volume] in Serum
  '2468-7': 'IGG3',        // IgG subclass 3 [Mass/volume] in Serum
  '2469-5': 'IGG4',        // IgG subclass 4 [Mass/volume] in Serum
  '4485-9': 'C3',          // Complement C3 [Mass/volume] in Serum or Plasma
  '4498-2': 'C4',          // Complement C4 [Mass/volume] in Serum or Plasma
  '11572-5': 'RF',         // Rheumatoid factor [Units/volume] in Serum or Plasma
  '8061-4': 'ANA',         // Nuclear Ab [Presence] in Serum
  '5130-0': 'ANTI-DSDNA',  // DNA double strand Ab [Units/volume] in Serum
  '33569-5': 'ANTI-SSA',   // Sjogrens syndrome-A extractable nuclear Ab [Units/volume] in Serum by Immunoassay
  '5352-0': 'ANTI-SSA',    // Sjogrens syndrome-A extractable nuclear Ab [Presence] in Serum by Immune diffusion (ID)
  '17791-5': 'ANTI-SSB',   // Sjogrens syndrome-B extractable nuclear Ab [Units/volume] in Serum
  '45142-7': 'ANTI-SSB',   // Sjogrens syndrome-B extractable nuclear Ab [Units/volume] in Serum by Immunoassay
  '5353-8': 'ANTI-SSB',    // Sjogrens syndrome-B extractable nuclear Ab [Presence] in Serum by Immunoassay
  '53017-0': 'ANTI-RO52',  // Sjogrens syndrome-A extractable nuclear 52kD Ab [Units/volume] in Serum
  '56549-9': 'ANTI-RO52',  // Sjogrens syndrome-A extractable nuclear 52kD Ab [Units/volume] in Serum by Immunoassay
  '99139-8': 'ANTI-RO52',  // Sjogrens syndrome-A extractable nuclear 52kD Ab [Units/volume] in Serum by Line blot
  '53016-2': 'ANTI-RO52',  // Sjogrens syndrome-A extractable nuclear 52kD Ab [Presence] in Serum
  '82933-3': 'ANTI-RO52',  // Sjogrens syndrome-A extractable nuclear 52kD IgG Ab [Presence] in Serum by Line blot
  '11090-8': 'ANTI-SM',    // Smith extractable nuclear Ab [Units/volume] in Serum
  '43182-5': 'ANTI-SM',    // Smith extractable nuclear Ab [Units/volume] in Serum by Immunoassay
  '5356-1': 'ANTI-SM',     // Smith extractable nuclear Ab [Presence] in Serum by Immunoassay
  '5355-3': 'ANTI-SM',     // Smith extractable nuclear Ab [Presence] in Serum by Counterimmunoelectrophoresis (CIE)
  '29374-6': 'ANTI-RNP',   // Ribonucleoprotein extractable nuclear Ab [Units/volume] in Serum
  '51928-0': 'ANTI-RNP',   // Ribonucleoprotein extractable nuclear Ab [Units/volume] in Serum by Immunoassay
  '33571-1': 'ANTI-JO-1',  // Jo-1 extractable nuclear IgG Ab [Units/volume] in Serum
  '8076-2': 'ANTI-JO-1',   // Jo-1 extractable nuclear Ab [Presence] in Serum
  '99069-7': 'ANTI-JO-1',  // Jo-1 extractable nuclear Ab [Units/volume] in Serum by Line blot
  '99068-9': 'ANTI-KU',    // Ku Ab [Units/volume] in Serum by Line blot
  '18484-6': 'ANTI-KU',    // Ku Ab [Presence] in Serum
  '105549-0': 'ANTI-KU',   // Ku Ab [Units/volume] in Serum
  '88732-3': 'ANTI-MI-2A', // Mi-2 alpha Ab [Units/volume] in Serum by Line blot
  '82997-8': 'ANTI-MI-2A', // Mi-2 alpha IgG Ab [Presence] in Serum by Line blot
  '88733-1': 'ANTI-MI-2B', // Mi-2 beta Ab [Units/volume] in Serum by Line blot
  '82996-0': 'ANTI-MI-2B', // Mi-2 beta IgG Ab [Presence] in Serum by Line blot
  '20483-4': 'AMA',        // Mitochondria Ab [Titer] in Serum
  // Codes nhi-clinical-mapper 0.1.6 emits for these orders (its own check:
  // tx.fhir.org ACTIVE + NLM); names re-read from NLM Clinical Table Search.
  '33910-1': 'RF',         // Rheumatoid factor [Presence] in Serum
  '31348-6': 'ANTI-DSDNA', // DNA double strand Ab [Presence] in Serum
  '42254-3': 'ANA',        // Nuclear Ab [Presence] in Serum by Immunofluorescence
  '14236-4': 'AMA',        // Mitochondria Ab [Presence] in Serum
  '17792-3': 'ANTI-SSA',   // Sjogrens syndrome-A extractable nuclear Ab [Units/volume] in Serum
  '8093-7': 'ANTI-SSA',    // Sjogrens syndrome-A extractable nuclear Ab [Presence] in Serum
  '8094-5': 'ANTI-SSB',    // Sjogrens syndrome-B extractable nuclear Ab [Presence] in Serum
  '31627-3': 'ANTI-SM',    // Smith extractable nuclear Ab [Presence] in Serum
  '8091-1': 'ANTI-RNP',    // Ribonucleoprotein extractable nuclear Ab [Presence] in Serum
  '11565-9': 'ANTI-JO-1',  // Jo-1 extractable nuclear Ab [Units/volume] in Serum
  '54160-7': 'ANTI-KI',    // Ki Ab [Presence] in Serum
  '33772-5': 'ANTI-PL-7',  // PL-7 Ab [Presence] in Serum
  '33771-7': 'ANTI-PL-12', // PL-12 Ab [Presence] in Serum
  '45149-2': 'ANTI-EJ',    // Ej Ab [Presence] in Serum
  '45152-6': 'ANTI-OJ',    // OJ Ab [Presence] in Serum
  '33921-8': 'ANTI-SRP',   // Signal Recognition Particle (SRP) Ab [Presence] in Serum or Plasma
  '107563-9': 'ANTI-MDA5', // MDA5 Ab [Presence] in Serum or Plasma
  '107562-1': 'ANTI-TIF1G', // TIF1-gamma Ab [Presence] in Serum or Plasma
  // Further codes the mapper emits, verified 2026-10-09 against tx.fhir.org
  // (LOINC 2.82, ACTIVE) and NLM: the name-routed ANA titer without a stated
  // IFA method, and the method-neutral quantitative twins of the myositis
  // line-blot analytes (for numeric U/mL results).
  '29953-7': 'ANA',         // Nuclear Ab [Titer] in Serum
  '105551-6': 'ANTI-PL-7',  // PL-7 Ab [Units/volume] in Serum
  '105552-4': 'ANTI-PL-12', // PL-12 Ab [Units/volume] in Serum
  '105547-4': 'ANTI-EJ',    // Ej Ab [Units/volume] in Serum
  '105548-2': 'ANTI-OJ',    // OJ Ab [Units/volume] in Serum
  '53031-1': 'ANTI-SRP',    // Signal Recognition Particle (SRP) Ab [Units/volume] in Serum or Plasma
  '105529-2': 'ANTI-MDA5',  // MDA5 Ab [Units/volume] in Serum
  '105555-7': 'ANTI-TIF1G', // TIF1-gamma Ab [Units/volume] in Serum
  '105528-4': 'ANTI-NXP2',  // Mj (NXP-2) Ab [Units/volume] in Serum
  '105554-0': 'ANTI-PM-SCL100', // PM-SCL-100 Ab [Units/volume] in Serum
}

/** 特異過敏原免疫檢驗 — specific allergen IgE, one row per allergen. Kept out
 *  of the cumulative report (see ALLERGEN_NAMES). */
export const SPECIFIC_ALLERGEN_NHI_ORDER_CODES = ['30022C']

/** LOINCs that clinical-lab-normalization already maps (IGG/IGA/IGM/ANA). */
export const PACKAGE_IMMUNOLOGY_LOINCS = [
  '2465-3', // IgG [Mass/volume] in Serum or Plasma
  '2458-8', // IgA [Mass/volume] in Serum or Plasma
  '2472-9', // IgM [Mass/volume] in Serum or Plasma
  '5048-4', // Nuclear Ab [Titer] in Serum by Immunofluorescence
]

/**
 * NHI 醫令 orders whose every analyte is immunology. Sources: the app's own
 * NHI order-name table (12025B/12027B/12029B/12031C/12053C/12056B), the
 * field-report rows (12011C, 12034B, 12038B, 12060C, 12064B, 12137B, 12154B,
 * 12155B, 12173B, 30022C), and the IgG subclass orders, verified 2026-10-10
 * against the NHI fee schedule (醫療服務給付項目及支付標準, data.gov.tw 174450)
 * and TW Core medical-service-payment-tw: 12146B IgG1, 12147B IgG2, 12148B
 * IgG3, 12149B IgG4 (長庚 L72-206 「免疫球蛋白 G4 量」) — one subclass each —
 * and 08107B G型免疫球蛋白次群定量 (含 IgG1–IgG4), the four-subclass panel.
 * 08107B is billed in the 08 血液 section; being listed here exempts it from
 * that section's name gate. Every column still comes from the row's own
 * LOINC or item name, never from the order code. CRP (12015C), CEA, ferritin
 * and the other 12xxx tumour / inflammation markers are NOT here.
 */
export const IMMUNOLOGY_NHI_ORDER_CODES = [
  '12011C', // 類風濕性關節炎因子 RF
  '12025B', // 免疫球蛋白 G
  '12027B', // 免疫球蛋白 A
  '12028B', // 免疫球蛋白 M (older code; bridge maps it to 2472-9 like 12029B)
  '12029B', // 免疫球蛋白 M
  '12031C', // 免疫球蛋白 E
  '12034B', // 補體 C3
  '12038B', // 補體 C4
  '12053C', // 抗核抗體 ANA
  '12056B', // 粒腺體抗體 AMA
  '12060C', // DNA 抗體 (anti-dsDNA)
  '12064B', // ENA Ro/La — SS-A, SS-B, Ro52
  '12137B', // 肌肉炎自體抗體組合 (myositis line blot)
  '12146B', // 免疫球蛋白 G1 量 (IgG1)
  '12147B', // 免疫球蛋白 G2 量 (IgG2)
  '12148B', // 免疫球蛋白 G3 量 (IgG3)
  '12149B', // 免疫球蛋白 G4 量 (IgG4)
  '08107B', // G型免疫球蛋白次群定量 — IgG1, IgG2, IgG3 and IgG4
  '12154B', // ENA Jo-1
  '12155B', // ENA Ki/Ku
  '12173B', // ENA Sm/RNP
]

/**
 * Orders under which an immunology-looking NAME is NOT the immunology
 * analyte, so a name match into 免疫 is refused:
 * - 12103B 免疫電泳 / immunofixation: an 「IgG」 row there is a monoclonal band
 * - 12160B 免疫球蛋白κ/λ: free light chains
 * and whole NHI sections whose rows reuse these names for another test:
 * 06 尿液, 07 糞便, 08 血液, 11 血庫 (antibody screen / Coombs IgG), 13 微生物,
 * 14 病毒血清 (CMV / EBV IgG and IgM).
 */
// 12159B 尿液免疫固定電泳分析 joins 12103B / 12160B: its IgG / IgA / IgM rows
// are IFE lanes. Rows of all three reach 免疫's 電泳／輕鏈 subgroup through
// paraprotein-analytes.ts, before any name pass, so this only refuses the
// immunoglobulin name match.
export const IMMUNOLOGY_NAME_DENIED_NHI_ORDER_CODES = ['12103B', '12159B', '12160B']
export const IMMUNOLOGY_NAME_DENIED_NHI_SECTIONS = ['06', '07', '08', '11', '13', '14']

/** Words in a row's name or order display that place an immunology-looking
 *  name in another test: electrophoresis / immunofixation, light chains,
 *  a non-serum fluid, or an infection serology. */
export const IMMUNOLOGY_NAME_DENIED_CONTEXT =
  /IMMUNOFIXATION|\bIFE\b|ELECTROPHORESIS|電泳|免疫固定|LIGHT\s*CHAIN|輕鏈|\bKAPPA\b|\bLAMBDA\b|Κ|Λ|\bFLC\b|\bCSF\b|腦脊髓|URINE|尿|PLEURAL|胸水|ASCITES|腹水|SYNOVIAL|關節液|\bCMV\b|\bEBV\b|\bHSV\b|\bVZV\b|RUBELLA|TOXOPLASM|MYCOPLASMA|黴漿菌|\bHAV\b|\bHBC\b|COOMBS/

/** Bare short names that are immunology only in an immunology context — an
 *  immunology order, an ENA / blot / autoantibody word nearby, or a
 *  qualified spelling ("Ku Ab", "anti-Ku", "Rheumatoid factor"). Bare
 *  "C3" / "C4" are accepted: the names are matched whole, so C3d, C3NeF or
 *  C4d never reach the C3 / C4 columns. */
export const AMBIGUOUS_SHORT_IMMUNOLOGY_NAMES = new Set([
  'RF', 'KU', 'KI', 'EJ', 'OJ', 'SM', 'RNP', 'SRP', 'SRP54', 'SSA', 'SSB',
])

/** Words that supply that context. */
export const IMMUNOLOGY_NAME_CONTEXT =
  /\bENA\b|EXTRACTABLE|可抽出|核抗體|BLOT|MYOSITIS|肌肉炎|肌炎|AUTO-?\s*ANTIBOD|自體抗體|ANTI-?\s*NUCLEAR|RHEUMATOID|類風濕|SJOGREN|乾燥/

/** Item-name spellings → canonical key. Keys are NFKC + upper case with
 *  single spaces. Looked up by the full name, by the name before any
 *  parenthesis, and by each half of a bilingual 「中文 ;(English)」 name. */
export const IMMUNOLOGY_TEXT_TO_KEY: Readonly<Record<string, string>> = {
  IGG: 'IGG', 'IMMUNOGLOBULIN G': 'IGG', '免疫球蛋白G': 'IGG',
  IGA: 'IGA', 'IMMUNOGLOBULIN A': 'IGA', '免疫球蛋白A': 'IGA',
  IGM: 'IGM', 'IMMUNOGLOBULIN M': 'IGM', '免疫球蛋白M': 'IGM',
  IGE: 'IGE', 'TOTAL IGE': 'IGE', 'IMMUNOGLOBULIN E': 'IGE', '免疫球蛋白E': 'IGE',
  // IgG subclasses: also any "IgG 1" / "IgG-1" / "IgG subclass 1" /
  // 「IgG1亞型」 / 「免疫球蛋白G4」 spelling, by IGG_SUBCLASS_RE below.
  IGG1: 'IGG1', IGG2: 'IGG2', IGG3: 'IGG3', IGG4: 'IGG4',
  C3: 'C3', 'COMPLEMENT C3': 'C3', '補體3': 'C3', '補體C3': 'C3', '補體 C3': 'C3',
  C4: 'C4', 'COMPLEMENT C4': 'C4', '補體4': 'C4', '補體C4': 'C4', '補體 C4': 'C4',
  RF: 'RF', 'RA FACTOR': 'RF', 'RHEUMATOID FACTOR': 'RF', '類風濕性關節炎因子': 'RF', '類風濕因子': 'RF',
  ANA: 'ANA', 'ANA IFA': 'ANA', 'ANTINUCLEAR ANTIBODY': 'ANA', 'ANTI-NUCLEAR ANTIBODY': 'ANA', '抗核抗體': 'ANA',
  DSDNA: 'ANTI-DSDNA', 'DSDNA AB': 'ANTI-DSDNA', 'ANTI-DSDNA': 'ANTI-DSDNA', 'ANTI-DSDNA AB': 'ANTI-DSDNA',
  'ANTI DSDNA': 'ANTI-DSDNA', 'ANTI-DNA': 'ANTI-DSDNA', 'DNA抗體': 'ANTI-DSDNA',
  'SS-A/RO AB': 'ANTI-SSA', 'SS-A/RO': 'ANTI-SSA', 'SS-A': 'ANTI-SSA', SSA: 'ANTI-SSA', 'ANTI-SSA': 'ANTI-SSA',
  'ANTI-SS-A': 'ANTI-SSA', 'SS-A AB': 'ANTI-SSA', 'RO60': 'ANTI-SSA', 'RO-60': 'ANTI-SSA', 'SS-A/RO60': 'ANTI-SSA',
  'SS-B/LA AB': 'ANTI-SSB', 'SS-B/LA': 'ANTI-SSB', 'SS-B': 'ANTI-SSB', SSB: 'ANTI-SSB', 'ANTI-SSB': 'ANTI-SSB',
  'ANTI-SS-B': 'ANTI-SSB', 'SS-B AB': 'ANTI-SSB',
  RO52: 'ANTI-RO52', 'RO-52': 'ANTI-RO52', 'RO 52': 'ANTI-RO52', 'RO52 AB': 'ANTI-RO52', 'ANTI-RO52': 'ANTI-RO52',
  'SS-A/RO52': 'ANTI-RO52', TRIM21: 'ANTI-RO52',
  'SM AB': 'ANTI-SM', SM: 'ANTI-SM', 'ANTI-SM': 'ANTI-SM', 'SMITH AB': 'ANTI-SM',
  'RNP AB': 'ANTI-RNP', RNP: 'ANTI-RNP', 'ANTI-RNP': 'ANTI-RNP', 'U1-RNP': 'ANTI-RNP', 'U1RNP': 'ANTI-RNP', 'U1 RNP': 'ANTI-RNP',
  'JO-1': 'ANTI-JO-1', JO1: 'ANTI-JO-1', 'JO-1 AB': 'ANTI-JO-1', 'ANTI-JO-1': 'ANTI-JO-1', 'ANTI JO-1 ANTIBODY': 'ANTI-JO-1',
  'PL-7': 'ANTI-PL-7', PL7: 'ANTI-PL-7',
  'PL-12': 'ANTI-PL-12', PL12: 'ANTI-PL-12',
  EJ: 'ANTI-EJ', OJ: 'ANTI-OJ',
  SRP: 'ANTI-SRP', SRP54: 'ANTI-SRP',
  'MI-2ALPHA': 'ANTI-MI-2A', 'MI-2ALPHA(MI-2A)': 'ANTI-MI-2A', 'MI-2A': 'ANTI-MI-2A', 'MI-2Α': 'ANTI-MI-2A',
  'MI-2 ALPHA': 'ANTI-MI-2A', MI2ALPHA: 'ANTI-MI-2A',
  'MI-2BETA': 'ANTI-MI-2B', 'MI-2BETA(MI-2B)': 'ANTI-MI-2B', 'MI-2B': 'ANTI-MI-2B', 'MI-2Β': 'ANTI-MI-2B',
  'MI-2 BETA': 'ANTI-MI-2B', MI2BETA: 'ANTI-MI-2B',
  MDA5: 'ANTI-MDA5', 'MDA-5': 'ANTI-MDA5',
  TIF1G: 'ANTI-TIF1G', 'TIF1Γ': 'ANTI-TIF1G', 'TIF1-GAMMA': 'ANTI-TIF1G', TIF1GAMMA: 'ANTI-TIF1G', 'TIF-1Γ': 'ANTI-TIF1G',
  NXP2: 'ANTI-NXP2', 'NXP-2': 'ANTI-NXP2',
  SAE1: 'ANTI-SAE1', 'SAE-1': 'ANTI-SAE1',
  KU: 'ANTI-KU', 'KU AB': 'ANTI-KU', 'ANTI-KU': 'ANTI-KU',
  KI: 'ANTI-KI', 'KI AB': 'ANTI-KI', 'ANTI-KI': 'ANTI-KI',
  'PM-SCL100': 'ANTI-PM-SCL100', 'PM-SCL 100': 'ANTI-PM-SCL100', PMSCL100: 'ANTI-PM-SCL100',
  'PM-SCL75': 'ANTI-PM-SCL75', 'PM-SCL 75': 'ANTI-PM-SCL75', PMSCL75: 'ANTI-PM-SCL75',
  AMA: 'AMA', 'ANTI-MITOCHONDRIAL ANTIBODY': 'AMA', 'AMA, ANTI-MITOCHONDRIAL ANTIBODY': 'AMA', '粒腺體抗體': 'AMA', '粒線體抗體': 'AMA',
}

/** NFKC, upper case, single spaces — the form IMMUNOLOGY_TEXT_TO_KEY uses. */
export function normalizeImmunologyName(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase()
}

/** Prefixes and suffixes hospitals add that do not change the analyte: a
 *  serum specimen word, trailing dots. (STAT) and other parentheticals are
 *  handled by the before-parenthesis variant. */
const NEUTRAL_PREFIX_RE = /^(?:SERUM|血清)\s*[-:：]?\s*/
const TRAILING_DOTS_RE = /[.。…]+$/
/** Antibody qualifiers: "Ab", "antibody", 「抗體」 after, "anti-" / 「抗」 before.
 *  A name stripped of one is QUALIFIED — "Ku Ab" or "anti-Ku" is never the
 *  bare, context-dependent "Ku". */
const ANTIBODY_SUFFIX_RE = /\s*(?:-\s*)?(?:\bAB\b|\bANTIBOD(?:Y|IES)\b|抗體)$/
const ANTI_PREFIX_RE = /^(?:ANTI\s*-?\s*|抗\s*)(?=\S)/

/** One spelling to look up, and whether an antibody qualifier was removed. */
interface NameVariant { text: string; qualified: boolean }

/** Protein analytes. An antibody affix on one of these names a DIFFERENT
 *  test — anti-IgG, "C3 Ab", 「抗IgG抗體」 — so it never restates them; it
 *  only restates an antibody analyte ("Jo-1 Ab", "anti-dsDNA"). */
const PROTEIN_KEYS = new Set(['IGG', 'IGA', 'IGM', 'IGE', 'IGG1', 'IGG2', 'IGG3', 'IGG4', 'C3', 'C4'])
/** Antibody classes: after another test's name they qualify it ("Dengue
 *  (IgM)"), so a parenthetical class is never taken from such a name. */
const IMMUNOGLOBULIN_CLASS_KEYS = new Set(['IGG', 'IGA', 'IGM', 'IGE', 'IGG1', 'IGG2', 'IGG3', 'IGG4'])

const stripNeutral = (text: string) =>
  text.replace(TRAILING_DOTS_RE, '').trim().replace(NEUTRAL_PREFIX_RE, '').trim()

/** Spellings of ONE name segment (no parenthetical handling) worth trying. */
function segmentVariants(segment: string): NameVariant[] {
  const variants: NameVariant[] = []
  const add = (text: string, qualified: boolean) => {
    const clean = text.replace(TRAILING_DOTS_RE, '').trim()
    if (clean && !variants.some((v) => v.text === clean && v.qualified === qualified)) {
      variants.push({ text: clean, qualified })
    }
  }
  const neutral = stripNeutral(segment)
  add(segment, false)
  add(neutral, false)
  // Antibody qualifiers, in either order and together.
  const noSuffix = neutral.replace(ANTIBODY_SUFFIX_RE, '').trim()
  const noPrefix = neutral.replace(ANTI_PREFIX_RE, '').trim()
  const neither = noSuffix.replace(ANTI_PREFIX_RE, '').trim()
  if (noSuffix !== neutral) add(noSuffix, true)
  if (noPrefix !== neutral) add(noPrefix, true)
  if (neither !== neutral) add(neither, true)
  return variants
}

/** Spacing / hyphen-insensitive form: "SS A", "SSA" and "SS-A" all read SSA. */
const compact = (text: string) => text.replace(/[\s\-‐-―]+/g, '')

/** Compact spelling → key. A compact form is ambiguous only when every alias
 *  that folds to it is a bare ambiguous short name. */
const IMMUNOLOGY_COMPACT_TO_KEY: ReadonlyMap<string, { key: string; ambiguous: boolean }> = (() => {
  const map = new Map<string, { key: string; ambiguous: boolean }>()
  for (const [alias, key] of Object.entries(IMMUNOLOGY_TEXT_TO_KEY)) {
    const form = compact(alias)
    const ambiguous = AMBIGUOUS_SHORT_IMMUNOLOGY_NAMES.has(alias)
    const prior = map.get(form)
    if (prior && prior.key !== key) throw new Error(`immunology alias collision: ${alias}`)
    map.set(form, { key, ambiguous: prior ? prior.ambiguous && ambiguous : ambiguous })
  }
  return map
})()

// IgG subclass n in any of the spellings hospitals print: IgG1, IgG 1,
// IgG-1, IgG subclass 1, IgG1 subclass, IgG1亞型, IgG 1 次分類, 免疫球蛋白G1,
// 免疫球蛋白 G4 量. Anchored so 「IgG/Alb」, 「IgG index」 or 「IgG4-RD」 do not match.
const IGG_SUBCLASS_RE =
  /^(?:IGG|免疫球蛋白\s*G)\s*(?:SUBCLASS\s*|-\s*)?([1-4])(?:\s*(?:SUBCLASS|亞型|亞類|次分類|量))?$/

type ImmunologyMatch = { key: string; ambiguous: boolean }

/** Match one name segment: exact spellings first (so a bare "SSA" stays the
 *  ambiguous short name), then spacing / hyphen-insensitive ones. A spelling
 *  reached by removing an antibody affix counts only for antibody analytes. */
function matchSegment(segment: string): ImmunologyMatch | null {
  const variants = segmentVariants(segment)
  const allowed = (key: string, qualified: boolean) => !(qualified && PROTEIN_KEYS.has(key))
  for (const { text, qualified } of variants) {
    const key = IMMUNOLOGY_TEXT_TO_KEY[text]
    if (key && allowed(key, qualified)) {
      return { key, ambiguous: !qualified && AMBIGUOUS_SHORT_IMMUNOLOGY_NAMES.has(text) }
    }
    const subclass = text.match(IGG_SUBCLASS_RE)
    if (subclass && allowed(`IGG${subclass[1]}`, qualified)) return { key: `IGG${subclass[1]}`, ambiguous: false }
  }
  for (const { text, qualified } of variants) {
    const match = IMMUNOLOGY_COMPACT_TO_KEY.get(compact(text))
    if (match && allowed(match.key, qualified)) return { key: match.key, ambiguous: !qualified && match.ambiguous }
  }
  return null
}

/** A name's parts: the whole name, the part before any parenthetical, and
 *  the parenthetical — either a bilingual 「中文 ;(English)」 half or a
 *  trailing "(…)" — with the text that precedes it. NFKC folds the
 *  full-width 「；」「（」「）」. */
function nameParts(name: string): { full: string; leading: string; parenthetical: string | null } {
  const full = normalizeImmunologyName(name)
  const bilingual = full.match(/^(.*?)\s*;\s*\((.*)\)\s*$/)
  if (bilingual) return { full, leading: bilingual[1].trim(), parenthetical: bilingual[2].trim() || null }
  const inner = full.match(/^(.*?)\s*[(\[]([^()\[\]]+)[)\]]\s*$/)
  const leading = full.replace(/\s*[(\[].*$/, '').trim()
  return { full, leading, parenthetical: inner ? inner[2].trim() : null }
}

const isHanOnly = (text: string) => /^[\p{Script=Han}\d\s]+$/u.test(text)

/** Canonical immunology key for one source name, with whether the spelling
 *  that matched is a bare ambiguous short name (see
 *  AMBIGUOUS_SHORT_IMMUNOLOGY_NAMES). Null when nothing matches.
 *
 *  A parenthetical names the analyte only when what precedes it is mere
 *  decoration ("(IgM)", "Serum ;(IgA)") or a Chinese translation of a
 *  non-immunoglobulin analyte (「某抗體 ;(SS-A)」). After another test's name an
 *  antibody class qualifies that test — "Dengue (IgM)", "Anti-cardiolipin
 *  ;(IgG)", 「登革熱；(IgM)」 are not total IgM / IgG. A name that restates its
 *  parenthetical (「免疫球蛋白E ;(IgE)」) matches by its leading part. */
export function immunologyNameMatch(name: string | undefined | null): ImmunologyMatch | null {
  if (!name) return null
  const { full, leading, parenthetical } = nameParts(name)
  if (!full) return null
  const whole = matchSegment(full)
  if (whole) return whole
  if (leading && leading !== full) {
    const lead = matchSegment(leading)
    if (lead) return lead
  }
  if (!parenthetical) return null
  const inner = matchSegment(parenthetical)
  if (!inner) return null
  const before = stripNeutral(leading)
  if (!before) return inner
  if (isHanOnly(before) && !IMMUNOGLOBULIN_CLASS_KEYS.has(inner.key)) return inner
  return null
}

/** Canonical immunology key for one source name, or null. */
export function immunologyKeyFromName(name: string | undefined | null): string | null {
  return immunologyNameMatch(name)?.key ?? null
}

const ALLERGEN_NAME_SET = new Set(ALLERGEN_NAMES.map(normalizeImmunologyName))

/** True for a 30022C allergen item name (混合黴菌, 貓毛 …). */
export function isAllergenName(name: string | undefined | null): boolean {
  if (!name) return false
  const { full, leading, parenthetical } = nameParts(name)
  return [full, leading, parenthetical]
    .filter((part): part is string => !!part)
    .some((part) => ALLERGEN_NAME_SET.has(part) || ALLERGEN_NAME_SET.has(stripNeutral(part)))
}

/** LOINC Scale of every immunology LOINC the app maps (IMMUNOLOGY_LOINC_TO_KEY
 *  and PACKAGE_IMMUNOLOGY_LOINCS), read from the names quoted above:
 *  [Units/volume] / [Mass/volume] are Qn, [Presence] Ord, [Titer] Titr. Two
 *  LOINCs mapped to one column are interchangeable only on the same scale. */
export const IMMUNOLOGY_LOINC_SCALE: Readonly<Record<string, 'Qn' | 'Ord' | 'Titr'>> = (() => {
  const ord = [
    '8061-4', '5352-0', '5353-8', '53016-2', '82933-3', '5356-1', '5355-3', '8076-2', '18484-6', '82997-8',
    '82996-0', '33910-1', '31348-6', '42254-3', '14236-4', '8093-7', '8094-5', '31627-3', '8091-1', '54160-7',
    '33772-5', '33771-7', '45149-2', '45152-6', '33921-8', '107563-9', '107562-1',
  ]
  const titr = ['20483-4', '29953-7', '5048-4']
  const scale: Record<string, 'Qn' | 'Ord' | 'Titr'> = {}
  for (const loinc of [...Object.keys(IMMUNOLOGY_LOINC_TO_KEY), ...PACKAGE_IMMUNOLOGY_LOINCS]) scale[loinc] = 'Qn'
  for (const loinc of ord) scale[loinc] = 'Ord'
  for (const loinc of titr) scale[loinc] = 'Titr'
  return scale
})()
