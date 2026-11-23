import { buildDdiAtcReference, singleSubstanceAtcCodes } from '@/scripts/lib/ddi-atc-reference'

// NHI drug-master rows: code at 0, ingredient text at 5, ATC at 9.
const master = (code: string, ingredient: string, atc: string) => [code, '', '', '', '', ingredient, '', '', '', atc]
const DICTIONARY = [
  master('A031168100', 'ISOSORBIDE 5-MONONITRTATE 20 MG', 'C01DA14'),
  master('BC20554100', 'ISOSORBIDE 5-MONONITRTATE 60 MG', 'C01DA14'),
  master('BC26672100', 'SACUBITRIL/VALSARTAN AS SACUBITRIL VALSARTAN SODIUM SAL 100 MG', 'C09DX04'),
  master('AC43862100', 'WARFARIN SODIUM 1 MG', 'B01AA03'),
  master('A000000005', 'CIPROFLOXACIN 500 MG', 'J01MA02'),
  // Two different cough combinations under one ATC code (as the master files them).
  master('A031004151', 'CODEINE PHOSPHATE 1 MG/ML+ARMENIACA WATER .05 ML/ML', 'R05FA01'),
  master('AC217581G0', 'DEXTROMETHORPHAN HBR 10 MG+LYSOZYME CHLORIDE 10 MG', 'R05FA01'),
  // One code holding two substances.
  master('A000000007', 'METOCLOPRAMIDE HCL 5 MG', 'A03FA01'),
  master('A000000008', 'PANCREATIN 100 MG', 'A03FA01'),
]

const item = (udCode: string, atcCode: string | null, nhiCode: string | null, route = 'PO', isActive = true) =>
  ({ udCode, isActive, atcCode, route, nhiCode })
const build = (items: ReturnType<typeof item>[]) => buildDdiAtcReference(items, DICTIONARY)

describe('buildDdiAtcReference', () => {
  it('keeps one filed NHI code per ATC substance and no hospital item code', () => {
    const table = build([
      item('03971', 'C01DA14', 'AC311681G0'),
      item('02402', 'C01DA14', 'BC20554100'),
      item('05499', 'C09DX04', 'BC26672100'),
    ])
    expect(table).toEqual({ C01DA14: 'AC311681G0', C09DX04: 'BC26672100' })
    expect(JSON.stringify(table)).not.toMatch(/03971|02402|05499/)
  })

  it('leaves out inactive and trial items, items without a code, and combination families', () => {
    expect(build([
      item('01000', 'B01AA03', 'A000000001', 'PO', false),
      item('T008A', 'C09DX04', 'A000000002'),
      item('01001', 'B01AA03', null),
      item('01002', 'N02BE51', 'A000000003'),
      item('01003', 'C09', 'A000000004'),
    ])).toEqual({})
  })

  it('leaves out a code under which the master files different combinations or substances', () => {
    expect(singleSubstanceAtcCodes(DICTIONARY)).toEqual(new Set(['C01DA14', 'C09DX04', 'B01AA03', 'J01MA02']))
    expect(build([item('01006', 'R05FA01', 'AC217581G0'), item('01007', 'A03FA01', 'A000000007')])).toEqual({})
  })

  it('prefers an oral product when one substance comes in several routes', () => {
    expect(build([
      item('01004', 'J01MA02', 'A000000005', 'IV'),
      item('01005', 'J01MA02', 'B000000006', 'PO'),
    ])).toEqual({ J01MA02: 'B000000006' })
  })
})
