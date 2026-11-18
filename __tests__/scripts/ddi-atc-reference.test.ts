import { buildDdiAtcReference } from '@/scripts/lib/ddi-atc-reference'

const item = (udCode: string, atcCode: string | null, nhiCode: string | null, route = 'PO', isActive = true) =>
  ({ udCode, isActive, atcCode, route, nhiCode })

describe('buildDdiAtcReference', () => {
  it('keeps one filed NHI code per ATC substance and no hospital item code', () => {
    const table = buildDdiAtcReference([
      item('03971', 'C01DA14', 'AC311681G0'),
      item('02402', 'C01DA14', 'BC20554100'),
      item('05499', 'C09DX04', 'BC26672100'),
    ])
    expect(table).toEqual({ C01DA14: 'AC311681G0', C09DX04: 'BC26672100' })
    expect(JSON.stringify(table)).not.toMatch(/03971|02402|05499/)
  })

  it('leaves out inactive and trial items, items without a code, and combination families', () => {
    expect(buildDdiAtcReference([
      item('01000', 'C07AB07', 'A000000001', 'PO', false),
      item('T008A', 'C09DX04', 'A000000002'),
      item('01001', 'B01AA03', null),
      item('01002', 'N02BE51', 'A000000003'),
      item('01003', 'C09', 'A000000004'),
    ])).toEqual({})
  })

  it('prefers an oral product when one substance comes in several routes', () => {
    expect(buildDdiAtcReference([
      item('01004', 'J01MA02', 'A000000005', 'IV'),
      item('01005', 'J01MA02', 'B000000006', 'PO'),
    ])).toEqual({ J01MA02: 'B000000006' })
  })
})
