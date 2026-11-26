'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import type { CdssPatientProfile } from '../types'
import type { ClinicVitalsPatch } from '../stores/clinic-vitals.store'

interface Props {
  weight?: CdssPatientProfile['facts'][string]
  isEnglish: boolean
  now: Date
  /** Resolves whether the patient's stored record was written; nothing returned counts as written. */
  onSave?: (patch: ClinicVitalsPatch) => void | Promise<boolean>
}

type SaveState = 'idle' | 'saving' | 'saved' | 'failed'

/**
 * A missing dose input goes through the same per-patient measurement store as
 * clinic vitals. 「已存入」 waits for that store's write: a weight that could
 * not be kept is taken back out of the page, so nothing is computed from it,
 * and the form stays open with what was typed.
 */
export function AfWeightEntry({ weight, isEnglish, onSave }: Props) {
  const [state, setState] = useState<SaveState>('idle')
  const confirmation = useRef<HTMLParagraphElement>(null)
  const hasWeight = weight?.numericValue !== undefined && Number.isFinite(weight.numericValue)
    && weight.numericValue > 0 && weight.unit?.toLowerCase() === 'kg'
  useEffect(() => { if (state === 'saved' && hasWeight) confirmation.current?.focus() }, [state, hasWeight])

  if (!onSave) return null
  if (hasWeight && state === 'saved') return (
    <p ref={confirmation} role="status" tabIndex={-1} className="px-3 py-3 text-sm focus-visible:outline-2 focus-visible:outline-ring">
      {isEnglish ? 'Weight saved to the CDSS. Review the updated dose assessment below.' : '已存入 CDSS 並套用體重，請查看下方更新的劑量評估。'}
    </p>
  )
  if (hasWeight && state === 'idle') return null
  return <WeightForm isEnglish={isEnglish} saving={state === 'saving'} failed={state === 'failed'} onSave={async patch => {
    setState('saving')
    const kept = await Promise.resolve(onSave(patch)).then(result => result ?? true, () => false)
    if (!kept) void onSave({ entries: { bodyWeight: null } })
    setState(kept ? 'saved' : 'failed')
  }} />
}

function WeightForm({ isEnglish, saving, failed, onSave }: Required<Pick<Props, 'isEnglish'>> & {
  saving: boolean
  failed: boolean
  onSave: (patch: ClinicVitalsPatch) => Promise<void>
}) {
  const id = useId()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string>()
  // One field and nothing to press (owner request 2026-11-26): the weight typed
  // in the room is today's, and leaving the field or pressing Enter applies it.
  const apply = () => {
    if (saving || !value.trim()) return
    const number = Number(value)
    if (!Number.isFinite(number) || number <= 0) {
      setError(isEnglish ? 'Enter an actual weight greater than 0 kg.' : '請輸入大於 0 kg 的實際體重。')
      return
    }
    void onSave({ entries: { bodyWeight: { value: number } } })
  }

  return (
    <form className="space-y-2 border-t border-border px-3 py-3 text-sm" data-testid="cdss-af-weight-entry" noValidate
      onSubmit={event => { event.preventDefault(); apply() }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p>{isEnglish ? 'Weight is missing; CrCl cannot be calculated.' : '缺少體重，無法計算 CrCl。'}</p>
        <label className="flex items-center gap-2" htmlFor={`${id}-weight`}>
          {isEnglish ? 'Weight (kg)' : '體重（kg）'}
          <Input id={`${id}-weight`} type="number" inputMode="decimal" min="0" step="any"
            className="h-11 w-28" value={value} onChange={event => { setValue(event.target.value); setError(undefined) }}
            onBlur={apply} aria-invalid={error ? true : undefined}
            aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`} />
        </label>
      </div>
      <p id={`${id}-hint`} className="text-muted-foreground">
        {isEnglish ? "Enter the current weight: it is applied as today's measurement and the dose is reassessed." : '輸入目前體重即套用，視為今天量測，並重新評估劑量。'}
      </p>
      {error ? <p id={`${id}-error`} role="alert" className="text-destructive">{error}</p> : null}
      {saving ? <p role="status" className="text-muted-foreground">{isEnglish ? 'Saving…' : '儲存中…'}</p> : null}
      {failed && !saving ? (
        <p role="alert" className="text-destructive">
          {isEnglish
            ? 'The weight could not be saved, so the dose assessment does not use it. Enter it again to retry.'
            : '體重未能儲存，劑量評估未使用這筆體重。請再輸入一次重試。'}
        </p>
      ) : null}
    </form>
  )
}
