import {
  attentionFindings,
  interactionCheckBody,
  interpretInteractionCheck,
  planInteractionCheck,
} from '@/features/clinical-summary/medications/utils/interaction-check'
import type { MedicationRow } from '@/features/clinical-summary/medications/types'

function row(id: string, patch: Partial<MedicationRow>): MedicationRow {
  return { id, title: id, status: 'active', isInactive: false, isChronic: false, refillCount: 1, searchHaystack: '', ...patch }
}
const cloud = (id: string, ingredientText: string, patch: Partial<MedicationRow> = {}) =>
  row(id, { dataOrigin: 'medcloud', drugTerminology: { source: 'nhi-official-drug-master', snapshotId: 's', ingredientText }, ...patch })
const hospital = (id: string, ingredientName: string, patch: Partial<MedicationRow> = {}) =>
  row(id, { dataOrigin: 'hospital', hospitalMedicationName: { status: 'normalized', ingredientName, version: 'v', reviewedAt: 'd' }, ...patch })

// Response shapes below are trimmed from the service's real answers to
// synthetic drug lists (2026-11-13).
const resolved = (inputIndex: number, udCode: string, genericName: string, englishName = '') =>
  ({ inputIndex, udCode, genericName, englishName })
const alert = (a: string, b: string, severity: string, nursingAction: string, type = 'DRUG_INTERACTION') => ({
  alertId: `db50::${a}::${b}`, type, severity, drugA: { udCode: a }, drugB: { udCode: b },
  mechanism: '機轉', nursingAction, source: '北榮藥劑部交互作用資料庫',
})

describe('planInteractionCheck', () => {
  it('leaves skin and ear preparations out, and keeps eye drops, patches and gelatin capsules in', () => {
    const plan = planInteractionCheck([
      cloud('oint', 'NEOMYCIN (SULFATE) 3.5 MG/GM+BACITRACIN ZINC 500 U/GM', { secondaryTitle: 'B. &N. BACINEOCIN OINTMENT' }),
      cloud('cream', 'KETOCONAZOLE 20 MG/GM', { drugTerminology: { source: 'nhi-official-drug-master', snapshotId: 's', ingredientText: 'KETOCONAZOLE 20 MG/GM', doseForm: '乳膏劑' } }),
      cloud('ear', 'OFLOXACIN 3 MG/ML', { secondaryTitle: 'Tarivid Otic Solution' }),
      cloud('eye', 'TIMOLOL 5 MG/ML', { secondaryTitle: 'Timolol Ophthalmic Solution' }),
      cloud('patch', 'FENTANYL 12 MCG/HR', { secondaryTitle: 'Durogesic Transdermal Patch' }),
      cloud('cap', 'OMEPRAZOLE 20 MG', { secondaryTitle: 'Gelatin Capsules' }),
    ])
    expect(plan.localRowIds).toEqual(['oint', 'cream', 'ear'])
    expect(plan.items.map(item => item.query)).toEqual(['TIMOLOL', 'FENTANYL', 'OMEPRAZOLE'])
  })

  it('keeps eye gels and eye ointments in, and reads the TOP route and 耳用 form as local', () => {
    const term = (ingredientText: string, doseForm: string) =>
      ({ drugTerminology: { source: 'nhi-official-drug-master' as const, snapshotId: 's', ingredientText, doseForm } })
    const plan = planInteractionCheck([
      cloud('eye-gel', 'TIMOLOL 1 MG/GM', { secondaryTitle: 'Timolol Ophthalmic Gel', route: 'OPH', ...term('TIMOLOL 1 MG/GM', '眼用凝膠劑') }),
      cloud('eye-oint', 'TOBRAMYCIN 3 MG/GM', { secondaryTitle: 'Tobrex Eye Ointment' }),
      cloud('top', 'CLOBETASOL 0.5 MG/ML', { route: 'TOP' }),
      cloud('ear', 'OFLOXACIN 3 MG/ML', { route: '耳用', ...term('OFLOXACIN 3 MG/ML', '耳用液劑') }),
    ])
    expect(plan.localRowIds).toEqual(['top', 'ear'])
    expect(plan.items.map(item => item.query)).toEqual(['TIMOLOL', 'TOBRAMYCIN'])
  })

  it('sends ingredient names without strength, one entry per ingredient', () => {
    const plan = planInteractionCheck([
      cloud('c1', 'TRAMADOL HCL 37.5 MG+ACETAMINOPHEN (=PARACETAMOL) 325 MG'),
      cloud('c2', 'TAURINE 5 MG/ML'),
      hospital('h1', 'Netupitant / Palonosetron'),
    ])
    expect(plan.items.map(item => item.query)).toEqual(['TRAMADOL HCL', 'ACETAMINOPHEN', 'TAURINE', 'Netupitant', 'Palonosetron'])
    expect(interactionCheckBody(plan).medications[0]).toEqual({ drugName: 'TRAMADOL HCL' })
  })

  it('sends one entry for the same ingredient on two rows and skips ended rows', () => {
    const plan = planInteractionCheck([
      cloud('c1', 'WARFARIN SODIUM 1 MG'),
      cloud('c2', 'Warfarin sodium 5 MG'),
      cloud('c3', 'AMIODARONE HCL 200 MG', { isInactive: true }),
    ])
    expect(plan.items).toEqual([{ query: 'WARFARIN SODIUM', rowIds: ['c1', 'c2'] }])
  })

  it('keeps a number that is part of the ingredient name', () => {
    // Recorded as-is (typo included) in the hospital medication index.
    const plan = planInteractionCheck([cloud('c1', 'ISOSORBIDE 5-MONONITRTATE 20 MG'), cloud('c2', 'TAURINE .5 MG/ML')])
    expect(plan.items.map(item => item.query)).toEqual(['ISOSORBIDE 5-MONONITRTATE', 'TAURINE'])
  })

  it('drops an aside whose parenthesis the terminology text cut off', () => {
    const plan = planInteractionCheck([cloud('c1', 'OXYBUTYNIN CHLORIDE (=OXIBUTININA HCL=OXYBUTYNIN H 5 MG')])
    expect(plan.items.map(item => item.query)).toEqual(['OXYBUTYNIN CHLORIDE'])
  })

  it('lists a current row with no ingredient name as unnamed', () => {
    const plan = planInteractionCheck([
      row('x', { dataOrigin: 'hospital', hospitalMedicationName: { status: 'unresolved', version: 'v', reviewedAt: 'd' } }),
    ])
    expect(plan).toEqual({ items: [], unnamedRowIds: ['x'], localRowIds: [], endedRowIds: [], coveredUntil: {} })
  })
})

