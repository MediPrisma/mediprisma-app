// Build-time checks only. This module never changes runtime routing or admission.
export function checkDeploymentEnv(env) {
  const errors = []
  const notes = []
  const profile = env.MEDIPRISMA_DEPLOYMENT_PROFILE || ''
  if (!profile) return { enabled: false, errors, notes }
  if (profile !== 'hospital') {
    errors.push('MEDIPRISMA_DEPLOYMENT_PROFILE must be hospital or unset.')
    return { enabled: true, errors, notes }
  }

  // Values are intentionally never included in diagnostics (including invalid URLs).
  const endpoint = (key, originOnly) => {
    const value = env[key]
    if (!value) return false
    let url
    try { url = new URL(value) } catch {
      errors.push(`${key} must be an absolute HTTPS ${originOnly ? 'origin' : 'endpoint URL'}.`)
      return false
    }
    if (value !== value.trim() || /\s/.test(value) || !/^https:\/\//i.test(value) || value.includes('\\') ||
        url.protocol !== 'https:' || url.username || url.password || value.includes('?') || value.includes('#')) {
      errors.push(`${key} requires HTTPS with no whitespace, credentials, query or fragment.`)
    }
    if (originOnly && url.pathname !== '/') errors.push(`${key} takes an origin only, without an API path.`)
    const host = url.hostname.toLowerCase().replace(/\.$/, '')
    if (host === 'localhost' || host.endsWith('.localhost') || /^127\./.test(host) ||
        /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/.test(host) ||
        ['[::1]', '[::]', '[::ffff:0:0]', '0.0.0.0'].includes(host)) {
      errors.push(`${key} must reach the hospital service from another workstation; loopback/unspecified hosts are not deployment targets.`)
    }
    if (host === 'example.com' || host.endsWith('.example.com') || host === 'example.org' || host.endsWith('.example.org') ||
        host === 'example.net' || host.endsWith('.example.net') || host.endsWith('.invalid') || host.endsWith('.example')) {
      errors.push(`${key} is a documentation placeholder; supply the approved service address.`)
    }
    if (!originOnly && url.pathname === '/') errors.push(`${key} requires the full report receiver path.`)
    if (!originOnly && ['/collector/v1/events', '/cdss/v1/saves'].includes(url.pathname.replace(/\/$/, ''))) {
      errors.push(`${key} must point to the lab-report receiver, not the usage-event or FHIR save route.`)
    }
    return true
  }

  const fhir = env.NEXT_PUBLIC_CDSS_API_ORIGIN || ''
  const admission = env.NEXT_PUBLIC_CDSS_ADMISSION || ''
  if (fhir || admission) {
    if (admission !== 'firebase') errors.push('NEXT_PUBLIC_CDSS_ADMISSION must explicitly be firebase for this hospital profile.')
    if (!fhir) errors.push('NEXT_PUBLIC_CDSS_API_ORIGIN is required when FHIR admission is configured; do not rely on the localhost default.')
  } else {
    notes.push('FHIR is not configured: admission remains unset; this check does not enable storage.')
  }
  endpoint('NEXT_PUBLIC_CDSS_API_ORIGIN', true)
  endpoint('NEXT_PUBLIC_COLLECTOR_ORIGIN', true)
  endpoint('NEXT_PUBLIC_LAB_REPORT_INSTITUTION_URL', false)

  if (!env.NEXT_PUBLIC_COLLECTOR_ORIGIN) {
    notes.push('Collector is not configured for cross-workstation use. The existing runtime still falls back to localhost; blank does not disable it.')
  }
  if (!env.NEXT_PUBLIC_LAB_REPORT_INSTITUTION_URL) notes.push('Institution reports are not configured; the institution will not be contacted.')
  if ((fhir || admission || env.NEXT_PUBLIC_COLLECTOR_ORIGIN || env.NEXT_PUBLIC_LAB_REPORT_INSTITUTION_URL) &&
      !env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim()) {
    errors.push('NEXT_PUBLIC_FIREBASE_PROJECT_ID is required for configured hospital services; confirm the same project on both backends.')
  }
  if (env.NEXT_PUBLIC_FIREBASE_EMULATOR === '1') errors.push('NEXT_PUBLIC_FIREBASE_EMULATOR must not be enabled in the hospital profile.')
  if (env.NEXT_PUBLIC_APPCHECK_DEBUG) errors.push('NEXT_PUBLIC_APPCHECK_DEBUG must be unset in the hospital profile.')

  const serviceKeys = ['NEXT_PUBLIC_CDSS_ADMISSION', 'NEXT_PUBLIC_CDSS_API_ORIGIN',
    'NEXT_PUBLIC_COLLECTOR_ORIGIN', 'NEXT_PUBLIC_LAB_REPORT_INSTITUTION_URL']
  const tokenSets = serviceKeys.map(key => key.split('_').sort().join('_'))
  for (const [key, value] of Object.entries(env)) {
    if (value && key.startsWith('NEXT_PUBLIC_') && !serviceKeys.includes(key)) {
      const tokens = key.split('_')
      const misnamedUrl = (tokens.includes('INSTITUTION') && tokens.includes('REPORT') || tokens.includes('COLLECTOR')) &&
        (tokens.includes('ORIGIN') || tokens.includes('URL'))
      if (misnamedUrl || tokenSets.includes([...tokens].sort().join('_'))) {
        errors.push('Unrecognized public service setting. Use NEXT_PUBLIC_CDSS_ADMISSION, NEXT_PUBLIC_CDSS_API_ORIGIN, NEXT_PUBLIC_COLLECTOR_ORIGIN or NEXT_PUBLIC_LAB_REPORT_INSTITUTION_URL; check spelling and word order.')
      }
    }
    if (value && key.startsWith('NEXT_PUBLIC_') &&
        /(?:^|_)(?:ALLOWED_UIDS|COLLABORATOR_UIDS|TOKEN|PRIVATE_KEY|CLIENT_SECRET|ADMIN_PASSWORD|SERVICE_ACCOUNT)(?:_|$)/.test(key)) {
      // Do not print arbitrary key names either; they are untrusted input.
      errors.push('A private UID allowlist, token or server credential is set in a NEXT_PUBLIC variable. Keep it in the private backend environment.')
      break
    }
  }
  notes.push('FHIR, Collector events and institution reports have separate settings. A shared HTTPS origin is allowed when a verified reverse proxy routes them independently.')
  return { enabled: true, errors, notes }
}
