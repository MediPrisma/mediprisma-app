import { ddiServiceOrigin } from '@/features/clinical-summary/medications/hooks/hospital-service-reach'
import type { RightPanelFeatureConfig } from '@/src/shared/config/right-panel-registry'
import { MEDICATION_SAFETY_FEATURE_ID } from './useMedicationSafetyTab'
import { useMedicationSafetyTabState } from './tab-state'

export const MEDICATION_SAFETY_MODULE = {
  rightPanel: {
    // 安全: the hospital drug-interaction check. Only builds with the service
    // and its check package have it; its tab state further hides it away
    // from the hospital.
    id: MEDICATION_SAFETY_FEATURE_ID,
    name: 'Medication Safety',
    tabLabel: 'medicationSafety',
    order: 5.5,
    enabled: Boolean(ddiServiceOrigin()),
    audiences: ['medical'],
    useTabState: useMedicationSafetyTabState,
  } satisfies RightPanelFeatureConfig,
}
