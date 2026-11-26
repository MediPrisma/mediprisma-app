'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { CdssPatientProfile } from '../types'
import { todayIsoDate, type ClinicVitalsPatch } from '../stores/clinic-vitals.store'

interface Props {
  weight?: CdssPatientProfile['facts'][string]
  isEnglish: boolean
  now: Date
  /** Resolves whether the patient's stored record was written; nothing returned counts as written. */
  onSave?: (patch: ClinicVitalsPatch) => void | Promise<boolean>
}

type SaveState = 'idle' | 'saving' | 'saved' | 'failed'

/** The AF dose rules take no weight measured longer ago than this (personalized-care 2.31.0). */
const MAX_WEIGHT_AGE_DAYS = 90

/**
 * A missing dose input goes through the same per-patient measurement store as
 * clinic vitals. 「已存入」 waits for that store's write: a weight that could
 * not be kept is taken back out of the page, so nothing is computed from it,
 * and the form stays open with what was typed.
 */
export function AfWeightEntry({ weight, isEnglish, now, onSave }: Props) {
  const [state, setState] = useState<SaveState>('idle')
  const confirmation = useRef<HTMLParagraphElement>(null)
  const onFile = weight?.numericValue !== undefined && Number.isFinite(weight.numericValue)
    && weight.numericValue > 0 && weight.unit?.toLowerCase() === 'kg'
  // A weight the dose rules do not take (over 90 days old, or undated) is asked for like a missing one.
  const measuredOn = weight?.date?.slice(0, 10)
  const age = measuredOn ? Math.floor((Date.parse(todayIsoDate(now)) - Date.parse(measuredOn)) / 86_400_000) : NaN
  const hasWeight = onFile && Number.isFinite(age) && age <= MAX_WEIGHT_AGE_DAYS
  const unused = onFile && !hasWeight ? { reading: `${weight!.numericValue} kg`, measuredOn } : undefined
  useEffect(() => { if (state === 'saved' && hasWeight) confirmation.current?.focus() }, [state, hasWeight])

  if (!onSave) return null
  if (hasWeight && state === 'saved') return (
    <p ref={confirmation} role="status" tabIndex={-1} className="px-3 py-3 text-sm focus-visible:outline-2 focus-visible:outline-ring">
      {isEnglish ? 'Weight saved to the CDSS. Review the updated dose assessment below.' : '已存入 CDSS 並套用體重，請查看下方更新的劑量評估。'}
    </p>
  )
  if (hasWeight && state === 'idle') return null
  return <WeightForm isEnglish={isEnglish} unused={unused} saving={state === 'saving'} failed={state === 'failed'} onSave={async patch => {
    setState('saving')
    const kept = await Promise.resolve(onSave(patch)).then(result => result ?? true, () => false)
    if (!kept) void onSave({ entries: { bodyWeight: null } })
    setState(kept ? 'saved' : 'failed')
  }} />
}

function WeightForm({ isEnglish, unused, saving, failed, onSave }: Required<Pick<Props, 'isEnglish'>> & {
  /** The weight on file that the dose rules do not take, so the form can say why it asks. */
  unused?: { reading: string; measuredOn?: string }
  saving: boolean
  failed: boolean
  onSave: (patch: ClinicVitalsPatch) => Promise<void>
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string>()
  const input = useRef<HTMLInputElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const submit = useRef<HTMLButtonElement>(null)

  useEffect(() => { if (open) input.current?.focus() }, [open])
  // Ready to try again with what was typed.
  useEffect(() => { if (failed) submit.current?.focus() }, [failed])

  return (
    <div className="space-y-2 border-t border-border px-3 py-3 text-sm" data-testid="cdss-af-weight-entry">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p>{unused
          ? unused.measuredOn
            ? (isEnglish
              ? `The weight on file, ${unused.reading} (${unused.measuredOn}), is over ${MAX_WEIGHT_AGE_DAYS} days old and is not used; CrCl cannot be calculated.`
              : `病歷體重 ${unused.reading}（${unused.measuredOn}）已超過 ${MAX_WEIGHT_AGE_DAYS} 天，不採用，無法計算 CrCl。`)
            : (isEnglish
              ? `The weight on file, ${unused.reading}, has no measurement date and is not used; CrCl cannot be calculated.`
              : `病歷體重 ${unused.reading} 沒有量測日期，不採用，無法計算 CrCl。`)
          : isEnglish ? 'Weight is missing; CrCl cannot be calculated.' : '缺少體重，無法計算 CrCl。'}</p>
        <Button ref={trigger} type="button" variant="outline" className="min-h-11"
          aria-expanded={open} aria-controls={`${id}-form`} onClick={() => { setOpen(!open); setError(undefined) }}>
          {isEnglish ? 'Enter weight' : '補登體重'}
        </Button>
      </div>
      {open ? (
        <form id={`${id}-form`} className="space-y-2" noValidate onSubmit={event => {
          event.preventDefault()
          const number = value.trim() ? Number(value) : NaN
          if (!Number.isFinite(number) || number <= 0) {
            setError(isEnglish ? 'Enter an actual weight greater than 0 kg.' : '請輸入大於 0 kg 的實際體重。')
            input.current?.focus()
            return
          }
          // Entered in the room: the measurement is today's, so nobody types a date (owner request 2026-11-26).
          if (!saving) void onSave({ entries: { bodyWeight: { value: number } } })
        }}>
          <p id={`${id}-hint`} className="text-muted-foreground">
            {isEnglish ? "Enter the current weight; it is recorded as today's. The dose assessment updates after applying it." : '請填目前體重，視為今天量測；套用後重新評估劑量。'}
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1" htmlFor={`${id}-weight`}>
              {isEnglish ? 'Weight (kg)' : '體重（kg）'}
              <Input ref={input} id={`${id}-weight`} type="number" inputMode="decimal" min="0" step="any"
                className="h-11 w-32" value={value} onChange={event => { setValue(event.target.value); setError(undefined) }}
                aria-invalid={error ? true : undefined}
                aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`} />
            </label>
            <Button ref={submit} type="submit" className="min-h-11" aria-disabled={saving || undefined}>{isEnglish ? 'Apply weight' : '套用體重'}</Button>
            <Button type="button" variant="ghost" className="min-h-11" disabled={saving} onClick={() => {
              setOpen(false); setError(undefined); trigger.current?.focus()
            }}>{isEnglish ? 'Cancel' : '取消'}</Button>
          </div>
          {error ? <p id={`${id}-error`} role="alert" className="text-destructive">{error}</p> : null}
          {saving ? <p role="status" className="text-muted-foreground">{isEnglish ? 'Saving…' : '儲存中…'}</p> : null}
          {failed && !saving ? (
            <p role="alert" className="text-destructive">
              {isEnglish
                ? 'The weight could not be saved, so the dose assessment does not use it. Select Apply weight to try again.'
                : '體重未能儲存，劑量評估未使用這筆體重。請再按「套用體重」重試。'}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  )
}
