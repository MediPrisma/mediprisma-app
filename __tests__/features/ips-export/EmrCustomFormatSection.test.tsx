// 帶回病歷 → 我的格式: preview equals clipboard, per-patient exam decisions,
// and a format built by typing and inserting fields.
import { fireEvent, render, screen, within } from '@testing-library/react'
import { zhTW } from '@/src/shared/i18n/locales/zh-TW'
import { EmrCustomFormatSection } from '@/features/ips-export/components/EmrCustomFormatSection'
import { starterTokens } from '@/features/ips-export/utils/emr-custom-format'
import { useOutpatientPrefsStore } from '@/src/application/stores/outpatient-prefs.store'
import { buildLabPivots } from '@/src/shared/utils/lab-pivot.utils'

jest.mock('@/src/application/providers/language.provider', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { zhTW: translations } = require('@/src/shared/i18n/locales/zh-TW')
  return { useLanguage: () => ({ t: translations, locale: 'zh-TW' }) }
})
jest.mock('@/src/application/providers/auth.provider', () => ({
  useAuth: () => ({ user: { uid: 'doc-1' }, anonymousUid: null }),
}))

const x = zhTW.ipsExport.emrHandoff
const THIS_YEAR = String(new Date().getFullYear())

function obs(code: string, date: string, value: number) {
  return {
    resourceType: 'Observation',
    code: { text: code },
    effectiveDateTime: `${date}T09:00:00+08:00`,
    valueQuantity: { value, unit: 'mg/dL' },
  }
}

