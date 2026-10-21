const DEMO_ORGANIZATION_ENGLISH: Record<string, string> = {
  '示範長青醫院': 'A Hospital',
  '示範嘉恩醫院': 'B Hospital',
  '示範北辰醫院': 'C Hospital',
  '示範康健醫院': 'D Hospital',
  '示範榮恩醫學中心': 'A Medical Center',
  '示範向陽藥局': 'A Pharmacy',
  '示範康健藥局': 'B Pharmacy',
  '示範長青藥局': 'C Pharmacy',
  '示範康德診所': 'A Clinic',
  '示範長青診所': 'B Clinic',
  '示範安心耳鼻喉科診所': 'C Clinic',
  '示範祥安診所': 'D Clinic',
  '示範康健診所': 'E Clinic',
}

const DEMO_TEXT_ENGLISH: Record<string, string> = {
  '末期腎臟病前期（Pre-ESRD）之病人照護與衛教計畫':
    'Pre-ESRD patient care and education program',
  '對慢性腎臟病之高危險群進行個案管理，以期早期發現，積極治療與介入，以有效延緩進入透析治療之時機與併發症之發生。':
    'Case management for people at high risk of chronic kidney disease, supporting early detection and timely care to delay dialysis and reduce complications.',
  '初期慢性腎病追蹤': 'Early-stage chronic kidney disease follow-up',
  '為提升初期慢性腎臟病照護品質，鼓勵醫療院所提供個案管理服務，透過定期回診、定期監測檢驗(查)結果及客製化衛教，提供病人全方位照護。':
    'Ongoing case management with regular follow-up, laboratory monitoring, and individualized education for early-stage chronic kidney disease.',
  'NHI-FHIR Bridge（系統產生）': 'NHI-FHIR Bridge (system-generated)',
  '流感疫苗': 'Influenza vaccine',
  '23價多醣體肺炎鏈球菌疫苗': '23-valent pneumococcal polysaccharide vaccine',
  '疾病管制署': 'Taiwan CDC',
  '陳大明': 'Demo Patient',
}

/**
 * English aliases for the frozen, de-identified demo dataset.
 *
 * Real imported organization names must remain verbatim. Restricting the map
 * to the committed demo labels keeps source fidelity while making the English
 * demo presentation fully readable and consistently de-identified.
 */
export function localizeDemoOrganizationDisplay(text: string, locale: string): string {
  if (locale !== 'en') return text
  return DEMO_ORGANIZATION_ENGLISH[text.trim()] ?? text
}

/** Translate the small set of source-authored demo labels shown before a user
 * opens an original-language clinical document. Organization aliases are also
 * replaced when they occur inside a longer demo label. */
export function localizeDemoDisplayText(text: string, locale: string): string {
  if (locale !== 'en') return text

  const exact = DEMO_TEXT_ENGLISH[text.trim()]
  if (exact) return exact

  let localized = text
  for (const [source, target] of Object.entries(DEMO_ORGANIZATION_ENGLISH)) {
    localized = localized.replaceAll(source, target)
  }
  return localized
}
