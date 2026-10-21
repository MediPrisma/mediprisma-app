// What the guided tours teach. Each tour is one task a reader wants to get
// done, a few steps long, and every step says one thing.
//
// Writing a step:
// - Point at a control that exists on screen. A step whose control may be
//   absent for some records is `optional` and is skipped rather than
//   explained in the abstract.
// - Name controls exactly as the UI labels them; when a label changes, change
//   it here in the same commit.
// - Keep the body to a sentence or two. The screen is the documentation; the
//   step only has to make the control noticeable.
import { CLINICAL_DECISION_SUPPORT_FEATURE_ID } from '@/features/clinical-decision-support/module'
import { PERSONALIZED_EDUCATION_FEATURE_ID } from '@/features/personalized-education/module'
import type {
  GuidedTourDefinition,
  GuidedTourId,
  GuidedTourStep,
  Localized,
  TourContext,
  WhatsNewItem,
} from './guided-tour.types'
import { WHATS_NEW } from './guided-tour.news'

export { WHATS_NEW }

const medicalOnly = (context: TourContext) => context.audience === 'medical'
const desktopOnly = (context: TourContext) => context.desktop
const hasRightFeature = (id: string) => (context: TourContext) => context.rightFeatures.has(id)

const HUB_STEP: GuidedTourStep = {
  id: 'hub',
  scene: { panel: 'none' },
  target: '[data-tour="tour-hub-button"]',
  fallbackTarget: '[data-tour="header-more"]',
  fallbackGraceAttempts: 4,
  title: { 'zh-TW': '其他功能，到導覽中心挑著學', en: 'Learn the rest from the tour hub' },
  body: {
    'zh-TW': '「導覽」依任務分成 1 分鐘的小導覽，新功能也會在這裡提示。',
    en: 'Tours are split into one-minute tasks, and new features are announced there too.',
  },
  fallbackBody: {
    'zh-TW': '在「更多」選單打開導覽中心：依任務分成 1 分鐘的小導覽，新功能也會在這裡提示。',
    en: 'Open the tour hub from More: one-minute tours by task, plus new features.',
  },
}

const SUMMARY_SOURCE_STEP: GuidedTourStep = {
  id: 'summary-source',
  scene: { panel: 'right', step: 'summary' },
  target: '[data-tour="right-content-medical-summary"] [data-source-link]',
  optional: true,
  highlightPadding: 4,
  title: { 'zh-TW': '點虛線底線的文字，核對原文', en: 'Select dotted text to check the source' },
  body: {
    'zh-TW': '有虛線底線的數值、診斷或藥名都連到原始紀錄。AI 整理的內容，請以原文為準。',
    en: 'Dotted values, diagnoses and medicines link to the original records. Rely on the source, not the AI wording.',
  },
}

