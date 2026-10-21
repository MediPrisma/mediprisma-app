import { fireEvent, render, screen, within } from '@testing-library/react'
import { HYPERLIPIDEMIA_GUIDELINE_PACK, type CdssPatientProfile } from '@voho0000/personalized-care'
import { createFhirCdssPatientProfile } from '@voho0000/personalized-care-fhir'
import type {
  HostEncounter,
  HostMedication,
  HostPatient,
} from '@voho0000/personalized-care-fhir'
import { NhiTable1Panel } from '@/features/clinical-decision-support/renderers/NhiTable1Panel'
import { NhiLipidCoverageSummary } from '@/features/clinical-decision-support/renderers/NhiLipidCoverageSummary'
import { buildNhiRecordSources } from '@/features/clinical-decision-support/renderers/ClinicalDecisionSupportView'
import { useNhiLipidAiAssist } from '@/features/clinical-decision-support/hooks/use-nhi-lipid-ai-assist.hook'
import { useNhiLipidReviewStore } from '@/features/clinical-decision-support/stores/nhi-lipid-review.store'
import { applyPreventReading, buildPreventReading } from '@/features/clinical-decision-support/utils/prevent-reading'

jest.mock('@/features/clinical-decision-support/hooks/use-nhi-lipid-ai-assist.hook', () => ({
  useNhiLipidAiAssist: jest.fn(),
}))
jest.mock('@/features/data-selection', () => ({ DataSelectionDrawer: () => null }))
jest.mock('@/src/shared/components/ModelPicker', () => ({ ModelPicker: () => null }))

/**
 * Diabetes that only the prescriptions show. A 雲端病歷 row carries the
 * claim's principal diagnosis alone, so a visit billed as I10 hides the E11 or
 * E13 beside it; the acarbose and semaglutide written at that visit are what
 * is left. Both lipid layouts — 健保表一 and 三區塊 — read the same pack row.
 *
 * Drug-master strings copied from nhi-drug-terminology-20260728: Dibose is
 * acarbose A10BF01, Ozempic is semaglutide A10BJ06, Forxiga is dapagliflozin
 * A10BK01.
 */

const NOW = new Date('2026-09-29T00:00:00+08:00')
const ICD10_CM = 'http://hl7.org/fhir/sid/icd-10-cm'
const patient: HostPatient = { id: 'dm-by-drug', resourceType: 'Patient', gender: 'male', birthDate: '1960-01-01' }

function prescription(id: string, text: string, ingredientText: string, atcCode: string): HostMedication {
  return {
    id,
    status: 'unknown',
    authoredOn: '2026-09-23',
    medicationCodeableConcept: { text },
    dispenseRequest: { expectedSupplyDuration: { value: 28, unit: 'd' } },
    drugTerminology: { source: 'nhi-official-drug-master', snapshotId: 'nhi-drug-terminology-20260728', ingredientText, atcCode },
  }
}

function visit(id: string, date: string, codes: readonly string[]): HostEncounter {
  return {
    id,
    status: 'finished',
    class: { code: 'AMB' },
    period: { start: date },
    reasonCode: codes.map((code) => ({ coding: [{ system: ICD10_CM, code }] })),
  } as HostEncounter
}

function profileOf(medications: HostMedication[]): CdssPatientProfile {
  return createFhirCdssPatientProfile({
    patient,
    conditions: [],
    encounters: [visit('lipid-visit', '2026-06-23', ['E78.41']), visit('bp-visit', '2026-09-23', ['I10'])],
    observations: [],
    medications,
    allergies: [],
    carePlans: [],
    now: NOW,
  })
}

const ON_DRUGS = () => profileOf([
  prescription('dibose', '〝元宙〞克血糖膜衣錠 Dibose F.C. Tablets "Y.C."', 'ACARBOSE 100 MG', 'A10BF01'),
  prescription('ozempic', '胰妥讚 注射劑 Ozempic solution for injection', 'SEMAGLUTIDE 1.34 MG/ML', 'A10BJ06'),
])
const ON_SGLT2I_ALONE = () => profileOf([
  prescription('forxiga', '福適佳 膜衣錠 10 毫克', 'DAPAGLIFLOZIN 10 MG', 'A10BK01'),
])

function riskCard(profile: CdssPatientProfile) {
  const card = HYPERLIPIDEMIA_GUIDELINE_PACK.build({ profile, locale: 'zh-TW' })
    .recommendations.find((item) => item.id === 'dyslipidemia-risk-and-target')
  if (!card?.coverageSummary) throw new Error('Expected the NHI lipid coverage summary')
  return card
}

beforeEach(() => {
  jest.mocked(useNhiLipidAiAssist).mockReturnValue({
    suggestions: {}, decisions: {}, isRunning: false, isDataReady: true, error: null,
    modelId: 'test', modelName: 'Test', run: jest.fn(async () => undefined), decide: jest.fn(),
  })
  useNhiLipidReviewStore.getState().activate('dm-by-drug')
})

