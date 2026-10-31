// Dev harness: a simulated cardiologist on the decision map (決策地圖 v2).
// Answers the every-visit questions the way the scenario says, then presses
// the primary button of every point the map marks as today's (following each
// chain to its next step) and records what was read and pressed. Exposed as
// window.__cdssSimulate(visit).
export const ANSWER_VALUE = {
  'dyspnoea-trend': { 變差: 'worse', 穩定: 'stable', 進步: 'better' },
  'weight-trend': { 增加: 'up', 不變: 'same', 減少: 'down' },
  'af-symptoms': { 有: 'yes', 無: 'no' },
  bleeding: { 有: 'yes', 無: 'no' },
  'angina-trend': { 更多: 'more', 一樣: 'same', 較少: 'less', 沒有: 'none' },
}
export const VISIT_KEY = { dyspnea: 'dyspnoea-trend', weight: 'weight-trend', afSymptoms: 'af-symptoms', bleeding: 'bleeding', angina: 'angina-trend' }
// The disease a scenario's `page` opens on; heart failure is the host default.
export const SCENARIO_PAGE_PACK = { af: 'atrial-fibrillation-cdss', cad: 'chronic-coronary-disease-cdss', htn: 'hypertension-cdss' }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const clean = (t) => (t || '').replace(/\s+/g, ' ').trim()

export function installSimulate() {
  window.__cdssSimulate = async (visit = {}) => {
    const screen = () => document.querySelector('[data-testid="cdss-visit-screen"]')
    if (!screen()) return { error: 'map not on screen' }
    const steps = []
    // 1. Every-visit answers.
    for (const [key, label] of Object.entries(visit)) {
      const ask = VISIT_KEY[key]
      const value = ANSWER_VALUE[ask]?.[label]
      if (!ask || !value) continue
      const button = screen().querySelector(`[data-book-ask="${ask}"] button[data-book-ask-option="${value}"]`)
      if (!button) { steps.push({ kind: 'ask-missing', ask, value }); continue }
      if (button.getAttribute('aria-pressed') === 'true') {
        steps.push({ kind: 'ask-prefilled', ask, value, prefilled: button.dataset.prefilled === 'true' })
        continue
      }
      button.click()
      steps.push({ kind: 'ask', ask, value })
      await sleep(600)
    }
    // 2. Today's points, top to bottom, following chains.
    const markOf = (dp) => screen().querySelector(`[data-book-map-dp="${dp}"]`)?.dataset.bookMark
    for (let guard = 0; guard < 12; guard += 1) {
      const primary = [...screen().querySelectorAll('[data-visit-primary]:not([disabled])')].find((button) => (
        ['act', 'safety'].includes(markOf(button.closest('[data-book-dp]')?.dataset.bookDp))
      ))
      if (!primary) break
      const entry = primary.closest('[data-book-dp]')
      steps.push({
        kind: 'decide',
        dp: primary.dataset.visitPrimary,
        mark: markOf(entry.dataset.bookDp),
        text: clean(entry.textContent).slice(0, 160),
        primary: clean(primary.textContent),
      })
      primary.click()
      await sleep(700)
    }
    const after = window.__cdssMeasure().visit
    return { steps, after }
  }
}
