// Display + Connection + Feedback + About settings.
//
// Matches the visual rhythm of the other Settings tabs (AI Preferences,
// Chat Templates, Custom Summary Modules):
//   - Outer container: space-y-6 between major sections
//   - Each section:    space-y-3 (small uppercase Label + content space-y-2)
//   - Default sm buttons, no shrunk h-7 custom sizes
//
// Stays in lock-step with ApiKeyField.tsx so the four tabs feel like one
// surface rather than four different designers.
'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun, ExternalLink, Bug, Lightbulb } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useTheme } from '@/src/application/providers/theme.provider'
import { useFontSize, type FontSize } from '@/src/application/providers/font-size.provider'
import { useLanguage } from '@/src/application/providers/language.provider'
import { useAppVersion } from '@/src/shared/hooks/use-app-version.hook'
import { useFhirContext, isLocalBundleFhirUrl } from '@/src/application/hooks/chat/use-fhir-context.hook'
import { FeedbackDialog } from '@/features/feedback/components/FeedbackDialog'
import { FeatureRequestPoolDialog } from '@/features/feature-request-pool'
import { useBetaFeatures } from '@/src/application/hooks/use-beta-features.hook'
import { isMedcloudLaunchRoute } from '@/src/application/launch/medcloud-launch-route'
import {
  readPilotPackIds,
  writePilotPackIds,
} from '@/features/clinical-decision-support/guideline-packs/pilot-gate'
import { HOST_CARE_PACKS } from '@/features/clinical-decision-support/guideline-packs/registry'

const REPO = 'voho0000/medical-note-smart-on-fhir'

// The unreleased packs this app actually lists. Read from the composition
// root's own switcher list rather than from every pack the package carries, so
// this section can never offer a checkbox for a pathway the switcher would not
// show anyway — and so a newly listed pack is offered here with no second place
// to update.
const PILOT_CANDIDATE_PACKS = HOST_CARE_PACKS.filter((pack) => !pack.enabled)

const FONT_SIZE_OPTIONS: Array<{ value: FontSize; labelKey: string; fallback: string; preview: string }> = [
  { value: 'xs', labelKey: 'fontSizeXSmall', fallback: '特小', preview: 'text-[0.625rem]' },
  { value: 'sm', labelKey: 'fontSizeSmall', fallback: '小', preview: 'text-xs' },
  { value: 'base', labelKey: 'fontSizeNormal', fallback: '標準', preview: 'text-sm' },
  { value: 'lg', labelKey: 'fontSizeLarge', fallback: '大', preview: 'text-base' },
  { value: 'xl', labelKey: 'fontSizeXLarge', fallback: '特大', preview: 'text-lg' },
]

