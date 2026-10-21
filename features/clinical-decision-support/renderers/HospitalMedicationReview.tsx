import type { HospitalMedicationEvidence } from '../utils/hospital-medication-profile'
import { hospitalMedicationUseLabel } from '../utils/hospital-medication-profile'
import type { CdssLocale } from '../types'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export function HospitalMedicationReview({ evidence, locale }: {
  evidence?: readonly HospitalMedicationEvidence[]
  locale: CdssLocale
}) {
  const pending = evidence?.filter((item) => item.useState === 'active-order-unconfirmed'
    || item.useState === 'historical-record-current-status-unknown'
    || (item.useState === 'confirmed-current' && !item.ingredientName)) ?? []
  if (!pending.length) return null
  const english = locale === 'en'
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 px-2.5 text-xs shadow-none" data-testid="cdss-hospital-medication-review"
          aria-label={english ? `Medication review: ${pending.length} hospital prescriptions` : `用藥核對：${pending.length} 筆院內處方`}>
          {english ? 'Medication review' : '用藥核對'} <span className="tabular-nums">{pending.length}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" aria-label={english ? 'Hospital medication review' : '院內用藥核對'} className="max-h-[min(75vh,36rem)] w-[min(90vw,32rem)] overflow-y-auto p-3">
      <h3 className="text-sm font-semibold text-foreground">
        {english ? `Confirm current use of ${pending.length} hospital prescription(s)` : `${pending.length} 筆院內處方，目前使用待確認`}
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {english ? 'Safety checks include possible prescription exposure. A prescription alone does not confirm actual use; reconcile the list before starting or increasing medication.'
          : '安全判讀納入處方的可能用藥暴露。開立紀錄無法確認實際服藥，開始或加量前請先核對用藥清單。'}
      </p>
        <ul className="mt-2 divide-y divide-border text-xs">
          {pending.map((item) => (
            <li key={item.factKey} className="space-y-1 break-words py-2" data-testid="cdss-hospital-medication-evidence">
              <p className="font-medium text-foreground">{item.name.recordedProductName || item.name.recordedGenericName || item.name.recordedName || item.source.value || (english ? 'Unnamed medication' : '未命名藥物')}</p>
              {item.ingredientName && <p>{english ? 'Ingredient: ' : '成分：'}<span>{item.ingredientName}</span></p>}
              <p className="text-muted-foreground">{item.source.date} · {hospitalMedicationUseLabel(item.useState, english)}</p>
              <p className="text-muted-foreground">
                {item.fromOfficialTerminology ? (english ? 'Official NHI drug master' : '健保藥品主檔')
                  : !item.ingredientName ? (english ? 'No ingredient mapping applied' : '尚未套用成分對照')
                    : item.name.source === 'verified-product-alias' ? (english ? 'Verified product ingredient alias' : '已查證商品成分對照')
                      : (english ? 'Ingredient stated in the source name' : '來源藥名明列成分')}
                {item.name.referenceUrl && <a className="ml-2 text-primary underline underline-offset-2" href={item.name.referenceUrl} target="_blank" rel="noopener noreferrer">{english ? 'Reference' : '對照來源'}</a>}
              </p>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
