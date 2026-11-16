'use client'

import { useLanguage } from '@/src/application/providers/language.provider'
import { cn } from '@/src/shared/utils/cn.utils'
import type { RightPanelTabState } from '@/src/shared/config/right-panel-tab-state'
import { useMedicationSafetyTab, type MedicationSafetyTab } from './useMedicationSafetyTab'

/** The 安全 tab as the right panel shows it: absent away from the hospital,
 *  greyed when the service cannot be reached, otherwise the count. */
export function useMedicationSafetyTabState(): RightPanelTabState {
  const { locale } = useLanguage()
  const tab = useMedicationSafetyTab()
  if (!tab.visible) return { hidden: true }
  return {
    dimmed: tab.unreachable,
    status: safetyTabStatus(tab, locale === 'en'),
    suffix: tab.count === null ? undefined : <SafetyTabCount tab={tab} />,
  }
}

/** e.g. 「需注意 3 項，另有 1 項未檢核」. */
function safetyTabStatus(tab: MedicationSafetyTab, en: boolean): string {
  if (tab.unreachable) return en ? 'not checked: hospital service unreachable' : '未檢核：連不上院內服務'
  if (tab.count === null) return en ? 'checking' : '檢核中'
  const main = en ? `${tab.count} to review` : `需注意 ${tab.count} 項`
  const rest = tab.unchecked ? (en ? `, ${tab.unchecked} not checked` : `，另有 ${tab.unchecked} 項未檢核`) : ''
  return main + rest
}

/** 0 means nothing to open; the dot means some drugs were not checked, so 0
 *  does not mean "all clear". */
function SafetyTabCount({ tab }: { tab: MedicationSafetyTab }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5">
      <span
        className={cn(
          'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[0.6875rem] font-semibold leading-none tabular-nums',
          tab.avoid > 0
            ? 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100'
            : 'bg-muted text-muted-foreground',
        )}
      >
        {tab.count}
      </span>
      {tab.unchecked > 0 && <span className="h-1 w-1 rounded-full bg-muted-foreground" />}
    </span>
  )
}
