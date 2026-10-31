'use client'

// 上次門診 opens on the clinician's own last visit with the patient when the
// visit physician matches this name. The same picker is in the tab itself.

import { Label } from '@/components/ui/label'
import { useLanguage } from '@/src/application/providers/language.provider'
import { ClinicianNamePicker } from '@/features/clinical-summary/last-outpatient'

export function ClinicianNameSetting() {
  const { t } = useLanguage()
  return (
    <div className="space-y-3">
      <Label className="text-xs uppercase text-muted-foreground">
        {t.settings.clinicianNameSection}
      </Label>
      <ClinicianNamePicker idPrefix="clinician-name" />
    </div>
  )
}
