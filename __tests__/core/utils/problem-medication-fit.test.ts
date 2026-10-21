import { medicationFitsProblem, otherListedUse } from '@/src/core/utils/problem-medication-fit.utils'

describe('medicationFitsProblem', () => {
  it.each([
    ['Primary open-angle glaucoma', 'N06DA02', false], // donepezil
    ['Primary open-angle glaucoma', 'S01XA20', false], // artificial tears
    ['Primary open-angle glaucoma', 'S01ED51', true], // timolol combination
    ['Hypertension', 'G04BD04', false], // oxybutynin
    ['Hypertension', 'C09CA01', true],
    ['Benign prostatic hyperplasia with overactive bladder', 'G04BD12', true], // mirabegron
    ['Benign prostatic hyperplasia', 'N02BE01', false], // acetaminophen
    ['Type 2 diabetes mellitus', 'A10BK01', true],
    ['第二型糖尿病', 'A10BK01', true],
    ['Hypothyroidism', 'H03AA01', true],
    ['Gastroesophageal reflux disease and gastritis', 'A03FA03', true], // domperidone
  ] as const)('%s with %s → %s', (problem, atc, expected) => {
    expect(medicationFitsProblem(problem, atc)).toBe(expected)
  })

  it('has no opinion on a problem whose treatments are too broad to judge', () => {
    expect(medicationFitsProblem('Chronic kidney disease stage 3b', 'G04BD04')).toBeUndefined()
    expect(medicationFitsProblem('Delirium', 'N06DA02')).toBeUndefined()
  })

  it('has no opinion without an ATC code', () => {
    expect(medicationFitsProblem('Primary open-angle glaucoma', undefined)).toBeUndefined()
  })

  it('does not read pulmonary or ocular hypertension as systemic hypertension', () => {
    expect(medicationFitsProblem('Pulmonary hypertension', 'G04BD04')).toBeUndefined()
    // Ocular hypertension is judged as glaucoma care.
    expect(medicationFitsProblem('Ocular hypertension', 'S01ED01')).toBe(true)
  })

  it('does not read a diuretic that lowers potassium as hypokalemia treatment', () => {
    expect(medicationFitsProblem('Hypokalemia', 'C03CA01')).toBe(false) // furosemide
    expect(medicationFitsProblem('Hypokalemia', 'A12BA01')).toBe(true) // potassium chloride
    expect(medicationFitsProblem('Hypokalemia', 'C03DA01')).toBe(true) // spironolactone
  })

  it('names the listed problem an inferring medicine is also given for', () => {
    expect(otherListedUse(['A10BK01'], ['Chronic kidney disease stage 3b', 'BPH'])).toBe('Chronic kidney disease stage 3b')
    expect(otherListedUse(['A10BK01'], ['BPH'])).toBeUndefined()
    // Metformin is not such a medicine; neither is a mix with one.
    expect(otherListedUse(['A10BA02'], ['Chronic kidney disease'])).toBeUndefined()
    expect(otherListedUse(['A10BK01', 'A10BA02'], ['Chronic kidney disease'])).toBeUndefined()
    // Not one class: any common multi-use class, against any of its uses.
    expect(otherListedUse(['C09CA03'], ['Heart failure with reduced ejection fraction'])).toBe('Heart failure with reduced ejection fraction')
    expect(otherListedUse(['C07AB07'], ['Atrial fibrillation'])).toBe('Atrial fibrillation')
    expect(otherListedUse(['C03CA01'], ['Liver cirrhosis with ascites'])).toBe('Liver cirrhosis with ascites')
    expect(otherListedUse(['C07AB07', 'C09CA03'], ['Heart failure', 'Atrial fibrillation'])).toBe('Heart failure')
    expect(otherListedUse(['C09CA03'], ['Pulmonary hypertension'])).toBeUndefined()
  })

  it('accepts a class that fits any condition a combined label names', () => {
    expect(medicationFitsProblem('Hyperuricemia and gout with hypertension', 'C09CA01')).toBe(true)
  })
})
