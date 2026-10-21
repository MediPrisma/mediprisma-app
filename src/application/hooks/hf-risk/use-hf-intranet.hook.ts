'use client'

import { useEffect, useState } from 'react'
import { detectHfIntranet } from '@/src/infrastructure/hf-risk/intranet-discovery'

/** Read-only discovery through the service's existing network authorization. */
export function useHfIntranet(hospitalSite: boolean): boolean {
  const origin = process.env.NEXT_PUBLIC_HF_GATEWAY_ORIGIN ?? ''
  const policy = process.env.NEXT_PUBLIC_HF_AUTH_POLICY
  const [network, setNetwork] = useState<{ origin: string; allowed: boolean } | null>(null)
  useEffect(() => {
    if (hospitalSite || !origin || policy !== 'intranet') return
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    let active = true
    void detectHfIntranet(origin, controller.signal).then(allowed => {
      if (active) setNetwork({ origin, allowed })
    }).finally(() => clearTimeout(timeout))
    return () => { active = false; controller.abort(); clearTimeout(timeout) }
  }, [hospitalSite, origin, policy])
  const intranet = policy === 'intranet' && network?.origin === origin && network.allowed
  return Boolean(intranet)
}
