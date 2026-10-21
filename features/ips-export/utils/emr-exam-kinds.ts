// 帶回病歷 — "the latest echo" and "the latest ECG" for a copy format.
//
// Each kind is found on its own: an ECG from today and an echo from half a year
// ago are BOTH the latest of their kind. (The built-in 「最近一次」 range keeps
// the latest exam DAY instead, and is unchanged.)
//
// Recognition is deliberately narrow. An explicit NHI order code wins; a title
// pattern is the fallback. The narrative is never read to decide the kind — a
// CXR report that mentions "ECG leads" is not an ECG. Holter, exercise tests
// and TEE are different examinations and never count as a plain ECG / echo.

import { reportSource } from '@/src/shared/utils/shared-report-grouping'
import { inferReportDisplayGroup } from '@/src/shared/utils/report-grouping-helpers'
import type { EmrExamKind } from '@/src/application/stores/outpatient-prefs.store'
import {
  emrNarrativeKey,
  emrReportDate,
  emrReportTitle,
  toEmrReportItem,
  type EmrReportItem,
} from './emr-plaintext'

interface ExamKindRule {
  codes: string[]
  title: RegExp
  exclude: RegExp
}

const EXAM_KIND_RULES: Record<EmrExamKind, ExamKindRule> = {
  echo: {
    // 18005C 超音波心臟圖, 18007C 杜卜勒氏彩色心臟血流圖 — the two separately
    // billed parts of one transthoracic echo.
    codes: ['18005C', '18007C'],
    title: /心臟超音波|超音波心臟圖|心臟血流圖|echocardiogra|\bTTE\b/i,
    exclude: /transesophageal|經食道|\bTEE\b|stress|負荷|壓力|dobutamine|胎兒|fetal/i,
  },
  ecg: {
    // 18001C 心電圖.
    codes: ['18001C'],
    title: /心電圖|\bECG\b|\bEKG\b|electrocardiogra/i,
    exclude: /holter|24\s*(?:小時|hr|hour)|動態|運動|exercise|treadmill|stress|負荷|壓力|signal[- ]?averaged/i,
  },
}

const INVALID_STATUSES = new Set(['entered-in-error', 'cancelled'])
const UNFINISHED_STATUSES = new Set(['registered', 'partial', 'preliminary'])

export function classifyExamKind(dr: any): EmrExamKind | null {
  const group = inferReportDisplayGroup(dr)
  if (group === 'lab' || group === 'vitals') return null
  const source = reportSource(dr)
  const title = emrReportTitle(dr) || source.title
  const codeUpper = source.codes.map((code) => code.trim().toUpperCase())
  for (const kind of Object.keys(EXAM_KIND_RULES) as EmrExamKind[]) {
    const rule = EXAM_KIND_RULES[kind]
    if (rule.exclude.test(title)) continue
    if (codeUpper.some((code) => rule.codes.includes(code))) return kind
    if (rule.title.test(title)) return kind
  }
  return null
}

export interface EmrExamResolution {
  kind: EmrExamKind
  /** Newest report of this kind that has text to paste. Several when one day
   *  holds more than one DIFFERENT narrative of this kind (identical 2D +
   *  Doppler text is one). */
  latest: EmrReportItem[]
  /** A report of this kind NEWER than `latest` that has no text — image-only
   *  or viewer-only. The paste must not silently fall back to the older text. */
  newerWithoutText?: { date: string; title: string }
  /** Source status of the latest report when it is not final. */
  unfinishedStatus?: string
}

export function resolveLatestExams(diagnosticReports: any[]): Record<EmrExamKind, EmrExamResolution> {
  const buckets: Record<EmrExamKind, { withText: EmrReportItem[]; statuses: Map<string, string>; withoutText: Array<{ date: string; title: string }> }> = {
    echo: { withText: [], statuses: new Map(), withoutText: [] },
    ecg: { withText: [], statuses: new Map(), withoutText: [] },
  }

  for (const dr of diagnosticReports || []) {
    const status = typeof dr?.status === 'string' ? dr.status.trim().toLowerCase() : ''
    if (INVALID_STATUSES.has(status)) continue
    const kind = classifyExamKind(dr)
    if (!kind) continue
    const item = toEmrReportItem(dr)
    if (item) {
      buckets[kind].withText.push(item)
      if (status) buckets[kind].statuses.set(item.id, status)
      continue
    }
    const date = emrReportDate(dr)
    if (date) buckets[kind].withoutText.push({ date, title: emrReportTitle(dr) })
  }

  const out = {} as Record<EmrExamKind, EmrExamResolution>
  for (const kind of Object.keys(buckets) as EmrExamKind[]) {
    const bucket = buckets[kind]
    const newestDay = bucket.withText.reduce((max, item) => (item.date > max ? item.date : max), '')
    const seen = new Set<string>()
    const latest = bucket.withText
      .filter((item) => item.date === newestDay)
      .filter((item) => {
        const key = emrNarrativeKey(item)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    const newer = bucket.withoutText
      .filter((entry) => entry.date > newestDay)
      .sort((a, b) => b.date.localeCompare(a.date))[0]
    const unfinished = latest
      .map((item) => bucket.statuses.get(item.id))
      .find((status) => status && UNFINISHED_STATUSES.has(status))
    out[kind] = {
      kind,
      latest,
      ...(newer ? { newerWithoutText: newer } : {}),
      ...(unfinished ? { unfinishedStatus: unfinished } : {}),
    }
  }
  return out
}
