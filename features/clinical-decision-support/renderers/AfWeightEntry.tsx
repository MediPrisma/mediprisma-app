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
  onSave?: (patch: ClinicVitalsPatch) => void
}

/** A missing dose input goes through the same per-patient measurement store as clinic vitals. */
export function AfWeightEntry({ weight, isEnglish, now, onSave }: Props) {
  if (!onSave || (weight?.numericValue !== undefined && Number.isFinite(weight.numericValue)
    && weight.numericValue > 0 && weight.unit?.toLowerCase() === 'kg')) return null
  return <WeightForm isEnglish={isEnglish} now={now} onSave={onSave} />
}

function WeightForm({ isEnglish, now, onSave }: Required<Pick<Props, 'isEnglish' | 'now' | 'onSave'>>) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const today = todayIsoDate(now)
  const [measuredOn, setMeasuredOn] = useState(today)
  const [error, setError] = useState<string>()
  const input = useRef<HTMLInputElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => { if (open) input.current?.focus() }, [open])

  return (
    <div className="space-y-2 border-t border-border px-3 py-3 text-sm" data-testid="cdss-af-weight-entry">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p>{isEnglish ? 'Weight is missing; CrCl cannot be calculated.' : '缺少體重，無法計算 CrCl。'}</p>
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
          const date = new Date(measuredOn)
          if (!/^\d{4}-\d{2}-\d{2}$/.test(measuredOn) || !Number.isFinite(date.getTime())
            || date.toISOString().slice(0, 10) !== measuredOn || measuredOn > today) {
            setError(isEnglish ? 'Enter a valid measurement date, no later than today.' : '請填寫有效的量測日期，不能晚於今天。')
            return
          }
          onSave({ entries: { bodyWeight: { value: number, measuredOn } } })
          setOpen(false)
        }}>
          <p id={`${id}-hint`} className="text-muted-foreground">
            {isEnglish ? 'Use a measured weight and its original date. The dose assessment updates after applying it.' : '請填實際量測體重與原量測日期；套用後重新評估劑量。'}
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1" htmlFor={`${id}-weight`}>
              {isEnglish ? 'Weight (kg)' : '體重（kg）'}
              <Input ref={input} id={`${id}-weight`} type="number" inputMode="decimal" min="0" step="any"
                className="h-11 w-32" value={value} onChange={event => { setValue(event.target.value); setError(undefined) }}
                aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`} />
            </label>
            <label className="flex flex-col gap-1" htmlFor={`${id}-date`}>
              {isEnglish ? 'Measurement date' : '量測日期'}
              <Input id={`${id}-date`} type="date" max={today} className="h-11 w-44" value={measuredOn}
                onChange={event => { setMeasuredOn(event.target.value); setError(undefined) }} />
            </label>
            <Button type="submit" className="min-h-11">{isEnglish ? 'Apply weight' : '套用體重'}</Button>
            <Button type="button" variant="ghost" className="min-h-11" onClick={() => {
              setOpen(false); setError(undefined); trigger.current?.focus()
            }}>{isEnglish ? 'Cancel' : '取消'}</Button>
          </div>
          {error ? <p id={`${id}-error`} role="alert" className="text-destructive">{error}</p> : null}
        </form>
      ) : null}
    </div>
  )
}
