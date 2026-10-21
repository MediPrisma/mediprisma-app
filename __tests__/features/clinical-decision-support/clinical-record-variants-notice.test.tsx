import { render, screen } from '@testing-library/react'
import { ClinicalRecordVariantsNotice } from '@/features/clinical-decision-support/renderers/ClinicalRecordVariantsNotice'
import { selectCdssClinicalInputs } from '@/features/clinical-decision-support/utils/clinical-record-inputs'

it('explains actual quarantined evidence while leaving the remaining decision surface visible', () => {
  const annotation = { groupId: 'synthetic', classification: 'conflict' as const, variantCount: 2, reason: 'Conflicting source record payloads' }
  const selected = selectCdssClinicalInputs({ observations: [{ id: 'one', clinicalRecordVariant: annotation }, { id: 'two', clinicalRecordVariant: annotation }, { id: 'normal' }] })
  const { rerender } = render(<><ClinicalRecordVariantsNotice excluded={selected.excluded} locale="zh-TW" /><div>評估結果</div></>)
  expect(screen.getByTestId('cdss-source-record-variants')).toHaveTextContent('治療決策需先核對來源；已確認的安全證據仍保留')
  expect(screen.getByText('評估結果')).toBeVisible()
  expect(selected.input.observations).toEqual([{ id: 'normal' }])
  rerender(<ClinicalRecordVariantsNotice excluded={[]} locale="zh-TW" />)
  expect(screen.queryByTestId('cdss-source-record-variants')).not.toBeInTheDocument()
})
