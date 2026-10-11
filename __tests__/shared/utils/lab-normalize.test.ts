// Regression tests for canonical-key resolution. The cumulative report
// (累積報告) groups Observations into columns by canonical key, so any
// failure to collapse a same-analyte variant into the same key produces
// a visible duplicate column next to its pinnedColumn stub.
//
// Bug history (v0.11.10 audit, 2026-05-29):
//   Bridge passes through whatever display name the source EHR sent —
//   some hospitals emit pure Chinese names ("嗜中性白血球") while others
//   emit English short codes ("Segment"). Both carried LOINC 770-8 but
//   neither LOINC nor display-text resolved to "NEU", so the report
//   showed: NEU(empty pinned column) │ 嗜中性白血球 │ Segment.
//
// We intentionally use display-text aliases (not LOINC mappings) so that
// bridge mis-tags — e.g. a band-form row tagged with LOINC 770-8 — stay
// in their own column and remain visible as bridge bugs.
import { canonicalKeyFromLoinc, canonicalTestKeyFromString, getAnalyteLabel } from '@voho0000/clinical-lab-normalization/canonical'
import { categorizeObservation } from '@/src/shared/utils/lab-categories'
import { getLabPivotTestIdentity } from '@/src/shared/utils/lab-pivot.utils'

const bandObservation = {
  resourceType: 'Observation',
  status: 'final',
  code: {
    text: 'Band form 嗜中性帶狀球',
    coding: [
      { system: 'http://loinc.org', code: '764-1', display: 'Band form neutrophils/Leukocytes in Blood by Manual count' },
      { system: 'urn:oid:nhi.lab.code', code: '08013C', display: '白血球分類計數' },
      { system: 'https://example.org/CodeSystem/his-local-lab', code: 'BAND-FORM', display: 'Band form 嗜中性帶狀球' },
    ],
  },
  specimen: { display: 'Blood' },
  effectiveDateTime: '2026-01-01',
  valueQuantity: { value: 2, unit: '%', system: 'http://unitsofmeasure.org', code: '%' },
}

describe('Band form cumulative-report identity', () => {
  it('uses LOINC 764-1 to place the source row in canonical CBC BAND', () => {
    expect(categorizeObservation(bandObservation)?.id).toBe('cbc')
    expect(getLabPivotTestIdentity(bandObservation, 'cbc', 'standardized')).toEqual({
      testKey: 'BAND',
      mapKey: 'BAND',
      displayName: 'BAND',
    })
  })

  it('keeps the hospital label auditable in original-name mode', () => {
    expect(getLabPivotTestIdentity(bandObservation, 'cbc', 'original')).toEqual({
      testKey: 'BAND',
      mapKey: 'source:band form 嗜中性帶狀球|BAND',
      displayName: 'Band form 嗜中性帶狀球',
    })
  })
})