export function DisplaySettings() {
  const { theme, setTheme } = useTheme()
  const { fontSize, setFontSize } = useFontSize()
  const { t, locale } = useLanguage()
  const {
    enabled: betaFeaturesEnabled,
    offered: betaFeaturesOffered,
    syncError: betaFeaturesSyncError,
    setEnabled: setBetaFeaturesEnabled,
  } = useBetaFeatures()
  const version = useAppVersion()
  const { patientId, patientName, fhirServerUrl } = useFhirContext()
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [featureRequestsOpen, setFeatureRequestsOpen] = useState(false)
  // Which route this is and what this browser has stored are both client-only
  // facts, so the section resolves after hydration rather than during the first
  // render, which the server also produces. One state object, one commit.
  const [pilotPacks, setPilotPacks] = useState<{ visible: boolean; ids: readonly string[] }>({
    visible: false,
    ids: [],
  })
  useEffect(() => {
    // The unattended Medcloud hand-off shows no opt-in switches at all.
    if (isMedcloudLaunchRoute()) return
    // Restoring persisted browser state is exactly what this effect is for; it
    // cannot run during render without diverging from the server's HTML.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPilotPacks({ visible: PILOT_CANDIDATE_PACKS.length > 0, ids: readPilotPackIds() })
  }, [])

  const togglePilotPack = (packId: string, on: boolean) => {
    const next = on
      ? [...pilotPacks.ids, packId]
      : pilotPacks.ids.filter((id) => id !== packId)
    writePilotPackIds(next)
    setPilotPacks((previous) => ({ ...previous, ids: readPilotPackIds() }))
  }

  const hasConnectionInfo = !!(fhirServerUrl || patientId)
  const isLocalBundle = isLocalBundleFhirUrl(fhirServerUrl)
  const fhirServerDisplay = isLocalBundle
    ? ((t.connectionInfo as any)?.localBundle ?? '本地匯入 FHIR Bundle')
    : fhirServerUrl

  return (
    <div className="space-y-6">
      {/* Theme */}
      <div className="space-y-3">
        <Label className="text-xs uppercase text-muted-foreground">
          {(t.settings as any).theme ?? '主題'}
        </Label>
        <div className="flex gap-2">
          <Button
            variant={theme === 'light' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTheme('light')}
            className="gap-2"
          >
            <Sun className="h-4 w-4" />
            {(t.settings as any).themeLight ?? '亮色'}
          </Button>
          <Button
            variant={theme === 'dark' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTheme('dark')}
            className="gap-2"
          >
            <Moon className="h-4 w-4" />
            {(t.settings as any).themeDark ?? '暗色'}
          </Button>
        </div>
      </div>

      {/* Font size — scales the whole UI proportionally */}
      <div className="space-y-3">
        <Label className="text-xs uppercase text-muted-foreground">
          {(t.settings as any).fontSize ?? '字體大小'}
        </Label>
        <div className="flex gap-2">
          {FONT_SIZE_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={fontSize === opt.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFontSize(opt.value)}
              // A literal 44px, not `h-11`: the root font-size is 12px here, so the
              // rem utility would render 33px. size="sm" alone is 24px, and these
              // 5 buttons sit in a tight row on phones.
              className="h-[44px] flex-1 gap-1 px-2"
            >
              <span className={opt.preview}>A</span>
              {(t.settings as any)[opt.labelKey] ?? opt.fallback}
            </Button>
          ))}
        </div>
      </div>

      {/* Experimental clinical tools are opt-in, and opting in is all it takes:
          no account required (owner decision, 2026-09). Hidden only where no
          question may be asked at all — the unattended Medcloud hand-off. */}
      {betaFeaturesOffered ? (
        <div className="space-y-3">
          <Label className="text-xs uppercase text-muted-foreground">
            {t.settings.betaFeatures}
          </Label>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <Label htmlFor="beta-features-enabled" className="text-sm font-medium">
                {t.settings.enableBetaFeatures}
              </Label>
              <p id="beta-features-description" className="text-xs leading-relaxed text-muted-foreground">
                {t.settings.betaFeaturesDescription}
              </p>
              {betaFeaturesSyncError ? (
                <p role="status" className="text-xs leading-relaxed text-destructive">
                  {t.settings.betaFeaturesSyncError}
                </p>
              ) : null}
            </div>
            <Switch
              id="beta-features-enabled"
              checked={betaFeaturesEnabled}
              onCheckedChange={setBetaFeaturesEnabled}
              aria-describedby="beta-features-description"
              className="mt-0.5"
            />
          </div>
        </div>
      ) : null}

      {/* Pilot modules — a host-side gate over packs the care package ships
          disabled, so a tester can be shown one without a package release.
          Also reachable as `?pilotPacks=<id>,<id>`; this is the same store.

          Hidden once Beta features are on, because Beta already shows every
          unreleased pack: leaving per-pack checkboxes standing there would be
          controls that cannot change what the tester sees. */}
      {pilotPacks.visible && !betaFeaturesEnabled && PILOT_CANDIDATE_PACKS.length > 0 ? (
        <div className="space-y-3" data-testid="pilot-packs-settings">
          <Label className="text-xs uppercase text-muted-foreground">
            {t.settings.pilotPacks}
          </Label>
          <p id="pilot-packs-description" className="text-xs leading-relaxed text-muted-foreground">
            {t.settings.pilotPacksDescription}
          </p>
          <div className="space-y-2">
            {PILOT_CANDIDATE_PACKS.map((pack) => {
              const inputId = `pilot-pack-${pack.id}`
              return (
                <div key={pack.id} className="flex items-center gap-2">
                  <Checkbox
                    id={inputId}
                    checked={pilotPacks.ids.includes(pack.id)}
                    onCheckedChange={(checked) => togglePilotPack(pack.id, checked === true)}
                    aria-describedby="pilot-packs-description"
                  />
                  <Label htmlFor={inputId} className="text-sm font-normal">
                    {pack.label[locale === 'en' ? 'en' : 'zh']}
                  </Label>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      {/* Connection info — only shown when bundle / SMART context is loaded */}
      {hasConnectionInfo && (
        <div className="space-y-3">
          <Label className="text-xs uppercase text-muted-foreground">
            {t.connectionInfo?.title ?? '連線資訊'}
          </Label>
          <div className="space-y-2 text-xs">
            {fhirServerUrl && (
              <div>
                <div className="text-muted-foreground">{t.connectionInfo?.fhirServer ?? 'FHIR 伺服器'}</div>
                <div className="mt-0.5 break-all">{fhirServerDisplay}</div>
              </div>
            )}
            {patientId && (
              <div>
                <div className="text-muted-foreground">{t.connectionInfo?.patientId ?? '患者 ID'}</div>
                <div className="mt-0.5 font-mono break-all">{patientId}</div>
              </div>
            )}
            {patientName && (
              <div>
                <div className="text-muted-foreground">{t.connectionInfo?.patientName ?? '患者姓名'}</div>
                <div className="mt-0.5">{patientName}</div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <Label className="text-xs uppercase text-muted-foreground">
          {t.feedback?.title ?? '問題回報'}
        </Label>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setFeedbackOpen(true)} className="gap-2">
            <Bug className="h-4 w-4" />
            {(t.settings as any).openFeedback ?? '開啟回報表單'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setFeatureRequestsOpen(true)} className="gap-2">
            <Lightbulb className="h-4 w-4" />
            {t.featureRequests.openPool}
          </Button>
        </div>
      </div>

      {/* About */}
      <div className="space-y-3">
        <Label className="text-xs uppercase text-muted-foreground">
          {(t.settings as any).about ?? '關於'}
        </Label>
        <div className="space-y-2">
          {version && (
            <div className="text-xs text-muted-foreground">
              MediPrisma <span className="font-mono">v{version}</span>
            </div>
          )}
          {/* Just two links — "所有版本" already lists the current release
              at the top, so a separate "本版更新內容" button was redundant.
              "隱私政策" jumps to the markdown file on GitHub (rendered
              there) so we don't have to keep the in-app /privacy route
              in sync — single source of truth in the repo. */}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild className="gap-2">
              <a
                href={`https://github.com/${REPO}/releases`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {(t.settings as any).allReleases ?? '所有版本'}
                <ExternalLink className="h-3 w-3" />
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild className="gap-2">
              <a
                href={`https://github.com/${REPO}/blob/master/PRIVACY_POLICY.md`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {(t.settings as any).privacyPolicy ?? '隱私政策'}
                <ExternalLink className="h-3 w-3" />
              </a>
            </Button>
          </div>
        </div>
      </div>

      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
      <FeatureRequestPoolDialog open={featureRequestsOpen} onOpenChange={setFeatureRequestsOpen} />
    </div>
  )
}
