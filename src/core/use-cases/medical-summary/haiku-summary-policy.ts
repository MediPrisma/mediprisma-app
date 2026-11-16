import type { AiMessage } from '@/src/core/entities/ai.entity'

const EVIDENCE_CHECK = `FINAL EVIDENCE CHECK FOR EVERY VISIBLE FIELD:
Keep suspected, uncertain history, and claim-code-only status visible in the headline and problem label themselves. A qualification elsewhere does not qualify an unqualified label.
Associate a medicine or measurement with a problem only when the supplied evidence supports that relationship. Co-dispensing or a shared encounter alone is not proof of treatment or indication. Otherwise omit that association.
For reports, preserve negation, examination dates, and uncertainty. Do not add "new", "worsening", "progressive", or "old" unless the quoted source supports that comparison or timing. Never move an older finding to the latest examination.
For drug safety, use only supplied drug attributes and supported review conditions. Do not infer anticholinergic class from an ophthalmic/oral route or invent mandatory renal dose changes.
Prefer concise supported statements; omit unsupported inferences. Return all requested modules with valid JSON and their exact end markers.`

/** Reinforce existing grounding rules without changing the data or schema. */
export function withHaikuSummaryEvidenceCheck(messages: AiMessage[], modelId: string): AiMessage[] {
  if (modelId !== 'claude-haiku-5-5') return messages
  return messages.map(message => message.role === 'user'
    ? { ...message, content: `${message.content}\n\n${EVIDENCE_CHECK}` }
    : message)
}
