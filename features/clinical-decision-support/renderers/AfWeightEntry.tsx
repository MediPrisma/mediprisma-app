'use client'

import { useId, useState } from 'react'
import { Input } from '@/components/ui/input'
import type { CdssPatientProfile } from '../types'
import { todayIsoDate, type ClinicVitalsPatch } from '../stores/clinic-vitals.store'
import { CLINIC_ENTRY_PATTERN } from '../utils/apply-clinic-vitals'

interface Props {
  weight?: CdssPatientProfile['facts'][string]
  isEnglish: boolean
  now: Date
  /** Resolves whether the patient's stored record was written; nothing returned counts as written. */
  onSave?: (patch: ClinicVitalsPatch) => void | Promise<boolean>
}

type SaveState = 'idle' | 'saving' | 'applied' | 'failed'

/**
 * A missing dose input goes through the same per-patient measurement store as
 * clinic vitals: typed here, the weight is used for this visit, and it reaches
 * the saved CDSS record only when the clinician saves one. A weight that could
 * not be kept is taken back out of the page, so nothing is computed from it.
 *
 * The field stays for a weight entered today, here or in the clinic form, so a
 * mistyped number can be corrected where it was typed (owner request 2026-11-26).
 */
export function AfWeightEntry({ weight, isEnglish, now, onSave }: Props) {
  const [state, setState] = useState<SaveState>('idle')
  const hasWeight = weight?.numericValue !== undefined && Number.isFinite(weight.numericValue)
    && weight.numericValue > 0 && weight.unit?.toLowerCase() === 'kg'
  const enteredToday = hasWeight && weight?.date?.slice(0, 10) === todayIsoDate(now) && CLINIC_ENTRY_PATTERN.test(weight.zh)

  if (!onSave) return null
  if (hasWeight && !enteredToday && state === 'idle') return null
  // What was just typed here is in use even where the page's clock and the store's disagree on the day.
  return <WeightForm isEnglish={isEnglish} applied={hasWeight && (enteredToday || state === 'applied') ? weight!.numericValue : undefined}
    saving={state === 'saving'} failed={state === 'failed'} onSave={async patch => {
      setState('saving')
      const kept = await Promise.resolve(onSave(patch)).then(result => result ?? true, () => false)
      if (!kept) void onSave({ entries: { bodyWeight: null } })
      setState(kept ? 'applied' : 'failed')
    }} />
}

function WeightForm({ isEnglish, applied, saving, failed, onSave }: Required<Pick<Props, 'isEnglish'>> & {
  /** The weight entered today that the page is using, if there is one. */
  applied?: number
  saving: boolean
  failed: boolean
  onSave: (patch: ClinicVitalsPatch) => Promise<void>
}) {
  const id = useId()
  const [value, setValue] = useState(applied === undefined ? '' : String(applied))
  const [error, setError] = useState<string>()
  // A weight entered elsewhere today (the calculator, the clinic form) shows here too.
  const [shown, setShown] = useState(applied)
  if (applied !== shown) {
    setShown(applied)
    if (applied !== undefined) setValue(String(applied))
  }
  // One field and nothing to press (owner request 2026-11-26): the weight typed
  // in the room is today's, and leaving the field or pressing Enter applies it.
  const apply = () => {
    if (saving || !value.trim()) return
    const number = Number(value)
    if (!Number.isFinite(number) || number <= 0) {
      setError(isEnglish ? 'Enter an actual weight greater than 0 kg.' : '請輸入大於 0 kg 的實際體重。')
      return
    }
    if (number !== applied) void onSave({ entries: { bodyWeight: { value: number } } })
  }

  return (
    <form className="space-y-2 border-t border-border px-3 py-3 text-sm" data-testid="cdss-af-weight-entry" noValidate
      onSubmit={event => { event.preventDefault(); apply() }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {applied === undefined ? <p>{isEnglish ? 'Weight is missing; CrCl cannot be calculated.' : '缺少體重，無法計算 CrCl。'}</p> : null}
        <label className="flex items-center gap-2" htmlFor={`${id}-weight`}>
          {isEnglish ? 'Weight (kg)' : '體重（kg）'}
          <Input id={`${id}-weight`} type="number" inputMode="decimal" min="0" step="any"
            className="h-11 w-28" value={value} onChange={event => { setValue(event.target.value); setError(undefined) }}
            onBlur={apply} aria-invalid={error ? true : undefined}
            aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`} />
        </label>
      </div>
      <p id={`${id}-hint`} role={applied === undefined ? undefined : 'status'} className="text-muted-foreground">
        {applied === undefined
          ? (isEnglish ? "Enter the current weight: it is used as today's measurement and the dose is reassessed." : '輸入目前體重即帶入，視為今天量測，並重新評估劑量。')
          : (isEnglish
            ? `Using ${applied} kg as today's weight; change the number to correct it. It is kept for next time only once the CDSS record is saved.`
            : `已帶入 ${applied} kg（視為今天量測），可直接改數值。儲存 CDSS 紀錄後才會留到下次。`)}
      </p>
      {error ? <p id={`${id}-error`} role="alert" className="text-destructive">{error}</p> : null}
      {saving ? <p role="status" className="text-muted-foreground">{isEnglish ? 'Saving…' : '處理中…'}</p> : null}
      {failed && !saving ? (
        <p role="alert" className="text-destructive">
          {isEnglish
            ? 'The weight could not be kept, so the dose assessment does not use it. Enter it again to retry.'
            : '體重未能帶入，劑量評估未使用這筆體重。請再輸入一次重試。'}
        </p>
      ) : null}
    </form>
  )
}
