'use client'

import type { SummaryVersion } from '@/src/application/hooks/medical-summary/summary-versions.store'

export function SummaryVersionPicker({ versions, selectedId, onSelect, busy, locale }: {
  versions: SummaryVersion[]
  selectedId?: string
  onSelect: (id: string) => void
  busy: boolean
  locale: string
}) {
  if (!versions.length) return null
  const en = locale === 'en'
  const latest = (kind: SummaryVersion['kind']) => versions.filter(v => v.kind === kind).at(-1)
  const selected = versions.find(v => v.id === selectedId)
  const older = versions.filter(v => v.id !== latest(v.kind)?.id)
  return <div role="group" aria-label={en ? 'Summary version' : '摘要版本'} className="flex shrink-0 items-center gap-1">
    {(['cloud', 'hospital'] as const).map(kind => {
      const target = latest(kind)
      const active = !!target && selected?.id === target.id
      return <button key={kind} type="button" disabled={!target} aria-pressed={active}
        onClick={() => target && onSelect(target.id)}
        className={`inline-flex min-h-11 items-center gap-1 whitespace-nowrap rounded-md border px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 lg:min-h-8 ${active ? 'border-primary/30 bg-primary/10 text-primary' : 'border-input bg-background text-muted-foreground hover:bg-muted'}`}>
        {kind === 'cloud' ? en ? 'Cloud' : '雲端' : en ? 'With hospital data' : '含院內資料'}
      </button>
    })}
    {busy ? <span role="status" aria-label={en ? 'Generating new version' : '新版產生中'} className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" /> : null}
    {older.length ? <select aria-label={en ? 'Older summary versions' : '較早摘要版本'} value={older.some(v => v.id === selectedId) ? selectedId : ''}
        onChange={event => onSelect(event.target.value)}
        className="min-h-11 max-w-32 rounded-md border border-input bg-background px-1 text-xs focus-visible:outline-2 focus-visible:outline-ring lg:min-h-8">
        <option value="" disabled>{en ? 'Earlier' : '較早版本'}</option>
        {older.map(version => <option key={version.id} value={version.id}>
          {version.kind === 'cloud' ? en ? 'Cloud' : '雲端' : en ? 'With hospital data' : '含院內資料'}
          {' · '}{new Date(version.completedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          {version.result.generation?.modelName ? ` · ${version.result.generation.modelName}` : ''}
        </option>)}
      </select> : null}
  </div>
}
