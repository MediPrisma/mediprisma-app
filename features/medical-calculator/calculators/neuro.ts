import type { CalculatorDef, L } from '../types'
import { scoredQuestionnaire, EPWORTH_SCALE } from './_shared'

export const NEURO: CalculatorDef[] = [
  // ── Glasgow Coma Scale ──────────────────────────────────────────────────
    scoredQuestionnaire({
      id: 'gcs',
      name: { en: 'Glasgow Coma Scale (GCS)', zh: '昏迷指數 (GCS)' },
      category: 'neuro',
      audience: 'medical',
      blurb: { en: 'Level of consciousness.', zh: '意識程度評估。' },
      items: [
        { key: 'eye', label: { en: 'Eye opening', zh: '睜眼反應' }, options: [
          { label: { en: 'Spontaneous (4)', zh: '自動睜眼 (4)' }, points: 4 },
          { label: { en: 'To speech (3)', zh: '呼喚睜眼 (3)' }, points: 3 },
          { label: { en: 'To pain (2)', zh: '疼痛睜眼 (2)' }, points: 2 },
          { label: { en: 'None (1)', zh: '無反應 (1)' }, points: 1 },
        ] },
        { key: 'verbal', label: { en: 'Verbal response', zh: '語言反應' }, options: [
          { label: { en: 'Oriented (5)', zh: '正常對話 (5)' }, points: 5 },
          { label: { en: 'Confused (4)', zh: '答非所問 (4)' }, points: 4 },
          { label: { en: 'Inappropriate words (3)', zh: '不當字句 (3)' }, points: 3 },
          { label: { en: 'Incomprehensible sounds (2)', zh: '無法理解的聲音 (2)' }, points: 2 },
          { label: { en: 'None (1)', zh: '無反應 (1)' }, points: 1 },
        ] },
        { key: 'motor', label: { en: 'Motor response', zh: '運動反應' }, options: [
          { label: { en: 'Obeys commands (6)', zh: '遵從指令 (6)' }, points: 6 },
          { label: { en: 'Localizes pain (5)', zh: '疼痛定位 (5)' }, points: 5 },
          { label: { en: 'Withdraws from pain (4)', zh: '疼痛回縮 (4)' }, points: 4 },
          { label: { en: 'Abnormal flexion (3)', zh: '異常屈曲 (3)' }, points: 3 },
          { label: { en: 'Abnormal extension (2)', zh: '異常伸直 (2)' }, points: 2 },
          { label: { en: 'None (1)', zh: '無反應 (1)' }, points: 1 },
        ] },
      ],
      interpret: (s) => {
        let interp: L; let severity: 'normal' | 'moderate' | 'high'
        if (s <= 8) { interp = { en: '≤ 8 — severe; consider airway protection', zh: '≤ 8 — 重度；考慮氣道保護' }; severity = 'high' }
        else if (s <= 12) { interp = { en: '9–12 — moderate', zh: '9–12 — 中度' }; severity = 'moderate' }
        else { interp = { en: '13–15 — mild', zh: '13–15 — 輕度' }; severity = 'normal' }
        return { value: `${s} / 15`, interpretation: interp, severity }
      },
      reference: 'Teasdale & Jennett 1974. Eye (4) + Verbal (5) + Motor (6).',
    }),

  // ── Epworth Sleepiness Scale — patient self-report ──────────────────────
    scoredQuestionnaire({
      id: 'epworth',
      name: { en: 'Epworth Sleepiness Scale', zh: 'Epworth 嗜睡量表' },
      category: 'neuro',
      audience: 'both',
      blurb: { en: 'Daytime sleepiness; self-reported.', zh: '白天嗜睡程度；可自填。' },
      scale: EPWORTH_SCALE,
      items: [
        { key: 'q1', label: { en: 'Sitting and reading', zh: '坐著閱讀時' } },
        { key: 'q2', label: { en: 'Watching TV', zh: '看電視時' } },
        { key: 'q3', label: { en: 'Sitting inactive in a public place', zh: '在公共場所安靜坐著時' } },
        { key: 'q4', label: { en: 'As a car passenger for an hour without a break', zh: '搭車一小時（乘客）' } },
        { key: 'q5', label: { en: 'Lying down to rest in the afternoon', zh: '下午躺著休息時' } },
        { key: 'q6', label: { en: 'Sitting and talking to someone', zh: '坐著與人交談時' } },
        { key: 'q7', label: { en: 'Sitting quietly after lunch without alcohol', zh: '午餐後安靜坐著（未飲酒）時' } },
        { key: 'q8', label: { en: 'In a car, stopped in traffic', zh: '開車遇塞車停等時' } },
      ],
      interpret: (s) => {
        let interp: L; let severity: 'normal' | 'moderate' | 'high'
        if (s <= 10) { interp = { en: '0–10 normal', zh: '0–10 正常' }; severity = 'normal' }
        else if (s <= 14) { interp = { en: '11–14 mild sleepiness', zh: '11–14 輕度嗜睡' }; severity = 'moderate' }
        else if (s <= 17) { interp = { en: '15–17 moderate sleepiness', zh: '15–17 中度嗜睡' }; severity = 'high' }
        else { interp = { en: '18–24 severe sleepiness', zh: '18–24 重度嗜睡' }; severity = 'high' }
        return { value: `${s} / 24`, interpretation: interp, severity }
      },
      reference: 'Johns MW 1991. > 10 suggests excessive daytime sleepiness.',
    }),

  // ── NIH Stroke Scale (NIHSS) ────────────────────────────────────────────
    scoredQuestionnaire({
      id: 'nihss',
      name: { en: 'NIH Stroke Scale (NIHSS)', zh: 'NIH 中風量表 (NIHSS)' },
      category: 'neuro',
      audience: 'medical',
      blurb: { en: 'Acute stroke severity.', zh: '急性中風嚴重度。' },
      items: [
        { key: 'loc', label: { en: '1a. Level of consciousness', zh: '1a. 意識程度' }, options: [
          { label: { en: 'Alert (0)', zh: '清醒 (0)' }, points: 0 },
          { label: { en: 'Drowsy (1)', zh: '嗜睡 (1)' }, points: 1 },
          { label: { en: 'Stuporous (2)', zh: '木僵 (2)' }, points: 2 },
          { label: { en: 'Coma (3)', zh: '昏迷 (3)' }, points: 3 },
        ] },
        { key: 'locq', label: { en: '1b. LOC questions (month, age)', zh: '1b. 意識提問（月份、年齡）' }, options: [
          { label: { en: 'Both correct (0)', zh: '皆正確 (0)' }, points: 0 },
          { label: { en: 'One correct (1)', zh: '一項正確 (1)' }, points: 1 },
          { label: { en: 'Neither (2)', zh: '皆錯誤 (2)' }, points: 2 },
        ] },
        { key: 'locc', label: { en: '1c. LOC commands (open eyes, grip)', zh: '1c. 意識指令（睜眼、握拳）' }, options: [
          { label: { en: 'Both correct (0)', zh: '皆完成 (0)' }, points: 0 },
          { label: { en: 'One correct (1)', zh: '一項完成 (1)' }, points: 1 },
          { label: { en: 'Neither (2)', zh: '皆未完成 (2)' }, points: 2 },
        ] },
        { key: 'gaze', label: { en: '2. Best gaze', zh: '2. 眼球水平運動' }, options: [
          { label: { en: 'Normal (0)', zh: '正常 (0)' }, points: 0 },
          { label: { en: 'Partial palsy (1)', zh: '部分麻痺 (1)' }, points: 1 },
          { label: { en: 'Forced deviation (2)', zh: '強迫偏斜 (2)' }, points: 2 },
        ] },
        { key: 'visual', label: { en: '3. Visual fields', zh: '3. 視野' }, options: [
          { label: { en: 'No loss (0)', zh: '無缺損 (0)' }, points: 0 },
          { label: { en: 'Partial hemianopia (1)', zh: '部分偏盲 (1)' }, points: 1 },
          { label: { en: 'Complete hemianopia (2)', zh: '完全偏盲 (2)' }, points: 2 },
          { label: { en: 'Bilateral hemianopia (3)', zh: '雙側偏盲 (3)' }, points: 3 },
        ] },
        { key: 'facial', label: { en: '4. Facial palsy', zh: '4. 顏面麻痺' }, options: [
          { label: { en: 'Normal (0)', zh: '正常 (0)' }, points: 0 },
          { label: { en: 'Minor (1)', zh: '輕微 (1)' }, points: 1 },
          { label: { en: 'Partial (2)', zh: '部分 (2)' }, points: 2 },
          { label: { en: 'Complete (3)', zh: '完全 (3)' }, points: 3 },
        ] },
        { key: 'armL', label: { en: '5a. Motor arm — left', zh: '5a. 上肢運動 — 左' }, options: [
          { label: { en: 'No drift (0)', zh: '無漂移 (0)' }, points: 0 },
          { label: { en: 'Drift (1)', zh: '漂移 (1)' }, points: 1 },
          { label: { en: 'Some effort vs gravity (2)', zh: '可稍抗地心引力 (2)' }, points: 2 },
          { label: { en: 'No effort vs gravity (3)', zh: '無法抗地心引力 (3)' }, points: 3 },
          { label: { en: 'No movement (4)', zh: '完全不動 (4)' }, points: 4 },
        ] },
        { key: 'armR', label: { en: '5b. Motor arm — right', zh: '5b. 上肢運動 — 右' }, options: [
          { label: { en: 'No drift (0)', zh: '無漂移 (0)' }, points: 0 },
          { label: { en: 'Drift (1)', zh: '漂移 (1)' }, points: 1 },
          { label: { en: 'Some effort vs gravity (2)', zh: '可稍抗地心引力 (2)' }, points: 2 },
          { label: { en: 'No effort vs gravity (3)', zh: '無法抗地心引力 (3)' }, points: 3 },
          { label: { en: 'No movement (4)', zh: '完全不動 (4)' }, points: 4 },
        ] },
        { key: 'legL', label: { en: '6a. Motor leg — left', zh: '6a. 下肢運動 — 左' }, options: [
          { label: { en: 'No drift (0)', zh: '無漂移 (0)' }, points: 0 },
          { label: { en: 'Drift (1)', zh: '漂移 (1)' }, points: 1 },
          { label: { en: 'Some effort vs gravity (2)', zh: '可稍抗地心引力 (2)' }, points: 2 },
          { label: { en: 'No effort vs gravity (3)', zh: '無法抗地心引力 (3)' }, points: 3 },
          { label: { en: 'No movement (4)', zh: '完全不動 (4)' }, points: 4 },
        ] },
        { key: 'legR', label: { en: '6b. Motor leg — right', zh: '6b. 下肢運動 — 右' }, options: [
          { label: { en: 'No drift (0)', zh: '無漂移 (0)' }, points: 0 },
          { label: { en: 'Drift (1)', zh: '漂移 (1)' }, points: 1 },
          { label: { en: 'Some effort vs gravity (2)', zh: '可稍抗地心引力 (2)' }, points: 2 },
          { label: { en: 'No effort vs gravity (3)', zh: '無法抗地心引力 (3)' }, points: 3 },
          { label: { en: 'No movement (4)', zh: '完全不動 (4)' }, points: 4 },
        ] },
        { key: 'ataxia', label: { en: '7. Limb ataxia', zh: '7. 肢體協調不良' }, options: [
          { label: { en: 'Absent (0)', zh: '無 (0)' }, points: 0 },
          { label: { en: 'One limb (1)', zh: '一肢 (1)' }, points: 1 },
          { label: { en: 'Two limbs (2)', zh: '兩肢 (2)' }, points: 2 },
        ] },
        { key: 'sensory', label: { en: '8. Sensory', zh: '8. 感覺' }, options: [
          { label: { en: 'Normal (0)', zh: '正常 (0)' }, points: 0 },
          { label: { en: 'Mild–moderate loss (1)', zh: '輕中度喪失 (1)' }, points: 1 },
          { label: { en: 'Severe / total loss (2)', zh: '重度／完全喪失 (2)' }, points: 2 },
        ] },
        { key: 'language', label: { en: '9. Best language', zh: '9. 語言' }, options: [
          { label: { en: 'No aphasia (0)', zh: '無失語 (0)' }, points: 0 },
          { label: { en: 'Mild–moderate (1)', zh: '輕中度 (1)' }, points: 1 },
          { label: { en: 'Severe aphasia (2)', zh: '重度失語 (2)' }, points: 2 },
          { label: { en: 'Mute / global aphasia (3)', zh: '緘默／完全失語 (3)' }, points: 3 },
        ] },
        { key: 'dysarthria', label: { en: '10. Dysarthria', zh: '10. 構音障礙' }, options: [
          { label: { en: 'Normal (0)', zh: '正常 (0)' }, points: 0 },
          { label: { en: 'Mild–moderate (1)', zh: '輕中度 (1)' }, points: 1 },
          { label: { en: 'Severe (2)', zh: '重度 (2)' }, points: 2 },
        ] },
        { key: 'extinction', label: { en: '11. Extinction / inattention', zh: '11. 忽略／不注意' }, options: [
          { label: { en: 'No abnormality (0)', zh: '無異常 (0)' }, points: 0 },
          { label: { en: 'Mild (1)', zh: '輕度 (1)' }, points: 1 },
          { label: { en: 'Severe (2)', zh: '重度 (2)' }, points: 2 },
        ] },
      ],
      interpret: (s) => {
        let interp: L; let severity: 'normal' | 'moderate' | 'high'
        if (s === 0) { interp = { en: '0 — no stroke symptoms', zh: '0 — 無中風症狀' }; severity = 'normal' }
        else if (s <= 4) { interp = { en: '1–4 — minor stroke', zh: '1–4 — 輕微中風' }; severity = 'moderate' }
        else if (s <= 15) { interp = { en: '5–15 — moderate stroke', zh: '5–15 — 中度中風' }; severity = 'high' }
        else if (s <= 20) { interp = { en: '16–20 — moderate–severe stroke', zh: '16–20 — 中重度中風' }; severity = 'high' }
        else { interp = { en: '21–42 — severe stroke', zh: '21–42 — 重度中風' }; severity = 'high' }
        return { value: `${s} / 42`, interpretation: interp, severity }
      },
      reference: 'Brott T, et al. Stroke 1989. 15 items; higher = more severe. Guides thrombolysis/thrombectomy decisions.',
    }),

  // ── ABCD² Score (TIA → stroke risk) ─────────────────────────────────────
    scoredQuestionnaire({
      id: 'abcd2',
      name: { en: 'ABCD² Score (TIA)', zh: 'ABCD² 分數（TIA）' },
      category: 'neuro',
      audience: 'medical',
      blurb: { en: 'Stroke risk after TIA.', zh: 'TIA 後中風風險。' },
      items: [
        { key: 'age', label: { en: 'Age ≥ 60', zh: '年齡 ≥ 60' }, options: [
          { label: { en: 'No (0)', zh: '否 (0)' }, points: 0 },
          { label: { en: 'Yes (1)', zh: '是 (1)' }, points: 1 },
        ] },
        { key: 'bp', label: { en: 'BP ≥ 140/90 mmHg', zh: '血壓 ≥ 140/90 mmHg' }, options: [
          { label: { en: 'No (0)', zh: '否 (0)' }, points: 0 },
          { label: { en: 'Yes (1)', zh: '是 (1)' }, points: 1 },
        ] },
        { key: 'clinical', label: { en: 'Clinical features', zh: '臨床特徵' }, options: [
          { label: { en: 'Other (0)', zh: '其他 (0)' }, points: 0 },
          { label: { en: 'Speech disturbance, no weakness (1)', zh: '言語障礙、無無力 (1)' }, points: 1 },
          { label: { en: 'Unilateral weakness (2)', zh: '單側無力 (2)' }, points: 2 },
        ] },
        { key: 'duration', label: { en: 'Duration of symptoms', zh: '症狀持續時間' }, options: [
          { label: { en: '< 10 min (0)', zh: '< 10 分 (0)' }, points: 0 },
          { label: { en: '10–59 min (1)', zh: '10–59 分 (1)' }, points: 1 },
          { label: { en: '≥ 60 min (2)', zh: '≥ 60 分 (2)' }, points: 2 },
        ] },
        { key: 'diabetes', label: { en: 'Diabetes', zh: '糖尿病' }, source: { kind: 'hfpefClinical', key: 'diabetes', answers: { yes: '1', no: '0' } }, presumed: 0, options: [
          { label: { en: 'No (0)', zh: '否 (0)' }, points: 0 },
          { label: { en: 'Yes (1)', zh: '是 (1)' }, points: 1 },
        ] },
      ],
      interpret: (s) => {
        let cat: L; let severity: 'normal' | 'moderate' | 'high'; let risk: [string, string, string]; let note: L
        if (s <= 3) {
          cat = { en: 'Low risk', zh: '低風險' }; severity = 'normal'; risk = ['1.0%', '1.2%', '3.1%']
          note = { en: 'Low short-term stroke risk. Outpatient TIA workup is often reasonable per local pathways.', zh: '短期中風風險低。依當地流程通常可安排門診 TIA 檢查追蹤。' }
        } else if (s <= 5) {
          cat = { en: 'Moderate risk', zh: '中度風險' }; severity = 'moderate'; risk = ['4.1%', '5.9%', '9.8%']
          note = { en: 'Consider hospital admission or urgent (<24 h) specialist evaluation, vascular imaging, and starting secondary prevention.', zh: '考慮住院或 24 小時內緊急專科評估、血管影像,並開始次級預防。' }
        } else {
          cat = { en: 'High risk', zh: '高風險' }; severity = 'high'; risk = ['8.1%', '11.7%', '17.8%']
          note = { en: 'Admission and urgent evaluation generally warranted; expedite imaging and secondary prevention.', zh: '一般建議住院並緊急評估;儘速安排影像與次級預防。' }
        }
        return {
          value: `${s} / 7`,
          interpretation: cat,
          severity,
          extra: [
            { label: { en: '2-day stroke risk', zh: '2 天中風風險' }, value: risk[0] },
            { label: { en: '7-day stroke risk', zh: '7 天中風風險' }, value: risk[1] },
            { label: { en: '90-day stroke risk', zh: '90 天中風風險' }, value: risk[2] },
          ],
          notes: note,
        }
      },
      reference: 'Johnston SC, et al. Lancet 2007 (n=4799). Risks are for the pooled validation cohort; ABCD² is an adjunct, not a substitute for specialist assessment.',
    }),

  // ── modified Rankin Scale (mRS) ─────────────────────────────────────────
    {
      id: 'mrs',
      name: { en: 'Modified Rankin Scale (mRS)', zh: '改良 Rankin 量表 (mRS)' },
      category: 'neuro',
      audience: 'medical',
      blurb: { en: 'Functional outcome after stroke.', zh: '中風後功能結果。' },
      inputs: [
        { key: 'grade', type: 'select', label: { en: 'Functional status', zh: '功能狀態' }, defaultValue: '', options: [
          { value: '0', label: { en: '0 — No symptoms', zh: '0 — 無症狀' } },
          { value: '1', label: { en: '1 — No significant disability', zh: '1 — 無明顯失能' } },
          { value: '2', label: { en: '2 — Slight disability', zh: '2 — 輕度失能' } },
          { value: '3', label: { en: '3 — Moderate disability (walks unaided)', zh: '3 — 中度失能（可自行走動）' } },
          { value: '4', label: { en: '4 — Moderately severe (needs help walking)', zh: '4 — 中重度失能（行走需協助）' } },
          { value: '5', label: { en: '5 — Severe (bedridden, incontinent)', zh: '5 — 重度失能（臥床、失禁）' } },
          { value: '6', label: { en: '6 — Dead', zh: '6 — 死亡' } },
        ] },
      ],
      compute: (v) => {
        const g = v.grade
        if (g === '' || g === undefined) return null
        const grade = Number(g)
        const interp = [
          { en: 'No symptoms at all', zh: '完全無症狀' },
          { en: 'No significant disability — able to carry out usual activities', zh: '無明顯失能 — 可從事日常活動' },
          { en: 'Slight disability — unable to do all previous activities but independent', zh: '輕度失能 — 部分活動受限但生活可自理' },
          { en: 'Moderate disability — requires some help, walks unassisted', zh: '中度失能 — 需部分協助，可自行走動' },
          { en: 'Moderately severe — unable to walk / attend to needs without help', zh: '中重度失能 — 行走與生活需協助' },
          { en: 'Severe disability — bedridden, incontinent, constant care', zh: '重度失能 — 臥床、失禁、需全時照護' },
          { en: 'Dead', zh: '死亡' },
        ][grade]
        const severity: 'normal' | 'moderate' | 'high' = grade <= 1 ? 'normal' : grade <= 3 ? 'moderate' : 'high'
        return { value: String(grade), interpretation: interp, severity }
      },
      reference: 'van Swieten JC, et al. Stroke 1988. 0 (no symptoms) to 6 (dead).',
    },
]
