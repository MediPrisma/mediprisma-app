'use client'

import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger } from '@/components/ui/select'
import type { SummaryVersion } from '@/src/application/hooks/medical-summary/summary-versions.store'

/**
 * One dropdown for every completed standard-summary version. The newest cloud
 * and hospital versions sit on top; older ones are grouped below, newest first.
 * The closed trigger stays short (kind, plus the time when an older version is
 * open) so it never fights the model picker for width; the full time and model
 * live in the list rows.
 */
export function SummaryVersionPicker({ versions, selectedId, onSelect, busy, locale }: {
  versions: SummaryVersion[]
  selectedId?: string
  onSelect: (id: string) => void
  busy: boolean
  locale: string
}) {
  if (!versions.length) return null
  const en = locale === 'en'
  const kindLabel = (kind: SummaryVersion['kind']) => kind === 'cloud' ? en ? 'Cloud' : '雲端' : en ? 'With hospital data' : '含院內資料'
  const time = (version: SummaryVersion, seconds: boolean) => new Date(version.completedAt).toLocaleTimeString(locale,
    { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hourCycle: 'h23' })
  const detail = (version: SummaryVersion) => [time(version, true), version.result.generation?.modelName].filter(Boolean).join(' · ')
  const latest = (kind: SummaryVersion['kind']) => versions.filter(v => v.kind === kind).at(-1)
  const older = versions.filter(v => v.id !== latest(v.kind)?.id).reverse()
  const selected = versions.find(v => v.id === selectedId)
  const selectedIsOlder = !!selected && selected.id !== latest(selected.kind)?.id
  const triggerText = selected ? selectedIsOlder ? `${kindLabel(selected.kind)} · ${time(selected, false)}` : kindLabel(selected.kind) : en ? 'Version' : '版本'
  const row = (version: SummaryVersion, label: string) => <SelectItem key={version.id} value={version.id} className="text-xs">
    <span className="flex flex-col items-start gap-0.5">
      <span>{label}</span>
      <span className="text-[0.6875rem] text-muted-foreground tabular-nums">{detail(version)}</span>
    </span>
  </SelectItem>

  return <div className="flex shrink-0 items-center gap-1">
    <Select value={selected?.id ?? ''} onValueChange={onSelect}>
      <SelectTrigger size="sm" aria-label={en ? 'Summary version' : '摘要版本'} title={selected ? `${kindLabel(selected.kind)} · ${detail(selected)}` : undefined}
        className="min-h-11 max-w-[11rem] gap-1 bg-background px-2 py-0 text-xs shadow-none data-[size=sm]:h-auto lg:min-h-8">
        <span className={`block min-w-0 truncate ${selectedIsOlder ? '' : 'font-medium'}`}>{triggerText}</span>
      </SelectTrigger>
      <SelectContent align="start" className="w-auto min-w-[12rem] max-w-[min(20rem,calc(100vw-1rem))]">
        <SelectGroup>
          <SelectLabel>{en ? 'Latest' : '最新版本'}</SelectLabel>
          {(['cloud', 'hospital'] as const).map(kind => {
            const target = latest(kind)
            return target ? row(target, kindLabel(kind))
              : <SelectItem key={kind} value={`missing-${kind}`} disabled className="text-xs">
                <span className="flex flex-col items-start gap-0.5">
                  <span>{kindLabel(kind)}</span>
                  <span className="text-[0.6875rem] text-muted-foreground">{en ? 'Not generated yet' : '尚未產生'}</span>
                </span>
              </SelectItem>
          })}
        </SelectGroup>
        {older.length ? <>
          <SelectSeparator />
          <SelectGroup>
            <SelectLabel>{en ? 'Earlier' : '較早版本'}</SelectLabel>
            {older.map(version => row(version, kindLabel(version.kind)))}
          </SelectGroup>
        </> : null}
      </SelectContent>
    </Select>
    {busy ? <span role="status" aria-label={en ? 'Generating new version' : '新版產生中'} className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" /> : null}
  </div>
}