describe('canonicalTestKeyFromString — Chinese display-name aliases', () => {
  describe('CBC differential cells', () => {
    it.each([
      ['嗜中性白血球', 'NEU'],
      ['帶狀嗜中性白血球', 'BAND'],
      ['淋巴球', 'LYM'],
      ['單核球', 'MONO'],
      ['嗜伊紅性白血球', 'EOS'],
      ['嗜酸性白血球', 'EOS'],
      ['嗜鹼性白血球', 'BASO'],
      ['後骨髓球', 'META-MYELOCYTE'],
      ['Meta-Myelocyte', 'META-MYELOCYTE'],
      ['Blast', 'BLAST'],
      ['Promyl.', 'PROMYELOCYTE'],
      ['Myelo.', 'MYELOCYTE'],
      ['Meta', 'META-MYELOCYTE'],
      ['Meta.', 'META-MYELOCYTE'],
      ['Normobl.', 'NORMOBLAST'],
      ['PlasmaCell', 'PLASMA-CELL'],
      ['PS', 'PS'],
      ['PS Auto DC', 'PS'],
    ])('%s → %s', (input, expected) => {
      expect(canonicalTestKeyFromString(input)).toBe(expected)
    })
  })

  describe('CBC counts and RBC indices', () => {
    it.each([
      ['白血球計數', 'WBC'],
      ['紅血球計數', 'RBC'],
      ['血色素檢查', 'HB'],
      ['血球比容值測定', 'HCT'],
      ['血小板計數', 'PLT'],
      ['紅血球平均容積', 'MCV'],
      ['紅血球色素', 'MCH'],
      ['紅血球色素濃度', 'MCHC'],
      ['紅血球分佈變異數', 'RDW'],
    ])('%s → %s', (input, expected) => {
      expect(canonicalTestKeyFromString(input)).toBe(expected)
    })
  })

  describe('Chemistry — alternative Chinese spellings', () => {
    it.each([
      ['全膽紅素', 'T.BILI'],
      ['膽紅素總量', 'T.BILI'],
      ['肌酐', 'CREA'],
      ['肌酸酐', 'CREA'],
      ['肌酸酐、血', 'CREA'],
      ['乳酸', 'LACTATE'],
    ])('%s → %s', (input, expected) => {
      expect(canonicalTestKeyFromString(input)).toBe(expected)
    })
  })

  describe('Urine albumin/creatinine ratio aliases', () => {
    it.each([
      ['微白蛋白/肌酐酸比值', 'ACR'],
      ['微白蛋白/肌酸酐比值', 'ACR'],
      ['白蛋白/肌酐酸比值', 'ACR'],
      ['白蛋白/肌酸酐比值', 'ACR'],
    ])('%s → %s', (input, expected) => {
      expect(canonicalTestKeyFromString(input)).toBe(expected)
    })

    it('LOINC 14959-1 resolves to ACR independent of display text', () => {
      expect(canonicalKeyFromLoinc({
        code: {
          text: 'Unexpected source label',
          coding: [{ system: 'http://loinc.org', code: '14959-1' }],
        },
      })).toBe('ACR')
      expect(getAnalyteLabel({
        code: {
          text: 'Unexpected source label',
          coding: [{ system: 'http://loinc.org', code: '14959-1' }],
        },
      })).toBe('ACR')
    })
  })

  describe('English short codes (existing — sanity check)', () => {
    it.each([
      ['Segment', 'NEU'],
      ['Neutrophil', 'NEU'],
      ['Lymphocyte', 'LYM'],
      ['Hb', 'HB'],
      ['HCT', 'HCT'],
      ['MCH', 'MCH'],
      ['MCV', 'MCV'],
    ])('%s → %s', (input, expected) => {
      expect(canonicalTestKeyFromString(input)).toBe(expected)
    })
  })

  describe('comparison normalization', () => {
    it.each([
      ['ＭＣＶ', 'MCV'],
      ['m.c.v.', 'MCV'],
      ['mcv(平均紅血球容積)', 'MCV'],
    ])('%s → %s', (input, expected) => {
      expect(canonicalTestKeyFromString(input)).toBe(expected)
    })
  })

  // ── Safety: don't mask bridge LOINC mis-tagging ─────────────────────────
  // Bridge v0.11.9/v0.11.10 sometimes attaches LOINC 770-8 (Neutrophils
  // automated) to a band-form row (display "帶狀嗜中性白血球"). We resolve
  // the column by DISPLAY TEXT, not LOINC, so the mislabeled band row
  // stays in BAND and never silently joins NEU. This keeps bridge Bug 6
  // (v0.11.9 report) visible in the cumulative report.
  describe('does NOT mask bridge LOINC mis-tags', () => {
    it('帶狀嗜中性白血球 resolves to BAND (independent of LOINC)', () => {
      expect(canonicalTestKeyFromString('帶狀嗜中性白血球')).toBe('BAND')
      // Other neutrophil texts still go to NEU
      expect(canonicalTestKeyFromString('嗜中性白血球')).toBe('NEU')
      expect(canonicalTestKeyFromString('Segment')).toBe('NEU')
    })
  })

  // ── APTT seconds vs APTT ratio (v0.11.10 audit) ─────────────────────────
  // Bridge sends two distinct obs with NHI 醫令碼 08036C: APTT in seconds
  // (LOINC 14979-9, value 31.4 sec) and APTT ratio (LOINC 63561-5,
  // "aPTT --actual/normal", value 1.08 {ratio}). Before this fix both
  // collapsed to the same APTT row in the pivot — last-write-wins clobbered
  // the seconds value with the ratio, so the APTT column showed 1.08
  // {ratio} even though clinical convention is seconds. The split alias
  // keeps APTT (sec) and APTT-RATIO in separate columns.
  describe('APTT seconds / APTT ratio split', () => {
    it('plain "APTT" resolves to APTT (seconds, LOINC 14979-9 case)', () => {
      expect(canonicalTestKeyFromString('APTT')).toBe('APTT')
    })
    it('"APTT (ratio)" resolves to APTT-RATIO (LOINC 63561-5 case)', () => {
      expect(canonicalTestKeyFromString('APTT (ratio)')).toBe('APTT-RATIO')
      expect(canonicalTestKeyFromString('APTT (RATIO)')).toBe('APTT-RATIO')
    })
  })
})

