import { headlineItems, reviewHeadline } from '@/src/core/utils/headline-review.utils'

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

  it('waits for the problem list, and reads the age and sex as no item', () => {
    expect(reviewHeadline('70F with hyperkalemia', [], [])).toBeUndefined()
    expect(headlineItems('94-year-old man with CKD 3b and gout.')).toEqual(['CKD 3b', 'gout'])
  })
})
