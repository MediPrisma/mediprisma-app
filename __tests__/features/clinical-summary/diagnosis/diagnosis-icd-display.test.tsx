import { render, renderHook, screen } from '@testing-library/react'
import { useDiagnosisRows } from '@/features/clinical-summary/diagnosis/hooks/useDiagnosisRows'
import { DiagnosisItem } from '@/features/clinical-summary/diagnosis/components/DiagnosisItem'
import { useResourceAnchor } from '@/src/application/hooks/use-resource-anchor.hook'

jest.mock('@/src/application/hooks/use-resource-anchor.hook', () => ({
  useResourceAnchor: jest.fn(() => null),
}))

function Diagnosis({ concept }: { concept: Record<string, unknown> }) {
  const [row] = useDiagnosisRows([{ id: 'synthetic-condition', code: concept }])
  return <ul><DiagnosisItem diagnosis={row} /></ul>
}

describe('recorded diagnosis ICD display', () => {
  it('shows the supplied ICD code beside the SOAP diagnosis name even when another coding comes first', () => {
    render(<Diagnosis concept={{
      text: 'Synthetic diagnosis',
      coding: [
        { system: 'http://snomed.info/sct', code: '123456' },
        { system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'C50.912' },
        { system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'C50.912' },
      ],
    }} />)

    expect(screen.getByRole('listitem')).toHaveTextContent('C50.912 Synthetic diagnosis')
    expect(screen.getAllByText('C50.912')).toHaveLength(1)
    expect(screen.queryByText('123456')).not.toBeInTheDocument()
  })

  it('shows a supplied code once when the source has no diagnosis name', () => {
    render(<Diagnosis concept={{
      coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code: 'I10' }],
    }} />)

    expect(screen.getByRole('listitem')).toHaveTextContent(/^I10$/)
  })

  it('keeps a text-only diagnosis without inventing an ICD code', () => {
    render(<Diagnosis concept={{ text: 'Uncoded source diagnosis' }} />)
    expect(screen.getByRole('listitem')).toHaveTextContent(/^Uncoded source diagnosis$/)
  })
})

describe('repeated diagnosis display groups', () => {
  it('retains the clinical onset date separately from the source recording date', () => {
    const { result } = renderHook(() => useDiagnosisRows([{ id: 'onset', onsetDateTime: '2019-02-03', recordedDate: '2026-10-19', code: { text: 'Source diagnosis' } }]))
    expect(result.current[0].when).toBe('2019/2/3')
    expect(result.current[0].records?.[0]).toMatchObject({ when: '2026/10/19', onsetWhen: '起始日期 2019/2/3' })
  })
  const condition = (id: string, code: string, date: string, extra = {}) => ({
    id, recordedDate: date, encounter: { reference: `Encounter/${id}-visit` },
    code: { text: 'Synthetic diagnosis', coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code }] },
    ...extra,
  })

  it('shows one code row with the latest date and keeps both original dates, facilities and navigation targets', () => {
    const conditions = [condition('old', 'B02.9', '2026-03-03'), condition('new', 'B029', '2026-09-17')]
    const before = JSON.stringify(conditions)
    const encounters = ['old', 'new'].map((id) => ({ id: `${id}-visit`, serviceProvider: { display: `${id}院所` } }))
    const { result } = renderHook(() => useDiagnosisRows(conditions, 'zh-TW', undefined, encounters))
    expect(result.current).toHaveLength(1)
    expect(result.current[0].when).toBe('2026/9/17')
    expect(result.current[0].records?.map((record) => record.id)).toEqual(['new', 'old'])
    render(<ul><DiagnosisItem diagnosis={result.current[0]} /></ul>)
    expect(screen.getByText('查看 2 筆紀錄')).toBeInTheDocument()
    expect(screen.getByText('old院所')).toBeInTheDocument()
    expect(screen.getByText('new院所')).toBeInTheDocument()
    expect(useResourceAnchor).toHaveBeenCalledWith('Condition', ['new', 'old'], expect.any(Function))
    const details = screen.getByText('查看 2 筆紀錄').closest('details')!
    expect(details.open).toBe(false)
    const match = (useResourceAnchor as jest.Mock).mock.calls.at(-1)![2]
    match()
    expect(details.open).toBe(true)
    expect(JSON.stringify(conditions)).toBe(before)
  })

  it.each(['clinicalStatus', 'verificationStatus', '_cancerStage', 'codingSystem'])(
    'keeps %s differences visible', (field) => {
      const first: any = condition('one', 'C50.912', '2026-03-03')
      const second: any = condition('two', 'C50.912', '2026-09-17')
      if (field === 'clinicalStatus') { first.clinicalStatus = 'active'; second.clinicalStatus = 'resolved' }
      if (field === 'verificationStatus') { first.verificationStatus = 'confirmed'; second.verificationStatus = 'provisional' }
      if (field === '_cancerStage') { first._cancerStage = 'Stage I'; second._cancerStage = 'Stage II' }
      if (field === 'codingSystem') second.code.coding[0].system = 'http://hl7.org/fhir/sid/icd-10'
      const { result } = renderHook(() => useDiagnosisRows([first, second]))
      expect(result.current).toHaveLength(2)
    },
  )

  it('does not merge uncoded diagnoses just because their text is identical', () => {
    const { result } = renderHook(() => useDiagnosisRows([
      { id: 'one', code: { text: 'Synthetic source text' } }, { id: 'two', code: { text: 'Synthetic source text' } },
    ]))
    expect(result.current).toHaveLength(2)
  })
})
