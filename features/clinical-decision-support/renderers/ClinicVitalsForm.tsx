"use client"

import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/src/shared/utils/cn.utils'
import { TINTED_PRIMARY } from './visit/visit-presentation'
import {
  todayIsoDate,
  type ClinicVitals,
  type ClinicVitalsEntryKey,
  type ClinicVitalsPatch,
} from '../stores/clinic-vitals.store'

/**
 * The cuff, the pulse, the scale and the stadiometer, typed in.
 *
 * A room's measurements are often not synced to the record the pack reads, and
 * the freshest numbers a titration decision needs are the ones on the
 * clinician's paper. Saving hands the values to the pack, which recomputes
 * every module that reads them; nothing is written back to the chart.
 *
 * Height is here because the H2FPEF score reads a BMI and the record's height
 * is often absent — a patient measured once in 2019 at another hospital has no
 * height in 健保雲端 at all, and the score can then only under-report.
 *
 * Saving states only the fields that were filled in. A field left blank is not
 * an erasure: the visit record keeps what it had, with the date it had.
 */
export function ClinicVitalsForm({
  isEnglish,
  now,
  initial,
  onSave,
  onClear,
  onClose,
  /** Extra line under the form, used by the visit flow for its scope note. */
  footnote,
}: {
  isEnglish: boolean
  now: Date
  initial?: ClinicVitals
  onSave: (patch: ClinicVitalsPatch) => void
  onClear?: () => void
  onClose: () => void
  footnote?: string
}) {
  const id = useId()
  const entryOf = (key: ClinicVitalsEntryKey) => initial?.entries?.[key]?.value
  const [systolic, setSystolic] = useState(entryOf('systolic')?.toString() ?? '')
  const [diastolic, setDiastolic] = useState(entryOf('diastolic')?.toString() ?? '')
  const [heartRate, setHeartRate] = useState(entryOf('heartRate')?.toString() ?? '')
  const [oxygenSaturation, setOxygenSaturation] = useState(entryOf('oxygenSaturation')?.toString() ?? '')
  const [bodyWeight, setBodyWeight] = useState(entryOf('bodyWeight')?.toString() ?? '')
  const [bodyHeight, setBodyHeight] = useState(entryOf('bodyHeight')?.toString() ?? '')
  const parsed = {
    systolic: parseNumber(systolic),
    diastolic: parseNumber(diastolic),
    heartRate: parseNumber(heartRate),
    oxygenSaturation: parseNumber(oxygenSaturation),
    bodyWeight: parseNumber(bodyWeight),
    bodyHeight: parseNumber(bodyHeight),
  }
  // A blood pressure is two numbers or none; one half cannot be read.
  const bpHalfEntered = (parsed.systolic === undefined) !== (parsed.diastolic === undefined)
  const hasAnything = parsed.heartRate !== undefined
    || parsed.oxygenSaturation !== undefined
    || parsed.bodyWeight !== undefined
    || parsed.bodyHeight !== undefined
    || (parsed.systolic !== undefined && parsed.diastolic !== undefined)
  const canSave = hasAnything && !bpHalfEntered

  const fields: readonly {
    key: ClinicVitalsEntryKey
    label: string
    unit: string
    value: string
    set: (value: string) => void
    step: string
  }[] = [
    { key: 'systolic', label: isEnglish ? 'Systolic' : '收縮壓', unit: 'mmHg', value: systolic, set: setSystolic, step: '1' },
    { key: 'diastolic', label: isEnglish ? 'Diastolic' : '舒張壓', unit: 'mmHg', value: diastolic, set: setDiastolic, step: '1' },
    { key: 'heartRate', label: isEnglish ? 'Heart rate' : '心率', unit: 'bpm', value: heartRate, set: setHeartRate, step: '1' },
    { key: 'oxygenSaturation', label: 'SpO₂', unit: '%', value: oxygenSaturation, set: setOxygenSaturation, step: '1' },
    { key: 'bodyWeight', label: isEnglish ? 'Weight' : '體重', unit: 'kg', value: bodyWeight, set: setBodyWeight, step: '0.1' },
    { key: 'bodyHeight', label: isEnglish ? 'Height' : '身高', unit: 'cm', value: bodyHeight, set: setBodyHeight, step: '0.1' },
  ]

  return (
    <form
      className="flex flex-wrap items-end gap-x-3 gap-y-2 border-t border-border bg-muted/20 px-3.5 py-2.5"
      aria-label={isEnglish ? 'Measured in clinic' : '門診量測'}
      data-testid="cdss-hf-clinic-vitals-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (!canSave) return
        const measuredOn = todayIsoDate(now)
        const entries: ClinicVitalsPatch['entries'] = {}
        for (const key of Object.keys(parsed) as (keyof typeof parsed)[]) {
          const value = parsed[key]
          if (key === 'systolic' || key === 'diastolic') {
            if (parsed.systolic === undefined || parsed.diastolic === undefined) continue
          }
          if (value === undefined) continue
          entries[key] = { value, measuredOn }
        }
        onSave({ entries })
        onClose()
      }}
    >
      <span className="w-full text-xs text-muted-foreground @min-[40rem]:w-auto @min-[40rem]:self-center">
        {isEnglish
          ? 'Measured in clinic today. Encrypted and kept for this tab session; every module recomputes from it.'
          : '今日門診量測。加密保存於本分頁的工作階段；各模組會依此重新判定。'}
      </span>
      {fields.map((field) => (
        <label key={field.key} className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
          <span>{field.label} <span className="font-normal">{field.unit}</span></span>
          <Input
            id={`${id}-${field.key}`}
            type="number"
            inputMode="decimal"
            min="0"
            step={field.step}
            value={field.value}
            onChange={(event) => field.set(event.target.value)}
            className="h-8 w-20 px-2 text-sm tabular-nums md:text-sm"
            aria-invalid={bpHalfEntered && (field.key === 'systolic' || field.key === 'diastolic') ? true : undefined}
            data-testid={`cdss-hf-clinic-vitals-${field.key}`}
          />
        </label>
      ))}
      <div className="flex items-center gap-1.5">
        <Button type="submit" size="sm" variant="outline" className={cn('h-8 font-semibold', TINTED_PRIMARY)} disabled={!canSave} data-testid="cdss-hf-clinic-vitals-save">
          {isEnglish ? 'Apply' : '套用'}
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-8" onClick={onClose}>
          {isEnglish ? 'Cancel' : '取消'}
        </Button>
        {initial && onClear ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 text-muted-foreground"
            onClick={() => { onClear(); onClose() }}
            data-testid="cdss-hf-clinic-vitals-clear"
          >
            {isEnglish ? 'Clear' : '清除'}
          </Button>
        ) : null}
      </div>
      {bpHalfEntered ? (
        <span className="w-full text-[11px] text-amber-700 dark:text-amber-300" role="alert">
          {isEnglish ? 'Enter both systolic and diastolic.' : '收縮壓與舒張壓要一起填。'}
        </span>
      ) : null}
      {footnote ? (
        <span
          className="w-full text-[11px] leading-4 text-muted-foreground"
          data-testid="cdss-hf-clinic-vitals-footnote"
        >
          {footnote}
        </span>
      ) : null}
    </form>
  )
}

function parseNumber(raw: string): number | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  const value = Number(trimmed)
  return Number.isFinite(value) && value > 0 ? value : undefined
}
