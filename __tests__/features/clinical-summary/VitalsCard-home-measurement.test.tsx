import { createHash, webcrypto } from 'node:crypto'
import { render, screen, waitFor } from '@testing-library/react'
import { VitalsCard } from '@/features/clinical-summary/vitals/VitalsCard'
import { homeMeasurementLink } from '@/features/clinical-summary/vitals/utils/home-measurement-link'

let mockPatient: any
let mockUser: any

// The card tests stand in a synthetic pilot account; the real check is tested below with its own hash set.
jest.mock('@/features/clinical-summary/vitals/utils/home-measurement-access', () => ({
  isHomeMeasurementPilotUser: async (user: any) => user?.email === 'pilot@example.test',
}))
const { isHomeMeasurementPilotUser } = jest.requireActual('@/features/clinical-summary/vitals/utils/home-measurement-access')

jest.mock('@/src/application/providers/auth.provider', () => ({
  useAuth: () => ({ user: mockUser }),
}))

jest.mock('@/src/application/hooks/patient/use-patient-query.hook', () => ({
  usePatient: () => ({ patient: mockPatient, loading: false, error: null }),
}))

jest.mock('@/features/clinical-summary/vitals/hooks/useVitals', () => ({
  useVitals: () => ({ vitalSigns: [], isLoading: false, error: null }),
}))

jest.mock('@/features/clinical-summary/vitals/hooks/useVitalsView', () => ({
  useVitalsView: () => [],
}))

jest.mock('@/features/clinical-summary/vitals/components/VitalsGrid', () => ({
  VitalsGrid: () => null,
}))

jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({
    t: { vitals: { title: '生命徵象', homeMeasurement: '居家量測', homeMeasurementHint: '限院內網路' } },
  }),
}))

const APP = 'https://mediprisma.tw/app/'
const HOSPITAL_LAUNCH = 'https://mediprisma.tw/app/?medcloud2=auto&site=vghtpe'
// Synthetic patients only.
const hospitalPatient = {
  id: '1000001', resourceType: 'Patient', name: [{ use: 'official', text: '示範甲' }], birthDate: '1950-01-01',
  identifier: [{ use: 'official', system: 'urn:oid:his.patient.mrn', value: '1000001' }],
}
const cloudPatient = {
  id: 'cloud-1', resourceType: 'Patient', name: [{ text: '示範乙' }], birthDate: '1960-02-02',
  identifier: [{ system: 'https://cloud-wildcatch.invalid/fhir/IdentifierSystem/masked-tw-national-id', value: 'A1234*****' }],
}
const hashOf = (link: string | null) => Object.fromEntries(new URLSearchParams(new URL(link!).hash.slice(1)))

describe('homeMeasurementLink', () => {
  it('opens a patient with hospital data by 病歷號, wherever the app was launched', () => {
    const link = homeMeasurementLink(hospitalPatient as any, APP)
    expect(link).toBe('https://health-app.mediprisma.tw/open#chart=1000001')
  })

  it('without a 病歷號, in the hospital launch, passes name and birth date for the service to offer as candidates', () => {
    const link = homeMeasurementLink(cloudPatient as any, HOSPITAL_LAUNCH)
    expect(link?.startsWith('https://health-app.mediprisma.tw/open#')).toBe(true)
    expect(hashOf(link)).toEqual({ name: '示範乙', birth: '1960-02-02' })
    expect(new URL(link!).search).toBe('')
  })

  it('without a 病歷號, a masked name or missing birth date opens the service home page instead', () => {
    expect(homeMeasurementLink({ ...cloudPatient, name: [{ text: '示○乙' }] } as any, HOSPITAL_LAUNCH)).toBe('https://health-app.mediprisma.tw/')
    expect(homeMeasurementLink({ ...cloudPatient, birthDate: undefined } as any, HOSPITAL_LAUNCH)).toBe('https://health-app.mediprisma.tw/')
  })

  it('gives no link outside the hospital launch when there is no 病歷號', () => {
    expect(homeMeasurementLink(cloudPatient as any, APP)).toBeNull()
    expect(homeMeasurementLink(cloudPatient as any, 'https://mediprisma.tw/app-hmc/')).toBeNull()
  })

  it('gives no link without a patient', () => {
    expect(homeMeasurementLink(null, HOSPITAL_LAUNCH)).toBeNull()
  })

  it('does not look at de-identification: the doctor sees the hospital records, so the 病歷號 is used as it is', () => {
    expect(homeMeasurementLink({ ...hospitalPatient, deidentified: true } as any, APP)).toBe('https://health-app.mediprisma.tw/open#chart=1000001')
    expect(homeMeasurementLink({ ...cloudPatient, name: [{ use: 'anonymous', text: '示範乙' }] } as any, HOSPITAL_LAUNCH))
      .toBe(`https://health-app.mediprisma.tw/open#${new URLSearchParams({ name: '示範乙', birth: '1960-02-02' })}`)
  })
})

const PILOT = { email: 'pilot@example.test', emailVerified: true }
const PILOT_HASHES = new Set([createHash('sha256').update('pilot@example.test').digest('hex')])

// jsdom's crypto has no subtle; the browser's does.
beforeAll(() => {
  if (!globalThis.crypto.subtle) {
    Object.defineProperty(globalThis.crypto, 'subtle', { value: webcrypto.subtle, configurable: true })
  }
})

describe('isHomeMeasurementPilotUser', () => {
  it('lets in only the pilot account, by verified email in any case', async () => {
    await expect(isHomeMeasurementPilotUser({ email: ' Pilot@Example.TEST ', emailVerified: true }, PILOT_HASHES)).resolves.toBe(true)
    await expect(isHomeMeasurementPilotUser({ ...PILOT, emailVerified: false }, PILOT_HASHES)).resolves.toBe(false)
    await expect(isHomeMeasurementPilotUser({ email: 'other@example.test', emailVerified: true }, PILOT_HASHES)).resolves.toBe(false)
    await expect(isHomeMeasurementPilotUser(null, PILOT_HASHES)).resolves.toBe(false)
    await expect(isHomeMeasurementPilotUser(PILOT)).resolves.toBe(false)
  })
})

describe('VitalsCard home readings button', () => {
  beforeEach(() => { mockUser = PILOT })

  it('opens the service in a new tab without sending this page as referrer', async () => {
    mockPatient = hospitalPatient
    render(<VitalsCard />)
    const link = await screen.findByRole('link', { name: /居家量測/ })
    expect(link).toHaveAttribute('href', 'https://health-app.mediprisma.tw/open#chart=1000001')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('is absent when there is nothing to open', async () => {
    mockPatient = cloudPatient
    render(<VitalsCard />)
    await waitFor(() => expect(screen.queryByRole('link', { name: /居家量測/ })).not.toBeInTheDocument())
  })

  it('is absent for any other account, even with a patient to open', async () => {
    mockPatient = hospitalPatient
    mockUser = { email: 'someone@example.com', emailVerified: true }
    render(<VitalsCard />)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByRole('link', { name: /居家量測/ })).not.toBeInTheDocument()
  })
})
