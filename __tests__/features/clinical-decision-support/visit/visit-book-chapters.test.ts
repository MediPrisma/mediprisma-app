/**
 * The pack's chapters read defensively: the medicines table's rows for a point
 * living in another chapter (`tableRefs`) and its merged rows (`tableMerged`)
 * when the pack gives them, nothing when an older pack does not, and a
 * malformed entry dropped rather than drawn.
 */
import { bookChaptersOf } from '@/features/clinical-decision-support/renderers/visit/VisitBookLayout'

const chapter = (extra: Record<string, unknown> = {}) => ({ id: 'drugs', title: '藥物', short: '藥物', dps: ['DP-10', 'DP-09', 'DP-07', 'DP-08'], table: ['DP-10', 'DP-09', 'DP-07', 'DP-08'], ...extra })

describe('bookChaptersOf', () => {
  it('reads the reference and merged rows the pack gives', () => {
    const [drugs] = bookChaptersOf({
      book: [chapter({
        tableRefs: [{ dp: 'DP-06', chapter: 'volume', after: 'DP-09', label: '利尿劑', now: 'furosemide 每日 20 mg' }],
        tableMerged: [{ dps: ['DP-07', 'DP-08'], label: 'RAS 抑制、β 阻斷劑', note: 'HFpEF 非基礎用藥' }],
      })],
    }) ?? []
    expect(drugs?.tableRefs).toEqual([{ dp: 'DP-06', chapter: 'volume', after: 'DP-09', label: '利尿劑', now: 'furosemide 每日 20 mg' }])
    expect(drugs?.tableMerged).toEqual([{ dps: ['DP-07', 'DP-08'], label: 'RAS 抑制、β 阻斷劑', note: 'HFpEF 非基礎用藥' }])
  })

  it('draws an older pack\'s chapter as before: no reference or merged rows', () => {
    const [drugs] = bookChaptersOf({ book: [chapter()] }) ?? []
    expect(drugs).not.toHaveProperty('tableRefs')
    expect(drugs).not.toHaveProperty('tableMerged')
  })

  it('drops what it cannot read: a reference without a label, a group of one', () => {
    const [drugs] = bookChaptersOf({
      book: [chapter({
        tableRefs: [{ dp: 'DP-06', chapter: 'volume' }, 'DP-06'],
        tableMerged: [{ dps: ['DP-07'], label: 'x' }, { label: 'y' }],
      })],
    }) ?? []
    expect(drugs).not.toHaveProperty('tableRefs')
    expect(drugs).not.toHaveProperty('tableMerged')
  })
})
