"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { AlertTriangle, FileOutput, Image as ImageIcon, Loader2, RefreshCw, Settings2, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  CARD_BORDER_CLASSES,
  SUBTAB_LIST_CLASSES,
  SUBTAB_TRIGGER_CLASSES,
} from '@/src/shared/config/ui-theme.config'
import { useAudience } from '@/src/application/providers/audience.provider'
import { isExportSubTab, useRightPanel } from '@/src/application/providers/right-panel.provider'
import { useLanguage } from '@/src/application/providers/language.provider'
import { useIpsBundle } from './hooks/useIpsBundle'
import { useIpsExport } from './hooks/useIpsExport'
import { useInferredProblems } from './hooks/useInferredProblems'
import { inferredToCondition } from './utils/inference-engine'
import { buildIpsMarkdown } from './utils/ips-markdown'
import { IpsDataScopePanel } from './components/IpsDataScopePanel'
import { IpsExportPreview } from './components/IpsExportPreview'
import { InferredProblemsReview } from './components/InferredProblemsReview'
import { AiHandoffPanel } from './components/AiHandoffPanel'
import { EmrHandoffPanel } from './components/EmrHandoffPanel'
import { OriginalFhirDownload } from '@/features/import-bundle/components/OriginalFhirDownload'

export default function IpsExportFeature() {
  const { t } = useLanguage()
  const { audience } = useAudience()
  // 帶回病歷 pastes into a hospital chart's SOAP note — there is no such
  // destination in the 民眾 experience, so the tab only exists for clinicians.
  const showEmrTab = audience === 'medical'
  const x = t.ipsExport
  // The open sub-tab lives in the right-panel provider so 總覽's 「帶回病歷」
  // can open 帶回紀錄 itself. 民眾 have no 帶回紀錄 and land on 貼給 AI.
  const { exportTab, setExportTab, activeTab, revealSeq } = useRightPanel()
  const subTab = !showEmrTab && exportTab === 'emr' ? 'ai' : exportTab
  // The three sub-tabs share one scroll position; a reader sent here from
  // elsewhere starts at the top of the sub-tab, not wherever 貼給 AI was left.
  const rootRef = useRef<HTMLDivElement>(null)
  const seenReveal = useRef(revealSeq)
  useEffect(() => {
    if (revealSeq === seenReveal.current) return
    seenReveal.current = revealSeq
    if (activeTab !== 'ips-export') return
    // Next frame: on a phone the panel it sits in is only being shown now.
    const frame = requestAnimationFrame(() => rootRef.current?.scrollIntoView?.({ block: 'start' }))
    return () => cancelAnimationFrame(frame)
  }, [revealSeq, activeTab])
  const [includePatientIdentifiers, setIncludePatientIdentifiers] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const {
    downloadJson,
    downloadMarkdown,
    copyJson,
    copyMarkdown,
    copiedFormat,
    copyError,
    markdownFilename,
  } = useIpsExport({ includePatientIdentifiers })

  // Phase 2.2b — async LLM problem-list inference runs as a side-channel. Only
  // the user-CONFIRMED suggestions are turned into synthetic conditions and
  // merged into the bundle; nothing reaches the export without a checkbox click.
  const inferred = useInferredProblems()
  const confirmedConditions = useMemo(
    () => inferred.confirmed.map(inferredToCondition),
    [inferred.confirmed],
  )

  // 影像附件預設剝除(每張健保存摺影像 2-3 MB);使用者可 opt-in 帶回。
  const [includeImageAttachments, setIncludeImageAttachments] = useState(false)

  const { bundle, curatedData, patient, labels, validation, isLoading, error, refetch, hasPatient, resourceCount } =
    useIpsBundle(confirmedConditions, { includeImageAttachments, includePatientIdentifiers })

  const markdown = useMemo(
    () => (curatedData ? buildIpsMarkdown({
      patient,
      data: curatedData,
      labels,
      includePatientIdentifiers,
    }) : ''),
    [curatedData, patient, labels, includePatientIdentifiers],
  )

  // Loading clinical data
  if (isLoading) {
    return (
      <>
      <OriginalFhirDownload />
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {x.loading}
      </div>
      </>
    )
  }

  // Clinical data failed to load. A transient FHIR/network failure must not
  // strand the whole export behind a message — offer the retry here instead of
  // making the user leave and re-open the tab.
  if (error) {
    return (
      <>
      <OriginalFhirDownload />
      <Card className={`gap-2 py-4 border-destructive ${CARD_BORDER_CLASSES.clinical}`}>
        <CardContent className="text-sm">
          <div className="mb-1 font-medium text-destructive">{x.errorTitle}</div>
          <div className="text-muted-foreground">{error.message}</div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void refetch()}
            className="mt-3 h-7 gap-1 px-2 text-xs"
          >
            <RefreshCw className="h-3 w-3" />
            {t.errors.retry}
          </Button>
        </CardContent>
      </Card>
      </>
    )
  }

  // No patient / no data loaded yet
  if (!hasPatient || !bundle) {
    return (
      <>
      <OriginalFhirDownload />
      <Card className={`gap-2 py-4 ${CARD_BORDER_CLASSES.clinical}`}>
        <CardContent className="py-4 text-center text-sm text-muted-foreground">
          <FileOutput className="mx-auto mb-2 h-6 w-6 opacity-60" />
          {x.noData}
        </CardContent>
      </Card>
      </>
    )
  }

  return (
    <div ref={rootRef} className="mx-auto max-w-5xl space-y-3">
      {/* The right-panel tab already names this page; a visible title here
          only pushed the clinician's content down. */}
      <h1 className="sr-only">{x.hubTitle}</h1>
      <Tabs
        value={subTab}
        onValueChange={(value) => { if (isExportSubTab(value)) setExportTab(value) }}
        className="space-y-3"
      >
        <TabsList data-tour="ips-export-tabs" className={`${SUBTAB_LIST_CLASSES} grid w-full ${showEmrTab ? 'grid-cols-3 sm:max-w-xl' : 'grid-cols-2 sm:max-w-md'}`}>
          {/* Clinicians open this hub to get data back into the chart far more
              often than to hand it to an AI or download a file, so 帶回紀錄
              leads and opens by default (the provider starts there). 民眾
              have no such tab and still land on 貼給 AI. */}
          {showEmrTab && (
            <TabsTrigger value="emr" className={SUBTAB_TRIGGER_CLASSES}>{x.emrTab}</TabsTrigger>
          )}
          <TabsTrigger value="ai" className={SUBTAB_TRIGGER_CLASSES}>{x.aiUseTab}</TabsTrigger>
          <TabsTrigger value="institution" className={SUBTAB_TRIGGER_CLASSES}>{x.institutionTab}</TabsTrigger>
        </TabsList>

        {showEmrTab && (
          <TabsContent value="emr">
            <EmrHandoffPanel />
          </TabsContent>
        )}

        <TabsContent value="ai">
          <AiHandoffPanel />
        </TabsContent>

        <TabsContent value="institution">
          <OriginalFhirDownload />
          <IpsExportPreview
            bundle={bundle}
            markdown={markdown}
            validation={validation}
            copiedFormat={copiedFormat}
            copyError={copyError}
            markdownFilename={markdownFilename}
            resourceCount={resourceCount}
            includeImageAttachments={includeImageAttachments}
            includePatientIdentifiers={includePatientIdentifiers}
            onOpenSettings={() => setSettingsOpen(true)}
            onDownloadJson={() => downloadJson(bundle)}
            onDownloadMarkdown={() => downloadMarkdown(markdown)}
            onCopyJson={() => copyJson(bundle)}
            onCopyMarkdown={() => copyMarkdown(markdown)}
          />
        </TabsContent>
      </Tabs>

      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-3xl">
          <SheetHeader className="border-b bg-muted/20 px-4 py-3 pr-10 sm:px-5">
            <SheetTitle className="flex items-center gap-2 text-base">
              <Settings2 className="h-4 w-4 text-teal-600 dark:text-teal-400" />
              {x.settingsTitle}
            </SheetTitle>
            <SheetDescription className="text-xs leading-relaxed">{x.settingsDescription}</SheetDescription>
          </SheetHeader>

          <ScrollArea className="min-h-0 flex-1 [&_[data-radix-scroll-area-viewport]>div]:!block">
            <div className="space-y-4 p-4 sm:p-5">
              <div className={`rounded-xl border p-3 ${includePatientIdentifiers ? 'border-amber-300 bg-amber-50/70 dark:border-amber-500/30 dark:bg-amber-500/10' : 'bg-card'}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-start gap-2">
                    {includePatientIdentifiers ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" /> : <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-600 dark:text-teal-300" />}
                    <div>
                      <label htmlFor="ips-include-identifiers" className="text-sm font-medium">{x.includeIdentifiers}</label>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {includePatientIdentifiers ? x.identifiersWarning : x.identifiersMasked}
                      </p>
                    </div>
                  </div>
                  <Switch
                    id="ips-include-identifiers"
                    checked={includePatientIdentifiers}
                    onCheckedChange={setIncludePatientIdentifiers}
                    aria-label={x.includeIdentifiers}
                  />
                </div>
              </div>

              <div className="rounded-xl border bg-card p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-start gap-2">
                    <ImageIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div>
                      <label htmlFor="ips-include-images" className="text-sm font-medium">{x.includeImages}</label>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{x.includeImagesDescription}</p>
                    </div>
                  </div>
                  <Switch
                    id="ips-include-images"
                    checked={includeImageAttachments}
                    onCheckedChange={setIncludeImageAttachments}
                    aria-label={x.includeImages}
                  />
                </div>
              </div>

              <div className="border-t pt-4">
                <h3 className="text-sm font-semibold">{x.problemCandidatesTitle}</h3>
                <p className="mb-3 mt-1 text-xs leading-relaxed text-muted-foreground">{x.problemCandidatesDescription}</p>
                <InferredProblemsReview
                  status={inferred.status}
                  problems={inferred.problems}
                  confirmedIds={inferred.confirmedIds}
                  confirmedCount={inferred.confirmedCount}
                  available={inferred.available}
                  error={inferred.error}
                  onRun={inferred.run}
                  onToggle={inferred.toggleConfirm}
                  summaryCount={inferred.summaryProblemCount}
                  onImportEncounterIcds={inferred.importEncounterIcds}
                  onRemoveEncounterIcds={inferred.removeEncounterIcds}
                  onRemoveAiProblems={inferred.removeAiProblems}
                  encounterIcdCount={inferred.encounterIcdCount}
                />
              </div>

              <div className="border-t pt-4">
                <div className="mb-3">
                  <h3 className="text-sm font-semibold">{x.scopeTab}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{x.help}</p>
                </div>
                <IpsDataScopePanel bundle={bundle} curatedData={curatedData} />
              </div>
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </div>
  )
}
