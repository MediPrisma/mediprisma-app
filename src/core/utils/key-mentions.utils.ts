// Source keys a model wrote into prose ("Donepezil (M5)", "visits E1, E8,
// E15", "discharge summary D2") are meaningless to a reader. The app writes
// each one as the record it names — the medicine, the visit date, the
// document — and marks it so the UI can open that record. Nothing else in the
// sentence changes, and a token that is not one of the item's own cited keys
// (an ICD code such as C61 or E11.9) is left as written (owner, 2026-10-05).

export interface KeyMentionSource {
  key: string
  resourceType?: string
  display?: string
  date?: string
  /** "donepezil · N06D ANTI-DEMENTIA DRUGS" (medication catalog entries). */
  medicationClass?: string
}

/** A run of text, or the record(s) a key mention named (`keys` set). */
export interface KeyMentionSegment {
  text: string
  keys?: string[]
}

type Language = 'en' | 'zh-TW'

// "E11.9" is an ICD code; "E10." ends a sentence.
const KEY_TOKEN = /\b([A-Z]{1,2}\d{1,4})\b(?!\.\d)/g
const RUN_JOINER = /^\s*(,|，|、|\/|and|及|與|和)\s*$/i
const OPEN_PAREN = /[(（]\s*$/
const CLOSE_PAREN = /^\s*[)）]/

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
const isDocument = (type?: string) => type === 'DocumentReference' || type === 'Composition'
const HAN = /[㐀-鿿]/

function label(source: KeyMentionSource, language: Language): string {
  const type = source.resourceType ?? ''
  const date = source.date ?? ''
  const display = (source.display ?? '').trim()
  if (type === 'Encounter') {
    if (!date) return display || source.key
    return language === 'zh-TW' ? `${date} 就診` : `visit ${date}`
  }
  if (type.startsWith('Medication')) {
    const substance = source.medicationClass?.split(' · ')[0]?.trim()
    return substance ? capitalize(substance) : display || source.key
  }
  if (type === 'CarePlan') return language === 'zh-TW' ? `${date} 照護計畫`.trim() : `care plan ${date}`.trim()
  if (isDocument(type)) {
    // An English sentence names the document in English; the title itself
    // is often Chinese (出院病摘).
    const name = language === 'en' && (HAN.test(display) || !display)
      ? (/病摘|出院|discharge/i.test(display) ? 'discharge summary' : 'document')
      : display
    return [date, name].filter(Boolean).join(' ') || source.key
  }
  if (type === 'Condition') return display || source.key
  return [display, date].filter(Boolean).join(' ') || source.key
}

function collapsedLabel(sources: KeyMentionSource[], language: Language): string {
  const latest = sources.map((source) => source.date ?? '').sort().at(-1) ?? ''
  const visits = sources.every((source) => source.resourceType === 'Encounter')
  if (language === 'zh-TW') {
    return visits ? `${sources.length} 次就診，最近 ${latest}` : `${sources.length} 筆紀錄，最近 ${latest}`
  }
  return visits ? `${sources.length} visits, latest ${latest}` : `${sources.length} records, latest ${latest}`
}

const VISIT_LEAD = /(visits?|就診)\s+$/i
const DOCUMENT_LEAD = /(discharge summary|出院病摘|病摘)\s+$/i

/**
 * Split `text` into plain runs and key mentions. Only `citedKeys` that the
 * lookup resolves are treated as keys.
 */
export function resolveKeyMentions(
  text: string,
  citedKeys: readonly string[],
  lookup: (key: string) => KeyMentionSource | undefined,
  language: Language,
): KeyMentionSegment[] {
  const cited = new Set(citedKeys.map((key) => key.trim().toUpperCase()))
  const matches = [...text.matchAll(KEY_TOKEN)]
    .map((match) => ({ key: match[1], start: match.index!, end: match.index! + match[1].length }))
    .filter((match) => cited.has(match.key) && lookup(match.key))
  if (matches.length === 0) return [{ text }]

  // Consecutive keys joined by commas, slashes or "and" are one mention.
  const runs: Array<{ keys: string[]; start: number; end: number }> = []
  for (const match of matches) {
    const last = runs.at(-1)
    if (last && RUN_JOINER.test(text.slice(last.end, match.start))) {
      last.keys.push(match.key)
      last.end = match.end
    } else {
      runs.push({ keys: [match.key], start: match.start, end: match.end })
    }
  }

  const segments: KeyMentionSegment[] = []
  let cursor = 0
  const pushText = (value: string) => {
    if (!value) return
    const last = segments.at(-1)
    if (last && !last.keys) last.text += value
    else segments.push({ text: value })
  }
  for (const run of runs) {
    const sources = run.keys.map((key) => lookup(key)!)
    const before = text.slice(cursor, run.start)
    const inParens = OPEN_PAREN.test(before) && CLOSE_PAREN.test(text.slice(run.end))

    // "Donepezil (M5)": the name is already written — drop the bracket and
    // let the name itself open the record.
    if (inParens && run.keys.length === 1 && sources[0].resourceType?.startsWith('Medication')) {
      const outside = before.replace(OPEN_PAREN, '')
      const word = /([A-Za-z][A-Za-z-]{3,})\s*$/.exec(outside)
      const known = `${sources[0].display ?? ''} ${sources[0].medicationClass ?? ''}`.toLowerCase()
      if (word && known.includes(word[1].toLowerCase())) {
        pushText(outside.slice(0, word.index))
        segments.push({ text: word[1], keys: run.keys })
        cursor = run.end + (CLOSE_PAREN.exec(text.slice(run.end))?.[0].length ?? 0)
        continue
      }
    }

    // Drop a lead word the label already says: "visits E1, E8, E15" →
    // "3 visits, latest …"; "discharge summary D2" → "2025-02-11 discharge
    // summary". Only when the run is that kind of record.
    const visits = sources.every((source) => source.resourceType === 'Encounter' && source.date)
    const documents = sources.every((source) => isDocument(source.resourceType))

    // "HbA1c L1": the sentence already names the record — add only its date.
    const only = sources.length === 1 ? sources[0] : undefined
    const named = only?.display?.trim()
    if (only?.date && named && !visits && !documents && before.trimEnd().toLowerCase().endsWith(named.toLowerCase())) {
      pushText(before)
      segments.push({ text: only.date, keys: run.keys })
      cursor = run.end
      continue
    }

    let kept = before
    if (inParens) {
      const inner = /([(（])\s*(visits?|就診)\s+$/i.exec(before)
      if (inner && visits) kept = before.slice(0, inner.index) + inner[1]
    } else {
      const lead = (visits ? VISIT_LEAD : documents ? DOCUMENT_LEAD : null)?.exec(before)
      if (lead) kept = before.slice(0, lead.index)
    }
    pushText(kept)
    const sameKind = sources.every((source) => source.resourceType === sources[0].resourceType)
    const mention = run.keys.length >= 3 && sameKind
      ? collapsedLabel(sources, language)
      : sources.map((source) => label(source, language)).join(language === 'zh-TW' ? '、' : ', ')
    segments.push({ text: mention, keys: run.keys })
    cursor = run.end
  }
  pushText(text.slice(cursor))
  return segments
}

/** Labels follow the sentence's own language, not the interface's. */
export const keyMentionLanguage = (text: string): Language => (HAN.test(text) ? 'zh-TW' : 'en')

/** The same sentence as plain text, for places that are a link already. */
export const keyMentionsText = (segments: readonly KeyMentionSegment[]): string =>
  segments.map((segment) => segment.text).join('')
