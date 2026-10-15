/** Audited mapping used by the on-prem HF kit; no free-text analyte inference.
 * BNP is the service's historical feature name for NT-proBNP (LOINC 33762-6).
 * This is not a mapping for BNP assays.
 */
export interface HfLab { key: string; loinc: string[]; unit: string; units: string[]; alternatives?: { units: string[]; factor?: number; convert?: (value: number) => number }[] }
const mg = ['mg/dL', 'mg/dl', 'MG/DL']
const micro = ['umol/L', 'µmol/L', 'μmol/L']
const cells = ['10*3/uL', '10^3/uL', '10*3/μL', '10^3/μL', '10*3/µL', '10^3/µL', 'K/uL', 'k/uL', 'x10^3/uL', '10*9/L', '10^9/L', 'x10^9/L']
// EHR-FHIR-BRIDGE exports blood counts per microlitre, whereas the model
// expects thousands per microlitre. Convert from the explicit unit only.
const cellsPerMicrolitre = [{ units: ['/uL', 'cells/uL', 'Cells/uL', '#/uL'], factor: 0.001 }]
export const HF_LABS: HfLab[] = [
  { key: 'BNP', loinc: ['33762-6'], unit: 'pg/mL', units: ['pg/mL', 'pg/ml', 'ng/L', 'ng/l'] },
  { key: 'CREAT', loinc: ['2160-0'], unit: 'mg/dL', units: mg, alternatives: [{ units: micro, factor: 1 / 88.42 }] },
  { key: 'BUN', loinc: ['3094-0'], unit: 'mg/dL', units: mg, alternatives: [{ units: ['mmol/L'], factor: 2.801 }] },
  { key: 'K', loinc: ['2823-3'], unit: 'mmol/L', units: ['mmol/L', 'mmol/l', 'mEq/L', 'meq/L', 'mEq/l'] },
  { key: 'HGB', loinc: ['718-7'], unit: 'g/dL', units: ['g/dL', 'g/dl'], alternatives: [{ units: ['g/L', 'g/l'], factor: 0.1 }] },
  { key: 'ALB', loinc: ['1751-7'], unit: 'g/dL', units: ['g/dL', 'g/dl'], alternatives: [{ units: ['g/L', 'g/l'], factor: 0.1 }] },
  { key: 'PLT', loinc: ['777-3'], unit: '10*3/uL', units: cells, alternatives: cellsPerMicrolitre },
  { key: 'WBC', loinc: ['6690-2'], unit: '10*3/uL', units: cells, alternatives: cellsPerMicrolitre },
  { key: 'CRP', loinc: ['1988-5'], unit: 'mg/dL', units: mg, alternatives: [{ units: ['mg/L', 'mg/l'], factor: 0.1 }] },
  // Fasting serum/plasma glucose is also a glucose measurement. Project it
  // to the existing general glucose feature; never infer fasting in reverse.
  { key: 'GLU', loinc: ['2345-7', '1558-6'], unit: 'mg/dL', units: mg, alternatives: [{ units: ['mmol/L'], factor: 18.016 }] },
  { key: 'HBA1C', loinc: ['4548-4'], unit: '%', units: ['%'], alternatives: [{ units: ['mmol/mol'], convert: value => 0.09148 * value + 2.152 }] },
  { key: 'BILI', loinc: ['1975-2'], unit: 'mg/dL', units: mg, alternatives: [{ units: micro, factor: 1 / 17.104 }] },
  ...[{ key: 'ALT', loinc: '1742-6' }, { key: 'AST', loinc: '1920-8' }].map(item => ({ key: item.key, loinc: [item.loinc], unit: 'U/L', units: ['U/L', 'IU/L', 'u/L'] })),
  { key: 'UA', loinc: ['3084-1'], unit: 'mg/dL', units: mg, alternatives: [{ units: micro, factor: 1 / 59.48 }] },
  ...[{ key: 'LDLC', loinc: '13457-7' }, { key: 'HDLC', loinc: '2085-9' }, { key: 'CHOL', loinc: '2093-3' }].map(item => ({ key: item.key, loinc: [item.loinc], unit: 'mg/dL', units: mg, alternatives: [{ units: ['mmol/L'], factor: 38.67 }] })),
  ...[{ key: 'RDW', loinc: ['788-0'] }, { key: 'LYMP', loinc: ['736-9'] }, { key: 'SEG', loinc: ['770-8', '769-0'] }].map(item => ({ ...item, unit: '%', units: ['%'] })),
  { key: 'TG', loinc: ['2571-8'], unit: 'mg/dL', units: mg, alternatives: [{ units: ['mmol/L'], factor: 88.57 }] },
]
export function normalizeHfLab(lab: HfLab, quantity: Record<string, any>): Record<string, any> | null {
  if (typeof quantity.value !== 'number' || !Number.isFinite(quantity.value)) return null
  // Source units sometimes carry spaces ("g /dL"); spacing never changes a unit's meaning.
  const raw = quantity.code || quantity.unit
  const unit = typeof raw === 'string' ? raw.replace(/[µμ]/g, 'u').replace(/\s+/g, '') : raw
  const alternative = lab.alternatives?.find(item => item.units.includes(unit))
  if (!lab.units.includes(unit) && !alternative) return null
  const value = alternative ? (alternative.convert ? alternative.convert(quantity.value) : quantity.value * (alternative.factor ?? 1)) : quantity.value
  if (!Number.isFinite(value)) return null
  if (quantity.comparator && !['<', '<=', '>', '>='].includes(quantity.comparator)) return null
  return { value: Math.round(value * 1e6) / 1e6, unit: lab.unit, system: 'http://unitsofmeasure.org', code: lab.unit,
    ...(quantity.comparator ? { comparator: quantity.comparator } : {}) }
}
