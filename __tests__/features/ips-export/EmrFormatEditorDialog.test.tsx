import { fireEvent, render, screen } from '@testing-library/react'
import { EmrFormatEditorDialog } from '@/features/ips-export/components/EmrFormatEditorDialog'
import { resolveLatestExams } from '@/features/ips-export/utils/emr-exam-kinds'
import { findPinnableLab } from '@/src/shared/utils/pinned-labs'
import type { EmrCustomFormat } from '@/src/application/stores/outpatient-prefs.store'

jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({ locale: 'zh-TW', t: jest.requireActual('@/src/shared/i18n/locales/zh-TW').zhTW }),
}))
jest.mock('@/src/application/providers/auth.provider', () => ({
  useAuth: () => ({ user: null, anonymousUid: null }),
}))

const EMPTY: EmrCustomFormat = {
  id: 'f1',
  name: '腎功能',
  tokens: [],
  labRule: 'sameDay',
  missingText: '—',
  dateStyle: 'md',
  emptyLines: 'omit',
}

function renderEditor() {
  const onSave = jest.fn()
  render(
    <EmrFormatEditorDialog
      initial={EMPTY}
      isNew
      pinnedLabIds={['chem:CREA']}
      previewInputs={{
        resolveLab: (id) => ({ id, points: [] }),
        labLabel: (id) => findPinnableLab(id)?.short ?? null,
        exams: resolveLatestExams([]),
      }}
      onSave={onSave}
      onClose={() => {}}
    />,
  )
  return onSave
}

describe('EmrFormatEditorDialog', () => {
  it('puts the caret back in the format after a field button, so a space types a space', () => {
    const onSave = renderEditor()
    // The lab section's 「＋ 日期」 comes before the exam section's.
    const labDate = screen.getAllByRole('button', { name: '＋ 日期' })[0]!
    fireEvent.click(labDate)

    const editor = screen.getByRole('textbox', { name: /格式內容/ }) as HTMLTextAreaElement
    expect(document.activeElement).toBe(editor)
    fireEvent.change(editor, { target: { value: ' ' } })

    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    expect(onSave.mock.calls[0]?.[0].tokens).toEqual([
      { kind: 'lab', lab: 'chem:CREA', field: 'date' },
      { kind: 'text', text: ' ' },
    ])
  })
})
