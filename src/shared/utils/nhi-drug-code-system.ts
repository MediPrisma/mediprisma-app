export const NHI_DRUG_CODE_SYSTEMS = [
  'https://twcore.mohw.gov.tw/CodeSystem/nhi-drug-code',
  'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medication-nhi-tw',
] as const
const systems = new Set<string>(NHI_DRUG_CODE_SYSTEMS)
export function isNhiDrugCodeSystem(system: unknown): boolean {
  return typeof system === 'string' && systems.has(system)
}