describe('interpretInteractionCheck', () => {
  const rows = [
    hospital('h-isdn', 'Isosorbide dinitrate', { encounterReference: 'Encounter/1' }),
    cloud('c-sild', 'SILDENAFIL CITRATE 100 MG', { encounterReference: 'Encounter/9' }),
  ]
  const plan = planInteractionCheck(rows)

  it('raises a pair to "avoid" when the action says so, whatever the grade', () => {
    const review = interpretInteractionCheck(plan, rows, {
      resolvedMedications: [
        resolved(0, '01669', 'isosorbide dinitrate', 'Isordil tab 10 mg'),
        resolved(1, '02602', 'Sildenafil citrate (sildenafil)', 'VIAGRA FC * TAB 100 MG'),
      ],
      alerts: [alert('02602', '01669', 'low', '絕對不可併用。')],
    })
    expect(review.findings).toEqual([expect.objectContaining({
      tier: 'avoid', severity: 'low', rowIdsA: ['c-sild'], rowIdsB: ['h-isdn'], action: '絕對不可併用。', samePrescription: false,
    })])
    expect(review.checkedRowIds.sort()).toEqual(['c-sild', 'h-isdn'])
    expect(review.uncheckedRowIds).toEqual([])
  })

  it('raises a pair to "avoid" when only the mechanism or a 不宜併用 wording says so', () => {
    const answer = (nursingAction: string, mechanism: string) => interpretInteractionCheck(plan, rows, {
      resolvedMedications: [
        resolved(0, '01669', 'isosorbide dinitrate', 'Isordil tab 10 mg'),
        resolved(1, '02602', 'Sildenafil citrate (sildenafil)', 'VIAGRA FC * TAB 100 MG'),
      ],
      alerts: [{ ...alert('02602', '01669', 'low', nursingAction), mechanism }],
    }).findings[0]?.tier
    expect(answer('監測血壓', '可能嚴重低血壓，禁止併用')).toBe('avoid')
    expect(answer('不宜併用', '')).toBe('avoid')
    expect(answer('監測血壓', '可能低血壓')).toBe('note')
  })

  it('keeps the service grade as given, and an unknown grade as unknown', () => {
    const grade = (severity: string) => interpretInteractionCheck(plan, rows, {
      resolvedMedications: [
        resolved(0, '01669', 'isosorbide dinitrate', 'Isordil tab 10 mg'),
        resolved(1, '02602', 'Sildenafil citrate (sildenafil)', 'VIAGRA FC * TAB 100 MG'),
      ],
      alerts: [alert('02602', '01669', severity, '絕對不可併用。')],
    }).findings[0]?.severity
    expect(grade('high')).toBe('high')
    expect(grade('moderate')).toBe('moderate')
    expect(grade('low')).toBe('low')
    expect(grade('')).toBe('unknown')
    expect(grade('critical')).toBe('unknown')
  })

  it('reports a drug the service could not place as unchecked', () => {
    const review = interpretInteractionCheck(plan, rows, {
      resolvedMedications: [
        resolved(0, '01669', 'isosorbide dinitrate'),
        { inputIndex: 1, udCode: 'RAW-1', matchedBy: 'rawName', genericName: 'SILDENAFIL CITRATE' },
      ],
      alerts: [],
    })
    expect(review.findings).toEqual([])
    expect(review.uncheckedRowIds).toEqual(['c-sild'])
    expect(review.checkedRowIds).toEqual(['h-isdn'])
  })

  it('rejects a fuzzy match to a different drug and drops its alerts', () => {
    // The service answered "tramadol and paracetamol" with Augmentin syrup.
    const review = interpretInteractionCheck(plan, rows, {
      resolvedMedications: [
        resolved(0, '01669', 'isosorbide dinitrate'),
        resolved(1, '03101', 'amoxicillin and enzyme inhibitor (Amoxycilin/Clav.)', 'Augmentin *syrup 457 mg/5ml 35ml'),
      ],
      alerts: [alert('03101', '01669', 'high', '監測')],
    })
    expect(review.findings).toEqual([])
    expect(review.uncheckedRowIds).toEqual(['c-sild'])
  })

  it('does not accept a different salt that shares only the anion', () => {
    const salts = [cloud('nacl', 'SODIUM CHLORIDE 9 MG/ML')]
    const review = interpretInteractionCheck(planInteractionCheck(salts), salts, {
      resolvedMedications: [resolved(0, '01725', 'potassium chloride (Pot. chloride-SR)', 'Slow-K tab 600 mg')],
    })
    expect(review.uncheckedRowIds).toEqual(['nacl'])
  })

  it('does not accept a different drug that shares the first word', () => {
    const list = [hospital('tdm1', 'Trastuzumab emtansine'), cloud('ismn', 'ISOSORBIDE 5-MONONITRATE 20 MG')]
    const review = interpretInteractionCheck(planInteractionCheck(list), list, {
      resolvedMedications: [resolved(0, '05001', 'Trastuzumab'), resolved(1, '01669', 'isosorbide dinitrate')],
    })
    expect(review.uncheckedRowIds.sort()).toEqual(['ismn', 'tdm1'])
    expect(review.checkedRowIds).toEqual([])
  })

  it('accepts a trailing salt the service leaves out', () => {
    const list = [cloud('warf', 'WARFARIN SODIUM 1 MG'), cloud('diclo', 'DICLOFENAC SODIUM 25 MG')]
    const review = interpretInteractionCheck(planInteractionCheck(list), list, {
      resolvedMedications: [resolved(0, '03951', 'Warfarin'), resolved(1, '03868', 'diclofenac')],
    })
    expect(review.checkedRowIds.sort()).toEqual(['diclo', 'warf'])
  })

  it('accepts a chloride salt the service abbreviates', () => {
    const list = [cloud('oxy', 'OXYBUTYNIN CHLORIDE (=OXIBUTININA HCL=OXYBUTYNIN H 5 MG')]
    const review = interpretInteractionCheck(planInteractionCheck(list), list, {
      resolvedMedications: [resolved(0, '04424', 'Oxybutynin Cl (oxybutynin)', 'Oxbu ER * tab 5 mg')],
    })
    expect(review.checkedRowIds).toEqual(['oxy'])
  })

  it('accepts a chloride or hydrate the service leaves out after the drug name', () => {
    const list = [cloud('beth', 'BETHANECHOL CHLORIDE 25 MG'), cloud('ppi', 'PANTOPRAZOLE SODIUM SESQUIHYDRATE 40 MG')]
    const review = interpretInteractionCheck(planInteractionCheck(list), list, {
      resolvedMedications: [resolved(0, '05412', 'Bethanechol', 'Wecoli * tab 25 mg'), resolved(1, '03258', 'Pantoprazole')],
    })
    expect(review.checkedRowIds.sort()).toEqual(['beth', 'ppi'])
  })

  it('does not let potassium chloride pass as another potassium salt', () => {
    const list = [cloud('kcl', 'POTASSIUM CHLORIDE 600 MG')]
    const review = interpretInteractionCheck(planInteractionCheck(list), list, {
      resolvedMedications: [resolved(0, '00001', 'Potassium citrate')],
    })
    expect(review.uncheckedRowIds).toEqual(['kcl'])
  })

  it('does not let sodium chloride pass as another sodium salt', () => {
    const list = [cloud('nacl', 'SODIUM CHLORIDE 9 MG/ML'), cloud('warf', 'WARFARIN SODIUM 1 MG')]
    const review = interpretInteractionCheck(planInteractionCheck(list), list, {
      resolvedMedications: [resolved(0, '03868', 'Diclofenac sodium'), resolved(1, '03951', 'Warfarin')],
      alerts: [alert('03868', '03951', 'high', '監測出血')],
    })
    expect(review.uncheckedRowIds).toEqual(['nacl'])
    expect(review.findings).toEqual([])
  })

  it('treats everything as unchecked when the response is unusable', () => {
    expect(interpretInteractionCheck(plan, rows, null).uncheckedRowIds.sort()).toEqual(['c-sild', 'h-isdn'])
  })

  it('grades, orders and marks same-visit pairs; ignores non-interaction alerts', () => {
    const list = [
      hospital('spiro', 'Spironolactone', { encounterReference: 'Encounter/1' }),
      hospital('enal', 'Enalapril maleate', { encounterReference: 'Encounter/1' }),
      cloud('warf', 'WARFARIN SODIUM 1 MG', { encounterReference: 'Encounter/7' }),
      hospital('amio', 'Amiodarone', { encounterReference: 'Encounter/1' }),
      cloud('para', 'ACETAMINOPHEN 500 MG'),
    ]
    const review = interpretInteractionCheck(planInteractionCheck(list), list, {
      resolvedMedications: [
        resolved(0, '00050', 'Spironolactone'),
        resolved(1, '01675', 'Enalapril maleate (enalapril)'),
        resolved(2, '03951', 'Warfarin'),
        resolved(3, '01363', 'Amiodarone HCl (amiodarone)'),
        resolved(4, '01833', 'Acetaminophen (paracetamol)'),
      ],
      alerts: [
        alert('01833', '03951', 'low', '觀察'),
        alert('00050', '01675', 'moderate', '監測血鉀'),
        alert('03951', '01363', 'high', '監測 INR'),
        alert('03951', '01363', 'high', '監測 INR'),
        alert('00050', '01675', 'high', '分開管路', 'IV_INCOMPATIBILITY'),
      ],
    })
    expect(review.findings.map(f => [f.tier, f.severity, f.samePrescription, f.rowIdsA[0], f.rowIdsB[0]])).toEqual([
      ['act', 'high', false, 'warf', 'amio'],
      ['act', 'moderate', true, 'spiro', 'enal'],
      ['note', 'low', false, 'para', 'warf'],
    ])
  })

  it('does not report the two ingredients of one combination product', () => {
    const combo = [cloud('combo', 'TRAMADOL HCL 37.5 MG+ACETAMINOPHEN 325 MG')]
    const review = interpretInteractionCheck(planInteractionCheck(combo), combo, {
      resolvedMedications: [resolved(0, '01970', 'Tramadol HCl (tramadol)'), resolved(1, '01833', 'Acetaminophen (paracetamol)')],
      alerts: [alert('01970', '01833', 'moderate', '監測')],
    })
    expect(review.findings).toEqual([])
    expect(review.checkedRowIds).toEqual(['combo'])
  })
})