describe('健保表一: diabetes from glucose-lowering drugs', () => {
  it('marks 糖尿病 ◐ and traces it to the prescriptions', () => {
    const profile = ON_DRUGS()
    render(
      <NhiTable1Panel
        summary={riskCard(profile).coverageSummary!}
        locale="zh-TW"
        patientId="dm-by-drug"
        onAnswer={jest.fn()}
        onNavigate={jest.fn()}
        recordSources={buildNhiRecordSources(profile.facts)}
      />,
    )

    expect(screen.getByText('申報紀錄（診斷碼或處方）支持，須臨床確認')).toBeVisible()
    const row = screen.getAllByRole('button', { name: /^糖尿病/ })[0]
    expect(row).toHaveTextContent('◐')
    fireEvent.click(row)
    const popover = screen.getByTestId('nhi-criterion-popover-diabetes')
    expect(popover).toHaveTextContent('降血糖藥使用中')
    expect(within(popover).getByRole('button', { name: /開啟原始病歷 · ACARBOSE 100 MG/ })).toBeVisible()
    expect(within(popover).getByRole('button', { name: /開啟原始病歷 · SEMAGLUTIDE/ })).toBeVisible()
  })

  it('points the fasting-glucose component at the same prescriptions', () => {
    const sources = buildNhiRecordSources(ON_DRUGS().facts)
    expect(sources?.['met-glucose']?.map((source) => source.resourceId)).toEqual(['dibose', 'ozempic'])
    expect(sources?.diabetes?.map((source) => source.resourceId)).toEqual(['dibose', 'ozempic'])
  })

  it('does not read an SGLT2 inhibitor alone as diabetes', () => {
    const profile = ON_SGLT2I_ALONE()
    const summary = riskCard(profile).coverageSummary!
    expect(summary.diseaseChecks.find((check) => check.id === 'diabetes')?.state).toBe('unknown')
    expect(buildNhiRecordSources(profile.facts)?.diabetes).toBeUndefined()
  })
})

describe('三區塊: diabetes from glucose-lowering drugs', () => {
  function diagnosisSection(profile: CdssPatientProfile) {
    render(<NhiLipidCoverageSummary recommendation={riskCard(profile)} locale="zh-TW" patientId="dm-by-drug" presentation="diagnosis" />)
    return screen.getByTestId('lipid-diagnosis-confirmation')
  }
  const summaryOf = (section: HTMLElement, label: string) => within(section)
    .getAllByText(label, { selector: 'summary > span' })[0].closest('summary')!

  it('shows 糖尿病 and 空腹血糖偏高 as met, with the drugs as the reason', () => {
    const section = diagnosisSection(ON_DRUGS())

    const diabetes = summaryOf(section, '糖尿病')
    expect(diabetes).toHaveTextContent('✓ 符合')
    fireEvent.click(diabetes)
    expect(diabetes.closest('details')).toHaveTextContent('降血糖藥使用中')
    expect(summaryOf(section, '空腹血糖偏高')).toHaveTextContent('✓ 符合')
  })

  it('leaves 糖尿病 to confirm for an SGLT2 inhibitor alone', () => {
    const section = diagnosisSection(ON_SGLT2I_ALONE())
    expect(summaryOf(section, '糖尿病')).toHaveTextContent('? 待確認')
  })
})

describe('a clinician\'s 「否」 in PREVENT reaches every lipid card', () => {
  it('takes the treatment card off the diabetes pathway and answers 表一\'s 糖尿病 row', () => {
    const noAutofill = { resolve: () => undefined }
    const onDrugs = ON_DRUGS()
    const answered = applyPreventReading(onDrugs, buildPreventReading(onDrugs, noAutofill, { dm: 'no' }))
    const therapy = (profile: CdssPatientProfile) => JSON.stringify(HYPERLIPIDEMIA_GUIDELINE_PACK.build({ profile, locale: 'zh-TW' })
      .recommendations.find((item) => item.id === 'dyslipidemia-lipid-lowering-therapy'))

    expect(therapy(onDrugs)).toContain('糖尿病／CKD 高風險路徑')
    expect(therapy(answered)).not.toContain('糖尿病／CKD')
    expect(riskCard(answered).coverageSummary!.diseaseChecks.find((check) => check.id === 'diabetes')).toMatchObject({
      state: 'no',
      origin: 'physician',
      value: expect.stringContaining('醫師於 PREVENT 回答否'),
    })

    render(<NhiLipidCoverageSummary recommendation={riskCard(answered)} locale="zh-TW" patientId="dm-by-drug" presentation="diagnosis" />)
    const section = screen.getByTestId('lipid-diagnosis-confirmation')
    const row = within(section).getAllByText('糖尿病', { selector: 'summary > span' })[0].closest('details')!
    expect(row.querySelector('summary')).toHaveTextContent('× 不符合')
    expect(row).toHaveTextContent('醫師修正')
    expect(row).not.toHaveTextContent('依資料預選')
    const glucose = within(section).getAllByText('空腹血糖偏高', { selector: 'summary > span' })[0].closest('details')!
    expect(glucose.querySelector('summary')).toHaveTextContent('? 待確認')
    expect(glucose).toHaveTextContent('用藥不計入本項')
  })
})
