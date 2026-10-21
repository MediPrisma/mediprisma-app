import type { Metadata } from "next"
import LabReportsClient from "./client"

// Developer-only inbox for 回報檢驗資料問題. Reached from the notice mail's
// link; not linked from the clinical workspace. Firestore rules — not this
// page — decide who can read the reports.
export const metadata: Metadata = {
  title: "檢驗資料問題回報 · MediPrisma",
  robots: { index: false, follow: false },
}

export default function Page() {
  return <LabReportsClient />
}
