import { render, screen, within } from '@testing-library/react'
import { CalculatorDetail } from '@/features/medical-calculator/components/CalculatorDetail'
import { DoacDoseResults } from '@/features/medical-calculator/components/DoacDoseResults'
import { DoacPeriopResults } from '@/features/medical-calculator/components/DoacPeriopResults'
import { CALCULATORS } from '@/features/medical-calculator/calculators'
import { calculateDoacDoses } from '@/features/medical-calculator/doac-dose-model'
import { calculatePeriop } from '@/features/medical-calculator/doac-periop-model'
import { inputVisible, visibleValues, type CalcInput, type CalcValues, type CalculatorDef } from '@/features/medical-calculator/types'
import { LanguageProvider } from '@/src/application/providers/language.provider'
import { useLabAutofill } from '@/features/medical-calculator/hooks/use-lab-autofill.hook'

jest.mock('@/features/medical-calculator/hooks/use-lab-autofill.hook', () => ({
  useLabAutofill: jest.fn(),
}))

const doseCalc = CALCULATORS.find((c) => c.id === 'doac-dose-nvaf')!
const periopCalc = CALCULATORS.find((c) => c.id === 'doac-periop')!

const DDI_KEYS = ['ddi_ketoconazole', 'ddi_itraconazole', 'ddi_vori_posaconazole', 'ddi_hiv_pi', 'ddi_ciclosporin', 'ddi_tacrolimus', 'ddi_dronedarone', 'ddi_verapamil', 'ddi_amiodarone', 'ddi_quinidine', 'ddi_erythromycin', 'ddi_clarithromycin', 'ddi_glecaprevir', 'ddi_inducer', 'ddi_anticoagulant']

/** A small deterministic generator, so a failing sweep names the same case every run. */
function prng(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!
}

/** Random answers for every input: blank, or one of its own values. */
function randomValues(calc: CalculatorDef, random: () => number, extra: Record<string, readonly string[]>): CalcValues {
  const values: CalcValues = {}
  for (const input of calc.inputs) {
    const choices = extra[input.key] ?? (input.type === 'select' ? input.options.map((option) => option.value) : ['1'])
    values[input.key] = random() < 0.3 ? '' : pick(random, choices)
  }
  return values
}

function visible(calc: CalculatorDef, values: CalcValues, key: string): boolean {
  const input: CalcInput | undefined = calc.inputs.find((item) => item.key === key)
  return !!input && inputVisible(input, values)
}

describe('DOAC calculators: a field asked for is always on screen', () => {
  it('dose: every input an agent still needs is visible for that indication (4,000 random cases)', () => {
    const random = prng(20261022)
    const extra = { age: ['45', '78', '85'], weight: ['52', '70'], scr: ['0.9', '1.6', '3.2'], crcl_manual: ['12', '25', '45', '90'], vte_day: ['3', '15', '30'], postop_day: ['0', '3'] }
    const failures: string[] = []
    for (let run = 0; run < 4000; run += 1) {
      const values = randomValues(doseCalc, random, extra)
      const { results } = calculateDoacDoses(visibleValues(doseCalc.inputs, values))
      for (const result of results) {
        for (const key of result.missing) {
          const field = key === 'CrCl' ? 'scr' : key
          if (!visible(doseCalc, values, field)) failures.push(`${values.indication} ${result.agent}: ${key} hidden`)
        }
      }
    }
    expect([...new Set(failures)]).toEqual([])
  })

  it('peri-procedural: every input the plan still needs is visible (6,000 random cases)', () => {
    const random = prng(1103)
    const extra = {
      age: ['60', '82'], weight: ['55', '80'], scr: ['0.9', '2.4'], crcl_manual: ['10', '25', '40', '70', '95'],
      dose_time_1: ['08:00', '21:00'], dose_time_2: ['20:00', '08:00'],
      surgery_at: ['2026-11-03T08:00'], surgery_end_at: ['2026-11-03T10:00', '2026-11-03T07:00'],
      catheter_removed_at: ['2026-11-04T08:00'], sheath_removed_at: ['2026-11-03T12:00', '2026-11-03T09:00'],
    }
    const failures: string[] = []
    for (let run = 0; run < 6000; run += 1) {
      const values = randomValues(periopCalc, random, extra)
      const plan = calculatePeriop(visibleValues(periopCalc.inputs, values))
      for (const key of [...plan.missing, ...plan.pending]) {
        const field = key === 'CrCl' ? 'scr' : key === 'anaesthesia' ? 'traumatic_puncture' : key
        if (!visible(periopCalc, values, field)) failures.push(`${values.regimen} ${values.procedure_kind} ${values.neuraxial}: ${key} hidden`)
      }
    }
    expect([...new Set(failures)]).toEqual([])
  })

  it('an answer left in a hidden field never reaches the rules', () => {
    const values: CalcValues = { indication: 'nvaf', ddi_amiodarone: 'yes', pe_unstable: 'yes', postop_day: '2' }
    expect(visibleValues(doseCalc.inputs, values)).toMatchObject({ indication: 'nvaf', ddi_amiodarone: '', pe_unstable: '', postop_day: '' })
    expect(visibleValues(doseCalc.inputs, { ...values, indication: 'vtep-knee' })).toMatchObject({ ddi_amiodarone: 'yes', pe_unstable: '', postop_day: '2' })
    const periop: CalcValues = { regimen: 'rivaroxaban:20:1', dose_time_2: '20:00', procedure_kind: 'high', sheath_removed_at: '2026-11-03T12:00', neuraxial: 'none', traumatic_puncture: 'yes' }
    expect(visibleValues(periopCalc.inputs, periop)).toMatchObject({ dose_time_2: '', sheath_removed_at: '', traumatic_puncture: '' })
  })
})

