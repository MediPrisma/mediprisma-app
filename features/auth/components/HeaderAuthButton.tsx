// The header's one menu: account state and usage on top, the less-used
// header controls (passed in as `menuItems`) below. The trigger shows only
// who is using the app — a spinner while the session restores, 登入 / 訪客
// before sign-in, a person icon after.
'use client'

import { useState, useSyncExternalStore, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/src/application/providers/language.provider'
import { useAuth } from '@/src/application/providers/auth.provider'
import { AuthDialog } from './AuthDialog'
import { ChevronDown, LogIn, LogOut, User, Info, Gift, Loader2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

const subscribeToHydration = () => () => undefined
const getClientSnapshot = () => true
const getServerSnapshot = () => false

function MiniUsageRow({ label, used, limit }: { label: string; used: number; limit: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{used} / {limit}</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${Math.min((used / limit) * 100, 100)}%` }}
        />
      </div>
    </div>
  )
}

export interface HeaderAuthButtonProps {
  /** Menu entries below the account section (import, tours, audience …). */
  menuItems?: ReactNode
  /** Overlaid on the trigger, e.g. the unseen-news dot. */
  triggerBadge?: ReactNode
}

export function HeaderAuthButton({ menuItems, triggerBadge }: HeaderAuthButtonProps = {}) {
  const { t } = useLanguage()
  const {
    user,
    isAnonymous,
    loading,
    signOut,
    dailyUsage,
    dailyLimit,
    perplexityUsage,
    whisperUsage,
    perplexityLimit,
    whisperLimit,
  } = useAuth()
  const [showAuthDialog, setShowAuthDialog] = useState(false)
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    getClientSnapshot,
    getServerSnapshot,
  )

  const restoring = !hydrated || loading
  // Anonymous (free-tier) visitor — `user` is null by design.
  const guest = !restoring && !user && isAnonymous
  const signedIn = !restoring && !!user
  const accountName = user?.displayName || user?.email?.split('@')[0] || t.auth.signedInAs
  const label = restoring
    ? t.auth.restoringSession
    : signedIn ? accountName : guest ? t.auth.guest : t.auth.signIn
  const Icon = restoring ? Loader2 : signedIn ? User : guest ? Gift : LogIn
  const usage = (
    <>
      <MiniUsageRow label={t.auth.usageChat} used={dailyUsage} limit={dailyLimit} />
      <MiniUsageRow label={t.auth.usagePerplexity} used={perplexityUsage} limit={perplexityLimit} />
      <MiniUsageRow label={t.auth.usageWhisper} used={whisperUsage} limit={whisperLimit} />
    </>
  )

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            data-tour="header-more"
            className="relative h-9 w-auto gap-1.5 px-2.5 shadow-none hover:shadow-none max-md:h-[44px] max-md:min-w-[44px]"
            aria-label={label}
            title={label}
          >
            <Icon className={`h-4 w-4 ${restoring ? 'animate-spin' : ''}`} aria-hidden="true" />
            {/* A name would only repeat what the menu says; before sign-in
                the word is the invitation, so it stays where there is room. */}
            {!restoring && !signedIn && (
              <span className="max-md:hidden @max-[72rem]:hidden">{label}</span>
            )}
            <ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
            {triggerBadge}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          {signedIn && (
            <>
              <DropdownMenuLabel>
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium">{user?.displayName || t.auth.signedInAs}</p>
                  <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-xs text-muted-foreground flex items-center gap-1 cursor-help w-fit">
                        {t.auth.usageToday}
                        <Info className="h-3 w-3" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      {t.auth.usageTodayTooltip}
                    </TooltipContent>
                  </Tooltip>
                  {usage}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
            </>
          )}
          {guest && (
            <>
              <DropdownMenuLabel>
                <p className="text-sm font-medium">{t.auth.guestFreeTier}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-2">
                  <span className="text-xs text-muted-foreground">{t.auth.usageToday}</span>
                  {usage}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
            </>
          )}
          {!restoring && !signedIn && (
            <>
              <DropdownMenuItem className="min-h-[36px] gap-2 max-md:min-h-[44px]" onSelect={() => setShowAuthDialog(true)}>
                <LogIn className="h-4 w-4" />
                {guest ? t.auth.signInForMore : t.auth.signIn}
              </DropdownMenuItem>
              {menuItems && <DropdownMenuSeparator />}
            </>
          )}
          {menuItems}
          {signedIn && (
            <>
              {menuItems && <DropdownMenuSeparator />}
              <DropdownMenuItem className="min-h-[36px] gap-2 max-md:min-h-[44px]" onSelect={signOut}>
                <LogOut className="h-4 w-4" />
                {t.auth.signOut}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <AuthDialog open={showAuthDialog} onOpenChange={setShowAuthDialog} />
    </>
  )
}
