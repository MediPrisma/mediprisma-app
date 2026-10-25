'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import bundle from '@/e2e/fixtures/medcloud-no-reports-bundle.json'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { notifyBundleChanged } from '@/src/shared/utils/reset-on-bundle-change'
import { completeProgressiveImport } from '@/src/application/stores/progressive-import.store'
import { aiResultCacheKey, saveEncryptedCache } from '@/src/infrastructure/cache/encrypted-session-cache'
import { summaryVersionViewKey, type SummaryVersion } from '@/src/application/hooks/medical-summary/summary-versions.store'

/** Synthetic reader preview only. The browser regression separately exercises
 * the real progressive importer and AI transport with mocked responses. */
export default function Preview() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  async function openPreview() {
    setBusy(true)
    const importId = crypto.randomUUID()
    const runId = crypto.randomUUID()
    await LocalBundleService.save(bundle, { importId, demo: false })
    notifyBundleChanged()
    completeProgressiveImport({ version: 1, requestId: 'preview', runId, stage: 'hospital' }, importId)
    const slotKey = 'test-patient-1::medical::zh-TW::preview::ctx-synthetic'
    const viewKey = summaryVersionViewKey(runId, slotKey)
    const versions: SummaryVersion[] = ['cloud', 'hospital'].map((kind, i) => ({
      id: `preview-${kind}`, kind: kind as 'cloud' | 'hospital', runId, viewKey, slotKey,
      completedAt: Date.now() - (1 - i) * 60_000, coverage: null, catalog: [],
      result: {
        headline: i === 0 ? '雲端摘要：高血壓規律追蹤，持續使用降壓藥物。'
          : '含院內資料摘要：高血壓規律追蹤；院內門診記載居家血壓穩定，維持原治療。',
        problems: [], medicationEducation: [], sourceIndex: [],
        generation: { source: 'pre-generated', modelId: 'preview', modelName: '合成資料預覽' },
        completedCardIds: ['overview', 'problems', 'reports', 'safety'],
        reportHighlights: { summarized: true, groups: [], others: [], totalReports: 0, droppedQuoteCount: 0, hiddenPointCount: 0, uncertaintyRewriteCount: 0 },
      },
    }))
    await saveEncryptedCache(aiResultCacheKey('summary-versions-v1', 'history', importId), {
      versions, selected: { [viewKey]: versions[0].id },
    })
    localStorage.setItem('medical-note-locale', 'zh-TW')
    localStorage.setItem('medical-note-audience', 'medical')
    localStorage.setItem('medical-note-audience-selected', '1')
    localStorage.setItem('medical-note-onboarding-v1', '1')
    localStorage.setItem('medical-note-left-browser-tour-v1', '1')
    localStorage.setItem('medical-summary-prefs', JSON.stringify({ state: { autoGenerate: false }, version: 0 }))
    router.push('/')
  }
  return <main className="mx-auto max-w-xl space-y-4 p-6">
    <h1 className="text-xl font-semibold">摘要版本預覽</h1>
    <p>使用合成病人與預先寫好的摘要，開啟實際應用畫面；不呼叫 AI。</p>
    <button className="min-h-11 rounded-md border px-4" disabled={busy} onClick={() => void openPreview()}>
      {busy ? '載入中…' : '開啟雲端與院內雙版本'}
    </button>
  </main>
}