describe('DOAC result panels read short', () => {
  const answered: CalcValues = { age: '70', sex: 'male', weight: '70', scr: '1.0', indication: 'nvaf', gi_risk: 'no', ...Object.fromEntries(DDI_KEYS.map((key) => [key, 'no'])) }

  it('an input all four agents need is asked once, above them', () => {
    render(<DoacDoseResults values={answered} locale="zh-TW" />)
    const shared = screen.getByTestId('doac-shared-missing')
    expect(within(shared).getByRole('button', { name: '透析' })).toBeInTheDocument()
    expect(within(shared).getByRole('button', { name: '懷孕／哺乳' })).toBeInTheDocument()
    for (const agent of ['apixaban', 'rivaroxaban', 'edoxaban']) {
      expect(within(screen.getByTestId(`doac-agent-${agent}`)).queryByRole('button', { name: '透析' })).toBeNull()
    }
    // One agent's own question stays under it.
    expect(within(screen.getByTestId('doac-agent-dabigatran')).getByRole('button', { name: 'ALT/AST' })).toBeInTheDocument()
  })

  it('the Taiwan-label checks, limits and labels are folded, the fold saying the labels are pending', () => {
    render(<DoacDoseResults values={answered} locale="zh-TW" />)
    const sources = screen.getByTestId('doac-sources')
    expect(sources).not.toHaveAttribute('open')
    expect(within(sources).getByText('來源與限制 · 臺灣仿單待藥學部核對')).toBeInTheDocument()
    expect(within(sources).getByTestId('doac-taiwan-checks')).toHaveTextContent('edoxaban 15 mg')
    expect(screen.getByTestId('doac-indication')).toHaveTextContent(/^NVAF · 依 EU SmPC$/)
  })

  it('the peri-procedural sources are folded too', () => {
    render(<DoacPeriopResults values={{ regimen: 'apixaban:5:2', procedure_kind: 'high', neuraxial: 'none' }} locale="zh-TW" />)
    const sources = screen.getByTestId('doac-sources')
    expect(sources).not.toHaveAttribute('open')
    expect(sources).toHaveTextContent('時數是最低間隔')
  })
})

