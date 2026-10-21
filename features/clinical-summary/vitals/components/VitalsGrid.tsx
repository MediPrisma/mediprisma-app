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

interface VitalsGridProps {
  vitals: VitalsView
}

export function VitalsGrid({ vitals }: VitalsGridProps) {
  const { t } = useLanguage()
  const groups = groupReadingsByDay(vitals.readings)

  if (groups.length === 0) {
    return <p className="text-muted-foreground">{t.vitals.noData}</p>
  }

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
    </div>
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