describe('CANONICAL_KEYS — column-header eligibility', () => {
  // Each test key here is something the pivot WILL render as a column
  // header verbatim. Adding to TEST_ALIASES values automatically grows
  // this set, but the regression test pins the contract so a future
  // refactor that drops the spread is caught.
  const { CANONICAL_KEYS } = jest.requireActual<
    typeof import('@voho0000/clinical-lab-normalization/canonical')
  >('@voho0000/clinical-lab-normalization/canonical')

  it.each(['NEU', 'LYM', 'MONO', 'EOS', 'BASO', 'BAND', 'WBC', 'RBC',
           'HB', 'HCT', 'PLT', 'MCV', 'MCH', 'MCHC', 'RDW',
           'BLAST', 'PROMYELOCYTE', 'MYELOCYTE', 'META-MYELOCYTE', 'NORMOBLAST', 'PLASMA-CELL', 'PS',
           'PT', 'APTT', 'APTT-RATIO', 'INR', 'D-DIMER',
           'GLUCOSE-AC', 'GLUCOSE-FS', 'GLUCOSE'])('%s is canonical', (key) => {
    expect(CANONICAL_KEYS.has(key)).toBe(true)
  })
})

describe('CANONICAL_DISPLAY — pretty column headers', () => {
  const { CANONICAL_DISPLAY } = jest.requireActual<
    typeof import('@voho0000/clinical-lab-normalization/canonical')
  >('@voho0000/clinical-lab-normalization/canonical')

  it('uses conventional mixed-case clinical display labels', () => {
    expect(CANONICAL_DISPLAY['APTT-RATIO']).toBe('aPTT ratio')
    expect(CANONICAL_DISPLAY['NA']).toBe('Na')
    expect(CANONICAL_DISPLAY['CA']).toBe('Ca')
    expect(CANONICAL_DISPLAY['HBSAG']).toBe('HBsAg')
  })

  it('CBC immature/smear rows keep compact source-like headers', () => {
    expect(CANONICAL_DISPLAY['PROMYELOCYTE']).toBe('Promyl.')
    expect(CANONICAL_DISPLAY['MYELOCYTE']).toBe('Myelo.')
    expect(CANONICAL_DISPLAY['NORMOBLAST']).toBe('Normobl.')
    expect(CANONICAL_DISPLAY['PLASMA-CELL']).toBe('PlasmaCell')
  })
})

