'use client'

// Where the clinician's outpatient settings — pinned labs, copy formats — are
// kept: on this computer only (not signed in), or in their account — and,
// when the account cannot be reached, that they are waiting here. A visitor
// who is not signed in can sign in from right here.

import { useState } from 'react'
import { Cloud, CloudOff } from 'lucide-react'
import { useAuth } from '@/src/application/providers/auth.provider'
import { useOutpatientPrefsStore } from '@/src/application/stores/outpatient-prefs.store'
import { useLanguage } from '@/src/application/providers/language.provider'
import { cn } from '@/src/shared/utils/cn.utils'
import { AuthDialog } from './AuthDialog'

export function OutpatientPrefsStorageNote({ className }: { className?: string }) {
  const { user } = useAuth()
  const { t } = useLanguage()
  const s = t.outpatientPrefs.storage
  const [authOpen, setAuthOpen] = useState(false)
  const syncStatus = useOutpatientPrefsStore((state) => (user ? state.syncStatus[user.uid] : undefined))

  if (user && syncStatus === 'error') {
    return (
      <p role="status" className={cn('flex items-center gap-1.5 text-xs text-destructive', className)}>
        <CloudOff aria-hidden className="h-3.5 w-3.5 shrink-0" />
        <span>{s.error}</span>
      </p>
    )
  }

  if (user) {
    return (
      <p className={cn('flex items-center gap-1.5 text-xs text-muted-foreground', className)}>
        <Cloud aria-hidden className="h-3.5 w-3.5 shrink-0" />
        <span>{s.account}</span>
      </p>
    )
  }

  return (
    <>
      <p className={cn('flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground', className)}>
        <CloudOff aria-hidden className="h-3.5 w-3.5 shrink-0" />
        <span>{s.local}</span>
        <button type="button" className="-my-1.5 py-1.5 font-medium text-primary hover:underline" onClick={() => setAuthOpen(true)}>
          {s.signIn}
        </button>
      </p>
      <AuthDialog open={authOpen} onOpenChange={setAuthOpen} />
    </>
  )
}
