import type { CdssPatientProfile } from '@voho0000/personalized-care'
import data from '@/app/dev-nhi-table1/pipeline/patients.json'
import { buildFixtureProfile, fixtureChecks, fixtureSummary, replayFixtureReply, type LipidPipelineCase } from '@/app/dev-nhi-table1/pipeline/replay'
import { useNhiLipidReviewStore } from '@/features/clinical-decision-support/stores/nhi-lipid-review.store'
import { NHI_LIPID_AI_PROMPT_VERSION } from '@/features/clinical-decision-support/ai/nhi-lipid-ai-assist'

const cases = data.cases as unknown as LipidPipelineCase[]
const store = () => useNhiLipidReviewStore.getState()
let sequence = 0
function effective(record: CdssPatientProfile): CdssPatientProfile {
  return { ...record, nhiLipidReview: store().answers, nhiLipidReviewProvenance: store().provenance }
}
function run(scenario: LipidPipelineCase, record: CdssPatientProfile, unknownOnly = false) {
  const checks = fixtureChecks(effective(record))
  const runId = `synthetic-test-${++sequence}`
  store().beginAiRun(record.id, {
    runId, inputSignature: scenario.id, sourceScopeSignature: scenario.id,
    promptVersion: NHI_LIPID_AI_PROMPT_VERSION, startedAt: data.fixedNow,
  })
  const suggestions = replayFixtureReply(scenario, checks, data.fixedNow, unknownOnly)
  store().completeAiRun(record.id, runId, suggestions, Object.fromEntries(checks.map(item => [item.id, item.state])), data.fixedNow)
  return suggestions
}
function tier(record: CdssPatientProfile) {
  return fixtureSummary(effective(record)).tiers.find(item => item.selected)?.id ?? null
}

afterEach(() => store().activate(undefined))

describe('bridge FHIR → production parser → automatic answers → clinician review', () => {
  it.each(cases)('$id preserves the expected tier through a grounded AI replay and clinician review', scenario => {
    const record = buildFixtureProfile(scenario, data.fixedNow)
    store().activate(record.id)
    expect(tier(record)).toBe(scenario.expected.baselineTier)
    const suggestions = run(scenario, record)
    expect(tier(record)).toBe(scenario.expected.acceptedAiTier)
    for (const suggestion of suggestions.filter(item => item.state !== 'unknown')) {
      expect(suggestion.evidence.length).toBeGreaterThan(0)
      expect(store().provenance[suggestion.criterionId].source).toBe('ai')
    }
    expect(fixtureSummary(effective(record)).documentationNote).not.toContain('醫師核對')
    // Re-running unchanged evidence must not drop prior AI-origin facts merely
    // because they are no longer unknown after the first extraction.
    run(scenario, record)
    expect(tier(record)).toBe(scenario.expected.acceptedAiTier)
    for (const [id, answer] of Object.entries(scenario.physicianAnswers)) store().answer(record.id, id, answer)
    expect(tier(record)).toBe(scenario.expected.physicianTier)
    expect(fixtureSummary(effective(record)).documentationNote).toContain('醫師核對')
  })

  it('keeps a clinician rejection of carotid disease through repeated model replies', () => {
    const scenario = cases.find(item => item.id === 'cad-carotid')!
    const record = buildFixtureProfile(scenario, data.fixedNow)
    store().activate(record.id)
    run(scenario, record)
    expect(tier(record)).toBe('extreme')
    store().answer(record.id, 'carotid', 'no')
    expect(tier(record)).not.toBe('extreme')
    run(scenario, record)
    expect(store().answers.carotid).toBe('no')
    expect(store().provenance.carotid.source).toBe('manual')
    expect(tier(record)).not.toBe('extreme')
  })

  it('withdraws obsolete AI answers after insufficient evidence, retaining physician answers', () => {
    const scenario = cases.find(item => item.id === 'cad-carotid')!
    const record = buildFixtureProfile(scenario, data.fixedNow)
    store().activate(record.id)
    run(scenario, record)
    store().answer(record.id, 'smoking', 'no')
    run(scenario, record, true)
    expect(Object.values(store().provenance).some(item => item.source === 'ai')).toBe(false)
    expect(store().answers.smoking).toBe('no')
    expect(tier(record)).not.toBe('extreme')
  })

  it('clears all answers and evidence on a switch to another synthetic patient', () => {
    const first = cases[0]
    const record = buildFixtureProfile(first, data.fixedNow)
    store().activate(record.id)
    run(first, record)
    expect(Object.keys(store().aiReview.suggestions).length).toBeGreaterThan(0)
    store().activate(buildFixtureProfile(cases[1], data.fixedNow).id)
    expect(store().answers).toEqual({})
    expect(store().aiReview.suggestions).toEqual({})
  })
})
