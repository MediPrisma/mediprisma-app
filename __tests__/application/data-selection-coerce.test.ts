import { coerceProfile } from '@/src/application/providers/data-selection.provider'
import {
  DEFAULT_DATA_SELECTION,
  DEFAULT_DATA_FILTERS,
} from '@/src/shared/constants/data-selection.constants'

describe('coerceProfile — schema migration preserves user choices', () => {
  it('undefined → a full default profile', () => {
    const p = coerceProfile(undefined)
    expect(p.selection).toEqual(DEFAULT_DATA_SELECTION)
    expect(p.filters).toEqual(DEFAULT_DATA_FILTERS)
    expect(p.documentMode).toBe('recentAdmissions')
  })

  it('preserves the user toggles even when the stored profile predates new keys', () => {
    // Stale profile: encounters/medications turned OFF, but `documents` (selection)
    // and `observationVersion` (filters) are missing — as if saved before those
    // keys existed. The OLD code discarded the whole object → toggles reset.
    const staleSelection = { ...DEFAULT_DATA_SELECTION, encounters: false, medications: false } as Record<string, unknown>
    delete staleSelection.documents
    const staleFilters = { ...DEFAULT_DATA_FILTERS } as Record<string, unknown>
    delete staleFilters.observationVersion

    const p = coerceProfile({
      selection: staleSelection as any,
      filters: staleFilters as any,
    })

    // User choices survive…
    expect(p.selection.encounters).toBe(false)
    expect(p.selection.medications).toBe(false)
    // …and the missing keys are filled from the current defaults.
    expect(p.selection.documents).toBe(DEFAULT_DATA_SELECTION.documents)
    expect(p.filters.observationVersion).toBe(DEFAULT_DATA_FILTERS.observationVersion)
  })

  it('tolerates garbage (non-object) selection/filters by falling back to defaults', () => {
    const p = coerceProfile({ selection: 'nope' as any, filters: null as any })
    expect(p.selection).toEqual(DEFAULT_DATA_SELECTION)
    expect(p.filters).toEqual(DEFAULT_DATA_FILTERS)
  })

  it('keeps document picks (mode + ids)', () => {
    const p = coerceProfile({ documentMode: 'custom', documentIds: ['a', 'b'] })
    expect(p.documentMode).toBe('custom')
    expect(p.documentIds).toEqual(['a', 'b'])
  })

  it('drops legacy supplementary notes and manual context overrides', () => {
    const legacy = {
      supplementaryNotes: 'old note',
      editedClinicalContext: 'old frozen context',
    } as unknown as Parameters<typeof coerceProfile>[0]

    const p = coerceProfile(legacy)

    expect(p).not.toHaveProperty('supplementaryNotes')
    expect(p).not.toHaveProperty('editedClinicalContext')
  })
})
