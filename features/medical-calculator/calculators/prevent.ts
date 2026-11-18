import type { CalculatorDef, CalcValues, CalcInput } from '../types'

export const PREVENT_VERSION = 'base-ascvd-v1'
const l = (zh: string, en: string) => ({ zh, en })
const yesNo = (key: string, zh: string, en: string): CalcInput => ({ key, type: 'select', label: l(zh, en), defaultValue: '', options: [
  { value: '', label: l('未確認', 'Unconfirmed') }, { value: 'no', label: l('否', 'No') }, { value: 'yes', label: l('是', 'Yes') },
] })
export const PREVENT_INPUTS: CalcInput[] = [
  { key: 'sex', type: 'select', label: l('模型性別', 'Model sex'), source: {kind:'sex'}, defaultValue: '', options: [{value:'',label:l('未確認','Unconfirmed')},{value:'female',label:l('女','Female')},{value:'male',label:l('男','Male')}] },
  { key:'age',type:'number',label:l('年齡（30–79）','Age (30–79)'),source:{kind:'age'},unit:'y' },
  { key:'tc',type:'number',label:l('總膽固醇（130–320）','Total cholesterol (130–320)'),source:{kind:'lab',keys:['CHOL']},unit:'mg/dL',dimension:'cholesterol' },
  { key:'hdl',type:'number',label:l('HDL-C（20–100）','HDL-C (20–100)'),source:{kind:'lab',keys:['HDL']},unit:'mg/dL',dimension:'cholesterol' },
  { key:'sbp',type:'number',label:l('收縮壓（90–200）','Systolic BP (90–200)'),source:{kind:'vital',loinc:['8480-6'],vital:'sbp'},unit:'mmHg' },
  { key:'bmi',type:'number',label:l('BMI（18.5–<40）','BMI (18.5–<40)'),source:{kind:'bmi'},unit:'kg/m²' },
  { key:'egfr',type:'number',label:l('eGFR（15–140）','eGFR (15–140)'),source:{kind:'lab',keys:['EGFR(EPI)','EGFR(M)']},unit:'mL/min/1.73m²',dimension:'egfr' },
  yesNo('dm','糖尿病病史','Diabetes history'), yesNo('smoking','目前吸菸（近 30 天）','Current smoking (past 30 days)'),
  yesNo('statin','目前使用 statin','Current statin use'), yesNo('bptreat','目前使用降血壓藥','Current antihypertensive use'),
  yesNo('cvd','既有心血管疾病（冠心病、腦中風、PAD、心衰竭）','Known CVD (coronary disease, stroke, PAD, HF)'),
  yesNo('subclinical','已知亞臨床動脈粥樣硬化或 LVEF <40%','Known subclinical atherosclerosis or LVEF <40%'),
  yesNo('genetic','已確認遺傳性心血管疾病／致病變異','Confirmed inherited CVD / pathogenic variant'),
  yesNo('eskd','末期腎病／透析','End-stage kidney disease / dialysis'),
  yesNo('limitedLife','預期壽命不足一年','Life expectancy under one year'),
]

// Sex-specific simplified logistic PREVENT-ASCVD base equations, Khan et al.
// Circulation 2024;149:430–449, doi:10.1161/CIRCULATIONAHA.123.067626,
// Supplemental Table S12. Independent dot-product implementation; percentages.
// Order: intercept, age, age², nonHDL, HDL, SBP-low, SBP-high, DM, smoking,
// eGFR-low, eGFR-high, BP-treatment, statin, BP-treatment*SBP, statin*nonHDL,
// age*(nonHDL, HDL, SBP-high, DM, smoking, eGFR-low).
const COEFFICIENTS = {
  female: {
    10: [-3.819975,.719883,0,.1176967,-.151185,-.0835358,.3592852,.8348585,.4831078,.4864619,.0397779,.2265309,-.0592374,-.0395762,.0844423,-.0567839,.0325692,-.1035985,-.2417542,-.0791142,-.1671492],
    30: [-1.974074,.4669202,-.0893118,.1256901,-.1542255,-.0018093,.322949,.6296707,.268292,.100106,.0499663,.1875292,.0152476,-.0276123,.0736147,-.0521962,.0316918,-.1046101,-.2727793,-.1530907,-.1299149],
  },
  male: {
    10: [-3.500655,.7099847,0,.1658663,-.1144285,-.2837212,.3239977,.7189597,.3956973,.3690075,.0203619,.2036522,-.0865581,-.0322916,.114563,-.0300005,.0232747,-.0927024,-.2018525,-.0970527,-.1217081],
    30: [-1.736444,.3994099,-.0937484,.1744643,-.120203,-.0665117,.2753037,.4790257,.1782635,-.0218789,.0602553,.1421182,.0135996,-.0218265,.1013148,-.0312619,.020673,-.0920935,-.2159947,-.1548811,-.0712547],
  },
} as const

