import { formatOrganizationDisplay } from '@/src/shared/utils/organization-display'
import { vghtpeSourceDisplay, type HospitalSource, type InstitutionDisplay } from '../adapters/vghtpe-source-display'

/** Register hospital-specific presentation here; the default remains generic. */
export function sourceInstitutionDisplay(
  institution: string | undefined,
  source: HospitalSource | undefined,
  locale: string,
): InstitutionDisplay {
  const name = formatOrganizationDisplay(institution ?? '', locale)
  return vghtpeSourceDisplay(name, source, locale) ?? { name, suffix: '', label: name }
}

export function formatSourceInstitution(institution: string | undefined, source: HospitalSource | undefined, locale: string): string {
  return sourceInstitutionDisplay(institution, source, locale).label
}
