// 門診偏好 persistence: settings only, per visitor, and never a dead end when
// storage holds something this build does not understand.
import {
  resolveOutpatientPrefsKey,
  sanitizeOutpatientPrefs,
  useOutpatientPrefsStore,
} from '@/src/application/stores/outpatient-prefs.store'

describe('sanitizeOutpatientPrefs', () => {
  it('returns defaults for garbage', () => {
    expect(sanitizeOutpatientPrefs(null)).toMatchObject({ pinnedLabs: null, formats: [], labMode: null })
    expect(sanitizeOutpatientPrefs('x')).toMatchObject({ pinnedLabs: null })
  })

  it('keeps valid pins in order, dropping duplicates and junk', () => {
    const prefs = sanitizeOutpatientPrefs({ pinnedLabs: ['chem:CREA', 42, 'chem:CREA', 'note:Digoxin', 'bad'] })
    expect(prefs.pinnedLabs).toEqual(['chem:CREA', 'note:Digoxin'])
  })

  it('keeps an empty pin list as a deliberate choice', () => {
    expect(sanitizeOutpatientPrefs({ pinnedLabs: [] }).pinnedLabs).toEqual([])
  })

  it('repairs formats token by token', () => {
    const prefs = sanitizeOutpatientPrefs({
      formats: [{
        id: 'a',
        name: '血脂',
        labRule: 'weird',
        dateStyle: 'roc',
        missingText: '',
        tokens: [
          { kind: 'text', text: ' / ' },
          { kind: 'lab', lab: 'lipid:LDL', field: 'value' },
          { kind: 'lab', lab: 'lipid:LDL', field: 'eval' },
          { kind: 'exam', exam: 'echo', field: 'text' },
          { kind: 'script' },
          { kind: 'newline' },
        ],
      }, { name: 'no id' }],
      activeFormatId: 'missing',
    })
    expect(prefs.formats).toHaveLength(1)
    expect(prefs.formats[0]).toEqual({
      id: 'a',
      name: '血脂',
      labRule: 'sameDay',
      dateStyle: 'roc',
      missingText: '',
      emptyLines: 'omit',
      tokens: [
        { kind: 'text', text: ' / ' },
        { kind: 'lab', lab: 'lipid:LDL', field: 'value' },
        { kind: 'exam', exam: 'echo', field: 'text' },
        { kind: 'newline' },
      ],
    })
    expect(prefs.activeFormatId).toBe('a')
  })

  it('keeps a 最近 N 次 count only on value/date fields and only 2–5', () => {
    const tokens = sanitizeOutpatientPrefs({
      formats: [{
        id: 'a',
        name: 'Cr',
        tokens: [
          { kind: 'lab', lab: 'chem:CREA', field: 'value', count: 3 },
          { kind: 'lab', lab: 'chem:CREA', field: 'date', count: 2 },
          { kind: 'lab', lab: 'chem:CREA', field: 'unit', count: 3 },
          { kind: 'lab', lab: 'chem:CREA', field: 'value', count: 9 },
          { kind: 'lab', lab: 'chem:CREA', field: 'value', count: '3' },
        ],
      }],
    }).formats[0].tokens
    expect(tokens).toEqual([
      { kind: 'lab', lab: 'chem:CREA', field: 'value', count: 3 },
      { kind: 'lab', lab: 'chem:CREA', field: 'date', count: 2 },
      { kind: 'lab', lab: 'chem:CREA', field: 'unit' },
      { kind: 'lab', lab: 'chem:CREA', field: 'value' },
      { kind: 'lab', lab: 'chem:CREA', field: 'value' },
    ])
  })
})

describe('sanitizeOutpatientPrefs — 用藥複製格式', () => {
  it('repairs the stored med format field by field', () => {
    const { medFormat: format } = sanitizeOutpatientPrefs({
      medFormat: {
        id: 'mine',
        numbering: 'roman',
        fields: [
          { id: 'date', on: true, style: 'roc' },
          { id: 'name', on: false, style: 'nope' },
          { id: 'date', on: false },
          { id: 'bogus', on: true },
          { id: 'frequency', on: true, style: 'zh' },
        ],
        group: 'institution',
        endedAcute: 'list',
      },
    })
    expect(format).not.toBeNull()
    expect(format!.numbering).toBe('dot')
    expect(format!.group).toBe('institution')
    expect(format!.endedAcute).toBe('list')
    // Stored order first, each field once; the name is always on; missing
    // fields join at the end, switched off.
    expect(format!.fields.slice(0, 3)).toEqual([
      { id: 'date', on: true, style: 'roc' },
      { id: 'name', on: true, style: 'ingredient' },
      { id: 'frequency', on: true, style: 'zh' },
    ])
    expect(format!.fields).toHaveLength(10)
    expect(format!.fields.slice(3).every((field) => !field.on)).toBe(true)
  })

  it('drops the retired 慢箋 field and grouping from a stored format', () => {
    const { medFormat: format } = sanitizeOutpatientPrefs({
      medFormat: { id: 'mine', fields: [{ id: 'chronic', on: true, style: 'zh' }, { id: 'dose', on: true }], group: 'chronic' },
    })
    expect(format!.fields.map((field) => field.id)).not.toContain('chronic')
    expect(format!.group).toBe('none')
  })

  it('no stored format, or junk, means the default', () => {
    expect(sanitizeOutpatientPrefs({}).medFormat).toBeNull()
    expect(sanitizeOutpatientPrefs({ medFormat: 'junk' }).medFormat).toBeNull()
    expect(sanitizeOutpatientPrefs({ medFormat: { id: 'builtin:standard' } }).medFormat).toBeNull()
  })
})

describe('useOutpatientPrefsStore', () => {
  it('keeps each visitor’s settings apart', () => {
    const { update } = useOutpatientPrefsStore.getState()
    update('uid-a', { pinnedLabs: ['chem:CREA'] })
    update('uid-b', { pinnedLabs: ['lipid:LDL'] })
    const byUser = useOutpatientPrefsStore.getState().byUser
    expect(byUser['uid-a'].pinnedLabs).toEqual(['chem:CREA'])
    expect(byUser['uid-b'].pinnedLabs).toEqual(['lipid:LDL'])
  })

  it('resolves the storage key like the Beta switch', () => {
    expect(resolveOutpatientPrefsKey('acct', 'anon')).toBe('acct')
    expect(resolveOutpatientPrefsKey(null, 'anon')).toBe('anon')
    expect(resolveOutpatientPrefsKey(null, null)).toBe('guest')
  })
})
