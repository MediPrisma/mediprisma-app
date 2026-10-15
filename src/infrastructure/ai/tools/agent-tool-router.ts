// Deterministic first-pass routing for tool-capable local models. Sending all
// production schemas on every turn costs thousands of input tokens and makes
// smaller models more likely to call unrelated tools. The explicit chat data
// scope is the authorization boundary; wording heuristics only reduce the
// already-authorized schemas and never grant a new data source.

import type { ChatDataScope } from '@/src/core/entities/chat-message.entity'

const TOOL_GROUPS = {
  patient: ['queryPatientInfo'],
  overview: ['getDataOverview'],
  encounters: ['queryEncounters', 'getRecentVisits', 'getEncounterDetails', 'listEncounterDepartments', 'searchEncountersByDiagnosis'],
  conditions: ['queryConditions', 'searchEncountersByDiagnosis'],
  labs: [
    'queryDiagnosticReports',
    'queryLabResultsByCategory',
    'queryObservations',
    'searchObservationByName',
    'listAvailableObservationCodes',
  ],
  imaging: ['queryImagingRecords'],
  procedures: ['queryProcedures'],
  medications: ['queryMedications', 'getActiveMedicationList'],
  allergies: ['queryAllergies'],
  immunizations: ['queryImmunizations'],
  literature: ['searchMedicalLiterature'],
} as const

type ToolGroup = keyof typeof TOOL_GROUPS

const NO_RECORD_QUERY = [
  /不要查(?:詢)?(?:病歷|病人資料|個案資料)/i,
  /不用查(?:詢)?(?:病歷|病人資料|個案資料)/i,
  /do not (?:query|search|look up).*(?:record|chart|patient data)/i,
]

const BROAD_HEALTH_SUMMARY_QUERY = [
  /(?:健康摘要|白話版.*健康|身體狀況.*(?:慢性疾病|用藥).*(?:檢驗|正常範圍))/i,
  /(?:overall|plain-language).*(?:health|patient).*(?:summary|record)/i,
]

const MEDICAL_EVIDENCE_QUERY = [
  /(?:指引|指南|共識|文獻|研究|證據|治療原則|臨床建議|guideline|consensus|literature|evidence|study|recommendation)/i,
]

const GENERAL_MEDICAL_KNOWLEDGE_QUERY = [
  ...MEDICAL_EVIDENCE_QUERY,
  /(?:是什麼|什麼是|如何治療|怎麼治療|有哪些(?:藥|藥物|治療)|副作用|交互作用|禁忌|適應症|衛教|what is|how (?:is|to)|side effects?|interaction|contraindication|treatment options?)/i,
]

const CURRENT_MEDICAL_EVIDENCE_QUERY = [
  /(?:最新|更新|新版本|現在|目前|近期|recent|latest|updated?|current|new version)/i,
]

const EXPLICIT_PATIENT_REFERENCE = [
  /(?:我的|我在|我有|我目前|我最近|我適合|我能否|我可以|我應該|對我|這位(?:病人|患者|個案)|病人|患者|個案|病歷|健康資料|健康存摺|匯入(?:的)?資料|根據.{0,20}(?:紀錄|資料))/i,
  /(?:\bmy\b|this patient|patient record|medical record|health record|imported data)/i,
]

const IMPLICIT_PATIENT_RECORD_QUERY = [
  /(?:請查|查詢|幫我查|替我查|紀錄中|資料中|是否有|有沒有|最近(?:一次|兩次|幾次|的)?|目前(?:的)?|住院期間|就醫期間|這次(?:就醫|住院)|分析目前狀況)/i,
  /(?:look up|check (?:my|the)|show me|do i have|latest|most recent|current (?:medication|diagnos|lab|result))/i,
]

function matchesAny(question: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(question))
}

export function isGeneralMedicalKnowledgeQuestion(question: string): boolean {
  return matchesAny(question, GENERAL_MEDICAL_KNOWLEDGE_QUERY)
}

export function isMedicalEvidenceQuestion(question: string): boolean {
  return matchesAny(question, MEDICAL_EVIDENCE_QUERY)
}

export function asksForCurrentMedicalEvidence(question: string): boolean {
  return isMedicalEvidenceQuestion(question) &&
    matchesAny(question, CURRENT_MEDICAL_EVIDENCE_QUERY)
}

