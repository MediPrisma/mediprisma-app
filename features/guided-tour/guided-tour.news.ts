// Announcements of new features, newest last. An entry is shown once per
// browser: beside its control the first time it is on screen, and with a dot
// on the header's 導覽 button until the hub has been opened. Retire an entry
// once the feature is no longer news; its id must never be reused.
//
// Kept free of imports beyond types so the end-to-end fixtures can read the
// ids and start a run with every announcement already acknowledged.
import type { WhatsNewItem } from './guided-tour.types'

export const WHATS_NEW: WhatsNewItem[] = [
  {
    id: '2026-10-tour-hub',
    title: { 'zh-TW': '導覽改版：按任務挑著學', en: 'Tours, now by task' },
    where: { 'zh-TW': '頁首「導覽」', en: 'Tours in the header' },
    body: {
      'zh-TW': '導覽改成 1 分鐘的任務小段落，看過的會打勾，新功能也會在這裡提示。',
      en: 'Tours are now one-minute tasks with a tick when viewed, and new features are announced here.',
    },
    anchor: '[data-tour="tour-hub-button"]',
    opensHub: true,
  },
  {
    id: '2026-10-lab-trend-zoom',
    title: { 'zh-TW': '檢驗趨勢圖可拖曳放大', en: 'Zoom the lab trend chart' },
    where: { 'zh-TW': '報告 › 累積報告 › 點檢驗名稱', en: 'Reports › Cumulative › select a lab' },
    body: {
      'zh-TW': '點檢驗名稱打開趨勢圖，在圖上拖曳框選即可放大一段時間。',
      en: 'Select a lab name to open its trend, then drag across the chart to zoom.',
    },
    anchor: '[data-tour="cumulative-trend-hint"]',
    tourId: 'news-lab-trend-zoom',
  },
  {
    id: '2026-10-summary-diagnostics',
    title: { 'zh-TW': '摘要的 AI 執行紀錄', en: 'The summary’s AI log' },
    where: { 'zh-TW': '醫療摘要 › 齒輪「設定」', en: 'Medical summary › Settings' },
    body: {
      'zh-TW': '齒輪「設定」裡可「查看本次 AI 執行紀錄」，了解這次摘要用了哪些資料與模型。',
      en: 'Settings now shows this run’s AI log: which data and model the summary used.',
    },
    anchor: '[data-tour="medical-summary-settings"]',
    tourId: 'news-summary-diagnostics',
  },
]
