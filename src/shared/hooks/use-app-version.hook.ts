// Fetches the deployed app version from /version.json at runtime.
//
// version.json is generated when Next loads its config (next.config.ts →
// scripts/app-version.mjs): the date of the commit being built, as YYYY.M.D.
// It is not committed.
//
// Returns `null` until the fetch resolves, then the version string. Stays
// null forever on fetch error (offline, missing file) — caller should treat
// null as "hide the chip" rather than rendering a broken state.
'use client'

import { useEffect, useState } from 'react'

const VERSION_JSON_PATH = `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/version.json`

interface VersionPayload {
  version: string
}

export function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // `cache: 'no-store'` — version.json is tiny and we want bumps to show
    // up immediately on hard refresh; without this the browser's HTTP cache
    // could serve a stale copy for the lifetime of the cache header.
    fetch(VERSION_JSON_PATH, { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<VersionPayload>) : null))
      .then((payload) => {
        if (!cancelled && payload?.version) setVersion(payload.version)
      })
      .catch(() => {
        // Silent fail — better to hide the version display than render a
        // broken state. Could happen offline, behind a proxy, or before
        // version.json exists.
      })
    return () => {
      cancelled = true
    }
  }, [])

  return version
}