export const GUIDED_TOURS: GuidedTourDefinition[] = [
  {
    id: 'getting-started',
    icon: 'start',
    title: { 'zh-TW': '開始使用', en: 'Getting started' },
    description: { 'zh-TW': '病人總覽 → AI 摘要 → 核對原文', en: 'Overview → AI summary → check the source' },
    steps: [
      {
        id: 'overview',
        scene: { panel: 'left', step: 'patient-overview' },
        target: '[data-tour="overview-card"]',
        fallbackTarget: '[data-tour="left-tabs"]',
        highlightPadding: 4,
        title: { 'zh-TW': '先看總覽', en: 'Start with the overview' },
        body: {
          'zh-TW': '近期的檢驗、影像、用藥與就診放在同一頁，右上可切換 1 個月到 1 年。',
          en: 'Recent labs, imaging, medications and visits on one page. Switch from 1 month to 1 year at the top.',
        },
      },
      {
        id: 'record',
        target: '[data-tour="left-tabs"]',
        title: { 'zh-TW': '原始病歷在左側分頁', en: 'The source record is in the left tabs' },
        body: {
          'zh-TW': '病人資訊、就診紀錄、報告、用藥與文件都是原始紀錄，AI 摘要的依據都在這裡。',
          en: 'Patient information, visits, reports, medications and documents are the original records the AI summary draws on.',
        },
      },
      {
        id: 'summary',
        scene: { panel: 'right', step: 'summary' },
        target: '[data-tour="medical-summary-overview"]',
        // Not generated yet: point at the empty state's 產生摘要 instead.
        fallbackTarget: '[data-tour="medical-summary-empty"]',
        fallbackGraceAttempts: 0,
        lockTargetOnceResolved: true,
        highlightPadding: 4,
        title: { 'zh-TW': '右側醫療摘要整理重點', en: 'The medical summary collects the key points' },
        body: {
          'zh-TW': '初診快覽依序列出一句話摘要、問題清單與負責院所、影像與病理重點、開藥注意。',
          en: 'The first-visit summary lists a one-line overview, problems with their managing facility, imaging and pathology, and prescribing cautions.',
        },
        patientTitle: { 'zh-TW': '右側是你的健康摘要', en: 'Your health summary is on the right' },
        patientBody: {
          'zh-TW': '用白話整理健康狀況清單、我的用藥與照護，以及用藥提醒。',
          en: 'A plain-language list of health conditions, your medicines and care, and medication reminders.',
        },
        fallbackBody: {
          'zh-TW': '按「產生摘要」後，AI 會在這裡整理重點。預設不會自動產生。',
          en: 'Select Generate and the AI summary appears here. It does not run automatically by default.',
        },
      },
      SUMMARY_SOURCE_STEP,
      HUB_STEP,
    ],
  },
  {
    id: 'know-patient',
    icon: 'user',
    title: { 'zh-TW': '看懂這位病人', en: 'Get to know the patient' },
    description: { 'zh-TW': '總覽、病人資訊、就診紀錄', en: 'Overview, patient information, visits' },
    patientTitle: { 'zh-TW': '看懂我的資料', en: 'Understand my record' },
    steps: [
      {
        id: 'overview-range',
        scene: { panel: 'left', step: 'patient-overview' },
        target: '[data-tour="overview-card"]',
        fallbackTarget: '[data-tour="left-tabs"]',
        highlightPadding: 4,
        title: { 'zh-TW': '總覽：一頁看近況', en: 'Overview: recent status at a glance' },
        body: {
          'zh-TW': '檢驗可切換異常、常用、全部或自訂；「編輯自訂檢驗」可釘選自己常看的項目。',
          en: 'Show abnormal, common, all or custom labs. Edit custom labs to pin the ones you check most.',
        },
      },
      {
        id: 'patient-info',
        scene: { panel: 'left', step: 'patient-info' },
        target: '[data-tour="left-tab-patient"]',
        title: { 'zh-TW': '病人資訊', en: 'Patient information' },
        body: {
          'zh-TW': '基本資料、生命徵象、問題清單、預立醫療決定、醫療裝置與照護計畫。',
          en: 'Demographics, vital signs, problem list, advance directives, devices and care plans.',
        },
      },
      {
        id: 'visits',
        scene: { panel: 'left', step: 'visits' },
        target: '[data-tour="visits-card"]',
        fallbackTarget: '[data-tour="left-tab-visits"]',
        highlightPadding: 4,
        title: { 'zh-TW': '就診紀錄可以篩選', en: 'Filter the visit history' },
        body: {
          'zh-TW': '依院所、就診類型或西醫／中醫／牙醫篩選，也能只看含檢驗或含出院病摘的就診。',
          en: 'Filter by facility, visit type or Western/Chinese medicine/dental, or show only visits with labs or discharge summaries.',
        },
      },
    ],
  },
  {
    id: 'labs-reports',
    icon: 'activity',
    title: { 'zh-TW': '檢驗與報告', en: 'Labs and reports' },
    description: { 'zh-TW': '累積報告、趨勢圖、AI 翻譯', en: 'Cumulative report, trends, AI explanation' },
    steps: [
      {
        id: 'report-tabs',
        scene: { panel: 'left', step: 'reports' },
        target: '[data-tour="report-tabs"]',
        fallbackTarget: '[data-tour="left-tab-reports"]',
        title: { 'zh-TW': '報告分頁', en: 'Report views' },
        body: {
          'zh-TW': '累積報告把同一項檢驗排成表格；另有檢驗、影像、病理、癌篩、生命徵象與處置。',
          en: 'The cumulative report lines up each lab over time. Lab, imaging, pathology, cancer screening, vitals and procedures have their own views.',
        },
      },
      {
        id: 'cumulative-trend',
        target: '[data-tour="cumulative-trend-hint"]',
        optional: true,
        title: { 'zh-TW': '點檢驗名稱看趨勢', en: 'Select a lab name for its trend' },
        body: {
          'zh-TW': '趨勢圖上按住左右拖曳可框選放大；「放大密集區」一鍵聚焦，「還原」回到全部。',
          en: 'Drag across the trend chart to zoom into a period. Zoom to dense run focuses in one step; Reset shows everything.',
        },
      },
      {
        id: 'row-trend',
        scene: { panel: 'left', step: 'trend' },
        target: '[role="tabpanel"][data-state="active"] [data-tour="report-trend"]',
        optional: true,
        highlightPadding: 10,
        title: { 'zh-TW': '小折線圖：同項目的歷次紀錄', en: 'The small line icon: earlier results' },
        body: {
          'zh-TW': '明細列旁的折線圖可在趨勢圖與歷史表格之間切換。',
          en: 'The line icon beside a row switches between a trend chart and the history table.',
        },
      },
      {
        id: 'report-ai',
        scene: { panel: 'left', step: 'imaging-ai' },
        target: '[role="tabpanel"][data-state="active"] [data-tour="report-ai-interpretation"]',
        // The last step settles for the report tabs rather than ending the
        // tour without a word when this record has no report text.
        fallbackTarget: '[data-tour="report-tabs"]',
        highlightPadding: 10,
        title: { 'zh-TW': '「AI翻譯」解讀報告文字', en: 'Translate explains the report text' },
        body: {
          'zh-TW': '按下才執行，完成後在右側開啟，方便對照原文。它解讀的是文字，不判讀影像本身。',
          en: 'It runs only when selected and opens on the right beside the original. It explains the text, not the images.',
        },
        fallbackBody: {
          'zh-TW': '有文字的影像、病理報告旁會出現「AI翻譯」：按下才執行，完成後在右側對照原文。',
          en: 'Reports with text show Translate: it runs only when selected and opens on the right beside the original.',
        },
      },
    ],
  },
  {
    id: 'medications',
    icon: 'pill',
    title: { 'zh-TW': '用藥', en: 'Medications' },
    description: { 'zh-TW': '時間軸、健保餘藥、過敏與疫苗', en: 'Timeline, remaining supply, allergies, vaccines' },
    patientTitle: { 'zh-TW': '我的用藥', en: 'My medications' },
    steps: [
      {
        id: 'medication-tabs',
        scene: { panel: 'left', step: 'medications' },
        target: '[data-tour="medication-tabs"]',
        fallbackTarget: '[data-tour="left-tab-meds"]',
        title: { 'zh-TW': '用藥、過敏、疫苗', en: 'Medications, allergies, vaccines' },
        body: {
          'zh-TW': '可用中英文藥名、藥理類別、院所或日期搜尋，目前用藥與歷史用藥分開列。',
          en: 'Search by drug name in either language, class, facility or date. Current and past medications are listed separately.',
        },
      },
      {
        id: 'medication-remaining',
        target: '[data-tour="medication-remaining-switch"]',
        optional: true,
        highlightPadding: 6,
        title: { 'zh-TW': '健保署餘藥計算', en: 'NHI remaining supply' },
        body: {
          'zh-TW': '依近 90 日同成分同劑型領藥彙整餘藥日數，不代表單筆處方或實際服藥情形。',
          en: 'Remaining days from 90 days of same-ingredient, same-form dispensing. Not a single prescription or actual adherence.',
        },
      },
      {
        id: 'medication-timeline',
        scene: { panel: 'left', step: 'medication-timeline' },
        target: '[data-tour="medication-timeline-switch"]',
        fallbackTarget: '[data-tour="medication-timeline"]',
        highlightPadding: 8,
        title: { 'zh-TW': '時間軸看處方是否重疊', en: 'See overlapping prescriptions on a timeline' },
        body: {
          'zh-TW': '青綠色是慢箋、灰色是非慢箋，紅色虛線是今日；可切換 3 個月到全部。',
          en: 'Teal bars are chronic prescriptions, grey are non-chronic, and the red dashed line is today. Switch from 3 months to all.',
        },
      },
    ],
  },
  {
    id: 'split-view',
    icon: 'panels',
    title: { 'zh-TW': '雙欄閱讀', en: 'Split view' },
    description: { 'zh-TW': '左邊保留清單，右邊看細節', en: 'List on the left, details on the right' },
    when: desktopOnly,
    steps: [
      {
        id: 'split-icon',
        scene: { panel: 'left', step: 'visits' },
        target: '[data-tour="visit-open-right"]',
        fallbackTarget: '[data-tour="visits-card"]',
        highlightPadding: 10,
        title: { 'zh-TW': '雙欄圖示：把內容送到右側', en: 'The split-view icon sends content right' },
        body: {
          'zh-TW': '就診、報告、用藥與文件旁都有這個圖示：左邊保留清單，右邊看細節。',
          en: 'Visits, reports, medications and documents all have it: keep the list on the left and read details on the right.',
        },
      },
      {
        id: 'split-close',
        scene: { panel: 'left', step: 'right-pane' },
        target: '[data-tour="right-detail-pane"]',
        fallbackTarget: '[data-tour="right-panel"]',
        highlightPadding: 4,
        title: { 'zh-TW': '按「關閉」回到功能面板', en: 'Close returns to the tools' },
        body: {
          'zh-TW': '這裡是送到右側的用藥時間軸。看完按右上「關閉」，右側就回到原本的功能。',
          en: 'This is the medication timeline sent to the right. Close it to return to the right-side tools.',
        },
        fallbackBody: {
          'zh-TW': '送到右側的內容會顯示在這裡；看完按右上「關閉」，右側就回到原本的功能。',
          en: 'Content you send right appears here. Close it to return to the right-side tools.',
        },
      },
    ],
  },
  {
    id: 'medical-summary',
    icon: 'summary',
    title: { 'zh-TW': '醫療摘要', en: 'Medical summary' },
    description: { 'zh-TW': '核對來源、模型、自動產生與資料範圍', en: 'Sources, model, auto-generate and data scope' },
    patientTitle: { 'zh-TW': '我的健康摘要', en: 'My health summary' },
    steps: [
      {
        id: 'summary',
        scene: { panel: 'right', step: 'summary' },
        target: '[data-tour="medical-summary-overview"]',
        // Not generated yet: point at the empty state's 產生摘要 instead.
        fallbackTarget: '[data-tour="medical-summary-empty"]',
        fallbackGraceAttempts: 0,
        lockTargetOnceResolved: true,
        highlightPadding: 4,
        title: { 'zh-TW': '初診快覽的閱讀順序', en: 'How the first-visit summary reads' },
        body: {
          'zh-TW': '一句話摘要 → 問題清單與負責院所 → 影像與病理重點 → 開藥注意。',
          en: 'One-line overview → problems and managing facility → imaging and pathology → prescribing cautions.',
        },
        patientTitle: { 'zh-TW': '健康快覽的閱讀順序', en: 'How the health summary reads' },
        patientBody: {
          'zh-TW': '健康快覽 → 健康狀況清單 → 我的用藥與照護 → 用藥提醒。',
          en: 'Health at a glance → health conditions → my medicines and care → medication reminders.',
        },
        fallbackBody: {
          'zh-TW': '按「產生摘要」後，AI 會在這裡整理重點。預設不會自動產生。',
          en: 'Select Generate and the AI summary appears here. It does not run automatically by default.',
        },
      },
      SUMMARY_SOURCE_STEP,
      {
        id: 'summary-settings',
        scene: { panel: 'right', step: 'summary-settings' },
        target: '[data-tour="medical-summary-controls"]',
        highlightPadding: 4,
        title: { 'zh-TW': '模型與摘要設定', en: 'Model and summary settings' },
        body: {
          'zh-TW': '點模型名稱選擇 AI 模型；齒輪「設定」裡有自動產生、資料範圍與本次 AI 執行紀錄。',
          en: 'Select the model name to choose a model. Settings holds auto-generate, data scope and this run’s AI log.',
        },
      },
    ],
  },
  {
    id: 'custom-summary',
    icon: 'book',
    title: { 'zh-TW': '自訂摘要', en: 'Custom summaries' },
    description: { 'zh-TW': '編輯、分享與範本庫（章節式）', en: 'Edit, share and the library (by chapter)' },
    handOff: 'custom-summary',
    steps: [],
  },
  {
    id: 'clinical-chat',
    icon: 'chat',
    title: { 'zh-TW': '臨床對話', en: 'Clinical chat' },
    description: { 'zh-TW': '工具列、範本、不讀病歷', en: 'Toolbar, templates, chart-free mode' },
    patientTitle: { 'zh-TW': '問 AI 問題', en: 'Ask the AI' },
    steps: [
      {
        id: 'chat-controls',
        scene: { panel: 'right', step: 'chat' },
        target: '[data-tour="medical-chat-controls"]',
        fallbackTarget: '[data-tour="right-tab-medical-chat"]',
        title: { 'zh-TW': '直接問這位病人的問題', en: 'Ask about this patient' },
        body: {
          'zh-TW': 'AI 會查詢已載入的病歷回答。上方有對話紀錄、無痕模式（需登入）、模型與新對話。',
          en: 'The AI searches the loaded record to answer. Above: history, incognito (sign-in), model and new chat.',
        },
      },
      {
        id: 'chat-compose',
        scene: { panel: 'right', step: 'chat-compose' },
        target: '[data-tour="medical-chat-composer"]',
        title: { 'zh-TW': '文字、圖片、語音或「/」範本', en: 'Text, images, voice or “/” templates' },
        body: {
          'zh-TW': '可貼上圖片、用麥克風輸入；打「/」搜尋快捷範本。',
          en: 'Paste images, dictate with the microphone, or type “/” to search templates.',
        },
      },
      {
        id: 'chat-no-record',
        target: '[data-testid="chat-patient-data-toggle"]',
        optional: true,
        title: { 'zh-TW': '「不讀病歷」', en: 'Chart off' },
        body: {
          'zh-TW': '開啟後，本次對話不會讀取病人病歷，適合問一般問題；再按一次即可恢復。',
          en: 'While on, this conversation does not read the patient record—useful for general questions. Select again to restore.',
        },
      },
      {
        id: 'chat-template',
        scene: { panel: 'right', step: 'chat-template' },
        target: '[data-tour="chat-template-tools"]',
        fallbackTarget: '[data-tour="medical-chat-composer"]',
        title: { 'zh-TW': '範本庫與管理範本', en: 'Template library and your templates' },
        body: {
          'zh-TW': '「範本庫」加入現成範本；「管理範本」新增、排序或設定預設範本。',
          en: 'Add ready-made templates from the library, or create, reorder and set defaults in Manage templates.',
        },
        fallbackBody: {
          'zh-TW': '輸入區上方可開啟「範本庫」加入現成範本，或用「管理範本」建立自己的範本。',
          en: 'Above the input, open the template library or Manage templates to create your own.',
        },
      },
    ],
  },
  {
    id: 'export',
    icon: 'copy',
    title: { 'zh-TW': '帶回紀錄與複製', en: 'Copy back and export' },
    patientTitle: { 'zh-TW': '下載與分享資料', en: 'Download and share' },
    description: { 'zh-TW': '帶回紀錄、貼給 AI、下載檔案', en: 'Back to the chart, paste to AI, download' },
    patientDescription: { 'zh-TW': '貼給 AI、下載檔案', en: 'Paste to AI, download' },
    when: hasRightFeature('ips-export'),
    steps: [
      {
        id: 'export-tabs',
        scene: { panel: 'right', step: 'export' },
        target: '[data-tour="ips-export-tabs"]',
        fallbackTarget: '[data-tour="right-tab-ips-export"]',
        title: { 'zh-TW': '三種複製方式', en: 'Three ways to copy' },
        body: {
          'zh-TW': '「帶回紀錄」整理成可貼回病歷的文字；「貼給 AI」先遮蔽個資；「下載檔案」匯出 Markdown 或 FHIR JSON。',
          en: 'Back to chart formats text for your notes; Paste to AI masks identifiers first; Download exports Markdown or FHIR JSON.',
        },
        patientTitle: { 'zh-TW': '兩種分享方式', en: 'Two ways to share' },
        patientBody: {
          'zh-TW': '「貼給 AI」先遮蔽個資再複製；「下載檔案」匯出 Markdown 或 FHIR JSON。',
          en: 'Paste to AI masks identifiers before copying; Download exports Markdown or FHIR JSON.',
        },
      },
    ],
  },
  {
    id: 'calculator',
    icon: 'calculator',
    title: { 'zh-TW': '計算機', en: 'Calculators' },
    description: { 'zh-TW': '優先帶入這位病人的資料', en: 'Prefilled from this patient' },
    when: hasRightFeature('medical-calculator'),
    steps: [
      {
        id: 'calculator',
        scene: { panel: 'right', step: 'calculator' },
        target: '[data-tour="right-tab-medical-calculator"]',
        title: { 'zh-TW': '計算機會帶入現有資料', en: 'Calculators use available data' },
        body: {
          'zh-TW': '「此病人」列出資料足以計算的量表；可加星號收藏。使用前請核對帶入值與日期。',
          en: 'For patient lists scores this record can fill; star your favourites. Check prefilled values and dates.',
        },
      },
    ],
  },
  {
    id: 'care-guidance',
    icon: 'guide',
    title: { 'zh-TW': '個人化照護指引', en: 'Personalized care guidance' },
    description: { 'zh-TW': '疾病切換、檢視方式（Beta）', en: 'Conditions and views (Beta)' },
    when: (context) => medicalOnly(context) && hasRightFeature(CLINICAL_DECISION_SUPPORT_FEATURE_ID)(context),
    steps: [
      {
        id: 'guidance',
        scene: { panel: 'right', step: 'guidance' },
        target: `[data-tour="right-content-${CLINICAL_DECISION_SUPPORT_FEATURE_ID}"]`,
        fallbackTarget: `[data-tour="right-tab-${CLINICAL_DECISION_SUPPORT_FEATURE_ID}"]`,
        highlightPadding: 2,
        title: { 'zh-TW': '依病人條件對照指引', en: 'Guidelines matched to the patient' },
        body: {
          'zh-TW': '找出照護缺口與依據；可切換疾病與檢視方式。這是決策支援，不取代臨床判斷。',
          en: 'Finds care gaps with their basis; switch condition and view. Decision support, not a replacement for judgement.',
        },
      },
    ],
  },
  {
    id: 'education',
    icon: 'education',
    title: { 'zh-TW': '個人化衛教', en: 'Personalized education' },
    description: { 'zh-TW': '這次優先了解、接下來可以做（Beta）', en: 'What to know first, what to do next (Beta)' },
    when: (context) => context.audience === 'patient' && hasRightFeature(PERSONALIZED_EDUCATION_FEATURE_ID)(context),
    steps: [
      {
        id: 'education',
        scene: { panel: 'right', step: 'education' },
        target: `[data-tour="right-content-${PERSONALIZED_EDUCATION_FEATURE_ID}"]`,
        fallbackTarget: `[data-tour="right-tab-${PERSONALIZED_EDUCATION_FEATURE_ID}"]`,
        highlightPadding: 2,
        title: { 'zh-TW': '依你的狀況整理衛教', en: 'Education for your situation' },
        body: {
          'zh-TW': '分成「這次優先了解」與「接下來可以做」，可切換重點版與完整版。',
          en: 'Split into what to know first and what to do next, in a short or full version.',
        },
      },
    ],
  },
  {
    id: 'settings',
    icon: 'sliders',
    title: { 'zh-TW': '設定與回報', en: 'Settings and feedback' },
    description: { 'zh-TW': 'AI 偏好、Beta、問題回報、許願池', en: 'AI preferences, Beta, feedback, wishes' },
    steps: [
      {
        id: 'settings',
        scene: { panel: 'right', step: 'settings' },
        target: '[data-tour="right-tab-settings"]',
        title: { 'zh-TW': '設定分成兩頁', en: 'Settings has two pages' },
        body: {
          'zh-TW': '「AI 偏好設定」管理翻譯解讀、自訂端點與金鑰；「顯示與關於」有主題、字級、Beta 開關（不需登入）、問題回報與功能許願池。',
          en: 'AI preferences covers translation, custom endpoints and keys. Display & about has theme, text size, the Beta switch (no sign-in), feedback and the wish list.',
        },
      },
    ],
  },
  {
    id: 'news-lab-trend-zoom',
    icon: 'sparkles',
    title: { 'zh-TW': '檢驗趨勢圖可拖曳放大', en: 'Zoom the lab trend chart' },
    description: { 'zh-TW': '報告 › 累積報告 › 點檢驗名稱', en: 'Reports › Cumulative › select a lab' },
    steps: [
      {
        id: 'cumulative-trend',
        scene: { panel: 'left', step: 'reports' },
        target: '[data-tour="cumulative-trend-hint"]',
        fallbackTarget: '[data-tour="report-tabs"]',
        title: { 'zh-TW': '點檢驗名稱，再拖曳放大', en: 'Select a lab, then drag to zoom' },
        body: {
          'zh-TW': '趨勢圖上按住左右拖曳可框選放大；「放大密集區」一鍵聚焦，「還原」回到全部。',
          en: 'Drag across the trend chart to zoom into a period. Zoom to dense run focuses in one step; Reset shows everything.',
        },
      },
    ],
  },
  {
    id: 'news-summary-diagnostics',
    icon: 'sparkles',
    title: { 'zh-TW': '摘要的 AI 執行紀錄', en: 'The summary’s AI log' },
    description: { 'zh-TW': '醫療摘要 › 齒輪「設定」', en: 'Medical summary › Settings' },
    steps: [
      {
        id: 'summary-settings',
        scene: { panel: 'right', step: 'summary-settings' },
        target: '[data-tour="medical-summary-settings"]',
        fallbackTarget: '[data-tour="medical-summary-controls"]',
        title: { 'zh-TW': '看這次 AI 怎麼產生摘要', en: 'See how this summary was produced' },
        body: {
          'zh-TW': '齒輪「設定」裡可「查看本次 AI 執行紀錄」，了解這次用了哪些資料與模型。',
          en: 'Settings holds this run’s AI log: which data and model the summary used.',
        },
      },
    ],
  },
]

