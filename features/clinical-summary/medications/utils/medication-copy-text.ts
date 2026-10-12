// 複製現在用藥 — the plain text a clinician pastes into their own EMR's
// medication section, from the overview 用藥 card's 複製, in the clinician's
// one format. Pure, so the editor's preview is exactly what 複製 writes.
//
// Rules decided with the owner (2026-10-03, docs/plans/MED-COPY-CURRENT-2026-10-03.md):
//   - "現在用藥" is the overview's 使用中 list: still running, plus what ran out
//     in the last 14 days.
//   - A long-term prescription that ran out still counts — the patient is
//     usually here precisely because it ran out. Whether its line says so
//     ("已用完 N 天") is the format's 剩餘 field, like every other value: the
//     built-ins mark it, and a clinician can switch day counts off. Long-term =
//     慢箋 OR supplied for ≥ 28 days: 雲端病歷 never marks 慢箋 (no source
//     field, 262/262 records checked 2026-10-03), only 健康存摺 does, so the
//     flag alone would drop every cloud patient's ran-out monthly script.
//   - A short course (< 28 days, not 慢箋) that ran out, or anything the
//     source marks `stopped`, is left out by default; the format may list
//     them last instead.
//   - The same ingredient running from two institutions keeps both lines and
//     says so. Merging or picking one is the clinician's call, not ours.
//
// Every value printed is the source's own (or the medication row's display of
// it); nothing is inferred. The one translation offered — 頻次 into Chinese —
// covers only codes it recognises and is all-or-nothing per line, so a line is
// never half-translated.

import { doseUnlessRepeated } from './dose-helpers'
import {
  MED_COPY_FIELD_IDS,
  MED_COPY_FIELD_STYLES,
  type MedCopyBuiltinId,
  type MedCopyField,
  type MedCopyFieldId,
  type MedCopyFormat,
} from '@/src/application/stores/outpatient-prefs.store'

/** What one medication contributes. Mapped from the overview's item so this
 *  module does not depend on the overview hook's shape. */
export interface MedCopySourceItem {
  id: string
  /** The name the list shows (ingredient-led for clinicians). */
  title: string
  /** Product name, present only when it differs from `title`. */
  secondaryTitle?: string
  dose?: string
  frequency?: string
  route?: string
  institution?: string
  /** Prescribed day, YYYY-MM-DD. */
  day?: string
  durationDays?: number
  /** The day the supply runs to, YYYY-MM-DD, from the source's own dates. */
  endDay?: string
  /** Negative once the supply has run out. */
  daysRemaining?: number
  isChronic: boolean
  isInactive: boolean
  /** The overview's 使用中: running, or ran out within the recent tail. */
  isCurrent: boolean
  /** Lower-cased source status. */
  status: string
  category?: string
  /** The dose before an in-window adjustment. */
  previousDose?: string
  /** Same-ingredient identity (not product identity). */
  ingredientKey: string
}

export type MedCopyExcludedReason = 'ended' | 'stopped'

export interface MedCopyEntry {
  item: MedCopySourceItem
  /** Days since the supply ran out; set only when it has. */
  endedDays?: number
}

export interface MedCopyExcludedEntry extends MedCopyEntry {
  reason: MedCopyExcludedReason
}

export interface MedCopySelection {
  /** What the paste calls current, in the list's own order. */
  current: MedCopyEntry[]
  /** Long-term prescriptions in `current` that already ran out. */
  endedLongTerm: MedCopyEntry[]
  /** Left out of `current`: short courses that ran out, or stopped. */
  excluded: MedCopyExcludedEntry[]
}

/** A supply this long counts as long-term even without a 慢箋 mark. */
export const LONG_TERM_SUPPLY_DAYS = 28

function isLongTerm(item: MedCopySourceItem): boolean {
  return item.isChronic || (item.durationDays ?? 0) >= LONG_TERM_SUPPLY_DAYS
}

export function selectMedicationsForCopy(items: readonly MedCopySourceItem[]): MedCopySelection {
  const current: MedCopyEntry[] = []
  const endedLongTerm: MedCopyEntry[] = []
  const excluded: MedCopyExcludedEntry[] = []
  for (const item of items) {
    if (!item.isCurrent) continue
    const endedDays = item.daysRemaining !== undefined && item.daysRemaining < 0
      ? -item.daysRemaining
      : undefined
    const entry: MedCopyEntry = { item, ...(endedDays !== undefined ? { endedDays } : {}) }
    if (!item.isInactive) {
      current.push(entry)
    } else if (isLongTerm(item) && item.status !== 'stopped') {
      current.push(entry)
      endedLongTerm.push(entry)
    } else {
      excluded.push({ ...entry, reason: item.status === 'stopped' ? 'stopped' : 'ended' })
    }
  }
  return { current, endedLongTerm, excluded }
}

