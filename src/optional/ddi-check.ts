// Public fallback for clones without private package access: the names and
// types of @mediprisma/vghtpe-ddi-check 0.1.0, so the app compiles. The
// interaction check is off in such a build (DDI_CHECK_AVAILABLE is false, and
// next.config refuses a build that sets NEXT_PUBLIC_DDI_SERVICE_ORIGIN without
// the package). Nothing here checks anything: every row comes back unchecked,
// never as "no interaction".

export interface InteractionCheckMedication {
  id: string
  title: string
  status: string
  isInactive: boolean
  encounterReference?: string
  drugKey?: string
  secondaryTitle?: string
  route?: string
  nhiDrugCode?: string
  hospitalNhiCodes?: string[]
  durationDays?: number
  startedOnIso?: string
  dispensedOnIso?: string
  endDateIso?: string
  isChronic?: boolean
  chronicFills?: number
  drugTerminology?: {
    ingredientText?: string
    doseForm?: string
    officialNameEn?: string
    atcCode?: string
  }
  hospitalMedicationName?: {
    status?: 'normalized' | 'unresolved'
    ingredientName?: string
    recordedProductName?: string
    recordedName?: string
  }
}

export interface InteractionCheckItem {
  query: string
  nhiCode?: string
  codes?: string[]
  productName?: boolean
  rowIds: string[]
}

export interface InteractionCheckPlan {
  items: InteractionCheckItem[]
  unnamedRowIds: string[]
  localRowIds: string[]
  endedRowIds: string[]
  coveredUntil: Record<string, string>
}

export type InteractionTier = 'avoid' | 'act' | 'note'
export type InteractionSeverity = 'high' | 'moderate' | 'low' | 'unknown'

export interface InteractionFinding {
  id: string
  tier: InteractionTier
  severity: InteractionSeverity
  rowIdsA: string[]
  rowIdsB: string[]
  action: string
  mechanism: string
  source: string
  samePrescription: boolean
  involvesEnded: boolean
}

export interface InteractionReview {
  findings: InteractionFinding[]
  checkedRowIds: string[]
  uncheckedRowIds: string[]
  localRowIds: string[]
  endedRowIds: string[]
  coveredUntil: Record<string, string>
}

export function isLocalPreparation(_row: InteractionCheckMedication): boolean {
  return false
}

export function stillCoveredUntil(_row: InteractionCheckMedication): string | undefined {
  return undefined
}

export function planInteractionCheck(rows: InteractionCheckMedication[], _nowMs?: number): InteractionCheckPlan {
  return { items: [], unnamedRowIds: rows.filter(row => !row.isInactive).map(row => row.id), localRowIds: [], endedRowIds: [], coveredUntil: {} }
}

export function interactionCheckBody(_plan: InteractionCheckPlan): { medications: { nhiCode?: string; drugName?: string }[] } {
  return { medications: [] }
}

export function interpretInteractionCheck(_plan: InteractionCheckPlan, rows: InteractionCheckMedication[], _response: unknown): InteractionReview {
  return { findings: [], checkedRowIds: [], uncheckedRowIds: rows.map(row => row.id), localRowIds: [], endedRowIds: [], coveredUntil: {} }
}

export function attentionFindings(_review: InteractionReview): InteractionFinding[] {
  return []
}
