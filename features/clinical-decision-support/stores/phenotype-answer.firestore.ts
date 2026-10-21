/**
 * The persisted `PhenotypeAnswerRepository`, deliberately unimplemented.
 *
 * The seam it plugs into is already there — `setPhenotypeAnswerRepository` in
 * `phenotype-answer.store.ts` swaps the session implementation for this one and
 * nothing above it changes; `setPatientAnswerBacking` in
 * `patient-answer-backing.ts` does the same for every CDSS store at once — but
 * what either would write is patient data, and three decisions that are the
 * owner's have not been made:
 *
 *   1. **The path.** `cdssPhenotypeAnswers/{patientId}` and
 *      `users/{uid}/cdssPhenotypeAnswers/{patientId}` are different clinical
 *      claims, not two spellings of one: the first is 「this patient's
 *      判讀」 and hands over at the bedside, the second is 「this physician's
 *      判讀」 and does not.
 *   2. **The expiry.** An LVEF reading goes stale, and how many days make a
 *      stored answer 未作答 again decides whether the card re-asks.
 *   3. **The Rules.** Firestore Rules are the authority on who may read this,
 *      and `CLAUDE.md` puts them outside what this pilot may change.
 *
 * The trade-offs and a Rules draft are written up in
 * `docs/HF-DP01_phenotype-answer-persistence-proposal.md`. Until those are
 * settled the store keeps its encrypted tab-session default: an answer is
 * sealed under this tab's session key, so it survives a reload of this tab and
 * is unreadable — and therefore gone — in any other session. Carrying it to the
 * next visit is exactly what this file would add, and it is phase 2.
 *
 * Nothing here imports Firestore or opens a connection. Wiring it in is a
 * separate change that must also say, in its commit and its PR, that it adds a
 * patient-data write and where it writes.
 */
import type { PhenotypeAnswerRepository } from './phenotype-answer.store'

export class PhenotypeAnswerPersistenceNotApprovedError extends Error {
  constructor() {
    super(
      'The persisted phenotype-answer repository is not implemented: the collection path, '
      + 'the staleness window, and the Firestore Rules are still with the owner. See '
      + 'docs/HF-DP01_phenotype-answer-persistence-proposal.md.',
    )
    this.name = 'PhenotypeAnswerPersistenceNotApprovedError'
  }
}

/**
 * Would return the persisted repository once the three decisions above are
 * made. It throws today rather than returning a repository that silently drops
 * writes: a store that accepts an answer and loses it is worse than one that
 * never claimed to keep it, because the physician has no way to tell.
 */
export function createFirestorePhenotypeAnswerRepository(): PhenotypeAnswerRepository {
  throw new PhenotypeAnswerPersistenceNotApprovedError()
}
