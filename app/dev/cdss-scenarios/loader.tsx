'use client'
// Dev-only harness: load a synthetic scenario through the app's own import path,
// then open the app exactly as a physician would see it.
import { useEffect, useState } from 'react'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { notifyBundleChanged } from '@/src/shared/utils/reset-on-bundle-change'
import { useBetaFeaturesStore } from '@/src/application/stores/beta-features.store'
import index from './bundles/index.json'
import b0 from './bundles/p1-suspected-hfpef.json'
import b1 from './bundles/p2-new-hfref.json'
import b2 from './bundles/p3-new-af.json'
import b3 from './bundles/p4-stable-optimised.json'
import b4 from './bundles/p5-titrating-af.json'
import b5 from './bundles/p6-hyperkalaemia.json'
import b6 from './bundles/p7-worsening-congestion.json'
import b7 from './bundles/p8-post-discharge.json'
import b8 from './bundles/p9-hfpef-af-dose.json'
import b9 from './bundles/p10-improved-ef.json'
import b10 from './bundles/p11-af-dabigatran-renal.json'
import b11 from './bundles/p12-cad-nstemi-dapt.json'

const BUNDLES: Record<string, object> = {
  'p1-suspected-hfpef': b0,
  'p2-new-hfref': b1,
  'p3-new-af': b2,
  'p4-stable-optimised': b3,
  'p5-titrating-af': b4,
  'p6-hyperkalaemia': b5,
  'p7-worsening-congestion': b6,
  'p8-post-discharge': b7,
  'p9-hfpef-af-dose': b8,
  'p10-improved-ef': b9,
  'p11-af-dabigatran-renal': b10,
  'p12-cad-nstemi-dapt': b11,
}

// StrictMode runs effects twice in development; pop the queue once per page load.
let queuePopped = false

export default function Loader() {
  const [busy, setBusy] = useState<string | null>(null)
  const load = async (id: string) => {
    setBusy(id)
    // Each simulated visit starts clean: no answers, decisions or layout
    // choice carried over from the previous patient.
    const keep = Object.fromEntries(Object.keys(sessionStorage).filter((key) => key.startsWith('sim-')).map((key) => [key, sessionStorage.getItem(key) ?? '']))
    // Only the CDSS per-patient stores and the layout choice; nothing else this
    // browser keeps (settings, keys) is touched.
    for (const key of Object.keys(localStorage)) {
      if (/^(cdss-|af-answers|nhi-lipid|prevent-inputs)/.test(key)) localStorage.removeItem(key)
    }
    sessionStorage.clear()
    for (const [key, value] of Object.entries(keep)) sessionStorage.setItem(key, value)
    sessionStorage.setItem('sim-current', id)
    // A returning scenario brings in its stored previous visit, as a CDSS
    // store will; the others are the system's first visit with the patient.
    const previous = index.find((s) => s.id === id)?.previousVisit
    if (previous) sessionStorage.setItem('sim-previous-visit', previous)
    else sessionStorage.removeItem('sim-previous-visit')
    const store = useBetaFeaturesStore.getState()
    store.setBetaFeaturesEnabled('guest', true)
    await LocalBundleService.save(BUNDLES[id], { importId: `sim-${id}-${Date.now()}` })
    notifyBundleChanged()
    window.location.href = '/dev/cdss-scenarios/view'
  }
  useEffect(() => {
    const queue = JSON.parse(sessionStorage.getItem('sim-queue') || '[]') as string[]
    if (!queue.length || queuePopped) return
    queuePopped = true
    const [next, ...rest] = queue
    sessionStorage.setItem('sim-queue', JSON.stringify(rest))
    void load(next)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const runAll = (variant: string) => {
    sessionStorage.setItem('sim-variant', variant)
    sessionStorage.setItem('sim-auto', '1')
    const [first, ...rest] = index.map((s) => s.id)
    sessionStorage.setItem('sim-queue', JSON.stringify(rest))
    void load(first)
  }
  return (
    <main className="mx-auto max-w-3xl space-y-3 p-6">
      <h1 className="text-lg font-semibold">CDSS 情境模擬病人</h1>
      <p className="text-sm text-muted-foreground">點一位病人：以 app 的匯入流程載入合成 FHIR Bundle，然後開啟主畫面。</p>
      <div className="flex gap-2">
        <button type="button" data-run-all="baseline" onClick={() => runAll('baseline')} className="rounded-md border px-3 py-1 text-sm">全部跑一次（baseline）</button>
        <button type="button" data-run-all="new" onClick={() => runAll('new')} className="rounded-md border px-3 py-1 text-sm">全部跑一次（new）</button>
      </div>
      <ul className="space-y-2">
        {index.map((s) => (
          <li key={s.id}>
            <button type="button" data-scenario={s.id} disabled={busy !== null} onClick={() => load(s.id)}
              className="w-full rounded-md border border-border px-3 py-2 text-left hover:bg-muted/40">
              <span className="font-mono text-xs text-muted-foreground">{s.id} · {s.kind} · {s.page}{s.previousVisit ? ` · 上次 CDSS ${s.previousVisit}` : ' · CDSS 首次'}</span>
              <span className="block font-medium">{s.title}</span>
              <span className="block text-sm text-muted-foreground">{s.oneLine}</span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  )
}
