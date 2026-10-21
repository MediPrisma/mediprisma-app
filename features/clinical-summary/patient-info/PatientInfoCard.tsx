// Refactored PatientInfoCard Component
//
// A single-row card: clinicians know who the patient is and read the full
// record in the HIS, so identity takes one line and the problem list below
// gets the space. 更多資料 opens the extended demographics under that line.
"use client"

import { useId, useState } from 'react'
import { ChevronDown, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { usePatient } from "@/src/application/hooks/patient/use-patient-query.hook"
import { useLocalPatientProfile } from '@/src/application/hooks/patient/use-local-patient-profile.hook'
import { useLanguage } from "@/src/application/providers/language.provider"
import { FeatureCard } from "@/src/shared/components"
import {
  isValidPatientBirthDate,
  type UserEnteredPatientProfile,
} from '@/src/core/entities/patient.entity'
import { usePatientInfo } from './hooks/usePatientInfo'
import { hasExtendedPatientInfo, PatientInfoDisplay } from './components/PatientInfoDisplay'
import { PatientDemographicsEditorDialog } from './components/PatientDemographicsEditorDialog'

export function PatientInfoCard() {
  const { t } = useLanguage()
  const { patient, loading, error } = usePatient()
  const patientInfo = usePatientInfo(patient)
  const [editorOpen, setEditorOpen] = useState(false)
  const [showMore, setShowMore] = useState(false)
  const detailsId = useId()
  const localProfile = useLocalPatientProfile()
  const {
    available: canEditLocalProfile,
    importId,
    profile,
    saving: savingProfile,
  } = localProfile

  const errorObj = error ? new Error(String(error)) : null
  const hasDetails = !!patientInfo && hasExtendedPatientInfo(patientInfo)
  const initialProfileValues = patientInfo ? {
    name: patientInfo.name === t.patient.unknown
      ? undefined
      : patientInfo.name,
    gender:
      patient?.gender === 'male'
      || patient?.gender === 'female'
      || patient?.gender === 'other'
        ? patient.gender
        : undefined,
    birthDate:
      patient?.birthDate && isValidPatientBirthDate(patient.birthDate)
        ? patient.birthDate
        : undefined,
  } : undefined

  const saveProfile = async (next: UserEnteredPatientProfile | null) => {
    await localProfile.saveProfile(next)
    setEditorOpen(false)
    toast.success(next ? t.patient.profileSaved : t.patient.profileCleared)
  }

  return (
    <FeatureCard 
      title={t.patient.info}
      featureId="patient-info"
      isLoading={loading} 
      error={errorObj}
      isEmpty={!patientInfo}
      emptyMessage={t.errors.fetchPatient}
      inline
      headerAction={hasDetails || canEditLocalProfile ? (
        <>
          {hasDetails && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-primary hover:text-primary"
              aria-expanded={showMore}
              aria-controls={detailsId}
              onClick={() => setShowMore((open) => !open)}
            >
              {showMore ? t.patient.showLess : t.patient.moreDetails}
              <ChevronDown className={showMore ? 'rotate-180' : undefined} />
            </Button>
          )}
          {canEditLocalProfile && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEditorOpen(true)}
              aria-label={profile ? t.patient.editLocalProfile : t.patient.addLocalProfile}
            >
              <Pencil />
              <span className="hidden sm:inline">
                {profile ? t.patient.editLocalProfile : t.patient.addLocalProfile}
              </span>
            </Button>
          )}
        </>
      ) : undefined}
    >
      {patientInfo && (
        <PatientInfoDisplay patientInfo={patientInfo} showMore={showMore} detailsId={detailsId} />
      )}
      {canEditLocalProfile && editorOpen && (
        <PatientDemographicsEditorDialog
          key={`${importId ?? 'local'}:${profile?.updatedAt ?? 'new'}`}
          open
          onOpenChange={setEditorOpen}
          profile={profile}
          initialValues={initialProfileValues}
          saving={savingProfile}
          onSave={saveProfile}
        />
      )}
    </FeatureCard>
  )
}
