import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  localizeDemoDisplayText,
  localizeDemoOrganizationDisplay,
} from '@/src/shared/utils/demo-display'

describe('demo display localization', () => {
  it('keeps the frozen Chinese demo labels in the default locale', () => {
    expect(localizeDemoDisplayText('陳大明', 'zh-TW')).toBe('陳大明')
    expect(localizeDemoOrganizationDisplay('示範北辰醫院', 'zh-TW'))
      .toBe('示範北辰醫院')
  })

  it('uses readable de-identified English labels in the English demo', () => {
    expect(localizeDemoDisplayText('陳大明', 'en')).toBe('Demo Patient')
    expect(localizeDemoDisplayText('初期慢性腎病追蹤', 'en'))
      .toBe('Early-stage chronic kidney disease follow-up')
    expect(localizeDemoOrganizationDisplay('示範北辰醫院', 'en'))
      .toBe('C Hospital')
    expect(localizeDemoOrganizationDisplay('示範長青藥局', 'en'))
      .toBe('C Pharmacy')
    expect(localizeDemoOrganizationDisplay('示範祥安診所', 'en'))
      .toBe('D Clinic')
    expect(localizeDemoOrganizationDisplay('示範康健診所', 'en'))
      .toBe('E Clinic')
  })

  it.each(['demo-bundle.json', 'demo-medcloud-bundle.json'])(
    'has an English label for every demo organization in %s',
    (file) => {
      const bundle = readFileSync(path.join(__dirname, '../../../public/demo', file), 'utf8')
      const names = [...new Set(bundle.match(/示範[\u4e00-\u9fff]+/g) ?? [])]
      expect(names.length).toBeGreaterThan(0)
      const missing = names.filter((name) => localizeDemoOrganizationDisplay(name, 'en') === name)
      expect(missing).toEqual([])
    },
  )

  it('does not rewrite non-demo imported names', () => {
    expect(localizeDemoOrganizationDisplay('Taipei City Hospital', 'en'))
      .toBe('Taipei City Hospital')
  })
})