describe('DOAC calculators on screen', () => {
  const clinicalSelects = (over: Record<string, string>) => Object.fromEntries(
    Object.entries(over).map(([key, value]) => [key, { value, date: '2026-10-21', testName: '目前有效處方未見（依處方推算，請核對）' }]),
  )
  function renderCalc(calc: CalculatorDef, selects: Record<string, string>) {
    jest.mocked(useLabAutofill).mockReturnValue({
      autofill: { resolve: () => undefined, sex: 'male', clinicalSelects: clinicalSelects(selects) },
      isLoading: false, error: null, retry: jest.fn(async () => {}),
    } as unknown as ReturnType<typeof useLabAutofill>)
    return render(
      <LanguageProvider>
        <CalculatorDetail calc={calc} onBack={() => {}} isFavorite={false} onToggleFavorite={() => {}} />
      </LanguageProvider>,
    )
  }
  afterEach(() => jest.clearAllMocks())

  it('NVAF: no VTE or hip/knee questions, no group hints, and the co-medications on one folded line', () => {
    const { container } = renderCalc(doseCalc, Object.fromEntries(DDI_KEYS.map((key) => [key, 'no'])))
    for (const key of ['parenteral_lead_in', 'anticoagulant_switch', 'pe_unstable', 'vte_day', 'postop_day', 'ddi_amiodarone', 'ddi_quinidine']) {
      expect(container.querySelector(`#calc-${key}`)).toBeNull()
    }
    expect(container.querySelector('#calc-indication')).not.toBeNull()
    expect(screen.queryByText(/VTE 與髖膝預防各有劑量規則/)).toBeNull()
    const ddi = screen.getByTestId('calc-group-ddi')
    expect(ddi).not.toHaveAttribute('open')
    expect(within(ddi).getByText('13 項無')).toBeInTheDocument()
    expect(screen.queryByText(/eu-smpc-nvaf-vte/)).toBeNull()
  })

  it('a co-medication on the prescriptions is named on the folded line; a blank one opens it', () => {
    const { unmount } = renderCalc(doseCalc, { ...Object.fromEntries(DDI_KEYS.map((key) => [key, 'no'])), ddi_verapamil: 'yes' })
    expect(within(screen.getByTestId('calc-group-ddi')).getByText('有 verapamil；其餘 12 項無')).toBeInTheDocument()
    expect(screen.getByTestId('calc-group-ddi')).not.toHaveAttribute('open')
    unmount()
    renderCalc(doseCalc, { ...Object.fromEntries(DDI_KEYS.map((key) => [key, 'no'])), ddi_tacrolimus: '' })
    expect(screen.getByTestId('calc-group-ddi')).toHaveAttribute('open')
    expect(within(screen.getByTestId('calc-group-ddi')).getByText('1 項未填；其餘 12 項無')).toBeInTheDocument()
  })

  it('an old weight keeps its value, with its age beside the date in amber; a recent creatinine does not', () => {
    jest.useFakeTimers({ now: new Date('2026-10-22T08:00:00+08:00'), doNotFake: ['setTimeout', 'setInterval', 'queueMicrotask', 'nextTick', 'setImmediate'] })
    jest.mocked(useLabAutofill).mockReturnValue({
      autofill: {
        resolve: (source: any) => source?.kind === 'vital' ? { value: 64, unit: 'kg', date: '2026-03-01' } : source?.kind === 'lab' ? { value: 1.1, unit: 'mg/dL', date: '2026-10-01' } : undefined,
        sex: 'male', clinicalSelects: {},
      },
      isLoading: false, error: null, retry: jest.fn(async () => {}),
    } as unknown as ReturnType<typeof useLabAutofill>)
    const { container } = render(
      <LanguageProvider>
        <CalculatorDetail calc={doseCalc} onBack={() => {}} isFavorite={false} onToggleFavorite={() => {}} />
      </LanguageProvider>,
    )
    expect(container.querySelector<HTMLInputElement>('#calc-weight')!.value).toBe('64')
    expect(screen.getByTestId('calc-stale-weight')).toHaveTextContent('2026-03-01 · 7 個月前')
    expect(screen.queryByTestId('calc-stale-scr')).toBeNull()
    jest.useRealTimers()
  })

  it('peri-procedural, once daily: no second dose time, no apixaban 2.5 question, no ablation or catheter times', () => {
    const { container } = renderCalc(periopCalc, { doacRegimen: 'rivaroxaban:20:1' })
    for (const key of ['dose_time_2', 'dose_intent', 'sheath_removed_at', 'catheter_removed_at', 'traumatic_puncture']) {
      expect(container.querySelector(`#calc-${key}`)).toBeNull()
    }
    expect(container.querySelector('#calc-dose_time_1')).not.toBeNull()
    expect(container.querySelector('#calc-surgery_end_at')).not.toBeNull()
    expect(screen.queryByText(/分級依 EHRA 2021 Table 12/)).toBeNull()
  })
})
