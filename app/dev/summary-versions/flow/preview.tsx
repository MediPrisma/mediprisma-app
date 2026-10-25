'use client'

import { AppProviders } from '@/src/application/providers/app-providers'
import { AiDemographicsGateProvider } from '@/src/application/providers/ai-demographics-gate.provider'
import { RightDetailProvider } from '@/src/application/providers/right-detail.provider'
import { ImportBundleButton } from '@/features/import-bundle/ImportBundleButton'
import MedicalSummaryFeature from '@/features/medical-summary/Feature'

/** Real import and generation components; only the launch URL is injected.
 * E2E fixtures provide synthetic FHIR and intercept external auth/AI traffic. */
export default function Flow() {
  return <AppProviders launchHref="https://mediprisma.tw/app/?medcloud2=auto">
    <AiDemographicsGateProvider><RightDetailProvider>
      <ImportBundleButton />
      <MedicalSummaryFeature />
    </RightDetailProvider></AiDemographicsGateProvider>
  </AppProviders>
}
