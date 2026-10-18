import { formatOrganizationDisplay } from '@/src/shared/utils/organization-display'
import { vghtpeSourceDisplay, type HospitalSource } from '../adapters/vghtpe-source-display'

/** Register hospital-specific presentation here; the default remains generic. */
export function formatSourceInstitution(
  institution: string | undefined,
  source: HospitalSource | undefined,
  locale: string,
): string | undefined {
  if (!institution) return institution
  const name = formatOrganizationDisplay(institution, locale)
  return vghtpeSourceDisplay(name, source, locale) ?? name
}
