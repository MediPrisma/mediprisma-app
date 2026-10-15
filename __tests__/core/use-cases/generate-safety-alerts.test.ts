import { generateSafetyAlertsUseCase } from '@/src/core/use-cases/safety-alerts/generate-safety-alerts.use-case'

describe('GenerateSafetyAlertsUseCase', () => {
  describe('buildMessages', () => {
    it('builds system + user with schema, context, and language directive', () => {
      const msgs = generateSafetyAlertsUseCase.buildMessages({
        clinicalContext: 'eGFR 32; Metformin 1000mg',
        locale: 'zh-TW',
      })
      expect(msgs).toHaveLength(2)
      expect(msgs[0].role).toBe('system')
      expect(msgs[0].content).toContain('JSON')
      expect(msgs[0].content).toContain('繁體中文')
      expect(msgs[1].role).toBe('user')
      expect(msgs[1].content).toContain('eGFR 32')
    })

    it('uses English directive for en locale', () => {
      const msgs = generateSafetyAlertsUseCase.buildMessages({ clinicalContext: 'x', locale: 'en' })
      expect(msgs[0].content).toContain('English')
    })

    it('defaults to the clinician prompt and switches to the patient prompt by audience', () => {
      const medical = generateSafetyAlertsUseCase.buildMessages({ clinicalContext: 'x', locale: 'en' })
      const patient = generateSafetyAlertsUseCase.buildMessages({ clinicalContext: 'x', locale: 'en', audience: 'patient' })
      // Clinician (default) speaks to healthcare professionals; patient version
      // is layperson-facing and must forbid self-directed medication changes.
      expect(medical[0].content).toContain('healthcare professionals')
      expect(patient[0].content).toContain('layperson')
      expect(patient[0].content).toMatch(/NEVER tell the patient to start, stop, or change/i)
      expect(patient[0].content).not.toContain('healthcare professionals')
    })

    it('appends the SOURCE LIST and asks for source keys when a catalog is given', () => {
      const withCatalog = generateSafetyAlertsUseCase.buildMessages({
        clinicalContext: 'x',
        locale: 'en',
        catalog: [
          { key: 'L3', resourceType: 'DiagnosticReport', resourceId: 'r1', display: 'eGFR', date: '2026-06-02', organization: '甲醫院' },
          { key: 'D1', resourceType: 'DocumentReference', resourceId: 'd1', display: '出院病摘', date: '2026-05-18', organization: '甲醫院' },
        ],
      })
      expect(withCatalog[0].content).toContain('"sources"')
      expect(withCatalog[1].content).toContain('SOURCE LIST')
      expect(withCatalog[1].content).toContain('[L3] DiagnosticReport | 2026-06-02 | 甲醫院 | eGFR')
      expect(withCatalog[1].content).toContain('[D1] DocumentReference | 2026-05-18 | 甲醫院 | 出院病摘')
      expect(withCatalog[0].content).toContain('cite its matching D# source key')
      expect(withCatalog[0].content).toContain('valid evidence even if there is no separate endoscopy')
      expect(withCatalog[0].content).toContain('does NOT prove that a particular procedure was performed')
    })

    it('omits the SOURCE LIST when no catalog is provided', () => {
      const msgs = generateSafetyAlertsUseCase.buildMessages({ clinicalContext: 'x', locale: 'en' })
      expect(msgs[1].content).not.toContain('SOURCE LIST')
    })

    it('uses a compact Safety-specific instruction inside a shared card batch', () => {
      const medical = generateSafetyAlertsUseCase.buildBatchModuleInstruction({
        locale: 'zh-TW',
        audience: 'medical',
      })
      const patient = generateSafetyAlertsUseCase.buildBatchModuleInstruction({
        locale: 'zh-TW',
        audience: 'patient',
      })

      expect(medical.length).toBeLessThan(3_500)
      expect(patient.length).toBeLessThan(4_000)
      expect(medical).toContain('TIME-TO-HARM')
      expect(medical).toContain('TWO DIFFERENT non-pharmacy facilities')
      expect(medical).toContain('within about 3 months')
      expect(medical).toContain('<<<MEDIPRISMA_MODULE:safety>>>')
      expect(medical).toContain('<<<END_MEDIPRISMA_MODULE:safety>>>')
      expect(medical).not.toContain('Output ONLY a JSON object matching this schema')
      expect(patient).toContain('never tell the patient to start, stop, or change a medicine')
    })

    it('scrubs patient literals from both clinical context and source labels', () => {
      const msgs = generateSafetyAlertsUseCase.buildMessages({
        clinicalContext: '王小明 eGFR 32',
        piiLiterals: ['王小明'],
        locale: 'zh-TW',
        catalog: [{
          key: 'D1',
          resourceType: 'DocumentReference',
          resourceId: 'd1',
          display: '王小明出院病摘',
        }],
      })
      expect(msgs[1].content).not.toContain('王小明')
      expect(msgs[1].content).toContain('[已遮蔽] eGFR 32')
      expect(msgs[1].content).toContain('[已遮蔽]出院病摘')
    })
  })

  describe('parseScanResult', () => {
    const valid = JSON.stringify({
      scannedCount: 5,
      alerts: [
        { severity: 'high', title: '過敏衝突', detail: '對 Penicillin 過敏但處方 Amoxicillin', evidence: ['Penicillin'], category: 'allergy' },
      ],
    })

    it('parses clean JSON and assigns ids', () => {
      const r = generateSafetyAlertsUseCase.parseScanResult(valid)
      expect(r).not.toBeNull()
      expect(r!.scannedCount).toBe(5)
      expect(r!.alerts).toHaveLength(1)
      expect(r!.alerts[0].id).toBe('sa-0')
      expect(r!.alerts[0].category).toBe('allergy')
      // No sources cited → defaults to [] (never undefined, so the UI can map).
      expect(r!.alerts[0].sources).toEqual([])
    })

    it('keeps cited source keys on the alert', () => {
      const r = generateSafetyAlertsUseCase.parseScanResult(
        JSON.stringify({
          scannedCount: 3,
          alerts: [
            { severity: 'high', title: '腎劑量', detail: 'eGFR 32', evidence: ['eGFR 32'], sources: ['L3', 'M2'], category: 'renal' },
          ],
        }),
      )
      expect(r!.alerts[0].sources).toEqual(['L3', 'M2'])
    })

    it('keeps a document-supported diagnosis but marks an unsupported procedure assertion', () => {
      const catalog = [{
        key: 'D1',
        resourceType: 'DocumentReference',
        resourceId: 'doc-1',
        display: '出院病摘',
        getContentText: () => '出院診斷：胃潰瘍。',
      }]
      const diagnosisOnly = generateSafetyAlertsUseCase.parseScanResult(JSON.stringify({
        alerts: [{
          severity: 'medium',
          title: '胃潰瘍病史',
          detail: '出院病摘記載胃潰瘍。',
          sources: ['D1'],
          category: 'bleeding',
        }],
      }), catalog)
      expect(diagnosisOnly!.alerts[0].unsupportedSourceKeys).toEqual([])

      const unsupportedProcedure = generateSafetyAlertsUseCase.parseScanResult(JSON.stringify({
        alerts: [{
          severity: 'medium',
          title: '胃鏡結果',
          detail: '胃鏡顯示胃潰瘍。',
          sources: ['D1'],
          category: 'bleeding',
        }],
      }), catalog)
      expect(unsupportedProcedure!.alerts[0].unsupportedSourceKeys).toEqual(['D1'])
    })

    it('accepts a procedure assertion when the cited document text names it', () => {
      const catalog = [{
        key: 'D1',
        resourceType: 'DocumentReference',
        resourceId: 'doc-1',
        display: '出院病摘',
        getContentText: () => 'PANENDOSCOPY showed gastric ulcer.',
      }]
      const result = generateSafetyAlertsUseCase.parseScanResult(JSON.stringify({
        alerts: [{
          severity: 'medium',
          title: '胃鏡結果',
          detail: '胃鏡顯示胃潰瘍。',
          sources: ['D1'],
          category: 'bleeding',
        }],
      }), catalog)
      expect(result!.alerts[0].unsupportedSourceKeys).toEqual([])
    })

    describe('a medicine called anticholinergic against its listed mechanism', () => {
      // Synthetic catalog: the line facts the SOURCE LIST printed.
      const medicine = (key: string, display: string, medicationClass: string, medicine: { mechanism?: string; complete: boolean; anticholinergic?: string }) => ({
        key, resourceType: 'MedicationRequest', resourceId: `r-${key}`, display, medicationClass, medicine,
      })
      const catalog = [
        medicine('M1', 'SYN-OXY Extended-release Tablets 5mg', 'oxybutynin · G04B UROLOGICALS', { mechanism: 'Cholinergic Muscarinic Antagonist', complete: true, anticholinergic: 'ACB 3' }),
        medicine('M2', 'Synmiga Prolonged-release Tablets 50mg', 'mirabegron · G04B UROLOGICALS', { mechanism: 'beta3-Adrenergic Agonist', complete: true }),
        { key: 'M3', resourceType: 'MedicationRequest', resourceId: 'r-M3', display: 'SYN-HERB CAPSULES', medicationClass: 'synherb · A16A' },
      ]
      const parse = (alert: Record<string, unknown>) => generateSafetyAlertsUseCase.parseScanResult(
        JSON.stringify({ alerts: [{ severity: 'medium', category: 'other', ...alert }] }), catalog,
      )!.alerts[0]

      it('marks the β3 agonist an alert calls anticholinergic, by ingredient or brand', () => {
        expect(parse({
          title: 'Anticholinergic burden: SYN-OXY + Synmiga',
          detail: 'Concurrent oxybutynin and mirabegron increase anticholinergic and urinary retention risk.',
          sources: ['M1', 'M2'],
        }).propertyReviewKeys).toEqual(['M2'])
      })

      it('does not read a suggestion to switch, or an unknown medicine, as the claim', () => {
        expect(parse({
          title: 'Oxybutynin in an older adult',
          detail: 'Oxybutynin is strongly anticholinergic. Consider switching to mirabegron, which is not anticholinergic.',
          sources: ['M1', 'M2'],
        }).propertyReviewKeys).toEqual([])
        expect(parse({
          title: 'Anticholinergic load with synherb',
          detail: 'Synherb and oxybutynin add anticholinergic effects.',
          sources: ['M1', 'M3'],
        }).propertyReviewKeys).toEqual([])
      })
    })

    it('strips markdown fences / surrounding prose', () => {
      const r = generateSafetyAlertsUseCase.parseScanResult('Sure:\n```json\n' + valid + '\n```\nDone.')
      expect(r).not.toBeNull()
      expect(r!.alerts).toHaveLength(1)
    })

    it('normalises an off-list category to "other"', () => {
      const r = generateSafetyAlertsUseCase.parseScanResult(
        JSON.stringify({ alerts: [{ severity: 'low', title: 'x', detail: 'y', category: 'weird' }] }),
      )
      expect(r!.alerts[0].category).toBe('other')
    })

    it('handles an empty alert list', () => {
      const r = generateSafetyAlertsUseCase.parseScanResult('{"scannedCount":10,"alerts":[]}')
      expect(r!.alerts).toEqual([])
      expect(r!.scannedCount).toBe(10)
    })

    it('returns null on non-JSON / empty', () => {
      expect(generateSafetyAlertsUseCase.parseScanResult('not json at all')).toBeNull()
      expect(generateSafetyAlertsUseCase.parseScanResult('')).toBeNull()
    })

    it('returns null when the schema fails (bad severity enum)', () => {
      expect(
        generateSafetyAlertsUseCase.parseScanResult('{"alerts":[{"severity":"critical","title":"x","detail":"y"}]}'),
      ).toBeNull()
    })

    it('parses only a complete independently delimited Safety block', () => {
      const openBlock = [
        '<<<MEDIPRISMA_MODULE:safety>>>',
        '{"scannedCount":1,"alerts":[]}',
      ].join('\n')
      expect(generateSafetyAlertsUseCase.hasCompleteBatchModuleBlock(openBlock)).toBe(false)
      expect(generateSafetyAlertsUseCase.parseBatchModuleResult(openBlock)).toBeNull()

      const completeBlock = `${openBlock}\n<<<END_MEDIPRISMA_MODULE:safety>>>`
      expect(generateSafetyAlertsUseCase.hasCompleteBatchModuleBlock(completeBlock)).toBe(true)
      expect(generateSafetyAlertsUseCase.parseBatchModuleResult(completeBlock)?.alerts).toEqual([])
    })
  })
})
