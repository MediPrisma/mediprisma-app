import { fireEvent, render, screen } from '@testing-library/react'
import { PatientInfoCard } from '@/features/clinical-summary/patient-info/PatientInfoCard'

const mockSaveProfile = jest.fn().mockResolvedValue(undefined)
let mockSourceMetadata: any
let mockPatient: any
let mockLocalProfile: any

jest.mock('@/src/application/hooks/patient/use-patient-query.hook', () => ({
  usePatient: () => ({
    patient: mockPatient,
    loading: false,
    error: null,
  }),
}))

jest.mock('@/src/application/hooks/clinical-data/use-clinical-data-query.hook', () => ({
  useClinicalData: () => ({ sourceMetadata: mockSourceMetadata }),
}))

jest.mock('@/src/application/hooks/patient/use-local-patient-profile.hook', () => ({
  useLocalPatientProfile: () => mockLocalProfile,
}))

jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
  },
}))

jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({
    t: {
      common: { cancel: '取消', save: '儲存' },
      errors: { fetchPatient: '無法取得病人資料' },
      patient: {
        info: '病人資訊',
        name: '姓名',
        gender: '性別',
        age: '年齡',
        birthDate: '出生日期',
        birthYear: '出生年',
        male: '男性',
        female: '女性',
        other: '其他',
        unknown: '未知',
        userEntered: '自行填寫',
        addLocalProfile: '補充資料',
        editLocalProfile: '編輯資料',
        profileDialogTitle: '補充或更新病人基本資料',
        profileDialogDescription: 'SDK 沒有提供結構化基本資料',
        namePlaceholder: '輸入姓名（選填）',
        leaveUnknown: '維持未知',
        ageCalculatedFromBirthDate: '年齡會自動計算',
        ageCalculatedFromBirthYear: '只需填出生年',
        localProfilePrivacy: '只會加密保存在這個瀏覽器',
        invalidBirthDate: '出生日期無效',
        invalidBirthYear: '出生年無效',
        profileSaveFailed: '無法安全儲存',
        clearUserEntered: '清除自行填寫資料',
        savingProfile: '儲存中…',
        profileSaved: '已儲存',
        profileCleared: '已清除',
        showMore: '顯示更多資料',
        showLess: '收合詳細資料',
        moreDetails: '更多資料',
        ageValue: '{age}歲',
        nationalId: '身分證字號',
        medicalRecordNumber: '病歷號',
        passportNumber: '護照號碼',
        socialSecurityNumber: '社會安全號碼',
        identifierGeneric: '識別碼',
        phone: '電話',
        email: 'Email',
        fax: '傳真',
        sms: '簡訊',
        contactGeneric: '聯絡方式',
        address: '地址',
        maritalStatus: '婚姻狀態',
        married: '已婚',
        single: '未婚',
        divorced: '離婚',
        widowed: '喪偶',
        separated: '分居',
        language: '語言',
        languageZhTW: '繁體中文',
        languageZhCN: '簡體中文',
        languageEn: '英文',
        languageJa: '日文',
        contact: '聯絡人',
        relationshipFather: '父親',
        relationshipMother: '母親',
        relationshipSpouse: '配偶',
        relationshipSibling: '兄弟姐妹',
        relationshipChild: '子女',
        relationshipGuardian: '監護人',
        relationshipEmergency: '緊急聯絡人',
      },
    },
  }),
}))

describe('PatientInfoCard SDK local profile', () => {
  beforeEach(() => {
    mockSourceMetadata = { source: 'health-bank-sdk-json' }
    mockPatient = {
      resourceType: 'Patient',
      id: 'sdk-patient',
      name: [{ text: 'Unknown' }],
      gender: 'unknown',
    }
    mockLocalProfile = {
      available: true,
      importId: 'import-1',
      profile: null,
      saving: false,
      saveProfile: mockSaveProfile,
    }
  })

  it('shows SDK demographics immediately and opens the optional editor only on request', () => {
    render(<PatientInfoCard />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getAllByText('未知')).toHaveLength(2)
    expect(screen.getByText('N/A')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '補充資料' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('also exposes the editor for a non-SDK local FHIR import', () => {
    mockSourceMetadata = undefined
    render(<PatientInfoCard />)

    expect(screen.getByRole('button', { name: '補充資料' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens the editor with demographics from the current patient', () => {
    mockPatient = {
      ...mockPatient,
      name: [{ text: '陳○明' }],
      gender: 'male',
      birthDate: '1932-05-20',
    }
    render(<PatientInfoCard />)

    fireEvent.click(screen.getByRole('button', { name: '補充資料' }))

    expect(screen.getByLabelText('姓名')).toHaveValue('陳○明')
    expect(screen.getByRole('combobox', { name: '性別' })).toHaveTextContent('男性')
    expect(screen.getByLabelText('出生日期')).toHaveValue('1932-05-20')
  })

  it('marks each demographic value supplied by the user', () => {
    mockPatient = {
      ...mockPatient,
      name: [{ text: '王小明' }],
      gender: 'male',
      birthDate: '1980-01-15',
      demographicsSource: 'user-entered-local-profile',
      userEnteredDemographicFields: ['name', 'gender', 'birthDate'],
    }
    mockLocalProfile = {
      ...mockLocalProfile,
      profile: {
        source: 'user-entered',
        name: '王小明',
        gender: 'male',
        birthDate: '1980-01-15',
        updatedAt: '2026-07-30T00:00:00.000Z',
      },
    }
    render(<PatientInfoCard />)

    expect(screen.getByText('王小明')).toBeInTheDocument()
    expect(screen.getByText('男性')).toBeInTheDocument()
    // Name, gender, calculated age, and the detailed birth-date row.
    expect(screen.getAllByText('自行填寫')).toHaveLength(4)
    expect(screen.getByRole('button', { name: '編輯資料' })).toBeInTheDocument()
  })

  it('keeps the extended demographics behind 更多資料 until asked for', () => {
    mockPatient = {
      ...mockPatient,
      name: [{ text: '陳○明' }],
      gender: 'male',
      birthDate: '1932-05-20',
      identifier: [{ system: 'https://twcore.mohw.gov.tw/IdentifierSystem/national-id', value: 'A123456789' }],
    }
    render(<PatientInfoCard />)

    const toggle = screen.getByRole('button', { name: '更多資料' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    const details = document.getElementById(toggle.getAttribute('aria-controls')!)
    expect(details).not.toBeVisible()
    expect(details).toHaveTextContent('A123456789')

    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: '收合詳細資料' })).toHaveAttribute('aria-expanded', 'true')
    expect(details).toBeVisible()
  })
})