export function explicitlyReferencesPatient(question: string): boolean {
  return matchesAny(question, EXPLICIT_PATIENT_REFERENCE)
}

export function implicitlyRequestsPatientRecord(question: string): boolean {
  return matchesAny(question, IMPLICIT_PATIENT_RECORD_QUERY)
}

export function agentToolNamesForDataScope(
  availableToolNames: readonly string[],
  dataScope: ChatDataScope,
): string[] {
  if (dataScope === 'auto') return [...availableToolNames]
  if (dataScope === 'general') {
    return availableToolNames.filter((name) => name === 'searchMedicalLiterature')
  }
  if (dataScope === 'patient') {
    return availableToolNames.filter((name) => name !== 'searchMedicalLiterature')
  }
  return [...availableToolNames]
}

const GROUP_TRIGGERS: Record<ToolGroup, RegExp[]> = {
  patient: [/(年齡|歲|性別|gender|age|demographic)/i],
  overview: [/(資料概況|資料總覽|有哪些類型|data overview|what data|available data)/i],
  encounters: [/(就醫|門診|急診|住院|出院|看診|科別|visit|encounter|admission|hospitali[sz])/i],
  conditions: [/(診斷|疾病|病況|問題清單|condition|diagnos)/i],
  labs: [/(檢驗|檢查值|數值|趨勢|血糖|血球|腎功能|肝功能|肌酸酐|觀察值|lab|test result|trend|HbA1c|WBC|creatinine|eGFR|marker)/i],
  imaging: [/(影像|放射|超音波|電腦斷層|核磁|X\s*光|攝影|imaging|radiology|ultrasound|CT|MRI|X\s*[-–—]?\s*ray)/i],
  procedures: [/(手術|處置|治療程序|procedure|surgery|operation)/i],
  medications: [/(藥|用藥|處方|服用|停藥|用過|使用過|成分|學名|商品名|健保碼|哪一類藥|哪種藥|ATC|medication|medicine|prescription|drug|ingredient|generic name|brand name|drug class|taken|used)/i],
  allergies: [/(過敏|allerg)/i],
  immunizations: [/(疫苗|接種|immunization|vaccin)/i],
  literature: [/(文獻|研究|指引|證據|paper|literature|guideline|evidence)/i],
}

const MEDICATION_HISTORY_QUERY = /(?:過去|近(?:一|三|六|十?二|\d+)(?:個)?月|最近(?:一|三|六|十?二|\d+)(?:個)?月|曾經|用過|使用過|用藥歷史|用藥紀錄|處方紀錄|歷來|past|previous|history|ever (?:used|taken)|last\s+\d+\s+(?:days?|weeks?|months?|years?))/i
const CURRENT_MEDICATION_QUERY = /(?:目前用藥|現用藥|現在(?:的)?用藥|現在(?:在)?(?:吃|服用)|正在(?:吃|服用)|current(?:ly)? (?:taking|using)|current medications?|on now)/i
const MEDICATION_IDENTITY_QUERY = /(?:成分|學名|商品名|藥物種類|哪一類藥|哪種藥|ATC|是什麼藥|是不是.{0,20}藥|是否為.{0,20}藥|屬於.{0,20}藥|是.{0,20}(?:藥|劑)|ingredient|generic name|brand name|drug class|what (?:kind of )?(?:drug|medicine))/i

function cleanMedicationQuery(value: string | undefined): string | undefined {
  const cleaned = value
    ?.normalize('NFKC')
    .replace(/^(?:請問|請查(?:詢)?|幫我查(?:一下)?|幫我看(?:一下)?|查(?:一下)?|想知道|有沒有|是否有)\s*/i, '')
    .replace(/^(?:(?:這位|這個|該)?(?:病人|患者|個案)|我的)(?:的|用的|服用的)?\s*/i, '')
    .replace(/[，。！？?：:；;]+$/g, '')
    .trim()
  if (!cleaned || cleaned.length < 2 || cleaned.length > 120) return undefined
  if (/^(?:這個(?:藥|藥物)?|那個(?:藥|藥物)?|此藥|該藥|藥物|用藥|medicine|medication|drug)$/i.test(cleaned)) return undefined
  return cleaned
}

