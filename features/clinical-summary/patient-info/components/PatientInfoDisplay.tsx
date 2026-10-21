// Patient Info Display Component
//
// One line — 陳○明 · 男性 · 94歲 · ID … — because the header already names the
// patient and the HIS holds the full record. The extended demographics stay
// in the DOM behind the card's 更多資料 toggle (PatientInfoCard owns it).
import { Fragment } from 'react'
import { useLanguage } from '@/src/application/providers/language.provider'
import type { PatientInfo } from '../types'

interface PatientInfoDisplayProps {
  patientInfo: PatientInfo
  showMore?: boolean
  /** id of the extended-details region, for the toggle's aria-controls. */
  detailsId?: string
}

export function hasExtendedPatientInfo(patientInfo: PatientInfo): boolean {
  return (
    (patientInfo.identifiers?.length ?? 0) > 0 ||
    !!patientInfo.birthDate ||
    (patientInfo.telecom?.length ?? 0) > 0 ||
    (patientInfo.addresses?.length ?? 0) > 0 ||
    !!patientInfo.maritalStatus ||
    (patientInfo.languages?.length ?? 0) > 0 ||
    (patientInfo.contacts?.length ?? 0) > 0
  )
}

export function PatientInfoDisplay({ patientInfo, showMore = false, detailsId }: PatientInfoDisplayProps) {
  const { t, locale } = useLanguage()
  const separator = locale === 'en' ? ':' : '：'

  const isUserEntered = (field: 'name' | 'gender' | 'birthDate') =>
    patientInfo.userEnteredFields?.includes(field) ?? false
  // A bare "未知" or "N/A" says nothing without its label; a known value
  // (陳○明, 男性, 94歲) is self-explanatory.
  const unknownValues = new Set([t.patient.unknown, 'N/A'])
  const ageKnown = /^~?\d+$/.test(patientInfo.age)

  const facts: Array<{ key: string; label: string; value: string; known: boolean; userEntered: boolean }> = [
    { key: 'name', label: t.patient.name, value: patientInfo.name, known: !unknownValues.has(patientInfo.name), userEntered: isUserEntered('name') },
    { key: 'gender', label: t.patient.gender, value: patientInfo.gender, known: !unknownValues.has(patientInfo.gender), userEntered: isUserEntered('gender') },
    {
      key: 'age',
      label: t.patient.age,
      value: ageKnown ? t.patient.ageValue.replace('{age}', patientInfo.age) : patientInfo.age,
      known: ageKnown,
      userEntered: isUserEntered('birthDate'),
    },
  ]

  return (
    <div>
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        {facts.map((fact, i) => (
          <Fragment key={fact.key}>
            {i > 0 && <Dot />}
            <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5">
              {fact.known ? (
                <span className={fact.key === 'name' ? 'break-words font-semibold' : 'break-words'}>
                  <span className="sr-only">{fact.label}{separator}</span>
                  {fact.value}
                </span>
              ) : (
                <>
                  <span className="text-muted-foreground">{fact.label}</span>
                  <span>{fact.value}</span>
                </>
              )}
              {fact.userEntered && <UserEnteredBadge label={t.patient.userEntered} />}
            </span>
          </Fragment>
        ))}
        {patientInfo.id && (
          <>
            <Dot />
            <span className="min-w-0 break-all text-muted-foreground">ID {patientInfo.id}</span>
          </>
        )}
      </p>

      {hasExtendedPatientInfo(patientInfo) && (
        <div
          id={detailsId}
          hidden={!showMore}
          className="mt-1.5 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs"
        >
          {(patientInfo.identifiers ?? []).map((id, i) => (
            <FieldRow key={`id-${i}`} label={id.label} value={id.value} />
          ))}
          {patientInfo.birthDate && (
            <FieldRow
              label={t.patient.birthDate}
              value={patientInfo.birthDate}
              userEntered={isUserEntered('birthDate')}
              userEnteredLabel={t.patient.userEntered}
            />
          )}
          {(patientInfo.telecom ?? []).map((tel, i) => (
            <FieldRow key={`tel-${i}`} label={tel.label} value={tel.value} />
          ))}
          {(patientInfo.addresses ?? []).map((a, i) => (
            <FieldRow key={`addr-${i}`} label={t.patient.address} value={a} />
          ))}
          {patientInfo.maritalStatus && (
            <FieldRow label={t.patient.maritalStatus} value={patientInfo.maritalStatus} />
          )}
          {(patientInfo.languages ?? []).length > 0 && (
            <FieldRow
              label={t.patient.language}
              value={(patientInfo.languages ?? []).join(', ')}
            />
          )}
          {(patientInfo.contacts ?? []).map((c, i) => (
            <FieldRow
              key={`con-${i}`}
              label={locale === 'en'
                ? `${t.patient.contact} (${c.relationship})`
                : `${t.patient.contact}（${c.relationship}）`}
              value={c.phone ? `${c.name} · ${c.phone}` : c.name}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Dot() {
  return <span aria-hidden="true" className="text-muted-foreground/50">·</span>
}

function UserEnteredBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex rounded-full border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-[10px] leading-none text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300">
      {label}
    </span>
  )
}

function FieldRow({
  label,
  value,
  userEntered = false,
  userEnteredLabel = '',
}: {
  label: string
  value: string
  userEntered?: boolean
  userEnteredLabel?: string
}) {
  return (
    <>
      <span className="min-w-0 break-words text-muted-foreground">{label}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="break-words">{value}</span>
        {userEntered && <UserEnteredBadge label={userEnteredLabel} />}
      </span>
    </>
  )
}
