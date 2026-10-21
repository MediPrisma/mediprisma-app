// Which report is "the latest echo" / "the latest ECG" for a copy format.
import { classifyExamKind, resolveLatestExams } from '@/features/ips-export/utils/emr-exam-kinds'

const NHI = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medical-treatment-nhi-tw'

function report(title: string, date: string, opts: { code?: string; text?: string; status?: string; id?: string } = {}) {
  return {
    resourceType: 'DiagnosticReport',
    id: opts.id ?? `${title}-${date}`,
    status: opts.status ?? 'final',
    code: { ...(opts.code ? { coding: [{ system: NHI, code: opts.code }] } : {}), text: title },
    effectiveDateTime: `${date}T10:00:00+08:00`,
    ...(opts.text ? { conclusion: opts.text } : {}),
  }
}

describe('classifyExamKind', () => {
  it('uses NHI order codes first', () => {
    expect(classifyExamKind(report('心臟檢查', '2026-01-01', { code: '18005C' }))).toBe('echo')
    expect(classifyExamKind(report('Color Doppler', '2026-01-01', { code: '18007C' }))).toBe('echo')
    expect(classifyExamKind(report('Routine', '2026-01-01', { code: '18001C' }))).toBe('ecg')
  })

  it('falls back to the title', () => {
    expect(classifyExamKind(report('Transthoracic echocardiography', '2026-01-01'))).toBe('echo')
    expect(classifyExamKind(report('12-lead ECG', '2026-01-01'))).toBe('ecg')
    expect(classifyExamKind(report('心電圖', '2026-01-01'))).toBe('ecg')
  })

  it('keeps Holter, exercise tests and TEE apart', () => {
    expect(classifyExamKind(report('Holter ECG 24 hr', '2026-01-01'))).toBeNull()
    expect(classifyExamKind(report('Exercise ECG (treadmill)', '2026-01-01'))).toBeNull()
    expect(classifyExamKind(report('Transesophageal echocardiography (TEE)', '2026-01-01'))).toBeNull()
  })

  it('never reads the narrative to decide', () => {
    expect(classifyExamKind(report('Chest PA', '2026-01-01', { code: '32001C', text: 'ECG leads noted.' }))).toBeNull()
  })
})

describe('resolveLatestExams', () => {
  it('folds the identical-text 2D and Doppler parts of one echo', () => {
    const text = 'LVEF 60%. No regional wall motion abnormality.'
    const exams = resolveLatestExams([
      report('Echocardiography', '2026-03-12', { code: '18005C', text }),
      report('Color Doppler echocardiography', '2026-03-12', { code: '18007C', text }),
    ])
    expect(exams.echo.latest).toHaveLength(1)
  })

  it('keeps two different same-day reports and lets the caller say so', () => {
    const exams = resolveLatestExams([
      report('ECG', '2026-09-18', { code: '18001C', text: 'Sinus rhythm.' }),
      report('ECG', '2026-09-18', { code: '18001C', text: 'Atrial fibrillation.', id: 'second' }),
    ])
    expect(exams.ecg.latest).toHaveLength(2)
  })

  it('records a newer report without text instead of skipping past it', () => {
    const exams = resolveLatestExams([
      report('ECG', '2026-09-18', { code: '18001C', text: 'Sinus rhythm.' }),
      report('ECG', '2026-09-25', { code: '18001C' }),
    ])
    expect(exams.ecg.latest[0].date).toBe('2026-09-18')
    expect(exams.ecg.newerWithoutText).toEqual({ date: '2026-09-25', title: 'ECG' })
  })

  it('drops entered-in-error reports and surfaces unfinished status', () => {
    const exams = resolveLatestExams([
      report('ECG', '2026-09-18', { code: '18001C', text: 'Sinus rhythm.', status: 'preliminary' }),
      report('ECG', '2026-09-20', { code: '18001C', text: 'Wrong patient.', status: 'entered-in-error' }),
    ])
    expect(exams.ecg.latest[0].date).toBe('2026-09-18')
    expect(exams.ecg.unfinishedStatus).toBe('preliminary')
  })
})
