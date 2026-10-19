"use client"

import type { ReactElement, ReactNode } from 'react'
import { TapTooltip } from '@/src/shared/components/TapTooltip'
import { clinicalTooltipSurfaceClass } from '@/features/clinical-summary/components/clinical-metadata-styles'
import { useLanguage } from '@/src/application/providers/language.provider'
import type { MedicationRow } from '../types'
import type { HospitalMedicationName } from '@/src/shared/utils/hospital-medication-names'

/** Same provenance in list, overview, timeline label, and timeline fill detail. */
export function HospitalMedicationNameDetails({ name }: { name: HospitalMedicationName }) {
  const { locale } = useLanguage()
  const en = locale === 'en'
  const rows = [
    [en ? 'Ingredient' : '成分名', name.ingredientName || (en ? 'Ingredient unconfirmed' : '成分未確認')],
    [en ? 'Recorded generic name' : '原始學名欄位', name.recordedGenericName],
    [en ? 'Recorded product name' : '原始商品名', name.recordedProductName],
    [en ? 'Recorded name' : '院內原始藥名', name.recordedName],
  ].filter((row): row is [string, string] => Boolean(row[1]))
  return (
    <div>
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-left">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-secondary-foreground/65">{label}</dt>
            <dd className="min-w-0 break-words font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-1.5 border-t border-secondary-foreground/15 pt-1 text-xs text-secondary-foreground/70">
        {name.source === 'verified-product-alias'
          ? (en ? 'Verified product-name ingredient reference' : '商品名成分對照')
          : name.source === 'recorded-generic-name'
            ? (en ? 'Ingredient explicitly named in the source record' : '來源藥名明列成分')
            : (en ? 'Hospital source record' : '院內原始紀錄')}
        {' · '}{en ? 'Reviewed' : '核對日期'} {name.reviewedAt}
        <div>{en ? 'Strength and formulation: see the original name.' : '含量與劑型請依原始藥名核對。'}</div>
        {name.referenceUrl && (
          <a href={name.referenceUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">
            {en ? 'Ingredient reference' : '成分對照來源'}
          </a>
        )}
      </div>
    </div>
  )
}

interface MedicationTerminologyTooltipProps {
  medication: Pick<MedicationRow, 'drugTerminology' | 'hospitalMedicationName' | 'nhiDrugCode' | 'reconciledOrderIds' | 'sourceOrderIdentifiers'>
  enabled: boolean
  /** Facts about THIS prescription — dose, frequency, days supplied — shown
   *  under the drug-master rows. The card above describes the drug; this
   *  describes the fill, and 總覽 needs both in one place because its row has
   *  no space for either. Callers with nothing to add omit it and the card is
   *  exactly what it was. */
  extra?: ReactNode
  children: ReactElement
}

export function MedicationTerminologyTooltip({
  medication,
  enabled,
  extra,
  children,
}: MedicationTerminologyTooltipProps) {
  const { t, locale } = useLanguage()
  const mt = (t.medications as any)
  const terminology = medication.drugTerminology
  const integrated = (medication.reconciledOrderIds?.length ?? 0) > 1
  const hospitalName = !terminology || integrated ? medication.hospitalMedicationName : undefined

  // `extra` alone is worth a card: a drug missing from the NHI master still
  // has a dose and a supply, and dropping the tooltip would make those rows
  // silently behave differently from their neighbours.
  if (!enabled || (!terminology && !hospitalName && !extra && !medication.nhiDrugCode && !integrated)) return children

  const atcNames = [
    terminology?.atcNameEn,
    terminology?.atcNameZh,
  ].filter((value, index, values): value is string =>
    Boolean(value) && values.indexOf(value) === index,
  )
  const rows = [
    [locale === 'en' ? 'Hospital order number' : '院內藥囑編號', medication.sourceOrderIdentifiers?.join('、')],
    [locale === 'en' ? 'Recorded NHI product code' : (integrated ? '雲端紀錄健保藥碼' : '來源紀錄健保藥碼'), medication.nhiDrugCode],
    ...(!terminology ? [] : [
    [mt.terminologyIngredientLabel ?? 'Ingredient / strength', terminology.ingredientText],
    [mt.terminologyOfficialNameZhLabel ?? 'Chinese product name', terminology.officialNameZh],
    [mt.terminologyOfficialNameEnLabel ?? 'English product name', terminology.officialNameEn],
    [mt.terminologyDoseFormLabel ?? 'Dose form', terminology.doseForm],
    [
      mt.terminologyAtcLabel ?? 'ATC class',
      terminology.atcCode
        ? `${terminology.atcCode}${atcNames.length > 0 ? ` · ${atcNames.join('／')}` : ''}`
        : undefined,
    ],
    [
      mt.terminologyAtcLevel2Label ?? 'ATC therapeutic subgroup',
      terminology.atcLevel2Code
        ? `${terminology.atcLevel2Code} · ${
          locale === 'en'
            ? terminology.atcLevel2NameEn
              || terminology.atcLevel2NameZh
              || terminology.atcLevel2Code
            : terminology.atcLevel2NameZh
              || terminology.atcLevel2NameEn
              || terminology.atcLevel2Code
        }`
        : undefined,
    ],
    ]),
  ].filter((row): row is [string, string] => Boolean(row[1]))

  // The compact row shows ONE drug name; ingredient, strength, dose form, the
  // other-language product name and the ATC class exist only here. asChild
  // keeps the caller's own span as the trigger (an extra wrapper would break
  // the row's three-lane grid) — that span already carries tabIndex, so the
  // record stays reachable by hover, keyboard AND tap.
  return (
    <TapTooltip
      asChild
      sideOffset={4}
      contentTestId="medication-terminology-tooltip"
      contentClassName={`${clinicalTooltipSurfaceClass} max-w-[min(92vw,30rem)] whitespace-normal text-xs leading-relaxed`}
      content={(
        <>
          <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-left">
            {rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-secondary-foreground/65">{label}</dt>
                <dd className="min-w-0 break-words font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          {hospitalName && <HospitalMedicationNameDetails name={hospitalName} />}
          {integrated && (
            <div className="mt-1.5 border-t border-secondary-foreground/15 pt-1.5">
              {locale === 'en' ? 'The hospital and MediCloud records were matched to this prescription. Original records are retained.' : '這筆藥囑已整合院內與健保雲端紀錄，原始來源均保留。'}
            </div>
          )}
          {extra && (
            <div className={rows.length > 0 || hospitalName
              ? 'mt-1.5 border-t border-secondary-foreground/15 pt-1.5'
              : undefined}
            >
              {extra}
            </div>
          )}
          {terminology && (
            <div className="mt-1.5 border-t border-secondary-foreground/15 pt-1 text-[0.6875rem] text-secondary-foreground/70">
              {mt.terminologySource ?? 'NHI drug master'}
              {' · '}
              {mt.terminologySnapshotLabel ?? 'Version'}: {terminology.snapshotId}
            </div>
          )}
        </>
      )}
    >
      {children}
    </TapTooltip>
  )
}
