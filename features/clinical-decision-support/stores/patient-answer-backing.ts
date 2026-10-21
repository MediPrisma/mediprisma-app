/**
 * Where every CDSS store keeps what the clinician said about a patient.
 *
 * Seven stores hold answers about one person's chart — the every-visit asks,
 * the clinic vitals and signs, the AF page's structured answers, the HF
 * phenotype gate, the HFpEF inputs, the physician's decisions, and the
 * evidence rows the physician switched on or off. Each keeps
 * its own shape and its own validation; none of them decides where its data
 * lives. That is this file's one job, so the day answers are carried to the
 * next visit, one backing is replaced here and every store follows.
 *
 * The default is today's: this tab, keyed by patient, encrypted under the tab
 * session's key (`encrypted-answer-cache.service`) — ciphertext in
 * `localStorage`, readable only by the session that wrote it, so the next
 * person at a shared workstation reads nothing. Nothing is written to the
 * chart and nothing leaves the machine.
 *
 * Carrying answers across visits is not implemented, on purpose: where they
 * would be written (the hospital's FHIR server or Firestore, under the patient
 * or the physician), how long an answer stays valid, and who may read it are
 * the owner's decisions (see `phenotype-answer.firestore.ts`). A backing that
 * writes anywhere else is a new patient-data write and says so in its commit
 * and its PR.
 */
import {
  discardEncryptedAnswers,
  hasEncryptedAnswers,
  loadEncryptedAnswers,
  persistEncryptedAnswers,
} from '@/src/application/services/encrypted-answer-cache.service'

/** The kinds of answer kept per patient, one per store. */
export type PatientAnswerKind =
  | 'visit-answers'
  | 'clinic-vitals'
  | 'af-answers'
  | 'coronary-phase'
  | 'phenotype-answer'
  | 'hfpef-inputs'
  | 'physician-decisions'
  | 'evidence-overrides'
  | 'carried-answers'

/**
 * The key prefix each kind has always been stored under. Unchanged, so what an
 * open tab already holds is read back as before.
 *
 * The evidence-row switches are the one exception: they used to be kept as
 * plaintext under `cdss-evidence-overrides:`, so their sealed copy has a prefix
 * of its own, and the store removes whatever is left under the old one.
 */
const STORAGE_PREFIXES: Readonly<Record<PatientAnswerKind, string>> = {
  'visit-answers': 'cdss-visit-answers:',
  'clinic-vitals': 'cdss-clinic-vitals:',
  'af-answers': 'cdss-af-answers:',
  'coronary-phase': 'cdss-coronary-phase:',
  'phenotype-answer': 'cdss-phenotype-answer:',
  'hfpef-inputs': 'cdss-hfpef-inputs:',
  'physician-decisions': 'cdss-physician-decisions:',
  'evidence-overrides': 'cdss-evidence-row-overrides:',
  'carried-answers': 'cdss-carried-answers:',
}

/** The browser key one patient's answers of one kind are kept under. */
export function patientAnswerStorageKey(kind: PatientAnswerKind, patientId: string): string {
  return `${STORAGE_PREFIXES[kind]}${patientId}`
}

/**
 * Where a patient's answers are kept. A store reads through `load` once per
 * patient and holds the answer in memory; `save` and `discard` return at once
 * and finish in the background, so the screen never waits on them, and a write
 * that fails never reaches what the screen shows.
 */
export interface PatientAnswerBacking {
  /**
   * Whether anything is kept for this patient, answered without a round trip,
   * so a first visit — the common case — hydrates in the same tick. A backing
   * that cannot tell without asking answers `true`, and `load` has the answer.
   */
  has: (kind: PatientAnswerKind, patientId: string) => boolean
  /** What is kept, as stored; the store validates it. Nothing kept is `null` or `undefined`. */
  load: (kind: PatientAnswerKind, patientId: string) => Promise<unknown>
  save: (kind: PatientAnswerKind, patientId: string, value: unknown) => void
  discard: (kind: PatientAnswerKind, patientId: string) => void
}

/** The default: this tab, encrypted, under each kind's own key. */
export const ENCRYPTED_TAB_SESSION_BACKING: PatientAnswerBacking = {
  has: (kind, patientId) => hasEncryptedAnswers(patientAnswerStorageKey(kind, patientId)),
  load: (kind, patientId) => loadEncryptedAnswers<unknown>(patientAnswerStorageKey(kind, patientId)),
  save: (kind, patientId, value) => persistEncryptedAnswers(patientAnswerStorageKey(kind, patientId), value),
  discard: (kind, patientId) => discardEncryptedAnswers(patientAnswerStorageKey(kind, patientId)),
}

/** This tab's memory and nothing else, for a test that wants to see what each store keeps. */
export function createMemoryPatientAnswerBacking(): PatientAnswerBacking & {
  readonly kept: ReadonlyMap<string, unknown>
} {
  const kept = new Map<string, unknown>()
  return {
    kept,
    has: (kind, patientId) => kept.has(patientAnswerStorageKey(kind, patientId)),
    load: async (kind, patientId) => kept.get(patientAnswerStorageKey(kind, patientId)),
    save: (kind, patientId, value) => {
      kept.set(patientAnswerStorageKey(kind, patientId), value)
    },
    discard: (kind, patientId) => {
      kept.delete(patientAnswerStorageKey(kind, patientId))
    },
  }
}

let backing: PatientAnswerBacking = ENCRYPTED_TAB_SESSION_BACKING

/** The backing every store reads and writes through. */
export function patientAnswerBacking(): PatientAnswerBacking {
  return backing
}

/**
 * Replaces the backing for every store — at start-up, before any chart is
 * read, or in a test. A store already holding a patient's answers in memory
 * keeps them until it is reset; this does not move data between backings.
 */
export function setPatientAnswerBacking(next: PatientAnswerBacking): void {
  backing = next
}
