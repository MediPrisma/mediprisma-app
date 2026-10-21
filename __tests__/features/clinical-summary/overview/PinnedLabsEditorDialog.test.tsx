import { fireEvent, render, screen } from '@testing-library/react'
import { PinnedLabsEditorDialog } from '@/features/clinical-summary/overview/components/PinnedLabsEditorDialog'

jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({ locale: 'zh-TW', t: jest.requireActual('@/src/shared/i18n/locales/zh-TW').zhTW }),
}))
jest.mock('@/src/application/providers/auth.provider', () => ({
  useAuth: () => ({ user: null, anonymousUid: null }),
}))

const CARDIO = ['chem:CREA', 'chem:EGFR(M)', 'chem:K', 'chem:ALT', 'glucose:GLUCOSE-AC', 'glucose:HBA1C', 'lipid:LDL', 'lipid:HDL', 'lipid:TG', 'chem:NT-PROBNP']
const SYSTEM = ['cbc:HB', 'cbc:WBC', 'cbc:PLT', 'chem:CREA', 'chem:K']

function renderEditor(initialIds: string[] = SYSTEM) {
  const onSave = jest.fn()
  render(
    <PinnedLabsEditorDialog
      open
      onOpenChange={() => {}}
      initialIds={initialIds}
      systemDefaultIds={SYSTEM}
      onSave={onSave}
    />,
  )
  const saved = () => {
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    return onSave.mock.calls.at(-1)?.[0] as string[]
  }
  return { saved }
}

const cardio = () => screen.getByRole('button', { name: /心臟科常用/ })

describe('cardiology pack', () => {
  it('replaces the system set instead of adding to it', () => {
    const { saved } = renderEditor()
    fireEvent.click(cardio())
    expect(cardio()).toHaveAttribute('aria-pressed', 'true')
    expect(saved()).toEqual(CARDIO)
  })

  it('puts the previous list back when pressed again', () => {
    const { saved } = renderEditor(['cbc:PLT', 'chem:NA'])
    fireEvent.click(cardio())
    fireEvent.click(cardio())
    expect(cardio()).toHaveAttribute('aria-pressed', 'false')
    expect(saved()).toEqual(['cbc:PLT', 'chem:NA'])
  })

  it('falls back to the system set when the pack was already saved', () => {
    const { saved } = renderEditor(CARDIO)
    expect(cardio()).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(cardio())
    expect(saved()).toEqual(SYSTEM)
  })

  it('reads as off once the list is edited, and re-applies on press', () => {
    const { saved } = renderEditor()
    fireEvent.click(cardio())
    // Add PLT by hand from the catalogue.
    fireEvent.click(screen.getAllByRole('button', { name: /^PLT/ })[0]!)
    expect(cardio()).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(cardio())
    expect(saved()).toEqual(CARDIO)
    // …and one more press brings back the edited list, PLT included.
    fireEvent.click(cardio())
    expect(saved()).toEqual([...CARDIO, 'cbc:PLT'])
  })

  it('offers only the cardiology set for now', () => {
    renderEditor()
    expect(screen.queryByRole('button', { name: /腎臟科常用|新陳代謝常用/ })).toBeNull()
  })
})
