import { render, screen } from '@testing-library/react'
import { LabDayGroupCard } from '@/features/clinical-summary/reports/components/LabDayGroupCard'
import type { Row } from '@/features/clinical-summary/reports/types'
import { LanguageProvider } from '@/src/application/providers/language.provider'
import { AudienceProvider } from '@/src/application/providers/audience.provider'

describe('LabDayGroupCard source-program provenance', () => {
  it('labels an adult health-exam card in its header', () => {
    const member: Row = {
      id: 'adult-health-exam-cholesterol',
      title: 'CHOL',
      meta: 'Observation Group',
      group: 'lab',
      institution: '良安診所',
      sourceProgram: 'adult-preventive',
      effectiveDate: '2024-06-28T00:00:00+08:00',
      obs: [{
        id: 'adult-health-exam-cholesterol-observation',
        code: { text: 'CHOL' },
        valueQuantity: { value: 210, unit: 'mg/dL' },
      }],
    }
    const row: Row = {
      ...member,
      id: 'labday:adult-health-exam-lipid',
      obs: [],
      dayGroup: true,
      dayGroupCategoryId: 'chem',
      dayGroupLabelIds: ['chem'],
      groupedRows: [member],
    }

    render(
      <LanguageProvider>
        <AudienceProvider>
          <LabDayGroupCard row={row} defaultOpen={[]} />
        </AudienceProvider>
      </LanguageProvider>,
    )

    expect(screen.getByTestId('report-source-program').closest('button'))
      .toHaveTextContent('成人預防保健')
  })

  it('keeps the item and abnormal counts in stable aligned columns', () => {
    const member: Row = {
      id: 'abnormal-creatinine',
      title: 'CREA',
      meta: 'Observation Group',
      group: 'lab',
      institution: '示範長青醫院',
      effectiveDate: '2026-06-02T00:00:00+08:00',
      obs: [{
        id: 'abnormal-creatinine-observation',
        code: { text: 'CREA' },
        valueQuantity: { value: 2.1, unit: 'mg/dL' },
        interpretation: { coding: [{ code: 'H' }] },
      }],
    }
    const row: Row = {
      ...member,
      id: 'labday:abnormal-creatinine',
      obs: [],
      dayGroup: true,
      dayGroupCategoryId: 'chem',
      dayGroupLabelIds: ['chem'],
      groupedRows: [member],
    }

    render(
      <LanguageProvider>
        <AudienceProvider>
          <LabDayGroupCard row={row} defaultOpen={[]} />
        </AudienceProvider>
      </LanguageProvider>,
    )

    expect(screen.getByTestId('lab-day-metrics'))
      .toHaveClass('grid-cols-[5.5rem_6.5rem]')
    expect(screen.getByTestId('lab-day-item-count'))
      .toHaveClass('justify-self-end')
    expect(screen.getByTestId('lab-day-abnormal-count'))
      .toHaveClass('justify-self-start')
  })

  it('keeps date, category, source, and institution in stable scan columns', () => {
    const member: Row = {
      id: 'adult-preventive-creatinine',
      title: 'CREA',
      meta: 'Observation Group',
      group: 'lab',
      institution: '示範長青醫院',
      effectiveDate: '2026-06-02T00:00:00+08:00',
      sourceProgram: 'adult-preventive',
      obs: [{
        id: 'adult-preventive-creatinine-observation',
        code: { text: 'CREA' },
        valueQuantity: { value: 1.9, unit: 'mg/dL' },
      }],
    }
    const row: Row = {
      ...member,
      id: 'labday:adult-preventive-creatinine',
      obs: [],
      dayGroup: true,
      dayGroupCategoryId: 'chem',
      dayGroupLabelIds: ['chem'],
      groupedRows: [member],
    }

    render(
      <LanguageProvider>
        <AudienceProvider>
          <LabDayGroupCard row={row} defaultOpen={[]} />
        </AudienceProvider>
      </LanguageProvider>,
    )

    expect(screen.getByTestId('lab-day-identity-columns'))
      .toHaveClass(
        'grid-cols-[1rem_4.5rem_minmax(0,1fr)]',
        '@min-[300px]:grid-cols-[1rem_4.5rem_4.5rem_minmax(0,1fr)]',
        '@min-[560px]:grid-cols-[1rem_6rem_10rem_minmax(0,1fr)]',
      )
    expect(screen.getByTestId('lab-day-institution-slot'))
      .toHaveClass('row-start-2', '@min-[300px]:row-start-1')
    expect(screen.getByTestId('lab-day-classification'))
      .toContainElement(screen.getByTestId('report-source-program'))
    expect(screen.getByTestId('lab-day-category')).toHaveTextContent('生化')
    expect(screen.getByTestId('lab-day-institution-slot')).toHaveTextContent('示範長青醫院')
  })

  it('shows the compact MediCloud source and an explicit missing-institution label', () => {
    const member: Row = {
      id: 'medicloud-creatinine',
      title: 'CREA',
      meta: 'Observation Group',
      group: 'lab',
      sourceProvenance: 'nhi-medicloud',
      effectiveDate: '2026-09-14T08:00:00+08:00',
      obs: [{
        id: 'medicloud-creatinine-observation',
        code: { text: 'CREA' },
        valueQuantity: { value: 1.2, unit: 'mg/dL' },
      }],
    }
    const row: Row = {
      ...member,
      id: 'labday:medicloud-creatinine',
      obs: [],
      dayGroup: true,
      dayGroupCategoryId: 'chem',
      dayGroupLabelIds: ['chem'],
      groupedRows: [member],
    }

    render(
      <LanguageProvider>
        <AudienceProvider>
          <LabDayGroupCard row={row} defaultOpen={[]} />
        </AudienceProvider>
      </LanguageProvider>,
    )

    expect(screen.getByTestId('lab-day-institution-slot'))
      .toHaveTextContent('健保雲端圖形化查詢｜院所未提供')
    expect(screen.getByTestId('lab-day-institution-slot')).toHaveClass(
      '[grid-column:2/-1]',
      '[grid-row:2]',
    )
    expect(screen.getByTestId('lab-day-institution-slot'))
      .not.toHaveClass('@min-[300px]:row-start-1')
  })
})