/** Every word the paste prints that is not the source's own. Supplied by the
 *  caller from i18n so an English UI pastes English markers. `{n}`, `{date}`,
 *  `{dose}`, `{count}` and `{text}` are placeholders. */
export interface MedCopyTextLabels {
  title: string
  titleShort: string
  /** `{date}, {count} 項` — what follows the title in brackets. */
  titleMeta: string
  /** The bracket a marker is written in: `（{text}）` or ` ({text})`. */
  paren: string
  days: string
  daysShort: string
  remainingLeft: string
  remainingUntil: string
  endedDays: string
  /** 「至 MM/DD」's counterpart once the supply ran out: `{date} 已用完`. */
  endedOn: string

  ended: string
  stopped: string
  previousDose: string
  sameIngredient: string
  endedListTitle: string
  unknownInstitution: string
  uncategorised: string
  undated: string
  /** The one line printed when nothing is current — a real answer, distinct
   *  from data that has not loaded (the caller never builds text then). */
  none: string
}

export interface MedCopyContext {
  /** Today, YYYY-MM-DD — the title's date and the 跨年 rule of short dates. */
  today: string
  labels: MedCopyTextLabels
}

export interface MedCopyText {
  text: string
  lineCount: number
  /** Medications on current lines (the title's count). */
  currentCount: number
  /** Ran-out short courses printed in the closing list. */
  listedExcludedCount: number
}

// ── Built-in formats ─────────────────────────────────────────────────────────

function fields(on: Partial<Record<MedCopyFieldId, string | true>>): MedCopyField[] {
  return MED_COPY_FIELD_IDS.map((id) => {
    const value = on[id]
    return {
      id,
      on: id === 'name' || value !== undefined,
      style: typeof value === 'string' ? value : MED_COPY_FIELD_STYLES[id][0],
    }
  })
}

const BASE_FORMAT: Omit<MedCopyFormat, 'id' | 'name' | 'fields'> = {
  numbering: 'dot',
  separator: 'space',
  title: 'full',
  titleMeta: true,
  group: 'none',
  groupHeader: 'bracket',
  hoistShared: true,
  endedAcute: 'omit',
}

export const BUILTIN_MED_COPY_FORMATS: Record<MedCopyBuiltinId, MedCopyFormat> = {
  'builtin:compact': {
    ...BASE_FORMAT,
    id: 'builtin:compact',
    name: '',
    numbering: 'dash',
    fields: fields({ dose: true, frequency: true, remaining: 'endedOnly' }),
  },
  'builtin:standard': {
    ...BASE_FORMAT,
    id: 'builtin:standard',
    name: '',
    fields: fields({
      dose: true, prevDose: true, frequency: true, route: true,
      institution: true, date: true, days: true, remaining: 'endedOnly',
    }),
  },
  'builtin:full': {
    ...BASE_FORMAT,
    id: 'builtin:full',
    name: '',
    group: 'institution',
    endedAcute: 'list',
    fields: fields({
      name: 'both', dose: true, prevDose: true, frequency: true, route: true,
      institution: true, date: true, days: true, remaining: 'until',
    }),
  },
}

export const DEFAULT_MED_COPY_FORMAT_ID: MedCopyBuiltinId = 'builtin:compact'

/** The id the one custom 用藥 format is stored under. */
export const MED_COPY_CUSTOM_FORMAT_ID = 'mine'

/** The format 「複製」 uses: the clinician's own, else the default built-in. */
export function resolveMedCopyFormat(saved: MedCopyFormat | null | undefined): MedCopyFormat {
  return saved ?? BUILTIN_MED_COPY_FORMATS[DEFAULT_MED_COPY_FORMAT_ID]
}

// ── Values ───────────────────────────────────────────────────────────────────

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match))
}

function formatDay(day: string | undefined, style: string, today: string): string {
  const match = day ? ISO_DAY.exec(day) : null
  if (!match) return ''
  const [, y, m, d] = match
  if (style === 'roc') return `${Number(y) - 1911}/${m}/${d}`
  if (style === 'ymd') return `${y}/${m}/${d}`
  // 月/日, with the year added only when it is not this year's.
  return y === today.slice(0, 4) ? `${m}/${d}` : `${y}/${m}/${d}`
}

/** The calendar day `offset` days from `today` (YYYY-MM-DD) — the fallback
 *  for 「至／已用完」 dates when the source gives no end day: the remaining-day
 *  count is rounded up, so the source's own day comes first. */
