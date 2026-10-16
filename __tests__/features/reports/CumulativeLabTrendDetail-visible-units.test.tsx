import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { CumulativeLabTrendDetail } from '@/features/clinical-summary/reports/components/CumulativeLabTrendDetail'
import { LanguageProvider } from '@/src/application/providers/language.provider'
import type { LabTrendPoint, LabTrendSeries } from '@/src/shared/utils/lab-trend.utils'
import type { TrendWindow } from '@/features/clinical-summary/reports/utils/trend-time-scale'

function point(
  id: string,
  effectiveTime: string,
  value: number,
  unit: string,
): LabTrendPoint {
  return {
    id,
    effectiveTime,
    timestamp: Date.parse(effectiveTime),
    value,
    rawValue: value,
    unit,
    rawUnit: unit,
    status: 'final',
    abnormal: false,
    critical: false,
    preliminary: false,
    corrected: false,
    referenceRange: unit === 'ng/dL'
      ? { low: 0.92, high: 1.68 }
      : { low: 0.54, high: 1.4 },
    unitInferred: false,
    plotEligible: true,
  }
}

function mixedUnitSeries(testKey = 'FT4'): LabTrendSeries {
  const chartPoints = [
    point('old-pmol-1', '2024-03-06T00:00:00.000Z', 1.96, 'pmol/L'),
    point('old-pmol-2', '2024-06-10T00:00:00.000Z', 1.57, 'pmol/L'),
    point('recent-ng-1', '2025-02-12T00:00:00.000Z', 0.49, 'ng/dL'),
    point('recent-ng-2', '2026-01-14T00:00:00.000Z', 1.38, 'ng/dL'),
  ]
  return {
    selection: {
      categoryId: 'endocrine',
      mapKey: testKey,
      testKey,
      displayName: testKey,
      nameMode: 'standardized',
    },
    points: chartPoints,
    chartPoints,
    chartable: true,
    mixedUnits: true,
    mixedSpecimens: false,
    referenceRangesVary: true,
    sameDayMultiple: false,
    excluded: {
      invalidStatus: 0,
      missingDate: 0,
      nonNumeric: 0,
      comparator: 0,
    },
  }
}

function RememberedWindowHarness() {
  const [testKey, setTestKey] = useState('FT4')
  const [rememberedWindow, setRememberedWindow] = useState<TrendWindow>()
  return (
    <LanguageProvider>
      <button type="button" onClick={() => setTestKey('TSH')}>切換檢驗</button>
      <CumulativeLabTrendDetail
        key={testKey}
        series={mixedUnitSeries(testKey)}
        initialWindow={rememberedWindow}
        onWindowChange={setRememberedWindow}
      />
    </LanguageProvider>
  )
}

describe('CumulativeLabTrendDetail visible-window unit safety', () => {
  it('keeps unit groups separate across time windows and switches the group-specific delta', () => {
    const series = mixedUnitSeries()

    render(
      <LanguageProvider>
        <CumulativeLabTrendDetail series={series} />
      </LanguageProvider>,
    )

    expect(screen.getByRole('button', { name: '1 年' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('img', { name: /檢驗趨勢圖，共 2 筆/ })).toBeInTheDocument()
    expect(screen.queryByText(/所選時間範圍包含無法安全合併的不同單位/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '全部' }))
    expect(screen.getByRole('img', { name: /檢驗趨勢圖，共 2 筆/ })).toBeInTheDocument()
    expect(screen.getByText('+0.89', { exact: true })).toBeInTheDocument()
    const picker = screen.getByRole('combobox', { name: '繪圖單位／檢體' })
    fireEvent.change(picker, { target: { value: JSON.stringify(['pmol/L', '']) } })
    expect(screen.getByRole('img', { name: /檢驗趨勢圖，共 2 筆/ })).toBeInTheDocument()
    expect(screen.getByText('-0.39', { exact: true })).toBeInTheDocument()
    expect(screen.queryByText('+0.89', { exact: true })).not.toBeInTheDocument()
    fireEvent.change(picker, { target: { value: JSON.stringify(['ng/dL', '']) } })

    fireEvent.click(screen.getByRole('button', { name: '6 個月' }))
    expect(screen.getByText(/至少需要兩筆/)).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /檢驗趨勢圖/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '1 年' }))
    expect(screen.getByRole('img', { name: /檢驗趨勢圖，共 2 筆/ })).toBeInTheDocument()
  })

  it('keeps the user-selected range when switching to another analyte', () => {
    render(<RememberedWindowHarness />)

    fireEvent.click(screen.getByRole('button', { name: '3 年' }))
    expect(screen.getByRole('button', { name: '3 年' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: '切換檢驗' }))
    expect(screen.getByRole('button', { name: '3 年' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '1 年' })).toHaveAttribute('aria-pressed', 'false')
  })
})
