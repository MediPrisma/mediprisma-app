import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'FHIR authorization', referrer: 'no-referrer', robots: { index: false, follow: false } }
export default function FhirAuthorizationLayout({ children }: { children: React.ReactNode }) { return children }