/** The tours listed in the hub's task section. */
export const TASK_TOUR_IDS: GuidedTourId[] = [
  'know-patient',
  'labs-reports',
  'medications',
  'split-view',
  'medical-summary',
  'custom-summary',
  'clinical-chat',
  'export',
  'calculator',
  'care-guidance',
  'education',
  'settings',
]

export function getGuidedTour(id: GuidedTourId): GuidedTourDefinition | undefined {
  return GUIDED_TOURS.find((tour) => tour.id === id)
}

export function isTourAvailable(tour: GuidedTourDefinition, context: TourContext): boolean {
  return !tour.when || tour.when(context)
}

/** The tour's steps for this reader, with audience-specific copy applied. */
export function resolveTourSteps(tour: GuidedTourDefinition, context: TourContext): GuidedTourStep[] {
  return tour.steps
    .filter((step) => !step.when || step.when(context))
    .map((step) => context.audience === 'patient' && (step.patientTitle || step.patientBody)
      ? { ...step, title: step.patientTitle ?? step.title, body: step.patientBody ?? step.body }
      : step)
}

export function tourTitle(tour: GuidedTourDefinition, context: TourContext): Localized {
  return context.audience === 'patient' && tour.patientTitle ? tour.patientTitle : tour.title
}

export function tourDescription(tour: GuidedTourDefinition, context: TourContext): Localized {
  return context.audience === 'patient' && tour.patientDescription ? tour.patientDescription : tour.description
}

export function availableWhatsNew(context: TourContext): WhatsNewItem[] {
  return WHATS_NEW.filter((item) => !item.when || item.when(context))
}