describe('drugs whose supply has run out', () => {
  // 2026-11-17 in Taipei.
  const now = Date.parse('2026-11-17T10:00:00+08:00')
  const ended = (endDateIso: string, patch: Partial<MedicationRow> = {}) =>
    ({ isInactive: true, endDateIso, startedOnIso: '2026-01-01', durationDays: 30, ...patch })
  const queries = (rows: MedicationRow[]) => planInteractionCheck(rows, now).items.map(item => item.query)

  it('keeps a long-term drug for 14 days after its supply ends', () => {
    expect(queries([
      cloud('warf', 'WARFARIN SODIUM 1 MG', ended('2026-11-03')),
      cloud('amio', 'AMIODARONE HCL 200 MG', ended('2026-11-02')),
      cloud('fluc', 'FLUCONAZOLE 150 MG', ended('2026-11-03', { durationDays: 27, isChronic: true })),
    ])).toEqual(['WARFARIN SODIUM', 'FLUCONAZOLE'])
  })

  it('leaves out a short course once ended, and any order the source stopped', () => {
    const plan = planInteractionCheck([
      cloud('cipro', 'CIPROFLOXACIN 500 MG', ended('2026-11-16', { durationDays: 7 })),
      cloud('warf', 'WARFARIN SODIUM 1 MG', ended('2026-11-16', { status: 'stopped' })),
      cloud('amio', 'AMIODARONE HCL 200 MG'),
    ], now)
    expect(plan.items.map(item => item.query)).toEqual(['AMIODARONE HCL'])
    expect(plan.endedRowIds).toEqual([])
  })

  it('keeps a chronic slip for its later fills, which a pharmacy may have dispensed', () => {
    // 慢簽(三個月) written 8/1: the hospital gave 30 days to 8/30; two more
    // fills cover to 10/29, the grace to 11/12. A two-fill slip ending 10/10
    // covers to 11/9; a plain long-term supply ending 11/5 only to 11/5.
    expect(queries([
      hospital('three', 'Valsartan', ended('2026-08-30', { isChronic: true, chronicFills: 3 })),
      hospital('two', 'Spironolactone', ended('2026-10-10', { isChronic: true, chronicFills: 2 })),
      hospital('one', 'Rosuvastatin', ended('2026-11-05', { isChronic: true })),
      hospital('slipless', 'Metformin', ended('2026-10-10', { isChronic: true })),
    ])).toEqual(['Spironolactone', 'Rosuvastatin'])
    expect(queries([
      hospital('three', 'Valsartan', ended('2026-09-04', { isChronic: true, chronicFills: 3 })),
    ])).toEqual(['Valsartan'])
  })

  it('takes the newest record of a drug, so an older slip cannot split a same-visit pair', () => {
    const list = [
      hospital('val-old', 'Valsartan', ended('2026-09-05', { drugKey: 'val', isChronic: true, chronicFills: 3, encounterReference: 'Encounter/8' })),
      hospital('val', 'Valsartan', { drugKey: 'val', startedOnIso: '2026-11-12', encounterReference: 'Encounter/11' }),
      hospital('spiro', 'Spironolactone', { drugKey: 'spiro', startedOnIso: '2026-11-12', encounterReference: 'Encounter/11' }),
    ]
    const plan = planInteractionCheck(list, now)
    expect(plan.items).toEqual([{ query: 'Valsartan', rowIds: ['val'] }, { query: 'Spironolactone', rowIds: ['spiro'] }])
  })

  it('lets a later fill replace the visit record, and not a cancelled renewal', () => {
    const plan = planInteractionCheck([
      hospital('val-visit', 'Valsartan', ended('2026-11-05', { drugKey: 'val', isChronic: true, startedOnIso: '2026-10-07' })),
      hospital('val-fill', 'Valsartan', { drugKey: 'val', startedOnIso: '2026-10-07', dispensedOnIso: '2026-11-04' }),
      cloud('warf', 'WARFARIN SODIUM 1 MG', ended('2026-11-08', { drugKey: 'warf' })),
      cloud('warf-new', 'WARFARIN SODIUM 1 MG', { drugKey: 'warf', status: 'cancelled', isInactive: true, startedOnIso: '2026-11-16' }),
    ], now)
    expect(plan.items).toEqual([{ query: 'Valsartan', rowIds: ['val-fill'] }, { query: 'WARFARIN SODIUM', rowIds: ['warf'] }])
    expect(plan.endedRowIds).toEqual(['warf'])
  })

  it('keeps a whole slip when only its second fill is on record', () => {
    // 慢簽(三個月) 8/20: first fill to 9/18, second fill 9/19 to 10/18, the
    // third from a pharmacy with no record; the slip covers to 11/17.
    const plan = planInteractionCheck([
      cloud('warf-visit', 'WARFARIN SODIUM 1 MG', ended('2026-09-18', { drugKey: 'warf', isChronic: true, chronicFills: 3, startedOnIso: '2026-08-20' })),
      cloud('warf-fill', 'WARFARIN SODIUM 1 MG', ended('2026-10-18', { drugKey: 'warf', isChronic: true, startedOnIso: '2026-08-20', dispensedOnIso: '2026-09-19' })),
    ], now)
    expect(plan.items).toEqual([{ query: 'WARFARIN SODIUM', rowIds: ['warf-fill'] }])
    expect(plan.coveredUntil).toEqual({ 'warf-fill': '2026-11-17' })
  })

  it('marks a pair with an ended side, lists it after current pairs, and not when a current row shares it', () => {
    const list = [
      cloud('warf', 'WARFARIN SODIUM 1 MG', ended('2026-11-10')),
      cloud('amio', 'AMIODARONE HCL 200 MG'),
      cloud('flu', 'FLUCONAZOLE 150 MG'),
      cloud('para-old', 'ACETAMINOPHEN 500 MG', ended('2026-11-10')),
      cloud('para', 'ACETAMINOPHEN 500 MG', { drugKey: 'para-other', startedOnIso: '2026-11-15' }),
    ]
    const plan = planInteractionCheck(list, now)
    const review = interpretInteractionCheck(plan, list, {
      resolvedMedications: [
        resolved(0, '03951', 'Warfarin'),
        resolved(1, '01363', 'Amiodarone HCl (amiodarone)'),
        resolved(2, '02247', 'Fluconazole'),
        resolved(3, '01833', 'Acetaminophen (paracetamol)'),
      ],
      alerts: [
        alert('03951', '01363', 'high', '監測 INR'),
        alert('02247', '01363', 'high', '監測 QT'),
        alert('01833', '01363', 'high', '觀察'),
      ],
    })
    expect(review.findings.map(f => [f.rowIdsA, f.involvesEnded])).toEqual([
      [['flu'], false],
      [['para-old', 'para'], false],
      [['warf'], true],
    ])
    expect(review.endedRowIds).toEqual(['warf', 'para-old'])
  })
})

describe('attentionFindings', () => {
  const f = (id: string, tier: 'avoid' | 'act' | 'note', samePrescription: boolean) =>
    ({ id, tier, severity: 'unknown' as const, rowIdsA: ['a'], rowIdsB: ['b'], action: '', mechanism: '', source: '', samePrescription, involvesEnded: false })
  it('keeps every cross-visit pair and same-visit avoid pairs', () => {
    const review = {
      findings: [f('1', 'avoid', true), f('2', 'act', true), f('3', 'note', true), f('4', 'note', false), f('5', 'act', false)],
      checkedRowIds: [], uncheckedRowIds: [], localRowIds: [], endedRowIds: [], coveredUntil: {},
    }
    expect(attentionFindings(review).map(x => x.id)).toEqual(['1', '4', '5'])
  })
})
