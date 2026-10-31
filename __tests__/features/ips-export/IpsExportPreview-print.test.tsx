// 列印 / 另存 PDF with identifiers included: cancelling the browser's print
// window left the 「確認匯出含識別資訊」 dialog on screen and the page locked
// until a refresh. print() blocks the page, and it ran while the dialog was
// still closing; the export now starts only once the dialog is gone.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IpsExportPreview } from '@/features/ips-export/components/IpsExportPreview'
import type { IpsBundle } from '@/features/ips-export/utils/ips-types'

jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({ locale: 'zh-TW', t: jest.requireActual('@/src/shared/i18n/locales/zh-TW').zhTW }),
}))
jest.mock('@/src/shared/components/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <p>{content}</p>,
}))

const zhTW = jest.requireActual('@/src/shared/i18n/locales/zh-TW').zhTW
const x = zhTW.ipsExport

function renderPreview(overrides: Partial<React.ComponentProps<typeof IpsExportPreview>> = {}) {
  const props: React.ComponentProps<typeof IpsExportPreview> = {
    bundle: { resourceType: 'Bundle', type: 'document', entry: [] } as unknown as IpsBundle,
    markdown: '# 國際病人摘要',
    validation: null,
    copiedFormat: null,
    copyError: null,
    markdownFilename: 'IPS_test.md',
    resourceCount: 1,
    includeImageAttachments: false,
    includePatientIdentifiers: true,
    onOpenSettings: jest.fn(),
    onDownloadJson: jest.fn(),
    onDownloadMarkdown: jest.fn(),
    onCopyJson: jest.fn(),
    onCopyMarkdown: jest.fn(),
    ...overrides,
  }
  render(<IpsExportPreview {...props} />)
  return props
}

/**
 * Hands the print iframe a stub window before jsdom fires its load, which runs
 * print(), and records whether the dialog was still mounted when the export
 * began (jsdom has no close animation, so that is the only moment to catch it).
 */
function stubPrintFrames(print: jest.Mock) {
  const dialogOpenAtExport: boolean[] = []
  const append = document.body.appendChild.bind(document.body)
  jest.spyOn(document.body, 'appendChild').mockImplementation((node) => {
    if (node instanceof HTMLIFrameElement) {
      dialogOpenAtExport.push(screen.queryByRole('alertdialog') !== null)
      Object.defineProperty(node, 'contentWindow', { value: { focus: jest.fn(), print } })
    }
    return append(node)
  })
  return dialogOpenAtExport
}

afterEach(() => {
  jest.restoreAllMocks()
  document.querySelectorAll('iframe').forEach((frame) => frame.remove())
})

it('prints only after the identifier confirmation has closed, leaving the page usable', async () => {
  renderPreview()
  const print = jest.fn()
  const dialogOpenAtExport = stubPrintFrames(print)

  fireEvent.click(screen.getByRole('button', { name: x.savePdf }))
  expect(screen.getByRole('alertdialog')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: x.shareConfirmAction }))

  await waitFor(() => expect(print).toHaveBeenCalledTimes(1))
  expect(dialogOpenAtExport).toEqual([false])
  expect(document.body.style.pointerEvents).not.toBe('none')
  expect(screen.queryByRole('alertdialog')).toBeNull()
})

it('does not export when the confirmation is cancelled', async () => {
  const props = renderPreview()
  fireEvent.click(screen.getByRole('button', { name: x.savePdf }))
  fireEvent.click(screen.getByRole('button', { name: zhTW.common.cancel }))

  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(document.querySelector('iframe[aria-hidden="true"]')).toBeNull()
  expect(props.onDownloadMarkdown).not.toHaveBeenCalled()
})
