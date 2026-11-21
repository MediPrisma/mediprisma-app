/**
 * The scenario bundles carry no measured weight (owner decision 2026-10-22:
 * 雲端病歷 seldom has one). What the pack does then is what most real visits
 * see: a weight criterion is unknown and asked for, never taken as met or
 * unmet.
 */
import { atScenarioDay, scenarioProfile, scenarioRun } from './scenario-models'

describe('scenarios without a measured weight', () => {
  it('no bundle carries one', () => {
    for (const id of ['p1-suspected-hfpef', 'p3-new-af', 'p4-stable-optimised', 'p7-worsening-congestion', 'p8-post-discharge', 'p9-hfpef-af-dose', 'p11-af-dabigatran-renal'] as const) {
      expect(scenarioProfile(id).facts.bodyWeight).toBeUndefined()
    }
  })

  it('P9: the apixaban 60 kg criterion is unknown, the dose is left to check, and weight and CrCl are asked for', () => atScenarioDay(() => {
    const { model } = scenarioRun('p9-hfpef-af-dose', { page: 'af' })
    const dose = model.points.find((point) => point.dp === 'DP-09' && point.source === 'af')!
    expect(dose.headline).toBe('apixaban 5 mg bid：劑量待核對')
    expect(dose.needsData).toEqual(['體重（kg）', '醫療計算機 CrCl 結果'])
    const weight = dose.criteria?.[0]?.items.find((item) => item.label === '體重 ≤60 kg')
    expect(weight).toEqual({ label: '體重 ≤60 kg' })
    // Without a weight there is no Cockcroft–Gault CrCl, so every DOAC waits on it.
    expect(dose.optionTable?.rows.map((row) => row.status)).toEqual(['missing', 'missing', 'missing', 'missing'])
  }))
})
