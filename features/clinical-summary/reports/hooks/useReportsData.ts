// Custom Hook: Reports Data Processing
import { useMemo } from 'react'
import { getVghtpeSource } from '../adapters/vghtpe-source-display'
import { getReportInstitution as getDrInstitution } from '@/src/shared/utils/report-institution'
import { compareImagingCopies, imagingCopyInstitution, reportDisplayGroupingKeys } from '@/src/shared/utils/report-copy-grouping'
import type { DiagnosticReport, ImagingStudy, Observation, Row, ReportImage, NhiViewerAction } from '../types'
import { getCodeableConceptText, getConceptText } from '../utils/fhir-helpers'
import { inferReportDisplayGroup } from '../utils/grouping-helpers'
import {
  getAnalyteLabel,
  getAnalyteCanonicalKey,
  CANONICAL_DISPLAY,
} from '@voho0000/clinical-lab-normalization/canonical'
import {
  getAnalyteDisplayLabel,
  getOriginalAnalyteDisplayForObs,
  type AnalyteNameMode,
} from '@voho0000/clinical-lab-normalization/display'
import {
  compareTestsByPreferred,
  CANONICAL_TO_CATEGORY,
  type LabCategory,
} from '@/src/shared/utils/lab-categories'
import { getOrderNameDisplay, NHI_ORDER_CODE_TO_ZH, NHI_ORDER_CODE_TO_EN } from '@/src/shared/utils/nhi-order-names'
import { getAnalyteDisplayForMode } from '@/src/shared/utils/lab-analyte-display.utils'
import { decodeBase64Utf8 } from '@/src/shared/utils/base64.utils'
import { useAudience } from '@/src/application/providers/audience.provider'
import { useLanguage } from '@/src/application/providers/language.provider'
import type { Locale } from '@/src/shared/i18n/i18n.config'
import { referenceId } from '@/src/core/utils/observation-selectors'
import {
  formatImagingStudyMetadata,
  imagingStudyInstitution,
  imagingStudyTitle,
} from '@/src/shared/utils/imaging-study.utils'
import {
  getNhiViewerActions,
  isTrustedLegacyNhiViewerAttachment,
} from '../utils/nhi-viewer-request'
import {
  isAdultPreventiveHealthExamResource,
  isNhiMedicloudObservation,
} from '@/src/shared/utils/observation-provenance.utils'
import {
  qualifyingSharedEchoFamilyKeys,
  reportSource,
  sharedEchoReportFamilyKey,
  sharedReportNarrative,
  sharedReportTitle,
  type SharedReportSource,
} from '@/src/shared/utils/shared-report-grouping'

function isViewerOnlySharedEchoCompanion(report: any): boolean {
  return getNhiViewerActions(report).length > 0
    && sharedReportNarrative(report).length === 0
    && (report?.result?.length ?? 0) === 0
    && (report?._observations?.length ?? 0) === 0
    && (report?.presentedForm?.length ?? 0) === 0
    && (report?.imagingStudy?.length ?? 0) === 0
}

function derivePerDrTitle(dr: DiagnosticReport): string {
  const text = (getCodeableConceptText(dr.code) || '').trim()
  if (text && text !== '—') return text
  // Fallback for DRs with no human-readable code.text — surface the raw
  // coding entry instead of "Unnamed Report" so downstream renderers
  // still get an identifying label.
  const orderCode = (dr.code as any)?.coding?.[0]?.code as string | undefined
  if (orderCode) return orderCode.replace(/_/g, ' ')
  return text || 'Unnamed Report'
}

function deriveGroupTitle(text: string): string {
  return text || 'Unnamed Report'
}

// Lab DRs carry performer on the linked Observations (bridge convention);
// imaging DRs typically have no linked Observations and put performer on the
// DiagnosticReport itself. Fall through both before giving up.
function isNhiMedicloudReport(dr: any): boolean {
  const observations = Array.isArray(dr?._observations) ? dr._observations : []
  return observations.length > 0 && observations.every(isNhiMedicloudObservation)
}

// Single source of truth for a report's date: prefer effectiveDateTime (the
// exam/collection date — 檢查日期) over issued (the report-release date —
// 報告發布日), which can differ by days. Every date use below (grouping key,
// synthetic summary obs, row display) routes through this so the preference
// can't drift apart again — a past bug had the row header alone preferring
// issued, so a report grouped under 6/2 was displayed as 6/5.
function getDrDate(dr: any): string | undefined {
  return dr?.effectiveDateTime || dr?.effectivePeriod?.start || dr?.issued
}

function isAdultPreventiveReport(dr: DiagnosticReport): boolean {
  return isAdultPreventiveHealthExamResource(dr)
    || ((dr as any)._observations ?? []).some(isAdultPreventiveHealthExamResource)
}

function viewerActionIdentity(action: NhiViewerAction): string {
  if (action.kind === 'legacy') return `legacy|${action.url}`
  const descriptor = action.descriptor
  return [
    'live',
    descriptor.version,
    descriptor.procId,
    descriptor.patientContextHash,
    descriptor.iplCaseSeqNo,
    descriptor.readPos,
    descriptor.ordMark,
    descriptor.fileType,
    descriptor.fileQty,
    descriptor.feeYm,
  ].join('|')
}

/**
 * Shared DiagnosticReport -> Row projection used by both the Reports page and
 * encounter details. Keep grouping, narrative/image merging, and source ids in
 * this pure builder so every ReportRow consumer receives the same model.
 */
