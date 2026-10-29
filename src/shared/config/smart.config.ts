export const SMART_CONFIG = {
  trustedIssuerOrigins: [
    'https://launch.smarthealthit.org',
    // MediPrisma School: de-identified, approved training patients, read-only (MediPrisma/opd-agent-school docs/SCHOOL.md).
    'https://school.mediprisma.tw',
    'http://localhost',
    'http://127.0.0.1',
  ],
  demoLaunchSearch:
    '?iss=https%3A%2F%2Flaunch.smarthealthit.org%2Fv%2Fr4%2Ffhir&launch=WzAsIjJjZGE1YWFkLWU0MDktNDA3MC05YTE1LWUxYzM1YzQ2ZWQ1YSIsIjFlMzhiNzcxLWVhODctNDM0My1hNWE4LTYwMDIyMzc0Y2JhYSIsIlByYWN0aXRpb25lci81MjkxOTA5OS02YTdhLTQ0MmMtYjBkNS0yYjAyYzBkZDRiNzQiLDAsMCwwLCIiLCIiLCIiLCIiLCIiLCIiLCIiLDAsMSwiIl0',
} as const
