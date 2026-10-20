// Custom Hook: Diagnosis Rows Processing
import { useMemo } from 'react'
import type { Condition, DiagnosisRow, Category, Coding } from '../types'
import { formatDate } from '../utils/fhir-helpers'
import { buildIcdDictionary, localizedIcdDescription, stripLeadingIcdCode } from '@/src/shared/utils/icd-lookup'
import { formatOrganizationDisplay } from '@/src/shared/utils/organization-display'

export function useDiagnosisRows(conditions: any[], locale = 'zh-TW', icdDict?: Map<string, string>, encounters: readonly any[] = []) {
  return useMemo<DiagnosisRow[]>(() => {
    if (!conditions || !Array.isArray(conditions)) return []
    const dictionary = icdDict ?? buildIcdDictionary(conditions, locale)
    const encounterMap = new Map(encounters.map((encounter) => [encounter.id, encounter]))
    
    const rows = (conditions as Condition[]).map((condition, index) => {
      const icdCodes = [...new Set(
        (condition.code?.coding ?? [])
          .filter((coding) => /icd-?(?:10|9)/i.test(coding.system ?? ''))
          .map((coding) => coding.code?.trim())
          .filter((code): code is string => Boolean(code)),
      )]
      const categories: string[] = []
      if (condition.category) {
        condition.category.forEach((cat: Category) => {
          if (cat.coding) {
            cat.coding.forEach((coding: Coding) => {
              if (coding.display) categories.push(coding.display)
              else if (coding.code) categories.push(coding.code)
            })
          }
        })
      }

      const primaryCoding = condition.code?.coding?.find(coding => coding.code?.trim() === icdCodes[0])
      const title = (icdCodes[0] ? localizedIcdDescription(icdCodes[0], condition.code?.text,
        primaryCoding?.display, dictionary, locale, primaryCoding?.system) : undefined)
        || condition.code?.text || condition.code?.coding?.find(coding => coding.display)?.display || icdCodes[0] || 'Unknown'
      const original = stripLeadingIcdCode(condition.code?.text, icdCodes[0] ?? '')
      return {
        id: condition.id || `condition-${index}`,
        title,
        originalNarrative: original && original !== title ? original : undefined,
        originalNarrativeLabel: locale === 'en' ? 'Original diagnosis' : '來源診斷原文',
        icdCodes,
        when: formatDate(condition.onsetDateTime || condition.recordedDate),
        clinical: typeof condition.clinicalStatus === 'string' 
          ? condition.clinicalStatus 
          : (condition.clinicalStatus?.coding?.[0]?.display || condition.clinicalStatus?.coding?.[0]?.code || ''),
        verification: typeof condition.verificationStatus === 'string'
          ? condition.verificationStatus
          : (condition.verificationStatus?.coding?.[0]?.display || condition.verificationStatus?.coding?.[0]?.code || ''),
        categories: categories,
        stage: (condition as { _cancerStage?: string })._cancerStage || undefined,
        _date: condition.recordedDate || condition.onsetDateTime || '',
        _categoryIdentity: (condition.category ?? []).flatMap((category) => category.coding?.length
          ? category.coding.map((coding) => `${coding.system ?? ''}|${coding.code ?? ''}`) : [category.text ?? '']).sort(),
        _identity: (condition.code?.coding ?? [])
          .filter((coding) => /icd-?(?:10|9)/i.test(coding.system ?? '') && coding.code)
          .map((coding) => `${coding.system?.toLowerCase().replace(/\/$/, '')}|${coding.code?.trim().toUpperCase().replace(/\./g, '')}`)
          .filter((key, index, values) => values.indexOf(key) === index).sort().join(';'),
        records: [{ id: condition.id || `condition-${index}`,
          originalText: condition.code?.text || condition.code?.coding?.find((coding) => coding.display)?.display,
          date: condition.recordedDate || condition.onsetDateTime,
          when: formatDate(condition.recordedDate || condition.onsetDateTime) || (locale === 'en' ? 'Date not provided' : '未提供日期'),
          onsetWhen: condition.onsetDateTime && condition.recordedDate && condition.onsetDateTime !== condition.recordedDate
            ? `${locale === 'en' ? 'Onset' : '起始日期'} ${formatDate(condition.onsetDateTime)}` : undefined,
          institution: (() => {
            const encounter = encounterMap.get(condition.encounter?.reference?.split('/').pop())
            const name = encounter?.serviceProvider?.display
            return name ? formatOrganizationDisplay(name, locale) : undefined
          })(),
        }],
      }
    })

    // Repeated visit diagnoses are a display group, not deletion of Conditions.
    // Preserve separate rows for different coding systems, disease activity,
    // verification status, category and cancer stage.
    const grouped = new Map<string, typeof rows[number]>()
    for (const row of rows) {
      const key = row._identity ? JSON.stringify([row._identity, row.clinical, row.verification,
        row.stage, row._categoryIdentity]) : `uncoded:${row.id}`
      const previous = grouped.get(key)
      if (!previous) { grouped.set(key, row); continue }
      const records = [...previous.records, ...row.records]
        .filter((record, index, all) => all.findIndex((other) => other.id === record.id) === index)
      grouped.set(key, { ...(row._date > previous._date ? row : previous), records })
    }
    const displayRows = [...grouped.values()]

    // Sort: active first, then resolved, then others
    displayRows.sort((a, b) => {
      const statusOrder: Record<string, number> = {
        'active': 0,
        'recurrence': 1,
        'relapse': 2,
        'remission': 3,
        'inactive': 4,
        'resolved': 5,
      }
      
      const aStatus = a.clinical.toLowerCase()
      const bStatus = b.clinical.toLowerCase()
      const aOrder = statusOrder[aStatus] ?? 99
      const bOrder = statusOrder[bStatus] ?? 99
      
      return aOrder - bOrder
    })

    return displayRows.map(({ _identity, _date, _categoryIdentity, ...row }) => ({ ...row,
      records: [...row.records].sort((left, right) => (right.date ?? '').localeCompare(left.date ?? '')),
      historyLabel: locale === 'en' ? `View ${row.records.length} records` : `查看 ${row.records.length} 筆紀錄`,
    }))
  }, [conditions, locale, icdDict, encounters])
}