export function extractMedicationRecordQuery(question: string): string | undefined {
  // This extractor is for a single drug lookup, not a pasted clinical protocol.
  // A template's first quotation can be a guideline title rather than a drug.
  if (question.length > 300 || /[\r\n]/.test(question)) return undefined
  const quoted = question.match(/[「『\"“]([^」』\"”]{2,120})[」』\"”]/)?.[1]
  if (quoted) return cleanMedicationQuery(quoted)
  const nhiCode = question.match(/\b[A-Z]{2}\d{8}\b/i)?.[0]
  if (nhiCode) return nhiCode.toUpperCase()
  if (MEDICATION_IDENTITY_QUERY.test(question)) {
    const englishAfterPredicate = question.match(
      /(?:what (?:is|kind of (?:drug|medicine) is)|ingredient of|drug class of|look up)\s+([a-z][a-z0-9 .+()\/-]{1,100}?)(?:[?.,;]|$)/i,
    )?.[1]
    if (englishAfterPredicate) return cleanMedicationQuery(englishAfterPredicate)
    const latinBeforePredicate = question.match(
      /([A-Za-z][A-Za-z0-9 .+()\/-]{1,100}?)\s*(?:的(?:成分|學名|商品名|藥物種類|分類|ATC)|是什麼藥|是哪一類藥|是哪種藥|是不是|是否為|屬於|是(?=[^？?。]{0,30}(?:藥|劑)))/i,
    )?.[1]
    if (latinBeforePredicate) return cleanMedicationQuery(latinBeforePredicate)
    const beforePredicate = question.match(
      /(?:請問|請查(?:詢)?|幫我查(?:一下)?|幫我看(?:一下)?|查(?:一下)?|想知道)?\s*([A-Za-z][A-Za-z0-9 .+()\/-]{1,100}?|[\u3400-\u9fff][\u3400-\u9fffA-Za-z0-9 .+()＋／/-]{1,100}?)\s*(?:的(?:成分|學名|商品名|藥物種類|分類|ATC)|是什麼藥|是哪一類藥|是哪種藥|是不是|是否為|屬於|是(?=[^？?。]{0,30}(?:藥|劑)))/i,
    )?.[1]
    if (beforePredicate) return cleanMedicationQuery(beforePredicate)
  }
  const latinBeforeRecord = question.match(
    /([A-Za-z][A-Za-z0-9 .+()\/-]{1,100}?)\s*(?:的)?(?:用藥|處方)(?:紀錄|記錄)/i,
  )?.[1]
  if (latinBeforeRecord) return cleanMedicationQuery(latinBeforeRecord)
  const chineseBeforeRecord = question.match(
    /([\u3400-\u9fff][\u3400-\u9fffA-Za-z0-9 .+()＋／/-]{1,100}?)\s*(?:的)?(?:用藥|處方)(?:紀錄|記錄)/i,
  )?.[1]
  if (chineseBeforeRecord) return cleanMedicationQuery(chineseBeforeRecord)
  const afterUse = question.match(
    /(?:有沒有|是否|曾經)?\s*(?:用過|使用過|服用過|吃過|taken|used)\s*([A-Za-z][A-Za-z0-9 .+()\/-]{1,100}?|[\u3400-\u9fff][\u3400-\u9fffA-Za-z0-9 .+()＋／/-]{1,100}?)(?:[？?。，,;]|$)/i,
  )?.[1]
  return cleanMedicationQuery(afterUse)
}

export function selectAgentToolNames(
  question: string,
  availableToolNames: readonly string[],
  dataScope: ChatDataScope,
): string[] {
  const scopeAllowedNames = agentToolNamesForDataScope(availableToolNames, dataScope)
  if (dataScope === 'auto') return scopeAllowedNames
  const generalKnowledge = isGeneralMedicalKnowledgeQuestion(question)
  const literatureOnly = () => scopeAllowedNames.filter((name) => name === 'searchMedicalLiterature')
  if (matchesAny(question, NO_RECORD_QUERY)) {
    return generalKnowledge ? literatureOnly() : []
  }
  // Structured protocols can require several resource types even when a
  // summary/evidence keyword would otherwise select just one compact tool.
  if (dataScope !== 'general' && isStructuredClinicalRequest(question)) return scopeAllowedNames
  if (
    dataScope !== 'general' &&
    scopeAllowedNames.includes('getHealthSummarySnapshot') &&
    BROAD_HEALTH_SUMMARY_QUERY.some((pattern) => pattern.test(question))
  ) {
    return ['getHealthSummarySnapshot']
  }
  const selected = new Set<string>()
  // A genuinely personalized evidence question needs a compact patient
  // snapshot in addition to literature (when literature is available).
  if (
    isMedicalEvidenceQuestion(question) &&
    dataScope !== 'general' &&
    scopeAllowedNames.includes('getHealthSummarySnapshot')
  ) {
    selected.add('getHealthSummarySnapshot')
  }
  ;(Object.keys(GROUP_TRIGGERS) as ToolGroup[]).forEach((group) => {
    if (GROUP_TRIGGERS[group].some((pattern) => pattern.test(question))) {
      TOOL_GROUPS[group].forEach((name) => selected.add(name))
    }
  })
  if (selected.size === 0) return scopeAllowedNames
  return scopeAllowedNames.filter((name) => selected.has(name))
}

export function filterAgentToolsForDataScope<T>(
  tools: Record<string, T> | undefined,
  dataScope: ChatDataScope,
): Record<string, T> | undefined {
  if (!tools) return tools
  const names = agentToolNamesForDataScope(Object.keys(tools), dataScope)
  return Object.fromEntries(
    names.flatMap((name) => name in tools ? [[name, tools[name]]] : []),
  )
}

export function selectAgentToolsForQuestion<T>(
  tools: Record<string, T> | undefined,
  question: string,
  dataScope: ChatDataScope,
): Record<string, T> | undefined {
  if (!tools) return tools
  const names = selectAgentToolNames(question, Object.keys(tools), dataScope)
  return Object.fromEntries(
    names.flatMap((name) => name in tools ? [[name, tools[name]]] : []),
  )
}

/** Force step zero when the user-selected scope authorizes a clear lookup.
 * This prevents smaller models from answering from pretrained/sample memory
 * without reading the bound source. Later steps return to auto so multi-domain
 * prompts (conditions + medications + labs) can continue querying as needed. */
export function forcedInitialAgentToolName(
  question: string,
  selectedToolNames: readonly string[],
  dataScope: ChatDataScope,
): string | undefined {
  if (selectedToolNames.length === 0) return undefined
  if (dataScope === 'auto') return undefined
  const generalKnowledge = isGeneralMedicalKnowledgeQuestion(question)
  if (matchesAny(question, NO_RECORD_QUERY)) {
    return generalKnowledge && selectedToolNames.includes('searchMedicalLiterature')
      ? 'searchMedicalLiterature'
      : undefined
  }
  if (dataScope === 'general') {
    return isMedicalEvidenceQuestion(question) && selectedToolNames.includes('searchMedicalLiterature')
      ? 'searchMedicalLiterature'
      : undefined
  }
  if (selectedToolNames.length === 1) return selectedToolNames[0]

  if (isStructuredClinicalRequest(question) && selectedToolNames.includes('getDataOverview')) {
    return 'getDataOverview'
  }

  const priority: string[] = []
  if (MEDICATION_IDENTITY_QUERY.test(question) && extractMedicationRecordQuery(question)) {
    priority.push('queryMedications')
  }
  if (isMedicalEvidenceQuestion(question)) {
    priority.push('getHealthSummarySnapshot')
  }
  if (BROAD_HEALTH_SUMMARY_QUERY.some((pattern) => pattern.test(question))) {
    priority.push('getHealthSummarySnapshot')
  }
  if (/(?:摘要|整理|健康狀況|summary|overview)/i.test(question)) {
    priority.push('queryConditions', 'getDataOverview')
  }
  if (/(?:診斷|疾病|慢性病|condition|diagnos)/i.test(question)) {
    priority.push('queryConditions')
  }
  if (/(?:藥|用藥|處方|服用|用過|使用過|medication|medicine|prescription|drug|taken|used)/i.test(question)) {
    if (MEDICATION_HISTORY_QUERY.test(question)) {
      priority.push('queryMedications', 'getActiveMedicationList')
    } else if (CURRENT_MEDICATION_QUERY.test(question)) {
      priority.push('getActiveMedicationList', 'queryMedications')
    } else {
      priority.push('getActiveMedicationList', 'queryMedications')
    }
  }
  if (/(?:檢驗|檢查值|數值|lab|test result|marker)/i.test(question)) {
    priority.push('queryLabResultsByCategory', 'queryObservations')
  }
  if (/(?:影像|放射|超音波|電腦斷層|核磁|X\s*光|攝影|imaging|radiology|ultrasound|CT|MRI|X\s*[-–—]?\s*ray)/i.test(question)) {
    priority.push('queryImagingRecords')
  }
  if (/(?:就診|住院|急診|visit|encounter|admission)/i.test(question)) {
    priority.push('getRecentVisits', 'queryEncounters')
  }
  if (isMedicalEvidenceQuestion(question)) {
    priority.push('searchMedicalLiterature')
  }
  priority.push('queryPatientInfo', 'getDataOverview', ...selectedToolNames)
  return priority.find((name) => selectedToolNames.includes(name))
}

function isStructuredClinicalRequest(question: string): boolean {
  return question.length > 300 && /[\r\n]/.test(question)
}

/**
 * A small local model is more reliable when compact tools are executed
 * deterministically after routing. Keep the list intentionally short: most are
 * complete with `{}`, while getRecentVisits accepts only bounded arguments
 * extracted from explicit user wording by localAgentPrefetchInput.
 * Frontier models never use this path because their data scope remains `auto`.
 */
const LOCAL_AGENT_PREFETCH_TOOLS = new Set([
  'getDataOverview',
  'getHealthSummarySnapshot',
  'getActiveMedicationList',
  'queryMedications',
  'getRecentVisits',
  'queryImagingRecords',
])

export function shouldPreExecuteLocalAgentTool(
  initialToolName: string | undefined,
): boolean {
  return !!initialToolName && LOCAL_AGENT_PREFETCH_TOOLS.has(initialToolName)
}

/**
 * Preserve explicit visit constraints when a local model's first tool is
 * executed by the harness. This is deliberately narrow: it only fills two
 * optional getRecentVisits fields and never selects or authorizes a tool.
 */
export function localAgentPrefetchInput(
  question: string,
  initialToolName: string | undefined,
): Record<string, unknown> {
  if (initialToolName === 'queryMedications') {
    const input: Record<string, unknown> = {}
    const query = extractMedicationRecordQuery(question)
    if (query) input.query = query
    if (/(?:過去|近|最近)\s*(?:三|3)\s*(?:個)?月|(?:last|past)\s*(?:three|3)\s*months?/i.test(question)) {
      input.timeRange = 'last-90-days'
    } else if (/(?:過去|近|最近)\s*(?:一|1)\s*(?:個)?月|(?:last|past)\s*(?:one|1)\s*month/i.test(question)) {
      input.timeRange = 'last-30-days'
    } else if (/(?:過去|近|最近)\s*(?:六|6)\s*(?:個)?月|(?:last|past)\s*(?:six|6)\s*months?/i.test(question)) {
      input.timeRange = 'last-180-days'
    } else if (/(?:過去|近|最近)\s*(?:一年|十二|12)\s*(?:個月)?|(?:last|past)\s*(?:one|1)\s*year/i.test(question)) {
      input.timeRange = 'last-365-days'
    }
    return input
  }
  if (initialToolName !== 'getRecentVisits') return {}

  const input: Record<string, unknown> = {}
  if (/(?:最近|上|前)(?:一|1)次住院|最近一次.*住院|latest (?:hospital )?admission|most recent (?:hospital )?admission/i.test(question)) {
    input.type = 'inpatient'
    input.limit = 1
    return input
  }

  const countMatch = question.match(/(?:最近|近|前)\s*(\d+|[一二三四五六七八九十])\s*次(?:就醫|看診|門診|住院|visit|encounter)/i)
    ?? question.match(/(?:last|recent)\s*(\d+)\s*(?:visits?|encounters?)/i)
  if (!countMatch) return input

  const chineseCounts: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  }
  const parsed = chineseCounts[countMatch[1]] ?? Number.parseInt(countMatch[1], 10)
  if (Number.isFinite(parsed)) input.limit = Math.min(Math.max(parsed, 1), 10)
  return input
}