// The same paper's base total-CVD equations (Table S12), in the same term
// order. Read from the preventr package's coefficient data (sysdata.rda,
// martingmayer/preventr), whose ASCVD sets reproduce COEFFICIENTS above
// exactly; its BMI terms are zero in these models and so are left out.
const CVD_COEFFICIENTS = {
  female: {
    10: [-3.307728,.7939329,0,.0305239,-.1606857,-.2394003,.3600781,.8667604,.5360739,.6045917,.0433769,.3151672,-.1477655,-.0663612,.1197879,-.0819715,.0306769,-.0946348,-.27057,-.078715,-.1637806],
    30: [-1.318827,.5503079,-.0928369,.0409794,-.1663306,-.1628654,.3299505,.6793894,.3196112,.1857101,.0553528,.2894,-.075688,-.056367,.1071019,-.0751438,.0301786,-.0998776,-.3206166,-.1607862,-.1450788],
  },
  male: {
    10: [-3.031168,.7688528,0,.0736174,-.0954431,-.4347345,.3362658,.7692857,.4386871,.5378979,.0164827,.288879,-.1337349,-.0475924,.150273,-.0517874,.0191169,-.1049477,-.2251948,-.0895067,-.1543702],
    30: [-1.148204,.4627309,-.0984281,.0836088,-.1029824,-.2140352,.2904325,.5331276,.2141914,.1155556,.0603775,.232714,-.0272112,-.0384488,.134192,-.0511759,.0165865,-.1101437,-.2585943,-.1566406,-.1166776],
  },
} as const

export type PreventEndpoint = 'ascvd' | 'cvd'

export function calculatePrevent(v: CalcValues, endpoint: PreventEndpoint = 'ascvd'): { status: 'ready' | 'ineligible' | 'needs-data'; issues: string[]; risk10?: number; risk30?: number } {
  const excluded = ['cvd','subclinical','genetic','eskd','limitedLife'].filter(k=>v[k]==='yes')
  if (v.age?.trim() && Number.isFinite(Number(v.age)) && (Number(v.age)<30 || Number(v.age)>79)) excluded.push('age')
  if (excluded.length) return {status:'ineligible',issues:excluded}
  const issues = PREVENT_INPUTS.filter(input => input.type==='select'
    ? !input.options.some(o=>o.value!=='' && o.value===v[input.key])
    : !v[input.key]?.trim() || !Number.isFinite(Number(v[input.key]))).map(i=>i.key)
  const ranges: Record<string, [number,number]> = { age:[30,79],tc:[130,320],hdl:[20,100],sbp:[90,200],bmi:[18.5,40],egfr:[15,140] }
  for (const [key,[min,max]] of Object.entries(ranges)) if (v[key]?.trim() && (Number(v[key])<min || Number(v[key])>max || (key === 'bmi' && Number(v[key]) === 40))) issues.push(key)
  if (issues.length) return {status:'needs-data',issues:[...new Set(issues)]}
  const age=(Number(v.age)-55)/10, nh=(Number(v.tc)-Number(v.hdl))/38.67-3.5, h=(Number(v.hdl)/38.67-1.3)/.3
  const sl=(Math.min(Number(v.sbp),110)-110)/20, sh=(Math.max(Number(v.sbp),110)-130)/20
  const gl=(Math.min(Number(v.egfr),60)-60)/-15, gh=(Math.max(Number(v.egfr),60)-90)/-15
  const d=Number(v.dm==='yes'), s=Number(v.smoking==='yes'), b=Number(v.bptreat==='yes'), t=Number(v.statin==='yes')
  const terms=[1,age,age*age,nh,h,sl,sh,d,s,gl,gh,b,t,b*sh,t*nh,age*nh,age*h,age*sh,age*d,age*s,age*gl]
  const model=(endpoint==='cvd'?CVD_COEFFICIENTS:COEFFICIENTS)[v.sex as 'female'|'male']
  const risk=(years:10|30)=>100/(1+Math.exp(-model[years].reduce<number>((sum,beta,i)=>sum+beta*terms[i],0)))
  return {status:'ready',issues:[],risk10:risk(10),...(Number(v.age)<=59?{risk30:risk(30)}:{})}
}

