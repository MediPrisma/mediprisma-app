import { headlineItems, headlineProblemListState, reviewHeadline } from '@/src/core/utils/headline-review.utils'

// Synthetic headlines and problem lists.
describe('reviewHeadline', () => {
  it('names the items the problem list does not hold', () => {
    expect(reviewHeadline('70F with CKD stage 3a, hyperkalemia, anemia', ['Heart failure'], [])).toEqual({
      unlisted: ['CKD stage 3a', 'hyperkalemia', 'anemia'], medicines: [], values: [],
    })
  })

  it('accepts abbreviations, synonyms and chart wording for listed problems', () => {
    const problems = [
      'Chronic kidney disease stage 3b', 'Type 2 diabetes mellitus', 'Hypothyroidism',
      'Benign prostatic hyperplasia', 'Right primary open-angle glaucoma', 'Delirium', 'Atrial fibrillation',
      'Chronic systolic heart failure', 'Hypertension', 'Status post total knee arthroplasty',
    ]
    expect(reviewHeadline(
      '81M with CKD 3b, T2DM, hypothyroidism, BPH, POAG, dementia/delirium history, AF, HFrEF, HTN, s/p TKA',
      problems,
      [],
    )).toBeUndefined()
    expect(reviewHeadline('66F with renal impairment and heart failure with reduced ejection fraction', ['Reduced eGFR, chronicity undetermined', 'Heart failure'], []))
      .toBeUndefined()
  })

  it('keeps medicines and lab values apart from problems', () => {
    expect(reviewHeadline(
      '68M with chronic systolic heart failure, LVEF 35%, NT-proBNP 520 pg/mL, on Synvalsartan, Bisoprolol',
      ['Chronic systolic heart failure'],
      ['synvalsartan', 'bisoprolol'],
    )).toEqual({
      unlisted: [],
      medicines: ['on Synvalsartan', 'Bisoprolol'],
      values: ['LVEF 35%', 'NT-proBNP 520 pg/mL'],
    })
    // A short medicine name is not matched inside a problem ("iron deficiency anemia").
    expect(reviewHeadline('55F with iron deficiency anemia', ['Iron deficiency anemia'], ['iron'])).toBeUndefined()
  })

  it('reads what heart failure is measured by as that heart failure, and drops a leading "and"', () => {
    expect(reviewHeadline(
      '63F with chronic systolic heart failure, sinus bradycardia, and reduced left ventricular ejection fraction',
      ['Chronic systolic heart failure'],
      [],
    )).toEqual({ unlisted: ['sinus bradycardia'], medicines: [], values: [] })
    expect(reviewHeadline('74M with heart failure and elevated NT-proBNP', ['Heart failure'], [])).toBeUndefined()
  })

  it('reads a kind of mood disorder, and a tumour marker, as the listed condition', () => {
    expect(reviewHeadline('59F with mood disorder', ['Bipolar disorder'], [])).toBeUndefined()
    expect(reviewHeadline('72M with rising CEA', ['RLL lung adenocarcinoma'], [])).toBeUndefined()
    expect(reviewHeadline('72M with recent pneumonia', ['RLL lung adenocarcinoma'], []))
      .toEqual({ unlisted: ['recent pneumonia'], medicines: [], values: [] })
  })

  it('reviews against a settled empty list, and reads the age and sex as no item', () => {
    // Waiting for a list still streaming is the caller's decision; an empty
    // list that has landed holds none of the headline's problems.
    expect(reviewHeadline('70F with hyperkalemia', [], [])).toEqual({ unlisted: ['hyperkalemia'], medicines: [], values: [] })
    expect(reviewHeadline('70F', [], [])).toBeUndefined()
    expect(headlineItems('94-year-old man with CKD 3b and gout.')).toEqual(['CKD 3b', 'gout'])
  })
})

describe('headlineProblemListState', () => {
  it('reads the failure from the summary on screen, which a model switch keeps', () => {
    // Model A's summary stays on screen after switching to model B, whose slot
    // has no errors: A's failed problem list must still label A's headline.
    const shownFromModelA = { problems: [], completedCardIds: ['overview'], cardErrors: { problems: 'PARSE_FAILED' } }
    expect(headlineProblemListState(shownFromModelA)).toBe('failed')
  })

  it('waits while the list streams, and reviews once it landed, empty or not', () => {
    expect(headlineProblemListState({ problems: [], completedCardIds: ['overview'] })).toBe('pending')
    expect(headlineProblemListState(undefined)).toBe('pending')
    expect(headlineProblemListState({ problems: [], completedCardIds: ['overview', 'problems'] })).toBe('settled')
    expect(headlineProblemListState({ problems: [{}] })).toBe('settled')
  })
})
