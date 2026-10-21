// Special materials (特材) linked to one surgery, shown inside its expanded
// procedure row. The cloud record does not say which operation used a
// material; an inferred link is labelled as such and explains its basis.
"use client"

import { Link2, Package } from 'lucide-react'
import { useLanguage } from '@/src/application/providers/language.provider'
import type { ProcedureSpecialMaterialEntity } from '@/src/core/entities/clinical-data.entity'

interface ProcedureMaterialsSectionProps {
  materials: readonly ProcedureSpecialMaterialEntity[]
  /** Set when the materials belong to a grouped sub-procedure, not the lead. */
  procedureTitle?: string
}

export function ProcedureMaterialsSection({ materials, procedureTitle }: ProcedureMaterialsSectionProps) {
  const { t, locale } = useLanguage()
  const tt = t.procedures.materials
  const isZh = locale.startsWith('zh')
  const fill = (template: string, count: number) => template.replace('{count}', String(count))

  return (
    <section
      data-testid="procedure-materials"
      aria-label={procedureTitle ? `${tt.heading} · ${procedureTitle}` : tt.heading}
      className="mt-1 flex min-w-0 basis-full flex-col gap-2 border-t pt-2"
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <h4 className="m-0 text-[0.8125rem] font-semibold text-foreground">{tt.heading}</h4>
        {procedureTitle && (
          <span className="min-w-0 break-words text-xs text-foreground">{procedureTitle}</span>
        )}
        <span className="text-xs tabular-nums text-muted-foreground">
          {fill(tt.countDetail, materials.length)}
        </span>
      </div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {materials.map((material, index) => {
          const primaryName = (isZh ? material.nameZh : material.nameEn)
            || material.nameZh || material.nameEn || material.materialCode || '—'
          const secondaryName = isZh ? material.nameEn : material.nameZh
          const inferred = material.relationshipStatus === 'inferred'
          return (
            <li
              key={material.id || `material-${index}`}
              className="flex min-w-0 gap-3 rounded-md border bg-muted/40 px-3 py-2.5"
            >
              <Package className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="break-words text-sm font-semibold text-foreground">{primaryName}</span>
                {secondaryName && secondaryName !== primaryName && (
                  <span className="break-words text-xs text-muted-foreground">{secondaryName}</span>
                )}
                <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs tabular-nums text-muted-foreground">
                  {material.materialCode && (
                    <span className="font-mono text-foreground">{material.materialCode}</span>
                  )}
                  {material.materialType && <span>{material.materialType}</span>}
                  {material.quantity !== undefined && <span>{fill(tt.quantity, material.quantity)}</span>}
                  {material.licenseNumbers.length > 0 && (
                    <span>{fill(tt.licenses, material.licenseNumbers.length)}</span>
                  )}
                </div>
                {(inferred || material.licenseNumbers.length > 0) && (
                  <details className="group mt-1 text-xs">
                    <summary className="inline-flex min-h-[24px] max-md:min-h-[44px] cursor-pointer items-center gap-2 text-primary">
                      {inferred && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-muted-foreground/70 px-2 py-px text-foreground">
                          <Link2 className="h-3 w-3" aria-hidden="true" />
                          {tt.inferred}
                        </span>
                      )}
                      <span className="underline-offset-2 hover:underline">
                        {inferred ? tt.whyLinked : tt.licenseList}
                      </span>
                    </summary>
                    <div className="mt-2 flex flex-col gap-1.5 leading-relaxed text-foreground">
                      {inferred && <p className="m-0">{tt.inferredExplanation}</p>}
                      {inferred && material.relationshipBasis && (
                        <p className="m-0 text-muted-foreground">
                          {tt.sourceBasis}：{material.relationshipBasis}
                        </p>
                      )}
                      {material.licenseNumbers.length > 0 && (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-muted-foreground">{tt.licenseList}</span>
                          <ul className="m-0 list-none p-0">
                            {material.licenseNumbers.map((license) => (
                              <li key={license}>{license}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </details>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
