import type { ProgressiveImportRequest } from '../stores/progressive-import.store'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'

/** Check before claiming a pending run; the queued writer must check again. */
export function canClaimProgressiveImportWorkspace(request: ProgressiveImportRequest): boolean {
  return request.stage === 'cloud' ? !LocalBundleService.hasData()
    : LocalBundleService.getActiveImportId() === request.expectedImportId
}
