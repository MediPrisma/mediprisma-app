import type { ExcludedClinicalRecordVariant } from '../utils/clinical-record-inputs'

export function ClinicalRecordVariantsNotice({ excluded, locale }: {
  excluded?: readonly ExcludedClinicalRecordVariant[]
  locale: 'en' | 'zh-TW'
}) {
  if (!excluded?.length) return null
  return (
    <p role="status" data-testid="cdss-source-record-variants" className="rounded-md border border-border bg-muted/30 px-3 py-2 text-[max(12px,0.875rem)] text-foreground">
      {locale === 'en'
        ? 'Some source records have unresolved versions or conflicts. These items are temporarily excluded; other data are assessed as usual.'
        : '同筆來源紀錄有未決版本或衝突，這些項目暫不採用，其餘資料照常評估。'}
    </p>
  )
}