function dayFromToday(today: string, offset: number): string {
  const [y, m, d] = today.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10)
}

/** The pieces a cloud 頻次 is glued from (「QDACPO」 = QD + AC + PO), longest
 *  first so a longer code always wins over its prefix (QDAY before QD, STAT
 *  before ST). 健康存摺 records carry no 頻次 at all. */
const FREQUENCY_PARTS: ReadonlyArray<readonly [string, string]> = ([
  ['ASORDER', '依指示'], ['DAILY', '一天一次'], ['QDAY', '一天一次'], ['STAT', '立即'],
  ['QAM', '每天早上'], ['QPM', '每天晚上'], ['QOD', '隔天一次'], ['QWK', '每週一次'],
  ['QID', '一天四次'], ['BID', '一天兩次'], ['BIW', '每週兩次'], ['TID', '一天三次'],
  ['TIW', '每週三次'], ['PRN', '需要時'],
  ['QD', '一天一次'], ['QN', '每晚'], ['QW', '每週一次'], ['QM', '每月一次'], ['HS', '睡前'],
  ['AC', '飯前'], ['PC', '飯後'], ['PO', '口服'], ['ST', '立即'],
] as const).slice().sort((a, b) => b[0].length - a[0].length)

/** One source token cut into known pieces, or `null` when any stretch of it
 *  is not a code we know. */
function segmentFrequencyToken(token: string): { code: string; zh: string }[] | null {
  const upper = token.toUpperCase()
  const pieces: { code: string; zh: string }[] = []
  let at = 0
  while (at < upper.length) {
    const rest = upper.slice(at)
    // Q8H, Q3D, Q2W, Q6MON — every N hours / days / weeks / months.
    const every = /^Q(\d{1,2})(MON|H|D|W)/.exec(rest)
    if (every) {
      const unit = { H: '小時', D: '天', W: '週', MON: '個月' }[every[2] as 'H' | 'D' | 'W' | 'MON']
      pieces.push({ code: every[0], zh: `每 ${Number(every[1])} ${unit}` })
      at += every[0].length
      continue
    }
    const part = FREQUENCY_PARTS.find(([code]) => rest.startsWith(code))
    if (!part) return null
    pieces.push({ code: part[0], zh: part[1] })
    at += part[0].length
  }
  return pieces.length > 0 ? pieces : null
}

function frequencyTokens(frequency: string): string[] {
  return frequency.trim().split(/[\s,&+/]+/).filter(Boolean)
}

/** 頻次 with glued codes pulled apart: 「QDACPO」 → 「QD AC PO」. Unless every
 *  part cuts into known codes, the whole string stays as the source wrote it. */
export function splitFrequencyCodes(frequency: string): string {
  const trimmed = frequency.trim()
  if (/[\u3400-\u9fff]/.test(trimmed)) return trimmed
  // All or nothing, like the Chinese: a full SIG ("Take 1/2 tablet BID") has
  // words and separators that carry meaning, and re-joining its tokens with
  // spaces would turn half a tablet into "1 2". Only a string made entirely of
  // codes we recognise is re-spaced; anything else prints as the source wrote it.
  const out: string[] = []
  for (const token of frequencyTokens(trimmed)) {
    const pieces = segmentFrequencyToken(token)
    if (!pieces) return trimmed
    out.push(...pieces.map((piece) => piece.code))
  }
  return out.join(' ')
}

/** 頻次 in Chinese, or `null` when any part of it is not a code we know — the
 *  caller then prints the source unchanged rather than a half translation. */
export function frequencyToZh(frequency: string): string | null {
  const trimmed = frequency.trim()
  if (!trimmed || /[\u3400-\u9fff]/.test(trimmed)) return null
  const out: string[] = []
  for (const token of frequencyTokens(trimmed)) {
    const pieces = segmentFrequencyToken(token)
    if (!pieces) return null
    out.push(...pieces.map((piece) => piece.zh))
  }
  return out.join(' ')
}

function compactDose(dose: string): string {
  return dose.replace(/(\d)\s+(?=[^\d\s])/g, '$1')
}

