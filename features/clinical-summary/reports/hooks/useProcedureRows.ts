// Custom Hook: Procedure Rows Processing
import { useMemo } from 'react'
import type { Observation } from '../types'
import { getCodeableConceptText, getConceptText, formatDate } from '../utils/fhir-helpers'
import { getProcedureCategoryCode } from '../utils/procedure-category'
import { isNhiOrderCodeSystem } from '@/src/shared/utils/nhi-order-code'
import { useLanguage } from "@/src/application/providers/language.provider"
import type { ProcedureSpecialMaterialEntity } from "@/src/core/entities/clinical-data.entity"

export function useProcedureRows(procedures: any[]) {
  const { t, locale } = useLanguage()
  const isZh = locale.startsWith('zh')

  return useMemo(() => {
    if (!Array.isArray(procedures)) return []

    // ── Locale-aware code/name helpers (shared across main + child) ──────────
    // A coding can carry the other language via the FHIR `_display` translation
    // extension (the bridge adds a zh-TW translation on the PCS coding). We keep
    // coding.display as the English source and read zh from the translation when
    // present — falling back to English so pre-bilingual bundles don't regress.
    const pickTranslation = (c: any, langPrefix: string): string | undefined => {
      const exts = c?._display?.extension
      if (!Array.isArray(exts)) return undefined
      for (const e of exts) {
        if (typeof e?.url !== 'string' || !e.url.includes('translation')) continue
        const sub: any[] = Array.isArray(e.extension) ? e.extension : []
        const lang = sub.find((x) => x?.url === 'lang')?.valueCode || sub.find((x) => x?.url === 'lang')?.valueString
        const content = sub.find((x) => x?.url === 'content')?.valueString
        if (typeof lang === 'string' && lang.toLowerCase().startsWith(langPrefix) && typeof content === 'string') return content
      }
      return undefined
    }
    const codeWithDisplay = (c: any, zhName?: string): string => {
      if (!c?.code) return ''
      const name = isZh
        ? (pickTranslation(c, 'zh') || zhName || c.display)
        : (c.display || pickTranslation(c, 'en') || zhName)
      return name ? `${c.code} · ${name}` : c.code
    }
    const explicitPerformedText = (procedure: any): string | undefined => {
      if (procedure?.performedDateTime) return formatDate(procedure.performedDateTime)
      const start = procedure?.performedPeriod?.start
      const end = procedure?.performedPeriod?.end
      if (start && end) {
        const formattedStart = formatDate(start)
        const formattedEnd = formatDate(end)
        return formattedStart === formattedEnd
          ? formattedStart
          : `${formattedStart}–${formattedEnd}`
      }
      if (start) return formatDate(start)
      if (end) return formatDate(end)
      return undefined
    }

    // Pull the display fields for one Procedure resource.
    const extract = (procedure: any) => {
      const performed = procedure?.performedDateTime || procedure?.performedPeriod?.start
      const procedureCategory = getProcedureCategoryCode(procedure?.category)
      let performer: string | undefined
      if (Array.isArray(procedure?.performer) && procedure.performer.length > 0) {
        performer = procedure.performer
          .map((p: any) =>
            p?.actor?.display || p?.display ||
            p?.actor?.reference?.split('/').pop() || p?.reference?.split('/').pop())
          .filter(Boolean)
          .join(", ")
      }
      const outcome = getConceptText(procedure?.outcome)
      const categoryLabels = t.procedures.categoryLabels
      const category = procedureCategory
        ? categoryLabels[procedureCategory]
        : getConceptText(procedure?.category)
      const location = procedure?.location?.display
      const reasonItems: string[] = Array.isArray(procedure?.reasonCode)
        ? procedure.reasonCode
            .map((rc: any) => {
              const c = Array.isArray(rc?.coding) ? rc.coding[0] : undefined
              const name = isZh ? (rc?.text || c?.display) : (c?.display || rc?.text)
              const code = c?.code
              if (code && name) return `${code} · ${name}`
              return name || code || ''
            })
            .filter(Boolean)
        : []
      const reason = reasonItems.join(", ")
      const bodySite = getConceptText(procedure?.bodySite)
      const followUp = getConceptText(procedure?.followUp)
      const notes = Array.isArray(procedure?.note)
        ? procedure.note.map((n: any) => n?.text).filter(Boolean).join("\n")
        : undefined
      const reports = Array.isArray(procedure?.report)
        ? procedure.report.map((ref: any) => ref?.display || ref?.reference).filter(Boolean)
        : []
      const coding: any[] = Array.isArray(procedure?.code?.coding) ? procedure.code.coding : []
      // 健保存摺 and MediCloud (TW Core medical-service-payment-tw) NHI 醫令 alike.
      const nhiCoding = coding.find((c: any) => isNhiOrderCodeSystem(c?.system))
      const pcsCoding = coding.find((c: any) => {
        if (typeof c?.system !== 'string') return false
        const system = c.system.toLowerCase()
        return system.includes('icd-10-pcs')
          || system === 'http://www.cms.gov/medicare/coding/icd10'
      })
      const primaryCoding = nhiCoding || pcsCoding || coding.find((c: any) => c?.code)
      const codeText = procedure?.code?.text
      // Title = surgery name, locale-aware: zh → 繁中 (code.text), en → NHI
      // English display; falls back to whatever is present.
      const title = (isZh
        ? (codeText || nhiCoding?.display)
        : (nhiCoding?.display || codeText)
      ) || getCodeableConceptText(procedure?.code) || "Procedure"
      const originalTitle = codeText || primaryCoding?.display || primaryCoding?.code || title
      const source = nhiCoding
        ? t.procedures.sourceNhiOrder
        : pcsCoding
          ? t.procedures.sourceInpatientSecondary
          : t.procedures.sourceProcedure
      return { performed, explicitPerformed: explicitPerformedText(procedure), procedureCategory,
        performer, outcome, category, location, reason, bodySite, followUp, notes,
        reports, nhiCoding, pcsCoding, primaryCoding, codeText, title, originalTitle, source }
    }

    // Detail rows for the main Procedure. Related Procedures use the explicit
    // source-audit layout below instead of inheriting parent context.
    const buildMainComponents = (f: ReturnType<typeof extract>): any[] => {
      const out: any[] = []
      // Status is intentionally omitted: anything that reaches 健康存摺 is
      // already "completed", so the row carries no signal (user request).
      // Date and facility already live in the card header; do not repeat them
      // in the expanded body.
      if (f.nhiCoding?.code) out.push({ code: { text: t.procedures.orderCode }, valueString: codeWithDisplay(f.nhiCoding, f.codeText) })
      if (f.pcsCoding?.code) out.push({ code: { text: t.procedures.classificationCode }, valueString: codeWithDisplay(f.pcsCoding) })
      if (f.category && f.category !== "—") out.push({ code: { text: t.procedures.category }, valueString: f.category })
      if (f.reason && f.reason !== "—") out.push({ code: { text: t.procedures.reason }, valueString: f.reason })
      if (f.outcome && f.outcome !== "—") out.push({ code: { text: t.procedures.outcome }, valueString: f.outcome })
      if (f.location) out.push({ code: { text: t.procedures.location }, valueString: f.location })
      if (f.bodySite && f.bodySite !== "—") out.push({ code: { text: t.procedures.bodySite }, valueString: f.bodySite })
      if (f.followUp && f.followUp !== "—") out.push({ code: { text: t.procedures.followUp }, valueString: f.followUp })
      if (f.reports.length > 0) out.push({ code: { text: t.procedures.reports }, valueString: f.reports.join(", ") })
      if (f.notes) out.push({ code: { text: t.procedures.notes }, valueString: f.notes })
      return out
    }

    // Every explicit Procedure.partOf child remains independently auditable.
    // The child date comes only from its own performed[x]; the parent/encounter
    // date is never substituted when the source did not state one.
    const buildChildComponent = (f: ReturnType<typeof extract>): any => {
      const codeLabel = f.nhiCoding
        ? t.procedures.orderCode
        : f.pcsCoding
          ? t.procedures.classificationCode
          : t.procedures.code
      const codeValue = f.pcsCoding
        ? codeWithDisplay(f.pcsCoding, f.codeText)
        : f.primaryCoding?.code || '—'
      return {
        code: { text: f.originalTitle },
        valueString: codeValue,
        _isProcedureChild: true,
        _procedureCodeLabel: codeLabel,
        _procedureSourceLabel: t.procedures.source,
        _procedureSource: f.source,
        _procedureDateLabel: t.procedures.explicitDate,
        _procedureDate: f.explicitPerformed || t.procedures.dateNotStated,
      }
    }

    // ── Group by Procedure.partOf (bridge ≥0.20.x) ──────────────────────────
    // Secondary procedures of one operative session reference the main via
    // partOf. We render one collapsible row per main, nesting the children's
    // detail under it; a child whose parent isn't in this dataset falls back to
    // a standalone row so nothing is dropped.
    const refId = (ref: any): string | undefined =>
      typeof ref === 'string' ? ref.split('/').pop() : undefined
    const procById = new Map<string, any>(
      procedures.filter((p: any) => p?.id).map((p: any) => [p.id, p]),
    )
    // FHIR `partOf` is a Reference[] that may mix target types (a Procedure can
    // be part of another Procedure, or e.g. an Observation/Encounter). Scan the
    // whole list and take the first entry that resolves to another Procedure in
    // this dataset — never assume partOf[0] is the procedure parent.
    const parentIdOf = (p: any): string | undefined => {
      if (!Array.isArray(p?.partOf)) return undefined
      for (const entry of p.partOf) {
        const id = entry?.reference ? refId(entry.reference) : undefined
        if (id && procById.has(id)) return id
      }
      return undefined
    }
    const childrenByParent = new Map<string, any[]>()
    for (const p of procedures) {
      const pid = parentIdOf(p)
      if (!pid) continue
      const arr = childrenByParent.get(pid) ?? []
      arr.push(p)
      childrenByParent.set(pid, arr)
    }
    const materialsOf = (p: any): ProcedureSpecialMaterialEntity[] =>
      Array.isArray(p?.specialMaterials) ? p.specialMaterials : []
    // Mains = standalone procedures + session leads (+ orphan children).
    const mains = procedures.filter((p: any) => !parentIdOf(p))

    return mains.map((procedure: any, procedureIndex: number) => {
      const f = extract(procedure)
      const children = childrenByParent.get(procedure?.id) ?? []
      const stableRowId = procedure?.id || `missing-id-${procedureIndex}`

      const components: any[] = buildMainComponents(f)
      const childFacts = children
        .map((child, index) => ({ facts: extract(child), index }))
        .sort((a, b) => {
          // Put inpatient ICD-10-PCS records before NHI order records while
          // preserving source order within the same code-system group.
          const rank = (facts: ReturnType<typeof extract>) =>
            facts.pcsCoding ? 0 : facts.nhiCoding ? 1 : 2
          return rank(a.facts) - rank(b.facts) || a.index - b.index
        })
      // A material belongs to the Procedure its record names: the lead's sit
      // under the lead's details, a grouped child's directly under that child,
      // and the header counts both.
      let specialMaterialCount = 0
      const pushMaterials = (source: any, procedureTitle?: string) => {
        const materials = materialsOf(source)
        if (materials.length === 0) return
        specialMaterialCount += materials.length
        components.push({
          code: { text: t.procedures.materials.heading },
          valueString: materials
            .map((m) => [m.materialCode, m.nameZh, m.nameEn].filter(Boolean).join(' '))
            .join('; '),
          _isProcedureMaterials: true,
          _materials: materials,
          _materialsProcedureTitle: procedureTitle,
        })
      }
      pushMaterials(procedure)
      for (const { facts: cf, index } of childFacts) {
        components.push(buildChildComponent(cf))
        pushMaterials(children[index], cf.originalTitle)
      }

      const observation: Observation = {
        resourceType: "Observation",
        id: `procedure-${stableRowId}`,
        code: { text: f.title },
        valueString: "—",
        effectiveDateTime: f.performed,
        status: procedure?.status,
        category: procedure?.category,
        component: components,
        // Render the detail components as a flat list (the row header already
        // shows the surgery name + date — no redundant title/value row).
        _detailsOnly: true,
      } as Observation

      return {
        // Prefix with `procedure:` because ReportsCard concatenates these rows
        // with DiagnosticReport-derived rows (which use the report's raw id).
        id: `procedure:${stableRowId}`,
        title: f.title,
        // Completion is implicit for health-passbook procedures. Use the
        // clinically meaningful category in the date tooltip instead of a
        // repeated English status such as "completed".
        meta: f.category && f.category !== "—"
          ? f.category
          : (t.procedures.title || "Procedure"),
        obs: [observation],
        group: "procedures" as const,
        institution: f.performer,
        effectiveDate: f.performed,
        procedureCategory: f.procedureCategory,
        // Number of sub-procedures grouped under this session (0 = standalone).
        relatedCount: children.length,
        specialMaterialCount,
      }
    })
  }, [procedures, t, isZh])
}
