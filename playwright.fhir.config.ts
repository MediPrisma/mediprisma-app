import { defineConfig } from '@playwright/test'
import base from './playwright.config'

// Explicit local integration profile; the independent FHIR API must run. No Gateway.
export default defineConfig({ ...base, testMatch: '**/cdss-fhir-history.spec.ts', workers: 1,
  projects: base.projects?.map(project => ({ ...project, name: 'fhir-local' })),
  use: { ...base.use, baseURL: 'http://localhost:3007', trace: 'off', video: 'off', screenshot: 'off' },
  webServer: { ...base.webServer, command: 'node node_modules/next/dist/bin/next dev -p 3007',
    url: 'http://localhost:3007', reuseExistingServer: false,
    env: { ...(!Array.isArray(base.webServer) ? base.webServer?.env : {}),
      NEXT_PUBLIC_COLLECTOR_ORIGIN: 'http://127.0.0.1:1',
      NEXT_PUBLIC_CDSS_API_ORIGIN: process.env.FHIR_E2E_AUTH_MODE === 'firebase' ? 'http://127.0.0.1:28096'
        : process.env.FHIR_E2E_AUTH_MODE === 'oauth2' ? 'http://127.0.0.1:8098' : 'http://127.0.0.1:28098',
      NEXT_PUBLIC_CDSS_ADMISSION: process.env.FHIR_E2E_AUTH_MODE || 'intranet-pilot',
      ...(process.env.FHIR_E2E_AUTH_MODE === 'firebase' ? { NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'synthetic-fhir-project',
        NEXT_PUBLIC_FIREBASE_API_KEY: 'synthetic-browser-test-key', NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'synthetic-fhir-project.firebaseapp.com' } : {}),
      NEXT_PUBLIC_FHIR_OAUTH_ISSUER: 'http://127.0.0.1:28080/realms/mediprisma-fhir-local',
      NEXT_PUBLIC_FHIR_OAUTH_CLIENT_ID: 'mediprisma-app' } },
})