function fieldText(entry: MedCopyEntry, field: MedCopyField, ctx: MedCopyContext): string {
  const { item } = entry
  const { labels } = ctx
  const paren = (text: string) => fill(labels.paren, { text })
  switch (field.id) {
    case 'name':
      if (field.style === 'product') return item.secondaryTitle || item.title
      if (field.style === 'both' && item.secondaryTitle) return `${item.title} (${item.secondaryTitle})`
      return item.title
    case 'dose': {
      const dose = doseUnlessRepeated(item.dose, item.frequency)
      if (!dose) return ''
      return field.style === 'compact' ? compactDose(dose) : dose
    }
    case 'prevDose':
      if (!item.previousDose) return ''
      // previousDose is the old dose · frequency signature, so the arrow
      // compares it with the same signature of today's prescription.
      if (field.style === 'arrow') {
        const now = [doseUnlessRepeated(item.dose, item.frequency), item.frequency].filter(Boolean).join(' · ')
        if (now) return paren(`${item.previousDose} → ${now}`)
      }
      return paren(fill(labels.previousDose, { dose: item.previousDose }))
    case 'frequency':
      if (!item.frequency) return ''
      if (field.style === 'zh') return frequencyToZh(item.frequency) ?? item.frequency
      if (field.style === 'split') return splitFrequencyCodes(item.frequency)
      return item.frequency
    case 'route':
      return item.route ?? ''
    case 'institution':
      // As the source records it — a pharmacy fill names the pharmacy. Its
      // prescriber is not in either source, and an inferred one marked 推測
      // read as a riddle in a chart (tried and dropped 2026-10-05).
      return item.institution ?? ''
    case 'date':
      return formatDay(item.day, field.style, ctx.today)
    case 'days':
      if (item.durationDays === undefined) return ''
      return fill(field.style === 'd' ? labels.daysShort : labels.days, { n: item.durationDays })
    case 'remaining': {
      // 「只標已用完」 marks only what ran out, in brackets like the other
      // markers; the other styles also count down a supply still running.
      const endedOnly = field.style === 'endedOnly'
      if (item.daysRemaining !== undefined && item.daysRemaining < 0) {
        // 到哪天 stays a date after the supply ran out; the other two count.
        if (field.style === 'until') {
          return fill(labels.endedOn, { date: formatDay(item.endDay ?? dayFromToday(ctx.today, item.daysRemaining), 'md', ctx.today) })
        }
        const ended = fill(labels.endedDays, { n: -item.daysRemaining })
        return endedOnly ? paren(ended) : ended
      }
      // Ended by status, with no supply arithmetic to count from.
      if (item.isInactive) return endedOnly ? paren(labels.ended) : labels.ended
      if (item.daysRemaining === undefined || endedOnly) return ''
      return field.style === 'until'
        ? fill(labels.remainingUntil, { date: formatDay(item.endDay ?? dayFromToday(ctx.today, item.daysRemaining), 'md', ctx.today) })
        : fill(labels.remainingLeft, { n: item.daysRemaining })
    }
    case 'category':
      if (!item.category) return ''
      return field.style === 'paren' ? `(${item.category})` : `[${item.category}]`
  }
}

// ── Text ─────────────────────────────────────────────────────────────────────

const SEPARATORS: Record<MedCopyFormat['separator'], string> = {
  space: ' ',
  dot: '・',
  comma: ', ',
  bar: ' | ',
}

/** The group key's own field: printed in the group header, so never again on
 *  the group's lines. */
const GROUP_KEY_FIELD: Partial<Record<MedCopyFormat['group'], MedCopyFieldId>> = {
  institution: 'institution',
  date: 'date',
  category: 'category',
}

/** Fields that may move up to a group header when the whole group shares them. */
const HOISTABLE: MedCopyFieldId[] = ['institution', 'date', 'days']

