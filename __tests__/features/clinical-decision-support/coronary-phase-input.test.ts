/**
 * CAD DP-01's answer on its way to the store: the class and the day it was
 * pressed, the month only where the clinician gave one, and nothing for any
 * input or stored value this host does not recognise.
 */
import { coronaryPhaseForInput, coronaryPhaseInput } from '@/features/clinical-decision-support/renderers/visit/physician-input'
import { toCoronaryPhaseAnswer } from '@/features/clinical-decision-support/stores/coronary-phase.store'

const NOW = new Date('2026-10-19T09:00:00+08:00')

describe('coronaryPhaseForInput', () => {
  it('writes the class and the day it was pressed', () => {
    expect(coronaryPhaseForInput({ request: 'cad-phase', optionId: 'chronic-mi' }, NOW)).toEqual({ phase: 'chronic-mi', answeredOn: '2026-10-19' })
    expect(coronaryPhaseForInput({ request: 'cad-phase', optionId: 'unsure' }, NOW)).toEqual({ phase: 'unsure', answeredOn: '2026-10-19' })
  })

  it('carries the month the clinician gave, for the two windowed classes only', () => {
    expect(coronaryPhaseForInput(coronaryPhaseInput('acs-recent', '2026-04'), NOW)).toEqual({ phase: 'acs-recent', answeredOn: '2026-10-19', eventMonth: '2026-04' })
    expect(coronaryPhaseForInput(coronaryPhaseInput('pci-recent', '2026'), NOW)).toMatchObject({ eventMonth: '2026' })
    expect(coronaryPhaseForInput({ request: 'cad-phase', optionId: 'chronic-mi@2020-01' }, NOW)).toEqual({ phase: 'chronic-mi', answeredOn: '2026-10-19' })
    expect(coronaryPhaseForInput({ request: 'cad-phase', optionId: 'acs-recent@2026-13' }, NOW)).toEqual({ phase: 'acs-recent', answeredOn: '2026-10-19' })
  })

  it('leaves every other input to the stores that own it', () => {
    expect(coronaryPhaseForInput({ request: 'af-diagnosis', optionId: 'af' }, NOW)).toBeUndefined()
    expect(coronaryPhaseForInput({ request: 'cad-phase', optionId: 'stemi' }, NOW)).toBeUndefined()
  })
})

describe('toCoronaryPhaseAnswer', () => {
  it('keeps only a known class with a calendar answer day', () => {
    expect(toCoronaryPhaseAnswer({ phase: 'acs-recent', answeredOn: '2026-10-19', eventMonth: '2026-04' })).toEqual({ phase: 'acs-recent', answeredOn: '2026-10-19', eventMonth: '2026-04' })
    expect(toCoronaryPhaseAnswer({ phase: 'acs-recent', answeredOn: '2026-10-19', eventMonth: 'April' })).toEqual({ phase: 'acs-recent', answeredOn: '2026-10-19' })
    expect(toCoronaryPhaseAnswer({ phase: 'nstemi', answeredOn: '2026-10-19' })).toBeUndefined()
    expect(toCoronaryPhaseAnswer({ phase: 'acs-recent', answeredOn: '19/10/2026' })).toBeUndefined()
    expect(toCoronaryPhaseAnswer(['acs-recent'])).toBeUndefined()
  })
})
