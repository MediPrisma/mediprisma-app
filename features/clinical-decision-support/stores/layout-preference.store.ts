/**
 * Which face of the guidance a pack's page shows.
 *
 * Each pack has one face, with no switch (owner decision 2026-11-19: 「三區塊
 * 全部都拿掉，只留決策地圖，這樣也不用 tab 去切了，高血脂則是只留健保表一」):
 * dyslipidemia opens on the NHI Table 1 review (`nhi`); every pack that
 * declares a decision map opens on it (`map`, the pocket-handbook page,
 * 決策地圖 v2). `sections` is no longer offered; it remains only as what the
 * page falls back to when a map could not be built for this record, so a
 * failure there still shows the guidance rather than an empty page.
 *
 * `flow`, `board`, `c` and `classic` stay in the type so the view's older
 * branches keep compiling; nothing selects them.
 *
 * Before 2026-11-19 this was a per-browser preference persisted under
 * `cdss-layout-preference`. That stored value is now ignored.
 */
import { hasVisitMap } from '../renderers/visit/visit-model.source'

export type CdssLayout = 'map' | 'sections' | 'flow' | 'nhi' | 'c' | 'board' | 'classic'

const LIPID_PACK_ID = 'hyperlipidemia-cdss'

/** The face a pack's page opens on: Table 1 for dyslipidemia, else the decision map where the pack has one. */
export function layoutFor(packId: string): CdssLayout {
  if (packId === LIPID_PACK_ID) return 'nhi'
  return hasVisitMap(packId) ? 'map' : 'sections'
}
