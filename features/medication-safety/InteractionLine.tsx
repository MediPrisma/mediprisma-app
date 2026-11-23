'use client'

// One line above the 用藥 list: how the interaction check came out, opening
// the right panel's 安全 tab for the detail. Shown wherever that tab exists.
import { ChevronRight } from 'lucide-react'
import { useLanguage } from '@/src/application/providers/language.provider'
import { useRightPanel } from '@/src/application/providers/right-panel.provider'
import { cn } from '@/src/shared/utils/cn.utils'
import { MEDICATION_SAFETY_FEATURE_ID, useMedicationSafetyTab, type MedicationSafetyTab } from './useMedicationSafetyTab'

export function InteractionLine() {
  const tab = useMedicationSafetyTab()
  return tab.visible ? <VisibleInteractionLine tab={tab} /> : null
}

function VisibleInteractionLine({ tab }: { tab: MedicationSafetyTab }) {
  const { locale } = useLanguage()
  const en = locale === 'en'
  const { revealTab } = useRightPanel()

  // Drugs whose ingredient could not be matched are a mapping gap for us to
  // close, not something to pull the clinician's eye to here; the 安全 tab
  // still names them.
  const text = tab.unreachable
    ? (en ? 'Interactions not checked: hospital drug database unreachable' : '交互作用未檢核：連不上院內藥劑資料庫')
    : tab.count === null
      ? (en ? 'Checking interactions…' : '交互作用檢核中…')
      : tab.notRun
        // Nothing was sent, so "none found" would overstate it.
        ? (en ? 'Interactions not checked' : '交互作用未檢核')
      : tab.count > 0
        ? (en
          ? `Interactions: ${tab.count} to review${tab.avoid ? ` (${tab.avoid} avoid)` : ''}`
          : `交互作用：需注意 ${tab.count} 項${tab.avoid ? `（避免併用 ${tab.avoid}）` : ''}`)
        : (en ? `Interactions: none to review` : `交互作用：未發現需注意的組合`)

  return (
    <button
      type="button"
      onClick={() => revealTab(MEDICATION_SAFETY_FEATURE_ID)}
      className={cn(
        'flex w-full items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 text-left text-[max(12px,0.75rem)] hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [@media(pointer:coarse)]:min-h-[44px]',
        tab.avoid > 0 ? 'text-amber-900 dark:text-amber-100' : 'text-muted-foreground',
      )}
    >
      <span className="min-w-0 flex-1 break-words">{text}</span>
      <span className="inline-flex shrink-0 items-center text-primary">
        {en ? 'View' : '查看'}
        <ChevronRight aria-hidden className="h-3.5 w-3.5" />
      </span>
    </button>
  )
}
