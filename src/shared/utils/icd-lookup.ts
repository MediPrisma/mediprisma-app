// ICD-10 code lookup utility
// Resolves ICD-10 codes (e.g., "C50.912") to human-readable descriptions.
// Lookup order: bundle Condition resources → built-in common Taiwan dictionary → undefined
import { isMedcloudSource, isVghtpeSource } from './clinical-source-identity'

export interface IcdCode {
  code: string
  system?: string
  description?: string
}

function icdFamily(system?: string): string | undefined {
  const normalized = system?.trim().toLowerCase().replace(/\/$/, '')
  if (!normalized) return undefined
  if (/(?:^|\/)icd-?10-?cm$/.test(normalized)) return 'icd-10-cm'
  if (/(?:^|\/)icd-?10$/.test(normalized)) return 'icd-10'
  if (/(?:^|\/)icd-?9(?:-?cm)?$/.test(normalized)) return 'icd-9'
  return undefined
}

function normalizeIcdCodeToken(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function stripLeadingIcdCode(description: string | undefined, code: string): string | undefined {
  const clean = description?.trim()
  if (!clean || !code) return clean || undefined

  const normalizedCode = normalizeIcdCodeToken(code)
  if (!normalizedCode) return clean

  let i = 0
  let collected = ''
  while (i < clean.length && collected.length < normalizedCode.length) {
    const ch = clean[i]
    if (/[A-Za-z0-9]/.test(ch)) {
      collected += ch.toUpperCase()
      i += 1
      continue
    }
    if (/[.\-_\s]/.test(ch)) {
      i += 1
      continue
    }
    break
  }

  if (collected !== normalizedCode) return clean

  // Avoid stripping "F33421..." when the target code is "F33.42".
  if (i < clean.length && /[A-Za-z0-9]/.test(clean[i])) return clean

  while (i < clean.length && /[\s:：\-–—,，.。]/.test(clean[i])) i += 1
  return clean.slice(i).trim() || undefined
}

/**
 * Parse a comma/semicolon separated string of ICD codes into individual codes.
 * Example: "C50.912,N95.1,N73.9" → ["C50.912", "N95.1", "N73.9"]
 */
export function parseIcdCodes(text: string | undefined | null): string[] {
  if (!text) return []
  return text
    .split(/[,;、]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Build an exact-code lookup from FHIR Conditions and optional visit diagnoses.
 * Both the source code and dot-free alias resolve to the same description.
 *
 * Bridge contract: Condition.code typically has both
 *   - coding[].display  (English from the ICD code system)
 *   - text              (中文 description)
 *
 * `locale` decides which one wins when both are present:
 *   'en' → English coding[].display first
 *   else → 中文 text first
 *
 * Non-UI callers (AI context, clinical-insights) keep the prior English-
 * first behaviour by leaving the locale unspecified.
 */
export function buildIcdDictionary(
  conditions: any[],
  locale: string = 'en',
  encounters: any[] = [],
): Map<string, string> {
  const dict = new Map<string, string>()
  const preferText = locale !== 'en'
  const concepts = [
    ...encounters.flatMap((encounter) => encounter?._sourceEncounterRecords?.length ? encounter._sourceEncounterRecords : [encounter])
      .flatMap((encounter: any) => (encounter?.reasonCode ?? []).map((concept: any) => ({ concept, trustedClaimLabel: isMedcloudSource(encounter), borrowDisplay: !isVghtpeSource(encounter) }))),
    ...(Array.isArray(conditions) ? conditions : []).map((condition) => ({ concept: condition?.code, trustedClaimLabel: isMedcloudSource(condition), borrowDisplay: !isVghtpeSource(condition) })),
  ]
  for (const { concept, trustedClaimLabel, borrowDisplay } of concepts) {
    const codings = concept?.coding ?? []
    const text = concept?.text
    for (const coding of codings) {
      const family = icdFamily(coding?.system)
      if (!family) continue
      const code = coding?.code
      const display = coding?.display
      // Coding.display is a code label. Arbitrary CodeableConcept.text may
      // contain this patient's findings and must not become another visit's
      // translation. Only the explicit MediCloud claim adapter's CODE+label
      // text has the governed diagnosis-label contract.
      const claimLabel = trustedClaimLabel && text && stripLeadingIcdCode(text, coding?.code ?? '') !== text
        ? stripLeadingIcdCode(text, coding?.code ?? '') : undefined
      // North VGH's mapper also puts the clinician's complete SOAP diagnosis
      // into coding.display; for that source it is not a terminology label.
      const label = borrowDisplay ? display : undefined
      const picked = preferText ? (claimLabel || label) : (label || claimLabel)
      if (!code || !picked) continue
      const key = normalizeIcdCodeToken(code)
      const qualifiedKey = `${family}|${key}`
      const existing = dict.get(qualifiedKey)
      // An English-only SOAP label must not overwrite an exact Chinese label
      // supplied by another record of this same ICD code.
      const value = preferText && /\p{Script=Han}/u.test(existing ?? '')
        && !/\p{Script=Han}/u.test(picked) ? existing! : picked
      dict.set(qualifiedKey, value)
      // Legacy code-only callers represent Taiwan ICD-10-CM. Never populate
      // their namespace with WHO ICD-10, ICD-9, SNOMED or local code labels.
      if (family === 'icd-10-cm') { dict.set(code, value); dict.set(key, value) }
    }
  }
  return dict
}

/** Display only: borrow Chinese wording solely from an exact ICD-code match.
 * Do not use a broader category/prefix as the translation of a specific code. */
export function localizedIcdDescription(
  code: string,
  text?: string,
  display?: string,
  dict?: Map<string, string>,
  locale: string = 'zh-TW',
  system?: string,
): string | undefined {
  const sourceText = stripLeadingIcdCode(text, code)
  const sourceDisplay = stripLeadingIcdCode(display, code)
  const family = icdFamily(system)
  const exact = stripLeadingIcdCode(system
    ? (family ? dict?.get(`${family}|${normalizeIcdCodeToken(code)}`) : undefined)
    : dict?.get(code) ?? dict?.get(normalizeIcdCodeToken(code)), code)
    || ((!system || family === 'icd-10-cm') ? BUILTIN_ICD[code] : undefined)
  if (locale !== 'en') {
    const chinese = [sourceText, exact, sourceDisplay].find((value) => /\p{Script=Han}/u.test(value ?? ''))
    if (chinese) return chinese
  }
  return locale === 'en' ? sourceDisplay || sourceText || exact : sourceText || sourceDisplay || exact
}

/**
 * Built-in fallback dictionary for common Taiwan outpatient ICD-10 codes.
 * Add codes here as needed. Lookup is by prefix when a full code isn't found.
 */
const BUILTIN_ICD: Record<string, string> = {
  // Neoplasms
  'C50': '乳房惡性腫瘤 (Malignant neoplasm of breast)',
  'C16': '胃惡性腫瘤 (Stomach cancer)',
  'C18': '結腸惡性腫瘤 (Colon cancer)',
  'C20': '直腸惡性腫瘤 (Rectal cancer)',
  'C22': '肝惡性腫瘤 (Liver cancer)',
  'C25': '胰臟惡性腫瘤 (Pancreatic cancer)',
  'C34': '肺及支氣管惡性腫瘤 (Lung cancer)',
  'C53': '子宮頸惡性腫瘤 (Cervical cancer)',
  'C54': '子宮體惡性腫瘤 (Uterine cancer)',
  'C56': '卵巢惡性腫瘤 (Ovarian cancer)',
  'C61': '攝護腺惡性腫瘤 (Prostate cancer)',
  'C73': '甲狀腺惡性腫瘤 (Thyroid cancer)',

  // Cardiovascular
  'I10': '原發性高血壓 (Essential hypertension)',
  'I11': '高血壓性心臟病 (Hypertensive heart disease)',
  'I20': '心絞痛 (Angina pectoris)',
  'I21': '急性心肌梗塞 (Acute myocardial infarction)',
  'I25': '慢性缺血性心臟病 (Chronic ischemic heart disease)',
  'I48': '心房顫動 (Atrial fibrillation)',
  'I50': '心臟衰竭 (Heart failure)',
  'I63': '腦梗塞 (Cerebral infarction)',

  // Endocrine
  'E11': '第二型糖尿病 (Type 2 diabetes mellitus)',
  'E10': '第一型糖尿病 (Type 1 diabetes mellitus)',
  'E78': '血脂異常 (Disorders of lipoprotein metabolism)',
  'E03': '甲狀腺機能低下 (Hypothyroidism)',
  'E05': '甲狀腺機能亢進 (Hyperthyroidism)',

  // Respiratory
  'J06': '上呼吸道感染 (Acute upper respiratory infections)',
  'J18': '肺炎 (Pneumonia)',
  'J20': '急性支氣管炎 (Acute bronchitis)',
  'J44': '慢性阻塞性肺病 (COPD)',
  'J45': '氣喘 (Asthma)',

  // Digestive
  'K21': '胃食道逆流 (GERD)',
  'K29': '胃炎 (Gastritis)',
  'K70': '酒精性肝病 (Alcoholic liver disease)',
  'K74': '肝硬化 (Cirrhosis)',
  'K76': '肝病 (Other diseases of liver)',
  'K80': '膽結石 (Cholelithiasis)',

  // Genitourinary
  'N18': '慢性腎臟病 (Chronic kidney disease)',
  'N39': '泌尿道感染 (UTI)',
  'N40': '攝護腺肥大 (Prostatic hyperplasia)',
  'N63': '乳房腫塊 (Lump in breast)',
  'N73': '骨盆腔發炎 (Pelvic inflammatory disease)',
  'N92': '經期過多 (Excessive menstruation)',
  'N95': '更年期及女性更年期狀態 (Menopausal state)',

  // Mental/Neurological
  'F32': '憂鬱症 (Depressive episode)',
  'F33': '反覆性憂鬱症 (Recurrent depressive disorder)',
  'F41': '焦慮症 (Anxiety disorders)',
  'G40': '癲癇 (Epilepsy)',
  'G47': '睡眠障礙 (Sleep disorders)',

  // Musculoskeletal
  'M16': '髖關節炎 (Coxarthrosis)',
  'M17': '膝關節炎 (Gonarthrosis)',
  'M19': '其他關節炎 (Other arthrosis)',
  'M54': '背痛 (Dorsalgia)',
  'M81': '骨質疏鬆 (Osteoporosis)',

  // Aftercare / general
  'Z00': '一般健康檢查 (General examination)',
  'Z51': '其他術後照護 (Other aftercare)',
  'Z08': '惡性腫瘤後續追蹤 (Follow-up after cancer treatment)',
  'Z09': '其他疾病後續追蹤 (Follow-up after other treatment)',
}

/**
 * Look up an ICD-10 code description.
 * Tries: exact match in dict → prefix match in dict → built-in dict → undefined.
 */
export function lookupIcd(code: string, dict?: Map<string, string>): string | undefined {
  if (!code) return undefined
  // Try exact match
  if (dict?.has(code)) return stripLeadingIcdCode(dict.get(code), code)
  if (BUILTIN_ICD[code]) return stripLeadingIcdCode(BUILTIN_ICD[code], code)
  // Prefix match (e.g., "C50.912" → "C50")
  const prefix = code.split('.')[0]
  if (prefix !== code) {
    if (dict?.has(prefix)) return stripLeadingIcdCode(dict.get(prefix), prefix)
    if (BUILTIN_ICD[prefix]) return stripLeadingIcdCode(BUILTIN_ICD[prefix], prefix)
  }
  return undefined
}

/**
 * Convenience: parse + lookup in one call.
 */
export function resolveIcdCodes(
  text: string | undefined | null,
  dict?: Map<string, string>
): IcdCode[] {
  return parseIcdCodes(text).map((code) => ({
    code,
    description: lookupIcd(code, dict),
  }))
}

/**
 * Extract every ICD diagnosis from an Encounter, supporting both
 * NHI-FHIR-Bridge formats:
 *
 *   - NEW (v0.7.x+, ~2026-05): each diagnosis is its own `reasonCode[i]`
 *     entry with `coding[].code`, English `coding[].display`, and a
 *     "CODE 中文" `text`. Primary diagnosis is `reasonCode[0]`, secondary
 *     diagnoses follow.
 *
 *   - OLD: a single `reasonCode[0].text` holds comma-separated codes like
 *     "C50.912,N95.1,N73.9", no per-code display.
 *
 * `locale` controls which language wins when both are present:
 *   'en'    → English coding[].display preferred
 *   others  → 中文 text preferred (with the leading "CODE " prefix stripped)
 *
 * Falls back to the dict / built-in lookup when neither is usable.
 */
export function extractEncounterIcds(
  encounter: any,
  dict?: Map<string, string>,
  locale: string = 'zh-TW'
): IcdCode[] {
  const reasonCodes: any[] = Array.isArray(encounter?.reasonCode) ? encounter.reasonCode : []
  if (reasonCodes.length === 0) return []

  const out: IcdCode[] = []
  const seen = new Set<string>()
  const push = (code: string, description?: string, system?: string) => {
    const key = `${system ?? ''}|${normalizeIcdCodeToken(code)}`
    if (!code || seen.has(key)) return
    seen.add(key)
    const cleanedDescription = stripLeadingIcdCode(description, code)
    out.push({ code, description: cleanedDescription })
  }

  for (const rc of reasonCodes) {
    const coding = Array.isArray(rc?.coding) ? rc.coding : []
    const primaryCoding = coding.find((c: any) => c?.code) || coding[0]
    const code = primaryCoding?.code
    const display = typeof primaryCoding?.display === 'string' ? primaryCoding.display.trim() : ''
    const rawText = typeof rc?.text === 'string' ? rc.text.trim() : ''

    if (code) {
      // NEW format: per-reasonCode entry. Strip the leading code from text so
      // we get just the diagnosis description. NHI text may use either the
      // dotted ICD ("F33.42") or the compact form ("F3342").
      const textNoPrefix = stripLeadingIcdCode(rawText, code)
      const picked = localizedIcdDescription(code, textNoPrefix, display, dict, locale, primaryCoding?.system)
      push(code, picked || undefined, primaryCoding?.system)
      continue
    }

    // OLD format fallback: comma-separated codes inside reasonCode[*].text.
    if (rawText) {
      const codes = parseIcdCodes(rawText)
      if (codes.length > 0) {
        for (const c of codes) push(c, localizedIcdDescription(c, undefined, undefined, dict, locale))
      } else {
        // No parsable codes — keep the raw text as-is.
        push(rawText, undefined)
      }
    }
  }

  return out
}
