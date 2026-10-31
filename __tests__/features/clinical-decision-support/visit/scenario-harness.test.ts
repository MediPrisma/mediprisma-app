/**
 * The dev scenario harness (`app/dev/cdss-scenarios`): its 「全部跑一次」 run
 * opens each scenario's disease and answers its every-visit questions. A
 * scenario whose page or answer the harness cannot map would be logged under
 * its id while measuring another disease, or with an answer skipped.
 */
import { visitAskFor, type VisitAskId } from '@voho0000/personalized-care'
import { HOST_CARE_PACKS } from '@/features/clinical-decision-support/guideline-packs/registry'
import { ANSWER_VALUE, SCENARIO_PAGE_PACK, VISIT_KEY, installSimulate } from '@/app/dev/cdss-scenarios/view/simulate'
import index from '@/app/dev/cdss-scenarios/bundles/index.json'

type Scenario = { id: string; page: string; visit?: Partial<Record<string, string>> }
const scenarios = index as Scenario[]

describe('dev scenario harness', () => {
  it('opens every non-HF scenario on a disease this host lists', () => {
    const listed = HOST_CARE_PACKS.map((pack) => pack.id)
    for (const scenario of scenarios.filter((entry) => entry.page !== 'hf')) {
      const packId = SCENARIO_PAGE_PACK[scenario.page as keyof typeof SCENARIO_PAGE_PACK]
      expect({ id: scenario.id, listed: listed.includes(packId) }).toEqual({ id: scenario.id, listed: true })
    }
    expect(SCENARIO_PAGE_PACK.cad).toBe('chronic-coronary-disease-cdss')
  })

  it('maps every scenario answer to an option the pack asks', () => {
    for (const scenario of scenarios) {
      for (const [key, label] of Object.entries(scenario.visit ?? {})) {
        if (label === undefined) continue
        const ask = VISIT_KEY[key as keyof typeof VISIT_KEY] as VisitAskId | undefined
        const value = ask ? (ANSWER_VALUE[ask] as Record<string, string> | undefined)?.[label] : undefined
        const options = ask ? visitAskFor(ask, 'zh-TW').options : []
        expect({ id: scenario.id, key, option: options.find((option) => option.value === value)?.label }).toEqual({ id: scenario.id, key, option: label })
      }
    }
  })

  it('presses the angina answer on the map', async () => {
    document.body.innerHTML = `
      <div data-testid="cdss-visit-screen">
        <div data-book-ask="angina-trend">
          ${['more', 'same', 'less', 'none'].map((value) => `<button data-book-ask-option="${value}" aria-pressed="false"></button>`).join('')}
        </div>
      </div>`
    const pressed: string[] = []
    document.querySelectorAll<HTMLButtonElement>('[data-book-ask-option]').forEach((button) => {
      button.addEventListener('click', () => pressed.push(button.dataset.bookAskOption ?? ''))
    })
    const w = window as unknown as { __cdssMeasure: () => unknown; __cdssSimulate: (visit: unknown) => Promise<{ steps: unknown[] }> }
    w.__cdssMeasure = () => ({ visit: undefined })
    installSimulate()
    const { steps } = await w.__cdssSimulate({ angina: '較少' })
    expect(steps).toEqual([{ kind: 'ask', ask: 'angina-trend', value: 'less' }])
    expect(pressed).toEqual(['less'])
  })
})