function report(code: string, title: string, date: string, text?: string) {
  return {
    resourceType: 'DiagnosticReport',
    id: `${code}-${date}`,
    status: 'final',
    code: { coding: [{ system: 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medical-treatment-nhi-tw', code }], text: title },
    effectiveDateTime: `${date}T10:00:00+08:00`,
    ...(text ? { conclusion: text } : {}),
  }
}

const PIVOTS = buildLabPivots([
  obs('LDL', `${THIS_YEAR}-09-18`, 101),
  obs('HDL', `${THIS_YEAR}-09-18`, 50),
  obs('TG', `${THIS_YEAR}-09-18`, 182),
])

const REPORTS = [
  report('18001C', 'ECG', `${THIS_YEAR}-09-18`, 'Sinus rhythm.'),
  report('18001C', 'ECG', `${THIS_YEAR}-09-25`),
]

function seed(tokens = starterTokens('lipid', [])) {
  useOutpatientPrefsStore.getState().update('doc-1', {
    formats: [{ id: 'f1', name: '血脂', tokens, labRule: 'sameDay', missingText: '—', dateStyle: 'md', emptyLines: 'omit' }],
    activeFormatId: 'f1',
  })
}

describe('EmrCustomFormatSection', () => {
  beforeEach(() => useOutpatientPrefsStore.setState({ byUser: {} }))

  it('offers starters when the clinician has no format yet', () => {
    render(<EmrCustomFormatSection pivots={PIVOTS} diagnosticReports={[]} copiedKey="" onCopy={jest.fn()} />)
    expect(screen.getByText(x.custom.emptyTitle)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: x.custom.starterLipid }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('copies exactly the previewed text', () => {
    seed()
    const onCopy = jest.fn()
    render(<EmrCustomFormatSection pivots={PIVOTS} diagnosticReports={[]} copiedKey="" onCopy={onCopy} />)
    expect(screen.getByTestId('emr-custom-preview').textContent).toBe('LDL/HDL/TG 101/50/182')
    fireEvent.click(screen.getByRole('button', { name: `${x.custom.copy} 血脂` }))
    expect(onCopy).toHaveBeenCalledWith('LDL/HDL/TG 101/50/182')
  })

  it('lists every format with its own preview and copy button — no picking one first', () => {
    useOutpatientPrefsStore.getState().update('doc-1', {
      formats: [
        { id: 'f1', name: '血脂', tokens: starterTokens('lipid', []), labRule: 'sameDay', missingText: '—', dateStyle: 'md', emptyLines: 'omit' },
        { id: 'f2', name: 'LDL', tokens: [{ kind: 'text', text: 'LDL ' }, { kind: 'lab', lab: 'lipid:LDL', field: 'value' }], labRule: 'sameDay', missingText: '—', dateStyle: 'md', emptyLines: 'omit' },
      ],
      activeFormatId: 'f1',
    })
    const onCopy = jest.fn()
    render(<EmrCustomFormatSection pivots={PIVOTS} diagnosticReports={[]} copiedKey="" onCopy={onCopy} />)
    expect(screen.getAllByTestId('emr-custom-preview').map((node) => node.textContent)).toEqual(['LDL/HDL/TG 101/50/182', 'LDL 101'])
    expect(screen.queryByRole('combobox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: `${x.custom.copy} LDL` }))
    expect(onCopy).toHaveBeenCalledWith('LDL 101')
  })

  it('asks before deleting a format', () => {
    seed()
    render(<EmrCustomFormatSection pivots={PIVOTS} diagnosticReports={[]} copiedKey="" onCopy={jest.fn()} />)
    const openEditor = () => fireEvent.click(screen.getByRole('button', { name: `${x.custom.edit} 血脂` }))
    const formats = () => useOutpatientPrefsStore.getState().byUser['doc-1'].formats.map((format) => format.name)

    openEditor()
    fireEvent.click(screen.getByRole('button', { name: x.editor.deleteFormat }))
    const confirm = within(screen.getByRole('alertdialog'))
    expect(confirm.getByText(x.editor.deleteConfirmTitle.replace('{name}', '血脂'))).toBeInTheDocument()
    fireEvent.click(confirm.getByRole('button', { name: zhTW.common.cancel }))
    expect(formats()).toEqual(['血脂'])

    fireEvent.click(screen.getByRole('button', { name: x.editor.deleteFormat }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: x.editor.deleteConfirmAction }))
    expect(formats()).toEqual([])
  })

  it('adds a new format beside the existing one', () => {
    seed()
    render(<EmrCustomFormatSection pivots={PIVOTS} diagnosticReports={[]} copiedKey="" onCopy={jest.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: x.custom.newFormat }))
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.change(dialog.getByPlaceholderText(x.editor.namePlaceholder), { target: { value: '空白' } })
    fireEvent.change(dialog.getByRole('textbox', { name: x.editor.editorLabel }), { target: { value: 'x' } })
    fireEvent.click(dialog.getByRole('button', { name: zhTW.common.save }))
    expect(useOutpatientPrefsStore.getState().byUser['doc-1'].formats.map((format) => format.name)).toEqual(['血脂', '空白'])
    expect(screen.getByRole('heading', { name: '血脂' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '空白' })).toBeInTheDocument()
  })

  it('holds back an exam line whose newest report has no text until the clinician decides', () => {
    seed([...starterTokens('lipid', []), { kind: 'newline' }, ...starterTokens('exams', []).slice(5)])
    const onCopy = jest.fn()
    render(<EmrCustomFormatSection pivots={PIVOTS} diagnosticReports={REPORTS} copiedKey="" onCopy={onCopy} />)
    // Echo line is absent (no echo at all); ECG line waits for a decision.
    expect(screen.getByTestId('emr-custom-preview').textContent).toBe('LDL/HDL/TG 101/50/182')
    expect(screen.getByRole('button', { name: /1 行先不放/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: x.custom.notes.examUseOlder.replace('{olderDate}', '09/18') }))
    expect(screen.getByTestId('emr-custom-preview').textContent).toBe('LDL/HDL/TG 101/50/182\nEKG (09/18): Sinus rhythm.')

    fireEvent.click(screen.getByRole('button', { name: x.custom.notes.examUndo }))
    expect(screen.getByTestId('emr-custom-preview').textContent).toBe('LDL/HDL/TG 101/50/182')
  })

  it('builds a format by typing and inserting fields, and saves it', () => {
    seed([])
    render(<EmrCustomFormatSection pivots={PIVOTS} diagnosticReports={[]} copiedKey="" onCopy={jest.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: `${x.custom.edit} 血脂` }))
    const dialog = within(screen.getByRole('dialog'))
    const editor = dialog.getByRole('textbox', { name: x.editor.editorLabel })
    fireEvent.change(editor, { target: { value: 'LDL ' } })
    // Pick LDL from search, then insert its value.
    fireEvent.change(dialog.getByRole('searchbox', { name: x.editor.labSearchPlaceholder }), { target: { value: 'ldl' } })
    fireEvent.click(dialog.getByRole('button', { name: 'LDL' }))
    fireEvent.click(dialog.getByRole('button', { name: `＋ ${x.editor.labFields.value}` }))
    fireEvent.keyDown(editor, { key: 'Enter' })
    fireEvent.change(dialog.getByPlaceholderText(x.editor.freeTextPlaceholder), { target: { value: '【完】' } })
    fireEvent.click(dialog.getByRole('button', { name: x.editor.insert }))
    fireEvent.click(dialog.getByRole('button', { name: zhTW.common.save }))

    const saved = useOutpatientPrefsStore.getState().byUser['doc-1'].formats[0]
    expect(saved.tokens).toEqual([
      { kind: 'text', text: 'LDL ' },
      { kind: 'lab', lab: 'lipid:LDL', field: 'value' },
      { kind: 'newline' },
      { kind: 'text', text: '【完】' },
    ])
    expect(screen.getByTestId('emr-custom-preview').textContent).toBe('LDL 101\n【完】')
  })

  it('takes Chinese IME text only when composition ends', () => {
    seed([])
    render(<EmrCustomFormatSection pivots={PIVOTS} diagnosticReports={[]} copiedKey="" onCopy={jest.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: `${x.custom.edit} 血脂` }))
    const dialog = within(screen.getByRole('dialog'))
    const editor = dialog.getByRole('textbox', { name: x.editor.editorLabel }) as HTMLTextAreaElement
    fireEvent.compositionStart(editor)
    fireEvent.change(editor, { target: { value: 'ㄒㄩㄝˋ' } })
    editor.value = '血脂'
    fireEvent.compositionEnd(editor, { data: '血脂' })
    fireEvent.click(dialog.getByRole('button', { name: zhTW.common.save }))
    expect(useOutpatientPrefsStore.getState().byUser['doc-1'].formats[0].tokens).toEqual([{ kind: 'text', text: '血脂' }])
  })
})