export const PREVENT: CalculatorDef = {
  id:'prevent-ascvd', name:l('PREVENT-ASCVD｜10／30 年風險','PREVENT-ASCVD | 10/30-year risk'), category:'cardiac',inputs:PREVENT_INPUTS,
  blurb:l('初級預防基礎模型；需核對所有必填資料及適用條件。','Primary-prevention base model; verify required inputs and eligibility.'),
  coherence: { keys: ['tc', 'hdl'], windowDays: 0 },
  reference:'Khan et al. Circulation 2024;149:430–449. doi:10.1161/CIRCULATIONAHA.123.067626. Base ASCVD equations; 2026 ACC/AHA Dyslipidemia Guideline.',
  compute: values => { const r=calculatePrevent(values); if(r.status!=='ready') return null; return {value:r.risk10!.toFixed(2),unit:'%',extra:[{label:l('30 年 ASCVD','30-year ASCVD'),value:r.risk30===undefined?'— (30–59 years)':`${r.risk30.toFixed(2)}%`}],notes:l('美國族群基礎模型，不含 UACR、HbA1c、SDI；不能當作健保給付判定，也不能用修改治療輸入推估治療效益。','US base model without UACR, HbA1c or SDI. Not an NHI coverage decision or a treatment-benefit model.')} },
}

export const PREVENT_CVD_VERSION = 'base-cvd-v1'

/**
 * PREVENT total CVD (ASCVD plus heart failure): the 10-year risk the 2025
 * AHA/ACC hypertension guideline reads at 130–139/80–89 (≥7.5% to start
 * medication), which the hypertension page's DP-08 consumes. Same inputs and
 * eligibility as PREVENT-ASCVD; a different endpoint.
 */
export const PREVENT_CVD: CalculatorDef = {
  id:'prevent-cvd', name:l('PREVENT-CVD｜10／30 年總心血管風險','PREVENT-CVD | 10/30-year total CVD risk'), category:'cardiac',inputs:PREVENT_INPUTS,
  blurb:l('初級預防基礎模型（ASCVD＋心衰竭）；高血壓 130–139/80–89 是否用藥讀 10 年 ≥7.5%。','Primary-prevention base model (ASCVD plus heart failure); at 130–139/80–89 the hypertension guideline reads 10-year ≥7.5%.'),
  coherence: { keys: ['tc', 'hdl'], windowDays: 0 },
  reference:'Khan et al. Circulation 2024;149:430–449. doi:10.1161/CIRCULATIONAHA.123.067626. Base total-CVD equations; 2025 AHA/ACC High Blood Pressure Guideline.',
  compute: values => { const r=calculatePrevent(values,'cvd'); if(r.status!=='ready') return null; return {value:r.risk10!.toFixed(2),unit:'%',interpretation:r.risk10!>=7.5?l('10 年 ≥7.5%','10-year ≥7.5%'):l('10 年 <7.5%','10-year <7.5%'),extra:[{label:l('30 年總 CVD','30-year total CVD'),value:r.risk30===undefined?'— (30–59 years)':`${r.risk30.toFixed(2)}%`}],notes:l('美國族群基礎模型，不含 UACR、HbA1c、SDI；與 PREVENT-ASCVD 是不同終點，勿互換。','US base model without UACR, HbA1c or SDI. A different endpoint from PREVENT-ASCVD; do not interchange.')} },
}