// ── getAnalyteLabel — display-label resolution for per-visit accordion ──
// User complaint (2026-05-29): "為什麼累積報告生化會出現乳酸不是應該要是
// lactate嗎"; follow-up: "Na 你現在都顯示鈉". Cumulative-report column
// headers were already canonicalised via buildTestEntry, but the per-visit
// ObservationBlock accordion and single-obs DR titles still rendered
// obs.code.text directly — so bridge-emitted Chinese names (鈉 / 鉀 / 乳酸)
// leaked through to the UI. getAnalyteLabel centralises the resolution
// so every code path agrees with the cumulative-report header.
describe('getAnalyteLabel', () => {
  function obs(text: string, loinc?: string) {
    return {
      code: {
        text,
        coding: loinc ? [{ system: 'http://loinc.org', code: loinc }] : [],
      },
    }
  }

  describe('LOINC-canonical analytes show English short code', () => {
    it.each([
      // Bridge sends Chinese text + correct LOINC — most common case
      ['鈉', '2951-2', 'Na'],
      ['鉀', '2823-3', 'K'],
      ['鈣', '17861-6', 'Ca'],
      ['磷', '2777-1', 'IP'],
      ['白蛋白', '1751-7', 'ALB'],
      ['血中尿素氮', '3094-0', 'BUN'],
      ['肌酐(血液)', '2160-0', 'CREA'],
      ['尿酸', '3084-1', 'UA'],
    ])('text=%s LOINC=%s → %s', (text, loinc, expected) => {
      expect(getAnalyteLabel(obs(text, loinc))).toBe(expected)
    })
  })

  // ── v0.3.9 coverage expansion ──────────────────────────────
  // User asked to stop playing whack-a-mole on per-name Chinese
  // aliases — bridge already attaches LOINC, so add LOINC mappings
  // and the display label resolves regardless of Chinese variant.
  describe('expanded LOINC coverage (2026-05-29 audit)', () => {
    it.each([
      // CBC indices
      ['MCHC', '786-4', 'MCHC'],
      ['紅血球色素濃度', '786-4', 'MCHC'],
      ['MCV', '787-2', 'MCV'],
      ['紅血球平均容積', '787-2', 'MCV'],
      ['RDW', '788-0', 'RDW'],
      ['紅血球分佈變異數', '788-0', 'RDW'],
      // Chem additional
      ['CO2', '2028-9', 'CO₂'],
      ['二氧化碳', '2028-9', 'CO₂'],
      ['eGFR', '33914-3', 'EGFR(M)'],
      ['Estimated GFR', '33914-3', 'EGFR(M)'],
      ['Mg', '19123-9', 'Mg'],
      ['鎂', '19123-9', 'Mg'],
      ['Lipase', '3040-3', 'Lipase'],
      ['解脂脢', '3040-3', 'Lipase'],
      // Immunoglobulins — display override gives mixed case
      ['IgG', '2465-3', 'IgG'],
      ['免疫球蛋白G—免疫比濁法', '2465-3', 'IgG'],
      ['IgA', '2458-8', 'IgA'],
      ['免疫球蛋白A', '2458-8', 'IgA'],
      ['IgM', '2472-9', 'IgM'],
      ['免疫球蛋白M—免疫比濁法', '2472-9', 'IgM'],
      // Autoimmunity
      ['ANA', '5048-4', 'ANA'],
      ['抗核抗體(間接免疫螢光法)', '5048-4', 'ANA'],
      ['抗細胞核抗體', '5048-4', 'ANA'],
      // Vitamins
      ['Folate', '2284-8', 'FOLATE'],
      ['葉酸', '2284-8', 'FOLATE'],
      ['Vit B12', '2132-9', 'B12'],
      ['維生素B12', '2132-9', 'B12'],
      // Cardiac
      ['NT-ProBNP', '33762-6', 'NT-proBNP'],
      // CBC additional
      ['Reticulocyte', '14196-0', 'RETIC'],
      ['網狀紅血球計數', '14196-0', 'RETIC'],
    ])('text=%s LOINC=%s → %s', (text, loinc, expected) => {
      expect(getAnalyteLabel(obs(text, loinc))).toBe(expected)
    })
  })

  describe('CANONICAL_DISPLAY prettifies mixed-case clinical names', () => {
    it('keeps acronyms uppercase and uses conventional element-symbol casing', () => {
      expect(getAnalyteLabel(obs('鈉', '2951-2'))).toBe('Na')
      expect(getAnalyteLabel(obs('血中尿素氮', '3094-0'))).toBe('BUN')
    })
    it('uses mixed case for IgG / IgA / IgM / NT-proBNP / HbA1c', () => {
      expect(getAnalyteLabel(obs('IgG', '2465-3'))).toBe('IgG')
      expect(getAnalyteLabel(obs('IgA', '2458-8'))).toBe('IgA')
      expect(getAnalyteLabel(obs('IgM', '2472-9'))).toBe('IgM')
      expect(getAnalyteLabel(obs('NT-ProBNP', '33762-6'))).toBe('NT-proBNP')
      expect(getAnalyteLabel(obs('HbA1c', '4548-4'))).toBe('HbA1c')
    })
  })

  describe('text-alias analytes (no LOINC mapping yet) show canonical key', () => {
    it.each([
      // Chinese-name alias (Lactate LOINC 14118-4 not in LOINC_TO_CANONICAL —
      // text alias '乳酸' → LACTATE fills the gap)
      ['乳酸', '14118-4', 'Lactate'],
      // CBC differentials via Chinese text aliases (no LOINC needed in map)
      ['嗜中性白血球', undefined, 'NEU'],
      ['淋巴球', undefined, 'LYM'],
      ['Segment', undefined, 'NEU'],
    ])('text=%s LOINC=%s → %s', (text, loinc, expected) => {
      expect(getAnalyteLabel(obs(text, loinc))).toBe(expected)
    })
  })

  describe('non-canonical rows fall back to raw text (no over-translation)', () => {
    it.each([
      // Microbiology / antibiotic susceptibility — keep bridge label verbatim
      ['抗酸菌培養', '13026C', '抗酸菌培養'],
      ['ORDINARY CULTURE-A testcode', undefined, 'ORDINARY CULTURE-A testcode'],
      // Unknown analyte with no LOINC and no alias — keep raw
      ['免疫電泳分析', undefined, '免疫電泳分析'],
    ])('text=%s → %s (unchanged)', (text, loinc, expected) => {
      expect(getAnalyteLabel(obs(text, loinc))).toBe(expected)
    })
  })

  it('returns "—" for undefined / missing code', () => {
    expect(getAnalyteLabel(undefined)).toBe('—')
    expect(getAnalyteLabel({})).toBe('—')
  })

  it('safety: bridge mis-tag (band row with NEU LOINC) keeps BAND label', () => {
    // v0.11.9 Bug 6 scenario — bridge sometimes tags a band-form row with
    // the neutrophil LOINC (770-8). Our strategy is to keep these visible
    // by NOT adding 770-8 to LOINC_TO_CANONICAL — so the helper falls
    // through to the display-text alias '帶狀嗜中性白血球' → BAND. Mis-tag
    // stays visible as its own row instead of silently merging into NEU.
    expect(getAnalyteLabel(obs('帶狀嗜中性白血球', '770-8'))).toBe('BAND')
    // Without the mis-tag (no LOINC at all), same outcome via text alias.
    expect(getAnalyteLabel(obs('帶狀嗜中性白血球'))).toBe('BAND')
  })
})