export function buildMedicationCopyText(
  selection: MedCopySelection,
  format: MedCopyFormat,
  ctx: MedCopyContext,
): MedCopyText {
  const { labels } = ctx
  const separator = SEPARATORS[format.separator]
  const shown = format.fields.filter((field) => field.on)
  const remainingShown = shown.some((field) => field.id === 'remaining')
  const dateStyle = format.fields.find((field) => field.id === 'date')?.style ?? 'md'
  const paren = (text: string) => fill(labels.paren, { text })

  // Same ingredient running from more than one institution.
  const institutionsByIngredient = new Map<string, Set<string>>()
  for (const { item } of selection.current) {
    const set = institutionsByIngredient.get(item.ingredientKey) ?? new Set<string>()
    set.add(item.institution ?? '')
    institutionsByIngredient.set(item.ingredientKey, set)
  }

  const number = (index: number): string => {
    switch (format.numbering) {
      case 'dot': return `${index + 1}. `
      case 'paren': return `${index + 1}) `
      case 'dash': return '- '
      default: return ''
    }
  }

  const line = (
    entry: MedCopyEntry,
    prefix: string,
    hidden: ReadonlySet<MedCopyFieldId>,
    statusMarker?: string,
    closing = false,
  ): string => {
    const parts = shown
      .filter((field) => !hidden.has(field.id))
      .map((field) => fieldText(entry, field, ctx))
      .filter(Boolean)
    if (statusMarker) parts.push(paren(statusMarker))
    const institutions = institutionsByIngredient.get(entry.item.ingredientKey)
    if (!closing && institutions && institutions.size > 1) {
      parts.push(paren(fill(labels.sameIngredient, { n: institutions.size })))
    }
    return prefix + parts.join(separator)
  }

  const out: string[] = []
  const titleDate = formatDay(ctx.today, dateStyle === 'roc' ? 'roc' : 'ymd', ctx.today)
  const meta = fill(labels.titleMeta, { date: titleDate, count: selection.current.length })
  if (format.title === 'full') out.push(format.titleMeta ? `${labels.title} (${meta})` : labels.title)
  if (format.title === 'short') out.push(format.titleMeta ? `${labels.titleShort} (${meta}):` : `${labels.titleShort}:`)

  const keyField = GROUP_KEY_FIELD[format.group]
  if (selection.current.length === 0) {
    out.push(labels.none)
  } else if (!keyField) {
    selection.current.forEach((entry, index) => out.push(line(entry, number(index), new Set())))
  } else {
    const keyOf = (entry: MedCopyEntry): string => {
      const { item } = entry
      switch (format.group) {
        case 'institution': return item.institution || labels.unknownInstitution
        case 'date': return formatDay(item.day, dateStyle, ctx.today) || labels.undated
        default: return item.category || labels.uncategorised
      }
    }
    const groups: { key: string; sortKey: string; entries: MedCopyEntry[] }[] = []
    for (const entry of selection.current) {
      const key = keyOf(entry)
      let group = groups.find((candidate) => candidate.key === key)
      if (!group) {
        group = {
          key,
          sortKey: format.group === 'date' ? entry.item.day ?? '' : '',
          entries: [],
        }
        groups.push(group)
      }
      group.entries.push(entry)
    }
    // Newest prescribing day first; otherwise the list's order.
    if (format.group === 'date') groups.sort((a, b) => b.sortKey.localeCompare(a.sortKey))

    let index = 0
    for (const group of groups) {
      const hidden = new Set<MedCopyFieldId>([keyField])
      const extras: string[] = []
      if (format.hoistShared) {
        for (const field of shown) {
          if (field.id === keyField || !HOISTABLE.includes(field.id)) continue
          const values = group.entries.map((entry) => fieldText(entry, field, ctx))
          if (values[0] && values.every((value) => value === values[0])) {
            hidden.add(field.id)
            extras.push(values[0])
          }
        }
      }
      const tail = extras.length > 0 ? ` ${extras.join(' ')}` : ''
      if (format.groupHeader === 'colon') out.push(`${group.key}${tail}:`)
      else if (format.groupHeader === 'hash') out.push(`# ${group.key}${tail}`)
      else out.push(`【${group.key}】${extras.join(' ')}`)
      for (const entry of group.entries) {
        out.push(line(entry, number(index), hidden))
        index += 1
      }
    }
  }

  let listedExcludedCount = 0
  if (format.endedAcute === 'list' && selection.excluded.length > 0) {
    out.push('')
    out.push(fill(labels.endedListTitle, { count: selection.current.length }))
    const prefix = format.numbering === 'none' ? '' : '- '
    for (const entry of selection.excluded) {
      // 已停用 is a fact about the drug, always said; how long ago a supply
      // ran out is a day count, said only when the format counts days.
      const marker = entry.reason === 'stopped'
        ? labels.stopped
        : !remainingShown
          ? undefined
          : entry.endedDays !== undefined ? fill(labels.endedDays, { n: entry.endedDays }) : labels.ended
      out.push(line(entry, prefix, new Set<MedCopyFieldId>(['remaining']), marker, true))
      listedExcludedCount += 1
    }
  }

  return {
    text: out.join('\n'),
    lineCount: out.length,
    currentCount: selection.current.length,
    listedExcludedCount,
  }
}

/** Whether this format writes day counts — the receipt says which it did. */
export function medCopyFormatCountsDays(format: MedCopyFormat): boolean {
  return format.fields.some((field) => field.id === 'remaining' && field.on)
}

/** A fresh custom format, starting from a built-in. */
export function createMedCopyFormat(from: MedCopyFormat, name: string, id: string): MedCopyFormat {
  return {
    ...from,
    id,
    name,
    fields: from.fields.map((field) => ({ ...field })),
  }
}
