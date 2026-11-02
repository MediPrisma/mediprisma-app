// Vitals Grid Component
//
// One line per measurement day: the readings taken that day, then the date
// and how long ago it was. Usually that is a single line — a health check
// measures everything at once — but a height from 2018 and a blood pressure
// from last month each keep their own date instead of sharing the newer one.
// Readings the source tags as 成人預防保健 carry that badge after the date.
import { Fragment } from 'react'
import type { VitalKey, VitalsView } from '../types'
import { useLanguage } from '@/src/application/providers/language.provider'
import { formatDate } from '@/src/shared/utils/fhir-helpers'
import { groupReadingsByDay, readingAge, type ReadingAge } from '../utils/reading-dates'
import { ReportSourceProgramBadge } from '../../reports/components/ReportSourceProgramBadge'
import type { HomeBp } from '../utils/home-measurement-readings'

interface VitalsGridProps {
  vitals: VitalsView
  /** The home-measurement service's 722 week, on its own line under the clinic readings. */
  homeBp?: HomeBp | null
}

export function VitalsGrid({ vitals, homeBp }: VitalsGridProps) {
  const { t } = useLanguage()
  const groups = groupReadingsByDay(vitals.readings)

  const labels: Record<VitalKey, string> = {
    height: t.vitals.height,
    weight: t.vitals.weight,
    bmi: t.vitals.bmi,
    bp: t.vitals.bp,
    bpSys: t.vitals.systolic,
    bpDia: t.vitals.diastolic,
    hr: t.vitals.hr,
  }
  const ageText = (age: ReadingAge): string => {
    if (age.unit === 'today') return t.vitals.ageToday
    const [many, one] = {
      days: [t.vitals.ageDays, t.vitals.ageDaysOne],
      months: [t.vitals.ageMonths, t.vitals.ageMonthsOne],
      years: [t.vitals.ageYears, t.vitals.ageYearsOne],
    }[age.unit]
    return age.n === 1 ? one : many.replace('{n}', String(age.n))
  }
  const homeLine = homeBp ? <HomeBpLine bp={homeBp} ageText={ageText} /> : null

  if (groups.length === 0) {
    return (
      <div className="space-y-0.5">
        <p className="text-muted-foreground">{t.vitals.noData}</p>
        {homeLine}
      </div>
    )
  }

  return (
    <div className="space-y-0.5">
      {groups.map((group) => (
        <p key={`${group.day}|${group.sourceProgram ?? ''}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {group.readings.map((reading, i) => (
            <Fragment key={reading.key}>
              {i > 0 && <span aria-hidden="true" className="text-muted-foreground/50">·</span>}
              {/* Label and value break apart only when the pair is wider than
                  the line (a phone with enlarged text); neither splits itself. */}
              <span className="inline-flex flex-wrap items-baseline gap-x-1">
                <span className="whitespace-nowrap text-muted-foreground">{labels[reading.key]}</span>
                <span className="whitespace-nowrap font-semibold tabular-nums">{reading.value}</span>
              </span>
            </Fragment>
          ))}
          {/* Date and 成人預防保健 move to the next line as one piece, so the
              badge never ends up alone; they split only when the pair is wider
              than a whole line (enlarged text on a phone) rather than overflow. */}
          {(group.day || group.sourceProgram) && (
            <span className="ml-1 inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
              {group.day && <ReadingDate day={group.day} ageText={ageText} ageInParens={t.vitals.ageInParens} />}
              {/* May shrink and wrap its words on a very narrow card instead
                  of overflowing it. */}
              <ReportSourceProgramBadge sourceProgram={group.sourceProgram} label={t.vitals.adultPreventive} className="shrink" />
            </span>
          )}
        </p>
      ))}
      {homeLine}
    </div>
  )
}

// 居家血壓 722 128/78 mmHg · 心率 72 bpm  2026/10/24–2026/10/30（4 天前）· 5 天 9/14 時段
// Labelled as home readings so it never reads as a clinic measurement.
function HomeBpLine({ bp, ageText }: { bp: HomeBp; ageText: (age: ReadingAge) => string }) {
  const { t } = useLanguage()
  const age = readingAge(bp.end)
  const notes = [!bp.sufficient && t.vitals.homeBpInsufficient, !bp.dataComplete && t.vitals.homeBpIncomplete].filter(Boolean)
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5" title={t.vitals.homeBpHint} data-testid="vitals-home-bp">
      <span className="inline-flex flex-wrap items-baseline gap-x-1">
        <span className="whitespace-nowrap text-muted-foreground">{t.vitals.homeBp}</span>
        <span className="whitespace-nowrap font-semibold tabular-nums">{bp.systolic}/{bp.diastolic} mmHg</span>
      </span>
      {bp.heartRate !== null && (
        <>
          <span aria-hidden="true" className="text-muted-foreground/50">·</span>
          <span className="inline-flex flex-wrap items-baseline gap-x-1">
            <span className="whitespace-nowrap text-muted-foreground">{t.vitals.hr}</span>
            <span className="whitespace-nowrap font-semibold tabular-nums">{bp.heartRate} bpm</span>
          </span>
        </>
      )}
      <span className="ml-1 inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
        <time dateTime={bp.end} className="whitespace-nowrap">
          {formatDate(bp.start)}–{formatDate(bp.end)}{age && t.vitals.ageInParens.replace('{age}', ageText(age))}
        </time>
        <span className="whitespace-nowrap">{t.vitals.homeBpCounts.replace('{days}', String(bp.days)).replace('{sessions}', String(bp.sessions))}</span>
        {notes.map((note) => <span key={String(note)} className="whitespace-nowrap text-amber-700 dark:text-amber-400">{note}</span>)}
      </span>
    </p>
  )
}

// 2018/2/12（8 年前）— the date and the age are each unbreakable, but the age
// may drop below the date when both do not fit the line.
function ReadingDate({
  day,
  ageText,
  ageInParens,
}: {
  day: string
  ageText: (age: ReadingAge) => string
  ageInParens: string
}) {
  const age = readingAge(day)
  return (
    <time dateTime={day} className="inline-flex flex-wrap items-baseline gap-x-0.5 text-xs text-muted-foreground tabular-nums">
      <span className="whitespace-nowrap">{formatDate(day)}</span>
      {age && <span className="whitespace-nowrap">{ageInParens.replace('{age}', ageText(age))}</span>}
    </time>
  )
}
