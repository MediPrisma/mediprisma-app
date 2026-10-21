'use client'

import { useEffect } from 'react'

export default function FhirAuthorizationCallback() {
  useEffect(() => {
    const url = window.location.href
    window.history.replaceState({}, '', window.location.pathname)
    if (window.opener) window.opener.postMessage({ type: 'mediprisma-fhir-callback', url }, window.location.origin)
  }, [])
  return <main className="p-6"><p>FHIR 授權處理中，請回到原視窗。</p></main>
}
