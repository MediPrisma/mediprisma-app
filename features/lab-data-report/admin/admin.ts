import type { User } from '@/src/application/providers/auth.provider'

/** Same account as firestore.rules isLabDataReportAdmin (= isFeatureRequestAdmin). */
export const LAB_DATA_REPORT_ADMIN_EMAIL = 'voho0000@gmail.com'

export function isLabDataReportAdmin(user: User | null): boolean {
  return user?.emailVerified === true
    && user.email?.toLocaleLowerCase() === LAB_DATA_REPORT_ADMIN_EMAIL
}
