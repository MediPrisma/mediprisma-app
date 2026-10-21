import { formatIngredientStrength } from '@/src/shared/utils/medication-short-name'

describe('formatIngredientStrength', () => {
  it('turns the drug master ingredient into a short label', () => {
    expect(formatIngredientStrength('ACETYLCYSTEINE 600 MG')).toBe('Acetylcysteine 600 mg')
    expect(formatIngredientStrength('SODIUM CHLORIDE 0.9 %')).toBe('Sodium Chloride 0.9 %')
    expect(formatIngredientStrength('TRAMADOL HCL 50 MG/ML')).toBe('Tramadol HCl 50 mg/mL')
    expect(formatIngredientStrength('LEVOTHYROXINE SODIUM .1 MG')).toBe('Levothyroxine Sodium 0.1 mg')
  })

  it('keeps every component of a combination', () => {
    expect(formatIngredientStrength('AMLODIPINE 5 MG; VALSARTAN 80 MG')).toBe('Amlodipine 5 mg + Valsartan 80 mg')
    expect(formatIngredientStrength('SODIUM CHLORIDE 3.2 MG/ML+POTASSIUM CHLORIDE 1.4 MG/ML'))
      .toBe('Sodium Chloride 3.2 mg/mL + Potassium Chloride 1.4 mg/mL')
    expect(formatIngredientStrength('SENNOSIDE A+B(CALCIUM) 12 MG')).toBe('Sennoside A+B(CALCIUM) 12 mg')
  })

  it('leaves an ingredient without strength readable and empty input empty', () => {
    expect(formatIngredientStrength('FLURBIPROFEN')).toBe('Flurbiprofen')
    expect(formatIngredientStrength('OXYBUTYNIN CHLORIDE (=OXIBUTININA HCL=OXYBUTYNIN H 5 MG')).toBe('Oxybutynin Chloride 5 mg')
    expect(formatIngredientStrength('  ')).toBeUndefined()
    expect(formatIngredientStrength(undefined)).toBeUndefined()
  })
})