export function buildReportsData(
  diagnosticReports: any[],
  imagingStudies: any[] = [],
  nameMode: AnalyteNameMode = 'standardized',
  audience: 'medical' | 'patient' = 'medical',
  locale: Locale = 'en',
) {
    const rows: Row[] = []
    const seen = new Set() as Set<string>
    const studyById = new Map<string, ImagingStudy>()
    for (const study of imagingStudies as ImagingStudy[]) {
      if (study?.id) studyById.set(study.id, study)
    }
    const linkedStudyIds = new Set<string>()

    // Group DRs sharing (code.text, calendar date, institution) so bridge-
    // emitted multi-DR bundles (each antibiotic = one DR) collapse into one
    // accordion row. Unique-title DRs end up as single-member groups —
    // identical behaviour to per-DR processing.
    //
    // NARROW exception: multi-region CT only. NHI bills every body part
    // imaged on the same CT machine under one health-record code
    // (33xxx 電腦斷層造影 …) with NO body-part field, so a head+chest+abd
    // CT shows up as several distinct DRs sharing the group key. The
    // downstream MultiRegionStudyCard renders these as individually
    // numbered ① ② ③ sub-cards with bridge's ambiguity warning, so the
    // user can't mistake the cluster for a single report.
    //
    // We DO NOT generalise this to "any imaging modality" because other
    // bridge channels (X-ray, US, ECG) often emit duplicate-content DRs
    // for the same single exam; the panel merge above intentionally hides
    // those duplicates (bridge bug surface vs. clinical noise tradeoff —
    // see memory/feedback_no_masking_bridge_bugs.md). For CT, by contrast,
    // multiple DRs per (code, date, hospital) are almost always genuinely
    // separate studies; surfacing them as one merged row glues unrelated
    // narratives into an unreadable blob.
    const isCtCode = (code: any): boolean => {
      const text = (code?.text || code?.coding?.[0]?.display || '').toLowerCase()
      if (text.includes('電腦斷層') || text.includes('computed tomography')) return true
      return /\bct\b/.test(text)
    }
    // Pull a DR's narrative text. Bridge stores imaging reports primarily
    // on dr.conclusion (free text); some channels also use dr.note[].text
    // or attach a synthetic valueString observation via _observations.
    // Concatenate all available sources so the distinct-narrative check
    // catches dups regardless of which field bridge populated this time.
    const getDrNarrative = (dr: any): string => {
      const parts: string[] = []
      if (typeof dr?.conclusion === 'string' && dr.conclusion.trim()) {
        parts.push(dr.conclusion)
      }
      if (Array.isArray(dr?.note)) {
        for (const n of dr.note) {
          if (typeof n?.text === 'string' && n.text.trim()) parts.push(n.text)
        }
      }
      const obs = Array.isArray((dr as any)._observations) ? (dr as any)._observations : []
      for (const o of obs) {
        if (typeof o?.valueString === 'string' && o.valueString.trim().length > 30) {
          parts.push(o.valueString)
        }
      }
      return parts.join('\n').trim()
    }
    // Normalise narrative text for dup detection. Mirrors the bridge team's
    // planned v0.17.2+ strategy (NFKC + strip whitespace + lowercase) so the
    // app's dedup behaviour stays consistent with bridge's once their fix
    // lands. NFKC folds full-width punctuation into half-width ("S／P" →
    // "S/P"), and stripping whitespace catches the dictation system's
    // erratic spacing ("aortaReticular" vs "aorta Reticular"). Lowercase
    // catches the rare casing slip.
    const normaliseNarrative = (s: string): string =>
      (s || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/\s+/g, '')
    // Strict-prefix dup test (bridge's "Option 1"): two narratives are
    // considered duplicates only when one's normalised form is an EXACT
    // PREFIX of the other's. Provably safe — if the shorter narrative is a
    // prefix of the longer one, the longer one carries every clinical
    // finding of the shorter PLUS more, so dropping the shorter loses no
    // information. Two genuinely distinct reports (head vs chest CT) can't
    // be a prefix of each other once their findings diverge, so this rule
    // never merges different studies. The plain set-based equality check
    // we used before couldn't tell a truncated upload (item 14 cut mid-
    // sentence) apart from a fully-distinct study; this can.
    const isPrefixOf = (a: string, b: string): boolean =>
      a.length <= b.length && b.startsWith(a)
    const hasDistinctNarratives = (grp: DiagnosticReport[]): boolean => {
      const norms = grp
        .map(getDrNarrative)
        .filter((t): t is string => t.length > 0)
        .map(normaliseNarrative)
      if (norms.length < 2) return false
      // Sort longest → shortest; every shorter narrative must be a prefix of
      // the longest for the group to qualify as a single (deduped) report.
      norms.sort((a, b) => b.length - a.length)
      const longest = norms[0]
      return norms.slice(1).some((n) => !isPrefixOf(n, longest))
    }
    const groups = new Map<string, DiagnosticReport[]>()
    const groupOrder: string[] = []
    const sharedReportKeys = new Set<string>()
    const sharedReportSourcesByKey = new Map<string, SharedReportSource[]>()
    // Rendering may deduplicate or merge several DiagnosticReports into one
    // row. Keep every original id (including ids of dropped duplicate copies)
    // so a medical-summary citation can still navigate to the rendered row.
    const diagnosticReportIdsByKey = new Map<string, string[]>()
    // Report-text dedup is display-only. Viewer capabilities belong to their
    // original DiagnosticReports and must survive even when identical/prefix
    // narratives collapse into one row. Never dedup these by report content or
    // ImagingStudy UID.
    const viewerReportsByKey = new Map<string, DiagnosticReport[]>()
    let splitGroupIndex = 0
    const pushAsOwnGroup = (dr: DiagnosticReport) => {
      // Suffix with DR id so each split group gets a distinct key — keeps
      // the map insertion order stable and avoids accidental re-merging.
      const text = (getCodeableConceptText(dr.code) || '').trim()
      const date = (getDrDate(dr) || '').slice(0, 10)
      const inst = (getDrInstitution(dr) || '').trim()
      const sourceProgram = isAdultPreventiveReport(dr) ? 'adult-preventive' : ''
      const sourceProvenance = isNhiMedicloudReport(dr) ? 'nhi-medicloud' : ''
      const key = `${text}|${date}|${inst}|${sourceProgram}|${sourceProvenance}|${dr.id || `split-${splitGroupIndex++}`}`
      groups.set(key, [dr])
      diagnosticReportIdsByKey.set(key, dr.id ? [dr.id] : [])
      viewerReportsByKey.set(key, [dr])
      groupOrder.push(key)
    }

    // Pass 1: build the natural grouping (as before).
    const naturalGroups = new Map<string, DiagnosticReport[]>()
    const naturalOrder: string[] = []
    const displayGroupingKeys = reportDisplayGroupingKeys(diagnosticReports)
    const sharedEchoFamilyOwners = qualifyingSharedEchoFamilyKeys(diagnosticReports)
    ;(diagnosticReports as DiagnosticReport[]).forEach((dr) => {
      if (!dr) return
      const text = (getCodeableConceptText(dr.code) || '').trim()
      const date = (getDrDate(dr) || '').slice(0, 10)
      const inst = (getDrInstitution(dr) || '').trim()
      const sourceProgram = isAdultPreventiveReport(dr) ? 'adult-preventive' : ''
      const sourceProvenance = isNhiMedicloudReport(dr) ? 'nhi-medicloud' : ''
      const ownSharedKey = displayGroupingKeys.get(dr)
      const echoFamilyKey = sharedEchoReportFamilyKey(dr)
      const companionSharedKey = !ownSharedKey
        && echoFamilyKey
        && isViewerOnlySharedEchoCompanion(dr)
        ? sharedEchoFamilyOwners.get(echoFamilyKey)
        : null
      const key = ownSharedKey || companionSharedKey
        ? `shared-report|${ownSharedKey || companionSharedKey}`
        : `${text}|${date}|${inst}|${sourceProgram}|${sourceProvenance}`
      if (!naturalGroups.has(key)) {
        naturalGroups.set(key, [])
        naturalOrder.push(key)
      }
      naturalGroups.get(key)!.push(dr)
    })

    // Pre-merge narrative dedup (bridge "Option 1"): inside a single group,
    // collapse DRs whose normalised narratives are strict-prefix duplicates
    // (typically two channels of the same report — one truncated mid-
    // sentence, one complete). Keep the LONGEST in each equivalence class
    // so we never lose clinical text. Image-only DRs pass through. Returns
    // both the deduped list and the count of dropped duplicates, which is
    // attached to the resulting row so the UI can surface "bridge sent N
    // duplicates" without silently hiding the bug (per the no-mask-bridge-
    // bugs rule).
    const dedupGroupByNarrative = (
      grp: DiagnosticReport[],
    ): { drs: DiagnosticReport[]; dupCount: number } => {
      const withNarr: { dr: DiagnosticReport; norm: string }[] = []
      const imageOnly: DiagnosticReport[] = []
      for (const dr of grp) {
        const text = getDrNarrative(dr)
        if (!text) {
          imageOnly.push(dr)
          continue
        }
        withNarr.push({ dr, norm: normaliseNarrative(text) })
      }
      // Sort longest-first so the kept member is always the most complete
      // narrative. A shorter member is dropped iff its normalised form is a
      // prefix of one already kept.
      withNarr.sort((a, b) => b.norm.length - a.norm.length)
      const kept: { dr: DiagnosticReport; norm: string }[] = []
      let dupCount = 0
      for (const item of withNarr) {
        if (kept.some((k) => isPrefixOf(item.norm, k.norm))) {
          dupCount++
        } else {
          kept.push(item)
        }
      }
      return { drs: [...kept.map((x) => x.dr), ...imageOnly], dupCount }
    }
    // dupCount per emitted group key so the row builder below can attach
    // it to the resulting Row.
    const dupCountByKey = new Map<string, number>()

    // Pass 2: split CT multi-DR groups only when narratives are GENUINELY
    // distinct (head vs chest, not "head vs head-with-extra-whitespace").
    // When narratives are bridge duplicates, fall through to the regular
    // merge path and let dedupGroupByNarrative collapse them so the user
    // doesn't see the same Brain CT report twice in a fake "multi-region"
    // group card.
    for (const key of naturalOrder) {
      const grp = naturalGroups.get(key)!
      if (key.startsWith('shared-report|')) {
        // Viewer-only 18005C/18007C companions join this bucket so their
        // actions and source ids survive, but they do not become duplicate
        // written-report sources or empty clinical-content members.
        const sharedNarrativeKey = key.slice('shared-report|'.length)
        const isCrossSource = sharedNarrativeKey.startsWith('cross-source|')
        const contentReports = grp.filter(report => displayGroupingKeys.get(report) === sharedNarrativeKey)
        // Keep the richer original report as the display representative.
        if (isCrossSource) contentReports.sort(compareImagingCopies)
        groups.set(key, contentReports.length > 0 ? contentReports : grp)
        viewerReportsByKey.set(key, grp)
        diagnosticReportIdsByKey.set(
          key,
          grp.flatMap((report) => report.id ? [report.id] : []),
        )
        sharedReportKeys.add(key)
        sharedReportSourcesByKey.set(
          key,
          (contentReports.length > 0 ? contentReports : grp).map(report => ({
            ...reportSource(report),
            ...(isCrossSource ? { narrative: sharedReportNarrative(report) } : {}),
          })),
        )
        groupOrder.push(key)
        continue
      }
      const shouldSplit =
        grp.length > 1 && isCtCode(grp[0].code) && hasDistinctNarratives(grp)
      if (shouldSplit) {
        grp.forEach(pushAsOwnGroup)
      } else {
        const { drs: deduped, dupCount } = dedupGroupByNarrative(grp)
        groups.set(key, deduped)
        viewerReportsByKey.set(key, grp)
        diagnosticReportIdsByKey.set(
          key,
          grp.flatMap((report) => report.id ? [report.id] : []),
        )
        groupOrder.push(key)
        if (dupCount > 0) dupCountByKey.set(key, dupCount)
      }
    }

    // (Previously: obsInMultiGroup suppression removed 2026-05-29.) Bridge
    // sometimes references the same Observation in BOTH a multi-obs panel
    // (e.g. "尿生化檢查" with 7 obs) AND a standalone single-obs DR — this
    // is a bridge bug (duplicate cross-reference). We previously suppressed
    // the standalone duplicate; that masked the bug. Now we let both
    // appear so the user sees the bridge-side double-reference and can
    // file/track a fix. See memory/feedback_no_masking_bridge_bugs.md.

    for (const key of groupOrder) {
      const grp = groups.get(key)!
      const head = grp[0]
      const isSharedReport = sharedReportKeys.has(key)
      const sharedReportSources = sharedReportSourcesByKey.get(key)
      const isMulti = grp.length > 1
      const linkedStudies: ImagingStudy[] = []
      const rowStudyIds = new Set<string>()
      for (const dr of grp) {
        for (const ref of dr.imagingStudy ?? []) {
          const id = referenceId(ref.reference)
          if (!id || rowStudyIds.has(id)) continue
          rowStudyIds.add(id)
          linkedStudyIds.add(id)
          const study = studyById.get(id)
          if (study) linkedStudies.push(study)
        }
      }
      // Computed once for the whole group; reused by the synthetic summary obs
      // and the row's display date below (both keyed off head, the group's
      // first DR — all members share this date since it's part of the key).
      const rawDate = getDrDate(head) || linkedStudies[0]?.started

      const groupText = (getCodeableConceptText(head.code) || '').trim()
        || (linkedStudies[0] ? imagingStudyTitle(linkedStudies[0]) : '')
      const summaryParts: string[] = []
      const attachments: string[] = []
      const images: ReportImage[] = []
      const viewerReports = viewerReportsByKey.get(key) ?? grp
      const viewerEntries = viewerReports.flatMap((report) => (
        getNhiViewerActions(report).map((action) => ({ action, report }))
      ))
      // Exact duplicate extensions are always the same request and are safe to
      // collapse. This catches bridge retries even when no ImagingStudy link
      // was supplied.
      const seenViewerActions = new Set<string>()
      const uniqueViewerEntries = viewerEntries.filter((entry) => {
        const actionKey = viewerActionIdentity(entry.action)
        if (seenViewerActions.has(actionKey)) return false
        seenViewerActions.add(actionKey)
        return true
      })

      // A strict-prefix narrative duplicate can still carry a different
      // viewer request descriptor on each copied DiagnosticReport. When every
      // viewer-bearing copy explicitly references the SAME ImagingStudy, those
      // requests lead to one study and only one action belongs in the UI.
      // Never apply this rule without that stable FHIR identity: same-day CTs
      // can represent genuinely different body regions.
      const sharedViewerStudyIds = uniqueViewerEntries.map(({ report }) => {
        const ids = [...new Set((report.imagingStudy ?? [])
          .map((reference) => referenceId(reference.reference))
          .filter((id): id is string => !!id))]
        return ids.length === 1 ? ids[0] : null
      })
      const hasOneSharedViewerStudy = sharedViewerStudyIds.length > 1
        && sharedViewerStudyIds.every((id) => id !== null && id === sharedViewerStudyIds[0])
      const viewerActions: NhiViewerAction[] = (
        (dupCountByKey.get(key) ?? 0) > 0 && hasOneSharedViewerStudy
          ? uniqueViewerEntries.slice(0, 1)
          : uniqueViewerEntries
      ).map(({ action }) => action)
      const allObs: Observation[] = []

      for (const dr of grp) {
        // Exact shared-report groups retain every source identity, image, and
        // viewer action, while presenting narrative/observations from one
        // representative. The grouping key proved those full narratives equal.
        const includeClinicalContent = !isSharedReport || dr === head
        const obs = Array.isArray((dr as any)._observations)
          ? (dr as any)._observations.filter((o: any): o is Observation => !!o)
          : []
        // Every linked source Observation remains owned by a report even when
        // its duplicate narrative is represented once. Mark all ids as seen so
        // the orphan pipeline cannot reintroduce a second copy below the row.
        obs.forEach((o: Observation) => {
          if (o?.id) seen.add(o.id)
        })

        // In a multi-DR group, relabel each obs with its parent DR's specific
        // test name so the accordion children are distinguishable — but only
        // when the DR's own title differs from the group title. When all DRs
        // share the same name (e.g. same panel split across multiple DRs), the
        // individual observation names are already the right labels. We clone
        // the obs (don't mutate the upstream resource).
        const drTitle = derivePerDrTitle(dr)
        const perTitle = (!isSharedReport && isMulti && drTitle !== groupText) ? drTitle : null
        for (const o of obs) {
          const isNarrativeOnlyObservation = (
            typeof o?.valueString === 'string'
            && o.valueString.trim().length > 30
            && o.valueQuantity == null
            && o.valueCodeableConcept == null
            && (!Array.isArray(o.component) || o.component.length === 0)
          )
          // The exact full narrative is already represented by the head. Keep
          // every structured result from the remaining source procedures so a
          // shared conclusion can never hide a different numeric/coded result.
          if (!includeClinicalContent && isNarrativeOnlyObservation) continue
          if (perTitle) {
            allObs.push({
              ...o,
              code: { ...(o.code || {}), text: perTitle },
            } as Observation)
          } else {
            allObs.push(o)
          }
        }

        const conclusionText = dr.conclusion?.trim()
        const conclusionCodes = getConceptText(dr.conclusionCode)
        const notes = Array.isArray(dr.note)
          ? dr.note.map((n: any) => n?.text).filter(Boolean) as string[]
          : []
        // Push the report's conclusion verbatim — do NOT prepend a synthetic
        // "Conclusion:" label. The bridge text already carries its own heading
        // ("心電圖:", "Radiography ... Show:") and an app-added prefix showed up
        // as a redundant first line on every report. A report that genuinely
        // begins with "Conclusion:" keeps it, since we use the raw text.
        if (includeClinicalContent && conclusionText) summaryParts.push(conclusionText)
        if (includeClinicalContent && conclusionCodes && conclusionCodes !== '—') summaryParts.push(`Conclusion Codes: ${conclusionCodes}`)
        if (includeClinicalContent && notes.length > 0) summaryParts.push(notes.join('\n'))

        if (Array.isArray(dr.presentedForm)) {
          for (const form of dr.presentedForm) {
            // NHI's Viewer URL is an access capability, not report content. Keep it
            // solely as a validated, user-activated browser link; never decode,
            // fetch, proxy, or fold it into narrative/attachment text.
            if (isTrustedLegacyNhiViewerAttachment(form)) {
              continue
            }
            // Image (bridge v0.14.0+): hand it to the lazy viewer instead of
            // listing it as a text attachment. Decoding/rendering happens on
            // demand in the dialog. Two sources:
            //  - `_imageRef`: bytes live off-heap in IndexedDB (local-bundle
            //    import path); the viewer fetches the Blob by this key.
            //  - `data`: raw base64 inline (SMART live path).
            if (form?._imageRef) {
              images.push({
                ref: form._imageRef,
                contentType: form.contentType || 'image/jpeg',
                title: form.title,
                size: form.size,
              })
              continue
            }
            if (form?.data && (form.contentType || '').startsWith('image/')) {
              images.push({
                data: form.data,
                contentType: form.contentType || 'image/jpeg',
                title: form.title,
                size: form.size,
              })
              continue
            }
            // Inline TEXT report as base64 (e.g. Roche DIP pathology / radiology
            // notes ship the full report body as base64 text/plain in
            // presentedForm, NOT in conclusion). Decode it into the narrative so
            // it's readable + AI-interpretable, instead of dropping the body and
            // keeping only the title. (HTML attachments are handled by the
            // document renderer, not here — skip them to avoid raw markup.)
            const ct = (form?.contentType || '').toLowerCase()
            if (includeClinicalContent && form?.data && ct.startsWith('text/') && !ct.includes('html')) {
              const decoded = decodeBase64Utf8(form.data).trim()
              if (decoded) {
                summaryParts.push(decoded)
                continue
              }
            }
            const t = form?.title || form?.contentType
            if (t) attachments.push(t)
          }
        }
      }

      // ImagingStudy is study metadata, not a diagnostic conclusion. Append it
      // as a clearly labelled UI summary so metadata-only studies remain
      // visible without fabricating report narrative or fetching DICOM bytes.
      for (const study of linkedStudies) {
        const heading = locale === 'zh-TW' ? 'ImagingStudy 檢查資料' : 'ImagingStudy metadata'
        summaryParts.push(`${heading}\n${formatImagingStudyMetadata(study, locale)}`)
      }

      // A server may return only the DiagnosticReport reference while denying
      // or not supporting an ImagingStudy search. Preserve that provenance in
      // the row instead of silently dropping an otherwise metadata-only report.
      if (linkedStudies.length === 0 && rowStudyIds.size > 0) {
        const refs = [...rowStudyIds].join(', ')
        summaryParts.push(
          locale === 'zh-TW'
            ? `ImagingStudy 參照: ${refs}（目前未取得該資源內容）`
            : `ImagingStudy reference: ${refs} (resource content unavailable)`,
        )
      }

      // NOTE: Do NOT add UI dedup here even when bridge double-emits the same
      // measurement (e.g. 長庚嘉義 emitting both '鈉' + 'Na' for one source
      // row — see bridge report 2026-05-29). Masking it on the app side
      // would hide the bridge bug from the user and from future audits.
      // See memory/feedback_no_masking_bridge_bugs.md for the standing rule.

      // Sort obs by the dominant category's preferredOrder so panel rows
      // render in clinical reading order (e.g. urinalysis panel: physical →
      // chemistry → microscopy → ratio; CBC: counts → differential →
      // indices) instead of whatever arbitrary order bridge emits.
      // Single-obs DRs short-circuit (nothing to sort). Mixed-category DRs
      // (rare) fall back to alphabetical ordering inside compareTestsByPreferred.
      //
      // We resolve each obs's canonical analyte key via getAnalyteLabel (the
      // same path the row label uses) and look the category up from
      // CANONICAL_TO_CATEGORY. categorizeObservation is intentionally NOT used
      // here — its allowlist is English short codes + LOINC only, so bridges
      // that send Chinese display text with NHI codes ("白血球計數" / NHI
      // 08002C, no LOINC) would categorise as null and skip the sort even
      // though the rows still render as canonical WBC/RBC/… via the Chinese
      // aliases in TEST_ALIASES.
      // Use the raw UPPERCASE canonical key for the category/sort lookups
      // below — getAnalyteLabel returns the mixed-case DISPLAY form ('HbA1c'),
      // which only matched after the defensive .toUpperCase() on line 156.
      // Non-canonical rows (cultures, free-text) resolve to null → keep the
      // medical label so they still sort/compare sensibly.
      const labels: string[] = allObs.length > 1
        ? allObs.map(o => getAnalyteCanonicalKey(o as any) ?? getAnalyteLabel(o as any))
        : []
      if (allObs.length > 1) {
        const catCounts: Record<string, number> = {}
        const catMap: Record<string, LabCategory> = {}
        for (const label of labels) {
          const cat = CANONICAL_TO_CATEGORY.get(label.trim().toUpperCase())
          if (cat) {
            catCounts[cat.id] = (catCounts[cat.id] || 0) + 1
            catMap[cat.id] = cat
          }
        }
        const dominantId = Object.entries(catCounts)
          .sort((a, b) => b[1] - a[1])[0]?.[0]
        const dominantCat = dominantId ? catMap[dominantId] : null
        if (dominantCat) {
          const cmp = compareTestsByPreferred(dominantCat)
          const indexed = allObs.map((o, i) => ({ o, label: labels[i] }))
          indexed.sort((a, b) => cmp(a.label, b.label))
          allObs.length = 0
          for (const { o } of indexed) allObs.push(o)
        }
      }

      const summaryComponents: any[] = []
      if (attachments.length > 0) {
        summaryComponents.push({
          code: { text: 'Attachments' },
          valueString: attachments.join(', '),
        })
      }

      const obsWithSummary: Observation[] = [...allObs]
      // Create a synthetic "Report Summary" obs when the DR contributes
      // report-level content with no linked observations: conclusion text,
      // non-image attachments, OR inline images. The image-only case (X-ray /
      // ECG with empty conclusion) still needs a row to host the title + image
      // indicator, so we create the summary obs with empty valueString — the
      // image button on the header carries the affordance, ReportRow renders no
      // empty expandable when there's no text.
      if (summaryParts.length > 0 || attachments.length > 0 || images.length > 0 || viewerActions.length > 0) {
        const summaryValue = summaryParts.join('\n\n')
        const summaryObservation: Observation = {
          resourceType: 'Observation',
          id: head.id ? `dr-summary-${head.id}` : `dr-summary-${groupOrder.indexOf(key) + 1}`,
          code: { text: 'Report Summary' },
          valueString: summaryValue || (attachments.length > 0 ? 'Supporting documents available' : ''),
          effectiveDateTime: rawDate,
          status: head.status,
          component: summaryComponents,
        }
        obsWithSummary.unshift(summaryObservation)
      } else if (allObs.length === 0) {
        // Some NHI DiagnosticReports are index-only records: the source gives
        // an order name/date/facility but no Observation, conclusion, note,
        // attachment, image, or ImagingStudy content. These records are still
        // citable in Medical Summary, so dropping them here leaves no DOM row
        // for source navigation. Render an explicit metadata-only row instead
        // of inventing report findings or silently falling back to the list.
        obsWithSummary.unshift({
          resourceType: 'Observation',
          id: head.id ? `dr-metadata-${head.id}` : `dr-metadata-${groupOrder.indexOf(key) + 1}`,
          code: { text: 'Report Metadata' },
          valueString: locale === 'zh-TW'
            ? '來源未提供報告內文或結果'
            : 'The source did not provide report text or results',
          effectiveDateTime: rawDate,
          status: head.status,
        })
      }

      // Canonical DR title selection:
      //   1. Single-obs DR — use the obs's canonical analyte label. Bridge
      //      occasionally assigns wrong DR codes (e.g. "Uric Acid" title for
      //      a urine pH observation), and the obs's own code is more reliable.
      //   2. Multi-obs DR where ALL observations canonicalise to the same
      //      analyte — use that canonical label. This catches bridge's
      //      double-emission cases (long庚嘉義 sending 鈉 + Na for one source
      //      Na row, see bridge report 2026-05-29) without masking the bug
      //      itself: the duplicate observation rows and "N 項" counter still
      //      render below, so clinicians still see the bridge issue.
      //   3. Multi-analyte panel — keep bridge's panel name (e.g. "CBC",
      //      "白血球分類計數") because the analytes inside vary.
      const obsForTitle = summaryParts.length === 0 ? allObs : []
      const originalNames = obsForTitle
        .map((o) => getOriginalAnalyteDisplayForObs(o as any).trim())
        .filter((name) => name && name !== '—')
      const originalNameSet = new Set(originalNames)
      const sharedOriginalTitle = originalNameSet.size === 1
        ? [...originalNameSet][0]
        : null
      // Dedup on canonical key so audience switching doesn't change which
      // groups collapse to a shared-analyte title. Only the rendered string
      // varies by audience — sort and grouping logic stay canonical.
      const canonicalSet = new Set(
        obsForTitle.map((o) => getAnalyteLabel(o as any).trim()).filter(Boolean)
      )
      const sharedCanonical = canonicalSet.size === 1
        ? [...canonicalSet][0]
        : null
      // getAnalyteLabel returns the mixed-case DISPLAY form (HbA1c, IgG, …) for
      // analytes that carry a CANONICAL_DISPLAY override, and those strings are
      // NOT members of CANONICAL_KEYS (which holds the uppercase keys HBA1C /
      // IGG). Resolve the raw uppercase KEY separately so the audience/language
      // lay-name path fires for them too (HbA1c → 糖化血色素 (HbA1c)). Returns
      // null for non-canonical obs, which keep the getAnalyteLabel fallback.
      // Resolve the shared canonical KEY only when EVERY observation in the
      // group canonicalises to the *same* analyte. An earlier version built a
      // Set and dropped null keys (.filter(Boolean)) BEFORE the size check —
      // so a multi-analyte panel where only ONE analyte is recognised
      // collapsed to a single-key set and mistitled the whole panel. Real bug:
      // urinalysis 06012C carries 18 items but only "Urine Protein" maps to
      // PROT (the other 17 LOINCs aren't in LOINC_TO_CANONICAL → null), so the
      // panel rendered as "PROT" for the medical/English audience. Requiring
      // every obs to resolve to the same non-null key preserves the
      // double-emission case (長庚嘉義 鈉+Na → NA) while letting genuine panels
      // fall through to the order-code panel title. (sharedCanonical above is
      // already null for these — getAnalyteLabel returns 18 distinct fallback
      // strings — so only this sharedKey path was leaking the wrong title.)
      const keys = obsForTitle.map((o) => getAnalyteCanonicalKey(o as any))
      const sharedKey =
        keys.length > 0 && keys.every((k) => k != null && k === keys[0])
          ? keys[0]
          : null
      const sharedCanonicalTitle = sharedKey
        ? getAnalyteDisplayLabel(sharedKey, audience, locale)
        : sharedCanonical
      const standardizedNames = obsForTitle.map((observation) =>
        getAnalyteDisplayForMode(observation, audience, locale, 'standardized'),
      )
      const sharedStandardizedTitle = standardizedNames.length > 0
        && standardizedNames.every((name) => name === standardizedNames[0] && name !== '—')
        ? standardizedNames[0]
        : null
      // Multi-analyte panels / cultures / serology / imaging have no shared
      // canonical analyte, so their title falls back to the bridge's Chinese
      // NHI 醫令名 (groupText). For these, swap in a curated English name keyed
      // by the stable order code when audience=medical or the UI is English.
      // DISPLAY ONLY — grouping/dedup above still key off the Chinese groupText.
      const orderCode = (head.code as any)?.coding?.[0]?.code as string | undefined
      const panelTitle = getOrderNameDisplay(orderCode, groupText, audience, locale)
      // Patient + zh-TW: retain official NHI order names for panels without
      // a shared analyte label. Single-analyte rows use the common display
      // contract below, matching their cumulative and expanded result names.
      const officialZh = (audience === 'patient' && locale === 'zh-TW' && orderCode)
        ? NHI_ORDER_CODE_TO_ZH[orderCode]
        : undefined
      let displayTitle: string
      if (nameMode === 'original') {
        // A single-analyte row should expose exactly what the source called
        // the observation. Multi-analyte panels retain the source report title
        // while their children reveal each original analyte name.
        displayTitle = sharedOriginalTitle || groupText || derivePerDrTitle(head)
      } else if (sharedStandardizedTitle) {
        // A single analyte uses the same label as cumulative headers and its
        // expanded results, including patient-language labels. Order names
        // remain the fallback for multi-analyte panels.
        displayTitle = sharedStandardizedTitle
      } else if (officialZh) {
        // Prefer the analyte-level canonical short code (AST, NA, …). Serology /
        // immunology orders (ANA, IgG, AMA …) often don't resolve to a canonical
        // analyte because the bridge sends bare Chinese order text with no LOINC,
        // so fall back to the abbreviation baked into the curated order-code
        // English name, e.g. 12056B → "Anti-mitochondrial antibody (AMA)" → AMA.
        let abbr = sharedKey
          ? (CANONICAL_DISPLAY[sharedKey] || sharedKey)
          : null
        if (!abbr && orderCode) {
          const en = NHI_ORDER_CODE_TO_EN[orderCode]
          const m = en ? en.match(/\(([^()]+)\)\s*$/) : null
          if (m) abbr = m[1]
        }
        const canAppend = !!abbr
          && !officialZh.includes('(') && !officialZh.includes('（')
          && !officialZh.includes(abbr)
        displayTitle = canAppend ? `${officialZh} (${abbr})` : officialZh
      } else {
        displayTitle = (sharedCanonicalTitle && sharedCanonicalTitle !== groupText)
          ? sharedCanonicalTitle
          : panelTitle
      }
      if (sharedReportSources) {
        displayTitle = sharedReportTitle(sharedReportSources, locale, audience) ?? displayTitle
      }

      const categoryText = Array.isArray(head.category)
        ? head.category.map((c: any) => getCodeableConceptText(c)).filter(Boolean).join(', ')
        : getCodeableConceptText(head.category)
      // The feature helper renders a missing CodeableConcept as an em dash for
      // table cells. Here absence is meaningful because it activates the
      // explicit "inferred imaging" / "unclassified" provenance label.
      const category = categoryText === '—' ? '' : categoryText
      const institution = (key.startsWith('shared-report|cross-source|') ? imagingCopyInstitution(head) : undefined)
        || getDrInstitution(head)
        || (linkedStudies[0] ? imagingStudyInstitution(linkedStudies[0]) : undefined)
      const isLinkedImagingStudy = rowStudyIds.size > 0
      const reportGroup = inferReportDisplayGroup(head)
      const sourceProvenance = reportGroup === 'lab' && grp.every(isNhiMedicloudReport)
        ? 'nhi-medicloud' as const
        : undefined
      const inferredImagingLabel = locale === 'zh-TW'
        ? '影像（依檢查名稱／代碼辨識）'
        : 'Imaging (inferred from test name/code)'
      const inferredPathologyLabel = locale === 'zh-TW'
        ? '病理（依檢查名稱／代碼辨識）'
        : 'Pathology (inferred from test name/code)'

      rows.push({
        id: head.id || `report-${groupOrder.indexOf(key) + 1}`,
        title: deriveGroupTitle(displayTitle),
        // Raw bridge title (pre-display-enhancement) for history lookups —
        // useReportHistory matches this exactly against DiagnosticReport.code.text,
        // which `title` (e.g. "心電圖 (ECG)") no longer equals once an abbreviation
        // or translation is appended. Falls back to displayTitle when groupText is
        // empty so the lookup key is never blank.
        rawTitle: groupText || deriveGroupTitle(displayTitle),
        // An SDK r8 report has no source category. Do not silently call every
        // uncategorised report "Laboratory"; that turns source absence into a
        // clinical assertion. Linked ImagingStudy remains explicit.
        meta: `${category || (isLinkedImagingStudy
          ? 'ImagingStudy'
          : reportGroup === 'pathology'
            ? inferredPathologyLabel
            : reportGroup === 'imaging'
              ? inferredImagingLabel
              : (locale === 'zh-TW' ? '未分類' : 'Unclassified'))} • ${head.status || linkedStudies[0]?.status || '—'}`,
        obs: obsWithSummary,
        group: reportGroup,
        institution,
        hospitalSource: getVghtpeSource([...grp, ...allObs]),
        sourceProgram: grp.some(isAdultPreventiveReport)
          ? 'adult-preventive'
          : undefined,
        sourceProvenance,
        effectiveDate: rawDate,
        images: images.length > 0 ? images : undefined,
        viewerActions: viewerActions.length > 0 ? viewerActions : undefined,
        // Bridge sent extra DRs we collapsed via strict-prefix dedup —
        // surface the count so the row can show a small badge. 0 → row
        // omits the field entirely.
        bridgeDupCount: dupCountByKey.get(key),
        imagingStudyIds: rowStudyIds.size > 0 ? [...rowStudyIds] : undefined,
        diagnosticReportIds: diagnosticReportIdsByKey.get(key),
        sharedReportSources,
      })
    }

    // Standalone ImagingStudy resources have no DiagnosticReport to host them.
    // Render them directly in the Imaging tab using a synthetic display-only
    // Observation so the existing accessible accordion/text renderer can be
    // reused without changing the source FHIR semantics.
    for (const [index, study] of (imagingStudies as ImagingStudy[]).entries()) {
      if (!study || (study.id && linkedStudyIds.has(study.id))) continue
      const title = imagingStudyTitle(study)
      const metadata = formatImagingStudyMetadata(study, locale)
      const heading = locale === 'zh-TW' ? 'ImagingStudy 檢查資料' : 'ImagingStudy metadata'
      const rowId = study.id || `imaging-study-${index + 1}`
      rows.push({
        id: rowId,
        title,
        rawTitle: title,
        meta: `ImagingStudy • ${study.status || '—'}`,
        obs: [{
          resourceType: 'Observation',
          id: `imaging-study-summary-${rowId}`,
          code: { text: 'Report Summary' },
          valueString: `${heading}\n${metadata}`,
          effectiveDateTime: study.started,
          status: study.status,
        }],
        group: 'imaging',
        institution: imagingStudyInstitution(study),
        effectiveDate: study.started,
        imagingStudyIds: study.id ? [study.id] : undefined,
      })
    }

    return { reportRows: rows, seenIds: seen }
}

export function useReportsData(
  diagnosticReports: any[],
  imagingStudies: any[] = [],
  nameMode: AnalyteNameMode = 'standardized',
) {
  const { audience } = useAudience()
  const { locale } = useLanguage()
  return useMemo(
    () => buildReportsData(diagnosticReports, imagingStudies, nameMode, audience, locale),
    [diagnosticReports, imagingStudies, audience, locale, nameMode],
  )
}
