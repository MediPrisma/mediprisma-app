import fs from 'node:fs'
import path from 'node:path'
import {
  GUIDED_TOURS,
  TASK_TOUR_IDS,
  WHATS_NEW,
  getGuidedTour,
  isTourAvailable,
  resolveTourSteps,
} from '@/features/guided-tour/guided-tour.tours'
import type { TourContext } from '@/features/guided-tour/guided-tour.types'

const clinician: TourContext = {
  audience: 'medical',
  betaEnabled: false,
  authenticated: false,
  desktop: true,
  rightFeatures: new Set(['medical-summary', 'medical-chat', 'medical-calculator', 'ips-export', 'settings']),
}
const patient: TourContext = { ...clinician, audience: 'patient' }

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(full)
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

const SOURCES = ['app', 'features', 'src', 'components']
  .flatMap((dir) => sourceFiles(path.join(process.cwd(), dir)))
  .filter((file) => !file.endsWith('guided-tour.tours.ts'))
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n')

/** `data-tour="x"`, `data-testid="x"` or a bare `data-source-link` in a selector. */
function attributesIn(selector: string): Array<{ name: string; value?: string }> {
  return [...selector.matchAll(/\[(data-[a-z-]+)(?:="([^"]+)")?\]/g)]
    .map((match) => ({ name: match[1], value: match[2] }))
    // The tab panel state is Radix's, not ours.
    .filter((attribute) => attribute.name !== 'data-state' && attribute.name !== 'data-result-available')
}

function rendered(attribute: { name: string; value?: string }): boolean {
  if (!attribute.value) return SOURCES.includes(attribute.name)
  if (SOURCES.includes(`${attribute.name}="${attribute.value}"`)) return true
  // Passed through a component prop, or chosen in a data-tour expression.
  if (attribute.name === 'data-tour'
    && (SOURCES.includes(`dataTour="${attribute.value}"`) || SOURCES.includes(`'${attribute.value}'`))) return true
  // Registry-driven tabs render their attribute from a template.
  const dynamic = attribute.value.match(/^(left-tab|right-tab|right-content)-/)
  return Boolean(dynamic && SOURCES.includes(`${attribute.name}={\`${dynamic[1]}-\${`))
}

describe('guided tour catalogue', () => {
  it('points every step and announcement at an element the app renders', () => {
    const selectors = [
      ...GUIDED_TOURS.flatMap((tour) => tour.steps.flatMap((step) => [step.target, step.desktopTarget, step.fallbackTarget])),
      ...WHATS_NEW.map((item) => item.anchor),
    ].filter((selector): selector is string => Boolean(selector))
    const missing = selectors.flatMap((selector) => attributesIn(selector)
      .filter((attribute) => !rendered(attribute))
      .map((attribute) => `${selector} → ${attribute.name}=${attribute.value ?? ''}`))
    expect(missing).toEqual([])
  })

  it('keeps every step short and bilingual', () => {
    for (const tour of GUIDED_TOURS) {
      for (const step of tour.steps) {
        for (const copy of [step.title, step.body, step.patientTitle, step.patientBody, step.fallbackBody]) {
          if (!copy) continue
          expect(copy['zh-TW'].trim()).not.toBe('')
          expect(copy.en.trim()).not.toBe('')
          expect(copy['zh-TW'].length).toBeLessThanOrEqual(80)
        }
      }
    }
  })

  it('gives every step a unique id within its tour', () => {
    for (const tour of GUIDED_TOURS) {
      const ids = tour.steps.map((step) => step.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('keeps getting started to five steps that end at the hub', () => {
    const steps = resolveTourSteps(getGuidedTour('getting-started')!, clinician)
    expect(steps).toHaveLength(5)
    expect(steps[0].scene).toEqual({ panel: 'left', step: 'patient-overview' })
    expect(steps.at(-1)?.id).toBe('hub')
  })

  it('lists every task tour once and announces only tours that exist', () => {
    expect(new Set(TASK_TOUR_IDS).size).toBe(TASK_TOUR_IDS.length)
    for (const id of TASK_TOUR_IDS) expect(getGuidedTour(id)).toBeDefined()
    for (const item of WHATS_NEW) if (item.tourId) expect(getGuidedTour(item.tourId)).toBeDefined()
  })

  it('follows the audience, the Beta switch and the screen width', () => {
    const available = (context: TourContext) => GUIDED_TOURS
      .filter((tour) => isTourAvailable(tour, context))
      .map((tour) => tour.id)

    expect(available(clinician)).not.toContain('care-guidance')
    expect(available({ ...clinician, rightFeatures: new Set([...clinician.rightFeatures, 'clinical-decision-support']) }))
      .toContain('care-guidance')
    expect(available({ ...patient, rightFeatures: new Set([...patient.rightFeatures, 'clinical-decision-support']) }))
      .not.toContain('care-guidance')
    expect(available({ ...patient, rightFeatures: new Set([...patient.rightFeatures, 'personalized-education']) }))
      .toContain('education')
    expect(available(clinician)).toContain('split-view')
    expect(available({ ...clinician, desktop: false })).not.toContain('split-view')
  })

  it('uses plain-language copy for patients where it differs', () => {
    const clinicianSummary = resolveTourSteps(getGuidedTour('medical-summary')!, clinician)[0]
    const patientSummary = resolveTourSteps(getGuidedTour('medical-summary')!, patient)[0]
    expect(clinicianSummary.body['zh-TW']).toContain('開藥注意')
    expect(patientSummary.body['zh-TW']).toContain('用藥提醒')
    expect(patientSummary.body['zh-TW']).not.toContain('影像與病理')
  })
})
