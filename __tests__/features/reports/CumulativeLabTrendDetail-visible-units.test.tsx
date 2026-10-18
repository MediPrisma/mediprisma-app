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

function admissionSeries(): LabTrendSeries {
  const base = mixedUnitSeries('CRE')
  const dates = [
    '2025-10-05', '2025-12-28',
    '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-08',
    '2026-06-01', '2026-09-20',
  ]
  const chartPoints = dates.map((date, index) => point(`cre-${index}`, `${date}T00:00:00.000Z`, 1 + index / 10, 'mg/dL'))
  return { ...base, points: chartPoints, chartPoints, mixedUnits: false, referenceRangesVary: false }
}

describe('CumulativeLabTrendDetail zoom', () => {
  it('zooms into a dense run from its button and clears back to the preset window', () => {
    const onWindowChange = jest.fn()
    render(
      <LanguageProvider>
        <CumulativeLabTrendDetail series={admissionSeries()} onWindowChange={onWindowChange} />
      </LanguageProvider>,
    )

    expect(screen.getByRole('img', { name: /檢驗趨勢圖，共 10 筆/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /放大 .*6 筆/ }))

    expect(screen.getByRole('img', { name: /檢驗趨勢圖，共 6 筆/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1 年' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('button', { name: /放大 .*6 筆/ })).not.toBeInTheDocument()
    expect(onWindowChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '清除自訂範圍' }))
    expect(screen.getByRole('img', { name: /檢驗趨勢圖，共 10 筆/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1 年' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('leaves the zoom when a preset window is chosen', () => {
    render(
      <LanguageProvider>
        <CumulativeLabTrendDetail series={admissionSeries()} />
      </LanguageProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: /放大 .*6 筆/ }))
    fireEvent.click(screen.getByRole('button', { name: '全部' }))
    expect(screen.queryByRole('button', { name: '清除自訂範圍' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '全部' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('CumulativeLabTrendDetail keyboard range picker', () => {
  it('zooms to a start and end result chosen with form controls, including inside a zoom', () => {
    render(
      <LanguageProvider>
        <CumulativeLabTrendDetail series={admissionSeries()} />
      </LanguageProvider>,
    )

    const toggle = screen.getByRole('button', { name: '自訂範圍' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    const from = screen.getByRole('combobox', { name: '起' })
    const to = screen.getByRole('combobox', { name: '迄' })
    const zoom = screen.getByRole('button', { name: '放大' })

    // End before start cannot be applied.
    fireEvent.change(from, { target: { value: '5' } })
    fireEvent.change(to, { target: { value: '4' } })
    expect(zoom).toBeDisabled()

    // Two ordinary results that no dense-run button covers.
    fireEvent.change(from, { target: { value: '0' } })
    fireEvent.change(to, { target: { value: '1' } })
    fireEvent.click(zoom)
    expect(screen.getByRole('img', { name: /檢驗趨勢圖，共 2 筆/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '清除自訂範圍' })).toBeInTheDocument()

    // Narrow an already zoomed dense run further.
    fireEvent.change(from, { target: { value: '2' } })
    fireEvent.change(to, { target: { value: '7' } })
    fireEvent.click(zoom)
    expect(screen.getByRole('img', { name: /檢驗趨勢圖，共 6 筆/ })).toBeInTheDocument()
    fireEvent.change(from, { target: { value: '3' } })
    fireEvent.change(to, { target: { value: '4' } })
    fireEvent.click(zoom)
    expect(screen.getByRole('img', { name: /檢驗趨勢圖，共 2 筆/ })).toBeInTheDocument()
  })

  it('shows only the picked results when dense results sit just past the picked end', () => {
    render(
      <LanguageProvider>
        <CumulativeLabTrendDetail series={admissionSeries()} />
      </LanguageProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: '自訂範圍' }))
    // 2025-10-05 → 2026-03-02; five more results follow within six days.
    fireEvent.change(screen.getByRole('combobox', { name: '起' }), { target: { value: '0' } })
    fireEvent.change(screen.getByRole('combobox', { name: '迄' }), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: '放大' }))

    expect(screen.getByRole('img', { name: /檢驗趨勢圖，共 3 筆/ })).toBeInTheDocument()
    expect(screen.getByText(/自訂 2025\/10\/05–2026\/03\/02/)).toBeInTheDocument()
    // The run that starts on the picked end is mostly outside the range.
    expect(screen.queryByRole('button', { name: /放大 03\/02/ })).not.toBeInTheDocument()
  })

  it('keeps offering the dense-run zoom inside a wide custom range that still squeezes it', () => {
    render(
      <LanguageProvider>
        <CumulativeLabTrendDetail series={admissionSeries()} />
      </LanguageProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: '自訂範圍' }))
    fireEvent.change(screen.getByRole('combobox', { name: '起' }), { target: { value: '0' } })
    fireEvent.change(screen.getByRole('combobox', { name: '迄' }), { target: { value: '9' } })
    fireEvent.click(screen.getByRole('button', { name: '放大' }))

    expect(screen.getByRole('img', { name: /檢驗趨勢圖，共 10 筆/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /放大 .*6 筆/ }))
    expect(screen.getByRole('img', { name: /檢驗趨勢圖，共 6 筆/ })).toBeInTheDocument()
    // Once the run fills the view there is nothing left to offer.
    expect(screen.queryByRole('button', { name: /放大 .*6 筆/ })).not.toBeInTheDocument()
  })
})
