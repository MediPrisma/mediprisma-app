/**
 * The demo chart is a fixed teaching artifact whose newest clinical event is
 * 2026-08-27, from the export covering data through 2026-09-03. Every "is this
 * still current?" rule in the app (active
 * medications, recency windows) is evaluated against a clock, so judging the
 * demo by the real wall clock makes it decay: on 2026-08-17 the 2026-07-20
 * dispensings passed their 28-day supply window and silently left the AI data
 * scope, which broke six citations in the pre-generated demo summary — and the
 * 07-21 batch was one day from doing the same.
 *
 * Freezing the demo's reference time to its own as-of date keeps it coherent
 * and reproducible: the same demo shows the same medications and the same
 * resolvable citations today and next year. This value must ONLY be applied
 * when the loaded bundle is the demo — real patients are always judged against
 * the real clock.
 */
export const DEMO_DATA_AS_OF_ISO = '2026-09-03T23:59:59+08:00'

export const DEMO_DATA_AS_OF_MS = Date.parse(DEMO_DATA_AS_OF_ISO)

/**
 * The 雲端病歷 demo is the same patient captured from NHI MediCloud on
 * 2026-10-26, later than the 健康存摺 export, so it carries its own as-of date.
 * Its Patient id is fixed by scripts/build-medcloud-demo-bundle.mjs.
 */
export const MEDCLOUD_DEMO_PATIENT_ID = 'demo-medcloud-patient-1'
export const MEDCLOUD_DEMO_DATA_AS_OF_ISO = '2026-10-26T23:59:59+08:00'
export const MEDCLOUD_DEMO_DATA_AS_OF_MS = Date.parse(MEDCLOUD_DEMO_DATA_AS_OF_ISO)

/**
 * Reference "now" for recency rules: the demo's own as-of date for demo data,
 * the real clock for everything else.
 */
export function clinicalNowMs(isDemoData: boolean, patientId?: string | null): number {
  if (!isDemoData) return Date.now()
  return patientId === MEDCLOUD_DEMO_PATIENT_ID ? MEDCLOUD_DEMO_DATA_AS_OF_MS : DEMO_DATA_AS_OF_MS
}
