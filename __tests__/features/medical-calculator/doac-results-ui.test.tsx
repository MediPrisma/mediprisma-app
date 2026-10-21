import { render, screen, within } from '@testing-library/react'
import { DoacDoseResults } from '@/features/medical-calculator/components/DoacDoseResults'
import { DoacPeriopResults } from '@/features/medical-calculator/components/DoacPeriopResults'
import type { CalcValues } from '@/features/medical-calculator/types'

const answered: CalcValues = {
  age: '70', sex: 'male', weight: '70', scr: '1.0', dialysis: 'no', liver: 'none', liver_enzymes: 'no', bilirubin_high: 'no', pregnancy: 'no', gi_risk: 'no',
  parenteral_lead_in: 'done', pe_unstable: 'no',
  ...Object.fromEntries(['ddi_ketoconazole', 'ddi_itraconazole', 'ddi_vori_posaconazole', 'ddi_hiv_pi', 'ddi_ciclosporin', 'ddi_tacrolimus', 'ddi_dronedarone', 'ddi_verapamil', 'ddi_amiodarone', 'ddi_quinidine', 'ddi_erythromycin', 'ddi_clarithromycin', 'ddi_glecaprevir', 'ddi_inducer', 'ddi_anticoagulant'].map((key) => [key, 'no'])),
}

describe('DOAC dose results by indication', () => {
  it('acute VTE: each agent shows its phases, edoxaban and dabigatran after the parenteral lead-in', () => {
    render(<DoacDoseResults values={{ ...answered, indication: 'vte-acute' }} locale="zh-TW" />)
    expect(screen.getByTestId('doac-indication')).toHaveTextContent('急性 DVT／PE 治療')
    expect(screen.getByTestId('doac-schedule-apixaban')).toHaveTextContent('第 1–7 天：10 mg bid')
    expect(screen.getByTestId('doac-schedule-apixaban')).toHaveTextContent('第 8 天起：5 mg bid')
    expect(screen.getByTestId('doac-schedule-edoxaban')).toHaveTextContent('先用注射抗凝（LMWH 或 UFH）≥5 天')
  })
  it('knee prophylaxis: the duration, and edoxaban as not indicated', () => {
    render(<DoacDoseResults values={{ ...answered, indication: 'vtep-knee' }} locale="zh-TW" />)
    expect(within(screen.getByTestId('doac-agent-rivaroxaban')).getByText(/療程：膝關節置換：2 週/)).toBeInTheDocument()
    expect(screen.getByTestId('doac-agent-edoxaban')).toHaveAttribute('data-verdict', 'not-indicated')
    expect(screen.getByTestId('doac-agent-edoxaban')).toHaveTextContent('未核准此適應症')
  })
  it('a quotation from the 2.5 mg SmPC says so', () => {
    render(<DoacDoseResults values={{ ...answered, indication: 'vtep-hip' }} locale="zh-TW" />)
    expect(within(screen.getByTestId('doac-agent-apixaban')).getAllByText(/^Eliquis 2\.5 mg SmPC §4\.2 · p\.2$/).length).toBeGreaterThan(0)
  })
})

describe('DOAC peri-procedural results', () => {
  const spec: CalcValues = {
    regimen: 'apixaban:5:2', dose_time_1: '08:00', dose_time_2: '20:00', age: '70', sex: 'male', weight: '70', scr: '1.0', crcl_manual: '62', dialysis: 'no',
    procedure_kind: 'high', neuraxial: 'single', surgery_at: '2026-11-03T08:00', surgery_end_at: '2026-11-03T10:00', traumatic_puncture: 'no',
  }
  it('shows the interval, the last dose, the skipped doses and the earliest restart', () => {
    render(<DoacPeriopResults values={spec} locale="zh-TW" />)
    expect(screen.getByTestId('doac-periop-hold')).toHaveTextContent('最後一劑距手術 ≥72 小時')
    expect(screen.getByTestId('doac-periop-clock')).toHaveTextContent('最晚服藥：10-31 08:00')
    expect(screen.getByTestId('doac-periop-clock')).toHaveTextContent('跳過 6 劑')
    expect(screen.getByTestId('doac-periop-resume')).toHaveTextContent('最早 11-05 10:00')
    expect(screen.getAllByText('ASRA 2025 Apixaban, high dose · p.8').length).toBeGreaterThan(0)
  })
  it('the first dose back carries the model’s own dose wording, never a fixed 「術前的治療劑量」 (#review final Astra 1)', () => {
    const { unmount } = render(<DoacPeriopResults values={{ ...spec, regimen: 'apixaban:10:2', neuraxial: 'none' }} locale="zh-TW" />)
    const resume = screen.getByTestId('doac-periop-resume')
    expect(resume).toHaveTextContent('恢復的第一劑')
    expect(resume).toHaveTextContent('不自動接回起始劑量；需確認止血')
    expect(resume).not.toHaveTextContent('術前的治療劑量；需確認止血')
    unmount()
    render(<DoacPeriopResults values={{ ...spec, neuraxial: 'none' }} locale="zh-TW" />)
    expect(screen.getByTestId('doac-periop-resume')).toHaveTextContent('給回術前的治療劑量，不需起始負荷；需確認止血')
  })
  it('minor risk: “not stopped early”, and the dose at the start is listed as held', () => {
    render(<DoacPeriopResults values={{ ...spec, neuraxial: 'none', procedure_kind: 'minimal', haemostasis: 'yes' }} locale="zh-TW" />)
    expect(screen.getByTestId('doac-periop-hold')).toHaveTextContent('不提前停藥・谷底約 12 小時')
    expect(screen.getByTestId('doac-periop-resume')).toHaveTextContent('處置當下到恢復前延後 1 劑：11-03 08:00')
  })
  it('CrCl 12: no interval, asked to assess individually', () => {
    render(<DoacPeriopResults values={{ ...spec, crcl_manual: '12' }} locale="zh-TW" />)
    expect(screen.getByTestId('doac-periop-results')).toHaveAttribute('data-state', 'no-hours')
    expect(screen.queryByTestId('doac-periop-clock')).toBeNull()
    expect(screen.getByTestId('doac-periop-hold')).toHaveTextContent('No official indication for use')
  })
  it('blank answers are asked for, not assumed', () => {
    render(<DoacPeriopResults values={{ ...spec, neuraxial: '', procedure_kind: '' }} locale="zh-TW" />)
    const hold = screen.getByTestId('doac-periop-hold')
    expect(within(hold).getByRole('button', { name: '處置分級' })).toBeInTheDocument()
    expect(within(hold).getByRole('button', { name: '脊髓／硬膜外或深部阻斷' })).toBeInTheDocument()
  })
})
