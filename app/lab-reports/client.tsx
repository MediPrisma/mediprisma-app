"use client"

import dynamic from "next/dynamic"
import { AppProviders } from "@/src/application/providers/app-providers"

// Browser-only: everything on this page depends on the signed-in account,
// which the server cannot know — rendering it there only produces a
// hydration mismatch.
const LabReportsAdminPage = dynamic(
  () => import("@/features/lab-data-report/admin/LabReportsAdminPage").then((module) => module.LabReportsAdminPage),
  { ssr: false },
)

export default function LabReportsClient() {
  return (
    <AppProviders>
      <LabReportsAdminPage />
    </AppProviders>
  )
}
