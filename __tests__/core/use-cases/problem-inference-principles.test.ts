// Path B lock — the problem-list inference semantics are SHARED: the Medical
// Summary prompt and the IPS-export inference prompt must both embed the same
// synthesis rule (problem-inference-principles.ts), so the two features infer
// problems from 健保 data the same way. Each keeps its own evidence input and
// output contract; only the principle text is common.

import { PROBLEM_INFERENCE_SYNTHESIS_RULE } from '@/src/core/use-cases/problem-inference/problem-inference-principles'
import { generateMedicalSummaryUseCase } from '@/src/core/use-cases/medical-summary/generate-medical-summary.use-case'
import {
  buildEvidenceDigest,
  buildInferencePrompt,
} from '@/features/ips-export/utils/inference-engine'
import type { ClinicalDataCollection } from '@/src/core/entities/clinical-data.entity'

describe('PROBLEM_INFERENCE_SYNTHESIS_RULE — shared prompt semantics', () => {
  it('states the cross-data synthesis principle', () => {
    expect(PROBLEM_INFERENCE_SYNTHESIS_RULE).toContain('SYNTHESISING across ALL data')
    expect(PROBLEM_INFERENCE_SYNTHESIS_RULE).toContain('not just claim diagnosis codes')
    expect(PROBLEM_INFERENCE_SYNTHESIS_RULE).toContain('discharge summaries')
  })

  it('is embedded verbatim in the medical-summary prompt (both audiences)', () => {
    for (const audience of ['medical', 'patient'] as const) {
      const [system] = generateMedicalSummaryUseCase.buildMessages({
        clinicalContext: 'ctx',
        catalog: [],
        locale: 'zh-TW',
        audience,
      })
      // The 初診快覽 prompt introduces the section by its UI name before the
      // shared rule; only the rule text itself has to stay verbatim.
      expect(system.content).toContain(`For "problems" (問題清單與負責院所 — the complete problem list): ${PROBLEM_INFERENCE_SYNTHESIS_RULE}`)
    }
  })

  it('is embedded verbatim in the IPS inference prompt', () => {
    const digest = buildEvidenceDigest({
      encounters: [
        { id: 'e1', reasonCode: [{ coding: [{ code: 'E11.9' }] }] },
      ],
    } as unknown as ClinicalDataCollection)
    const [system] = buildInferencePrompt(digest)
    expect(system.content).toContain(PROBLEM_INFERENCE_SYNTHESIS_RULE)
  })
})
