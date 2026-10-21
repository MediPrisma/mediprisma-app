// Composition root — the ONE place where application code picks concrete
// infrastructure implementations for core interfaces.
//
// Replaces the never-wired DI container that used to live in src/shared/di
// (registerServices()/container.resolve() had zero production callers — every
// hook new'd its own concrete class). Rather than maintain that illusion,
// hooks call these factories, so implementation choice (and the SMART-vs-
// local-bundle switch) is single-sourced without container ceremony.

// NOTE: keep this module's import graph FHIR-only. The chat-session composition
// lives in composition.chat.ts so that consumers of clinical data (calculator,
// reports, tests) don't transitively pull in the side-effectful Firebase
// initialization.
import type { IClinicalDataRepository } from '@/src/core/interfaces/repositories/clinical-data.repository.interface'
import { FhirClinicalDataRepository } from '@/src/infrastructure/fhir/repositories/clinical-data.repository'
import { LocalBundleRepository } from '@/src/infrastructure/fhir/repositories/local-bundle.repository'
import { shouldUseLocalBundle } from '@/src/infrastructure/fhir/client/fhir-client.service'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'

/**
 * Clinical-data source for the loaded patient.
 * SMART > local bundle: an active SMART context always wins, even when a
 * previously imported bundle is still sitting in localStorage. Resolved fresh
 * on every call — the mode can flip mid-session (import / clear / SMART
 * launch), so the choice must never be cached.
 */
export async function getClinicalDataRepository(): Promise<IClinicalDataRepository> {
  return shouldUseLocalBundle()
    ? await LocalBundleRepository.create()
    : new FhirClinicalDataRepository()
}

/**
 * The original Bundle.id of the imported bundle, as the source wrote it (not
 * the app's own import id), or null when no bundle is imported. The 雲端病歷
 * extension pairs its same-run raw capture with this id.
 */
export async function getImportedBundleId(): Promise<string | null> {
  try {
    const bundle = await LocalBundleService.load() as { id?: unknown } | null
    return typeof bundle?.id === 'string' ? bundle.id : null
  } catch {
    return null
  }
}
