import {
  asksForCurrentMedicalEvidence,
  explicitlyReferencesPatient,
  extractMedicationRecordQuery,
  forcedInitialAgentToolName,
  implicitlyRequestsPatientRecord,
  isGeneralMedicalKnowledgeQuestion,
  localAgentPrefetchInput,
  selectAgentToolNames,
  selectAgentToolsForQuestion,
  shouldPreExecuteLocalAgentTool,
} from '@/src/infrastructure/ai/tools/agent-tool-router'

const names = [
  'queryPatientInfo',
  'getDataOverview',
  'getHealthSummarySnapshot',
  'queryEncounters',
  'getRecentVisits',
  'getEncounterDetails',
  'queryImagingRecords',
  'queryDiagnosticReports',
  'queryLabResultsByCategory',
  'queryObservations',
  'searchObservationByName',
  'listAvailableObservationCodes',
  'queryProcedures',
  'queryMedications',
  'getActiveMedicationList',
  'queryAllergies',
  'queryImmunizations',
  'searchMedicalLiterature',
]

describe('agent tool router', () => {
  it('does not turn a quoted guideline title in a clinical template into a drug filter', () => {
    const question = '# 血脂健保給付判讀\n依據「藥品給付規定」，掃描病人 Patient 年齡、診斷、用藥、檢驗 Observation 與影像。\n'
      + '基線指未用藥時的值；確認目前使用的是哪種藥，並整理所有日期與數值。\n'.repeat(10)
    expect(extractMedicationRecordQuery(question)).toBeUndefined()
    expect(localAgentPrefetchInput(question, 'queryMedications')).toEqual({})
    const selected = selectAgentToolNames(question, names, 'patient')
    expect(selected).toContain('queryPatientInfo')
    expect(selected).toContain('queryObservations')
    expect(selected).toContain('queryMedications')
    expect(forcedInitialAgentToolName(question, selected, 'patient')).toBe('getDataOverview')
    expect(selectAgentToolNames(question, names, 'general')).not.toContain('queryObservations')
  })

  it('routes a lab trend question to lab tools only', () => {
    const selected = selectAgentToolNames('請查最近兩次 HbA1c 的數值與趨勢', names, 'patient')
    expect(selected).toContain('searchObservationByName')
    expect(selected).toContain('queryDiagnosticReports')
    expect(selected).not.toContain('queryProcedures')
    expect(selected).not.toContain('queryAllergies')
  })

  it('combines encounter and lab groups for an inpatient lab question', () => {
    const selected = selectAgentToolNames('住院期間有哪些檢驗結果？', names, 'patient')
    expect(selected).toContain('queryEncounters')
    expect(selected).toContain('getEncounterDetails')
    expect(selected).toContain('queryDiagnosticReports')
    expect(selected).not.toContain('queryImmunizations')
  })

  it('removes tools when the user explicitly says not to query records', () => {
    expect(selectAgentToolNames('不要查詢病歷，請解釋 HbA1c', names, 'patient')).toEqual([])
  })

  it('fails open to every available tool for an unknown broad question', () => {
    expect(selectAgentToolNames('請協助分析目前狀況', names, 'patient'))
      .toEqual(names.filter((name) => name !== 'searchMedicalLiterature'))
  })

  it('returns the routed tool object without changing tool values', () => {
    const tools = Object.fromEntries(names.map((name) => [name, { name }]))
    const selected = selectAgentToolsForQuestion(tools, '是否有 Penicillin 過敏？', 'patient')
    expect(Object.keys(selected ?? {})).toEqual(['queryAllergies'])
    expect(selected?.queryAllergies).toBe(tools.queryAllergies)
  })

  it('forces an unambiguous patient-data lookup but not a general explanation', () => {
    expect(forcedInitialAgentToolName('請查這位病人的性別與年齡', ['queryPatientInfo'], 'patient'))
      .toBe('queryPatientInfo')
    expect(forcedInitialAgentToolName('請解釋性別欄位的意思', [], 'general'))
      .toBeUndefined()
    expect(forcedInitialAgentToolName('不要查詢病歷，請解釋過敏', ['queryAllergies'], 'patient'))
      .toBeUndefined()
  })

  it('forces a grounding tool for a broad multi-domain patient summary', () => {
    expect(forcedInitialAgentToolName(
      '請用我匯入的健康資料整理慢性疾病、目前用藥與檢驗摘要',
      ['queryConditions', 'queryLabResultsByCategory', 'getActiveMedicationList'],
      'patient',
    )).toBe('queryConditions')
  })

  it('routes a broad imported-record summary to the compact snapshot when available', () => {
    const question = '請用我匯入的健康資料，整理最近身體狀況、慢性疾病、目前用藥，以及超出正常範圍的檢驗數值。'
    expect(selectAgentToolNames(question, names, 'patient')).toEqual(['getHealthSummarySnapshot'])
    expect(forcedInitialAgentToolName(question, ['getHealthSummarySnapshot'], 'patient'))
      .toBe('getHealthSummarySnapshot')
  })

  it('never exposes FHIR tools for a general guideline update question', () => {
    const question = '目前糖尿病用藥 guideline 有什麼更新？'
    const fhirOnlyNames = names.filter((name) => name !== 'searchMedicalLiterature')

    expect(isGeneralMedicalKnowledgeQuestion(question)).toBe(true)
    expect(asksForCurrentMedicalEvidence(question)).toBe(true)
    expect(explicitlyReferencesPatient(question)).toBe(false)
    expect(selectAgentToolNames(question, fhirOnlyNames, 'general')).toEqual([])
    expect(forcedInitialAgentToolName(question, [], 'general')).toBeUndefined()
  })

  it('routes a general guideline question only to literature when available', () => {
    const question = '現在糖尿病 guideline 有什麼更新？'

    expect(selectAgentToolNames(question, names, 'general')).toEqual(['searchMedicalLiterature'])
    expect(forcedInitialAgentToolName(question, ['searchMedicalLiterature'], 'general'))
      .toBe('searchMedicalLiterature')
  })

  it.each([
    ['Traceton 是什麼藥？', 'Traceton'],
    ['Traceton 是抗組織胺藥物嗎？', 'Traceton'],
    ['「服安痛膜衣錠」的成分是什麼？', '服安痛膜衣錠'],
    ['AC56706100 的 ATC 分類', 'AC56706100'],
    ['What kind of drug is Traceton?', 'Traceton'],
    ['這位病人用的 Traceton 是什麼藥？', 'Traceton'],
  ])('routes a named drug question to the matching patient medication row: %s', (question, query) => {
    expect(extractMedicationRecordQuery(question)).toBe(query)
    const selected = selectAgentToolNames(question, names, 'patient')
    expect(selected).toEqual(['queryMedications', 'getActiveMedicationList'])
    expect(forcedInitialAgentToolName(question, selected, 'patient'))
      .toBe('queryMedications')
    expect(localAgentPrefetchInput(question, 'queryMedications')).toEqual({ query })
    expect(selectAgentToolNames(question, names, 'general')).toEqual([])
  })

  it('does not attach a medication query to an unnamed medication pronoun', () => {
    const question = '這個藥是哪一類藥？'
    expect(extractMedicationRecordQuery(question)).toBeUndefined()
    expect(localAgentPrefetchInput(question, 'queryMedications')).toEqual({})
  })

  it('prefers medication history over the current-medication shortcut for a past range', () => {
    const selected = selectAgentToolNames('請查這位病人過去三個月的用藥', names, 'patient')
    expect(selected).toEqual(['queryMedications', 'getActiveMedicationList'])
    expect(forcedInitialAgentToolName('請查這位病人過去三個月的用藥', selected, 'patient'))
      .toBe('queryMedications')
    expect(localAgentPrefetchInput('請查這位病人過去三個月的用藥', 'queryMedications'))
      .toEqual({ timeRange: 'last-90-days' })
  })

  it('extracts a named product for deterministic patient medication-history search', () => {
    const question = '這位病人有沒有用過 Traceton？'
    const selected = selectAgentToolNames(question, names, 'patient')

    expect(extractMedicationRecordQuery(question)).toBe('Traceton')
    expect(forcedInitialAgentToolName(question, selected, 'patient')).toBe('queryMedications')
    expect(localAgentPrefetchInput(question, 'queryMedications')).toEqual({ query: 'Traceton' })
    expect(extractMedicationRecordQuery('這位病人有沒有 Traceton 的用藥紀錄？'))
      .toBe('Traceton')
  })

  it('allows a compact patient snapshot only when evidence advice is explicitly personalized', () => {
    const question = '請根據我的病歷，說明最新糖尿病 guideline 對我有什麼影響。'
    const selected = selectAgentToolNames(question, names, 'patient-literature')

    expect(explicitlyReferencesPatient(question)).toBe(true)
    expect(selected).toEqual(['getHealthSummarySnapshot', 'searchMedicalLiterature'])
    expect(forcedInitialAgentToolName(question, selected, 'patient-literature')).toBe('getHealthSummarySnapshot')
  })

  it.each([
    'HbA1c 是什麼？',
    'Sotalol 有什麼副作用？',
    '糖尿病有哪些藥物治療？',
  ])('fails closed to no FHIR for general medical knowledge: %s', (question) => {
    const fhirOnlyNames = names.filter((name) => name !== 'searchMedicalLiterature')

    expect(explicitlyReferencesPatient(question)).toBe(false)
    expect(implicitlyRequestsPatientRecord(question)).toBe(false)
    expect(selectAgentToolNames(question, fhirOnlyNames, 'general')).toEqual([])
  })

  it('still routes an implicit but unambiguous record lookup', () => {
    const question = '請查最近兩次 HbA1c 的數值與趨勢'

    expect(implicitlyRequestsPatientRecord(question)).toBe(true)
    expect(selectAgentToolNames(question, names, 'patient')).toContain('searchObservationByName')
  })

  it('recognizes an English personal pronoun without over-fetching a full snapshot', () => {
    const question = 'What is my latest HbA1c?'
    const selected = selectAgentToolNames(question, names, 'patient')

    expect(explicitlyReferencesPatient(question)).toBe(true)
    expect(selected).toContain('searchObservationByName')
    expect(selected).not.toContain('getHealthSummarySnapshot')
  })

  it('treats the explicit scope as the boundary for an ambiguous imaging question', () => {
    const question = '胸部 X 光有什麼問題嗎'
    const patientTools = selectAgentToolNames(question, names, 'patient')
    const generalTools = selectAgentToolNames(question, names, 'general')

    expect(patientTools).toEqual(['queryImagingRecords'])
    expect(forcedInitialAgentToolName(question, patientTools, 'patient'))
      .toBe('queryImagingRecords')
    expect(generalTools).toEqual([])
  })

  it('leaves the full tool decision to a frontier model in automatic scope', () => {
    const question = 'X光有什麼問題嗎'

    expect(selectAgentToolNames(question, names, 'auto')).toEqual(names)
    expect(forcedInitialAgentToolName(question, names, 'auto')).toBeUndefined()
  })

  it('prefetches only compact local tools', () => {
    expect(shouldPreExecuteLocalAgentTool('getDataOverview')).toBe(true)
    expect(shouldPreExecuteLocalAgentTool('getHealthSummarySnapshot')).toBe(true)
    expect(shouldPreExecuteLocalAgentTool('getActiveMedicationList')).toBe(true)
    expect(shouldPreExecuteLocalAgentTool('queryMedications')).toBe(true)
    expect(shouldPreExecuteLocalAgentTool('getRecentVisits')).toBe(true)
    expect(shouldPreExecuteLocalAgentTool('queryImagingRecords')).toBe(true)
    expect(shouldPreExecuteLocalAgentTool('searchObservationByName')).toBe(false)
    expect(shouldPreExecuteLocalAgentTool(undefined)).toBe(false)
  })

  it('preserves explicit visit type and count in deterministic prefetch input', () => {
    expect(localAgentPrefetchInput('最近一次住院的日期與主要原因是什麼？', 'getRecentVisits'))
      .toEqual({ type: 'inpatient', limit: 1 })
    expect(localAgentPrefetchInput('請列出最近三次就醫日期與就醫類型。', 'getRecentVisits'))
      .toEqual({ limit: 3 })
    expect(localAgentPrefetchInput('最近有哪些就醫紀錄？', 'getRecentVisits')).toEqual({})
    expect(localAgentPrefetchInput('最近三次就醫', 'queryEncounters')).toEqual({})
  })
})
