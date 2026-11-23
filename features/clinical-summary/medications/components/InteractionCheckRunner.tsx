'use client'

import { useEffect, useMemo } from 'react'
import { useAudience } from '@/src/application/providers/audience.provider'
import { useLanguage } from '@/src/application/providers/language.provider'
import { useMedications } from '../hooks/useMedications'
import { useMedicationRows } from '../hooks/useMedicationRows'
import { useInteractionCheckStore, useRunInteractionCheck } from '../hooks/useInteractionCheck'
import { partitionMedicationRecords } from '../utils/remaining-supply'

/**
 * Runs the hospital interaction check once per patient medication list,
 * whichever panel is open, and publishes it for every place that shows it.
 * Renders nothing. Builds without the service skip the list work entirely.
 */
export function InteractionCheckRunner() {
  if (!process.env.NEXT_PUBLIC_DDI_SERVICE_ORIGIN) return null
  return <ConfiguredInteractionCheckRunner />
}

function ConfiguredInteractionCheckRunner() {
  const { audience } = useAudience()
  const { locale } = useLanguage()
  const { medications, isLoading } = useMedications()
  // The same current list the 用藥 tab shows: prescriptions, not the NHI
  // remaining-supply records.
  const { prescriptions } = useMemo(() => partitionMedicationRecords(medications), [medications])
  const rows = useMedicationRows(prescriptions, audience, locale)
  const { state, retry } = useRunInteractionCheck(rows, { enabled: audience === 'medical', ready: !isLoading })
  const publish = useInteractionCheckStore(s => s.publish)

  useEffect(() => { publish({ state, rows, retry }) }, [publish, retry, rows, state])
  return null
}
