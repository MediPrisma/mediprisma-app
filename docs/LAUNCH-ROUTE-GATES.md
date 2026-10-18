# Launch-route gates — what the app hides or suppresses, and why

2026-10-05 latest owner decision: CDSS save/history must be bound to the signed-in user. On `?site=vghtpe`, Firebase/intranet admission requires a nonanonymous App account; intranet retains the hospital subnet check. Only the original saver may list/read a record. The earlier same-day network-only decision is superseded. Deployment target: `https://fhir.mediprisma.tw`.

Every place the app behaves differently because of *how it was opened* is
listed here. A gate is one of two kinds, and the kind decides how strict the
review is:

- **不打斷（silence）** — the route must not stop to ask anything. Suppressing a
  dialog, a tour, a prompt, or an automatic action is this kind. It never hides
  a clinical surface.
- **不顯示（hide）** — a clinical surface (a tab, a care pack, a card, a switch)
  is not shown on this route. This kind needs the owner's explicit yes, stated
  in the commit message under `Visible behaviour changes`, and a row here.

The 2026-09-08 incident this page exists for: the Medcloud launch was made
silent on 2026-08-20 (kind 1), and on 2026-09-05 the same route test was
reused to hide the Beta tab and the held-back care packs (kind 2) — nobody
asked for that, and the hospital's own launch lost the personalized guidance
until it was noticed. Kind 2 must never ride along on a kind-1 rule again.

## Routes

| Route | Meaning |
|---|---|
| `?medcloud2=auto` | Unattended Medcloud hand-off: the 雲端懷爾抓抓 extension opens the app, hands the patient over, runs the summary. No one is at the keyboard. `isMedcloudLaunchRoute()`. |
| `?medcloud2=auto&site=vghtpe` (`/app/` or `/app-hmc/` on the app origin) | The hospital's own hand-off. Same silence; the Beta switch is offered and honoured like a plain visit. `isVghtpeUnattendedLaunch()`. |
| `?site=vghtpe` alone | Hospital routing only; not a launch route. |

## Gates in force

| Where | Kind | Behaviour on the route | Owner decision |
|---|---|---|---|
| `patient-identity.ts` / `CdssStorageActions.tsx` | 不顯示（拒絕存讀） | On `/`, `/app/`, `/app-hmc/` with `site=vghtpe`, including launch queries and full-window `visit=book`: explicitly de-identified source patients cannot save, list or read CDSS records. The anonymous-name source marker is preserved through local demographic overlays and IPS export/reimport. Switching the same patient between source privacy states clears visible history and cancels pending operations. Show guidance to reimport with 雲抓「去識別化」turned off. Non-de-identified patients with complete identity retain save/history; native masked national IDs using x, X or * remain accepted regardless of mask count. | Explicit owner request in chat, 2026-10-05: CDSS 只接受不選去識別化的病人。 |
| `features/clinical-decision-support/renderers/CdssStorageActions.tsx` | 不顯示（停用操作） | On `/`, `/app/`, `/app-hmc/` with `site=vghtpe`, including launch queries and full-window `visit=book`: guests, anonymous accounts and sessions without an established account UID cannot save or open CDSS history. Signed-in accounts retain these actions, limited to their own server-owned records; logout/account change closes and clears history. Existing site/Beta/role gates still apply. | Explicit owner request in chat, 2026-10-05: 綁定登入 user 才能儲存，僅原儲存者可讀取。 |
| `features/clinical-decision-support/LiveFeature.tsx` / `CdssStorageActions.tsx` (`offered`) | 不顯示 | On every route that shows CDSS, for every disease: the 「儲存」 and 「紀錄」 toolbar buttons, and with them saving, viewing, carrying forward and deleting CDSS records, are not offered on the 三區塊 layout. They remain on 決策地圖 v2 (panel and full-window `visit=book`) and the lipid NHI table. Switching to 三區塊 keeps the controller mounted, so a pending save is not cancelled and a FHIR grant is not dropped. Answers already carried keep their 「帶入 · 日期」 marks on 三區塊. | Explicit owner request in chat, 2026-10-07: 三區塊先不支援存資料（所有疾病、隱藏按鈕）。 |
| `features/medical-calculator/prognosis/HfMedcloudDryRun.tsx` | Submission | HF calculator at `/`, `/app/`, `/app-hmc/` and their launch-query variants: default Firebase policy requires existing sign-in; explicit intranet builds allow approved network callers without Firebase. Unset origin or unknown policy disables submission with a configuration notice. New prediction action requires an accepted check for the same input. Existing HF calculator surfaces remain visible. | Owner approved intranet access and formal prediction in chat, 2026-10-05 |
| `src/application/hooks/hf-risk/use-medcloud-hf-dry-run.hook.ts` | Submission | On all routes offering HF SaMD, a supported bridge import may prepare inputs. An unmapped selected index diagnosis prevents validation and prediction at the hook and UI boundaries until the user explicitly supplies HF on that exact existing encounter; unsupported imports and upstream eligibility checks remain enforced. Existing site/intranet entry gates remain unchanged. Cloud visit listing now includes dated visits without recognized diagnoses, so preparation defaults to the newest eligible outpatient visit even when supplementation is needed, rather than the previous newest diagnosed visit. This follows the owner request to use the latest outpatient visit with explicitly supplied HF history (2026-10-06). | Owner requested health-bank/TVGH bridge support in chat, 2026-10-05 |
| `features/clinical-summary/document-summary/DocumentSummaryCard.tsx` | 不顯示 | All routes: remove the unshipped standalone 歷史 B/C 肝篩檢 section from 文件, restoring the original document-only layout. Source-authored Composition chapters and the existing reports flow remain available. | Owner explicitly requested removal in chat, 2026-09-11 |
| `app/page.tsx` (tour launcher) | 不打斷 | Guided-tour offer never opens | e5374e97, 2026-08-20 |
| `app/_components/FirstRunOnboardingDialog.tsx` | 不打斷 | First-run onboarding never opens on either `/app/` or `/app-hmc/` when `medcloud2=auto`; the vghtpe hospital hand-off is covered on both paths | e5374e97; `/app-hmc/` confirmed by owner, 2026-09-09 |
| `src/application/providers/ai-demographics-gate.provider.tsx` | 不打斷 | Demographics prompt is not raised; the hand-off decides | e5374e97 |
| `src/application/providers/audience.provider.tsx` | 不打斷 | Opens in clinician mode; a stored 民眾 choice is not restored (storage untouched) | e5374e97 |
| `src/application/hooks/ai-generation/use-ai-slot-generation.hook.ts` | 不打斷 | The launch owns the automatic summary run; the browser's auto-generate switch does not fire a second one | e5374e97 |
| `src/application/telemetry/launch-context.ts` | — | Telemetry labels the launch source `medcloud2`; nothing changes for the user | e5374e97 |
| `features/lab-data-report/components/LabDataReportDialog.tsx` | — | Adds, never hides: on `?site=vghtpe` (with or without `medcloud2=auto`) the 回報檢驗資料問題 form asks 送給 — 團隊和機構（建議, default）/ 僅機構 / 僅連線測試. Elsewhere a report goes to the development team as before. The institution is the hospital Gateway named by `NEXT_PUBLIC_LAB_REPORT_INSTITUTION_URL`; until a build sets it, 團隊和機構 sends to the team alone and says so, 僅機構 cannot be sent, and the Gateway is never contacted. 僅連線測試 sends no patient data. | Supervisor's request relayed by the owner in chat, 2026-10-02 |
| `features/clinical-decision-support/guideline-packs/pilot-gate.ts` | 不顯示 | `?pilotPacks=` is ignored and stored pilot ids do not apply (a tester's per-pack switch must not follow a clinician into a hand-off) | 90a3938c, 2026-09-05 — **stands**; the Beta switch is the way in |
| `features/settings/components/DisplaySettings.tsx` (pilot-pack checkboxes) | 不顯示 | The per-pack 試辦 checkboxes are not shown | 90a3938c — stands, same reason |
| `src/application/hooks/use-beta-features.hook.ts` | 不顯示 | Beta switch not offered and Beta tabs hidden — **except** on the vghtpe hand-off, where the switch is offered and honoured (never turned on by itself) | dab86c39 hid it without being asked; corrected 0dbe966b → 8a3b564d, 2026-09-08 |
| `features/clinical-decision-support/guideline-packs/registry.ts` | 不顯示 | Held-back care packs hidden — **except** on the vghtpe hand-off, which follows the Beta switch | 8d47985d hid them without being asked; corrected 8a3b564d |

## AI summary · 初診快覽 v3 (all routes; PR #237)

These remove cards from the 醫療摘要 first-visit summary on every route. They
are not route gates; they are listed here because they take a clinical
surface away. Nothing below may reach production without the owner's own yes
(owner, in chat 2026-10-03: the AI summary needs more testing first; owner approved
production in chat 2026-10-15).

| Surface | Change | Owner decision |
|---|---|---|
| 開藥前必看 (overview `mustKnow` grid) | Removed on all routes; the problem list and 開藥注意 carry the content | Owner, in chat 2026-10-02 |
| 最可能的就診主因 (Focus card) and 最近 90 天 (Recent events card) | Removed on all routes | Owner, in chat 2026-10-02 |
| Red high-alert banner under the headline | Removed; 開藥注意 is one neutral list ordered by importance, placed under 影像與病理重點 | Owner, in chat 2026-10-02: 「不要有什麼高危的紅色警示…照著重要度排序」 |
| 民眾 audience: 最近需要注意的三件事, 就醫歷程 | Not shown (they rode on the removed cards) | Owner, in chat 2026-10-15 |
| 「雲端無過敏資料，非確認無過敏」 row | Not shown | Owner, in chat 2026-10-15 |
| AI data scope, every AI surface (醫療摘要, 臨床對話, insights) | Adds, beyond the saved time window, the newest prescribing-relevant lab value and the newest report of each modality class within 730 days, and sends pathology reports with the imaging selection; only the 醫療摘要 data drawer notes it | Owner, in chat 2026-10-15: 「照現狀」 (same as pilot/hmc) |
| 目前重點 (CurrentPrioritiesCard) | Removed on all routes; the headline replaces it | Owner, in chat 2026-10-13 |
| 健康提醒／安全警示卡 (CareRemindersSafetyCard) | Removed on all routes; the scan shows as 開藥注意 under 影像與病理重點, with 「未發現明顯安全風險」 when a finished scan found nothing | Owner, in chat 2026-10-13 |
| 跨院時間軸 (CrossFacilityTimeline) | Removed on all routes | Owner, in chat 2026-10-13 |
| 關鍵檢驗與檢查趨勢 (InvestigationTrendsCard) and its jump into 累積報告; 民眾: 我的檢驗趨勢 | Removed on all routes; 累積報告 stays on the left panel | Owner, in chat 2026-10-13 |
| 跨院用藥整合 (MedicationReconciliationCard) | Removed on all routes; 用藥 tab unchanged | Owner, in chat 2026-10-13 |
| 舊版問題清單 (ProblemListCard) | Replaced on all routes by the new problem list (負責院所與用藥) | Owner, in chat 2026-10-13 |
| 其他待確認事項 (DecisionList) | Removed; the prompt already returned no decisions | Owner, in chat 2026-10-13 |
| Card nav and card-layout manager (reorder / hide cards) | Removed on all routes; a saved layout is no longer read | Owner, in chat 2026-10-13 |

## Prompt Gallery visibility

| Where | Kind | Behaviour | Owner decision |
|---|---|---|---|
| `features/prompt-gallery/` | 不顯示 | A template marked private is omitted from「所有範本」and from other accounts; its author can still find and edit it under「我的範本」. | Explicit chat approval, 2026-09-08 |

## Overview display rules (all launch routes)

These are owner-requested presentation rules on the Overview tab at `/` and
its launch-query variants; they do not depend on site, role, or sign-in state.

| Surface | Compact presentation | Where the full content remains | Owner decision |
|---|---|---|---|
| Laboratory dates | The card shows only the newest dates that fit, without horizontal scrolling. Common mode omits dates with no matching common results. | Expanded list retains all eligible dates; All mode retains every collection day in the selected window. | Explicit chat approval, 2026-09-10 |
| Medication duration | The 2×2 card omits prescribed supply days. | Stacked rows, expanded list, and medication hover details retain supply days. | Explicit chat approval, 2026-09-10 |
| Report, medication, and visit rows | Stacked layouts also use single-line records; long text may be truncated. | Existing report dialogs, row tooltips, and destination tabs retain details. | Explicit chat approval, 2026-09-10 |

## Medical calculator display rules (all launch routes)

| Surface | Behaviour | Owner decision |
|---|---|---|
| HF SaMD at `/`, `/app/`, `/app-hmc/` and their launch-query variants where the existing site/intranet entry gate permits it | Model/source explanations are collapsed by default; input-check and prediction actions remain above details and sticky while scrolling. The extra physician-identity confirmation checkbox is removed: selecting a HF-history shortcut applies the diagnosis to existing visits for this request; advanced selections apply once code/date/rank are complete. Opening the calculator does not add diagnoses. Case-type 08 records are excluded from supplementation; outpatient shortcuts include the exact index encounter on same-day ties. Missing index diagnoses are explained next to disabled actions, and invalid manual ranks have inline feedback. Unavailable diagnosis shortcuts explain the missing eligible encounters beside their controls; fixed actions contain only buttons and the disabled reason. Returned API errors and warnings remain visible. | Explicit owner requests in chat, 2026-10-06: compact spacing and remove the extra「我是醫師，確認……」checkbox. |
| 國健署五項慢性病風險 at `/`, `/app/`, `/app-hmc/` and their launch-query variants | Autofilled laboratory dates more than 7 days apart produce the existing source-date warning only; they no longer hide eligible risk percentages or grades. Known disease, diagnostic thresholds, missing inputs and validation-range checks remain unchanged. | Explicit owner request to remove the date-based blocker, 2026-09-16 |

## Medical Summary display rules (all launch routes)

| Surface | Compact presentation | Where the full recovery action remains | Owner decision |
|---|---|---|---|
| 開藥注意 (the safety scan; was the care reminders and safety card) | Not shown for a failed scan, and its error or retry action is not repeated inside the section. A finished scan with no alert says so instead of disappearing. | The Medical Summary error banner lists the safety failure once, with other failed cards, and offers one retry action; that action reruns only failed cards and preserves successful cards. | Explicit Before/After approval in chat, 2026-09-15; carried to 開藥注意 2026-10-13 |

## HF visit action list (all launch routes)

| Surface | Behaviour | Owner decision |
|---|---|---|
| HF「今日處置」at `/` and launch-query variants | Omit the `heart-failure-monitoring` row when its first action is the generic reminder to retrieve institutional notes and complete patient-reported/measurement data (Chinese or English). It adds no decision or pending count. Concrete testing/follow-up recommendations remain. The pack output and safety modules are unchanged. | Explicit screenshot-based removal request, 2026-09-12 |
| HF「今日處置」at `/` and launch-query variants | Omit `cardiac-rehabilitation-safety` and its decision count: exercise clearance is outside this HF visit workflow. Keep `cardiac-rehabilitation` referral and other HF safety alerts. | Explicit owner request, 2026-09-12 |
| HF「今日處置」at `/` and launch-query variants | Remove the persistent paragraph explaining rule order, record persistence and claim behaviour; retain action ordering, decisions and counts. | Explicit owner request, 2026-09-12 |
| HF SGLT2i decision reasons at `/` and launch-query variants | Do not show potassium or bradycardia as SGLT2i contraindications. Show serious hypersensitivity under contraindication, and drug-specific temporary-hold reasons under deferral. | Explicit owner clinical review, 2026-09-12 |

| HF「本次評估」at `/` and launch-query variants | Remove the introductory workflow paragraph in both languages; retain all questions and their behaviour. | Explicit owner request, 2026-09-12 |

| HF record values at `/` and launch-query variants | Remove the explanatory footer and its current-time stamp in both languages; retain values, dates and edit controls. | Explicit owner request, 2026-09-12 |

| HF assessment at `/` and launch-query variants | Remove the duplicate clinic-measurement question; the ten-value clinical-information card above is the single display and editing entry point. Renumber compensation to question 5 and HFpEF confirmation to question 6. | Explicit owner request, 2026-09-12 |

| HF clinical values dialog at `/` and launch-query variants | After restoring defaults, show the explanation once in the dialog header rather than repeating it below every field; retain each field's undo control. | Explicit owner request, 2026-09-12 |

| HF views at `/` and launch-query variants | Hide the duplicate read-only `HFpEF 治療` card from both the new visit flow and original board; retain the HFpEF diagnosis panel, question 6, probability calculator, diagnostic evidence and confirmation controls. The source care-pack recommendation remains available internally to select the appropriate treatment pathway. | Explicit owner request, 2026-09-12 |

## Dyslipidemia views (all launch routes)

| Surface | Behaviour | Owner decision |
|---|---|---|
| 高血脂畫面切換 at `/` and launch-query variants | Hide「新版流程」for dyslipidemia because it rendered the same generic module list as「原版看板」. Keep「三區塊」and「原版看板」, and add the distinct「健保表一」review for NHI tier criteria, supporting evidence and treatment response. Heart-failure layout choices are unchanged. | Explicit owner request in chat, 2026-09-20 |

## 決策地圖 v2 — the decision map (all launch routes)

Since 2026-10-01 the HF and AF layout switch offers two faces: 「決策地圖 v2」,
the default, and 「三區塊」. The first decision map — 今天要決定 over the three
sections drawn as the map's three columns — is retired on every route, and a
browser that had stored it (or v2, offered beside it as `book`) opens v2. v2
stays in the CDSS panel, or opens over the whole window from its 全螢幕 or by
`?visit=book`; nothing depends on site, role or sign-in state. It draws the
pack's model in the prototype's layout (the Artifact 「CDSS 小麻式版面原型」);
where it redraws an input, the new entry writes the same store. It asks only
what the Artifact asks: the inputs 三區塊 asks beyond that are not shown on v2,
by the owner's decision, and each such row below is marked **不顯示** with where
the input stays.

| Surface on the other layouts | On 決策地圖 v2 | Where the original stays | Owner decision | Tests |
|---|---|---|---|---|
| The first 決策地圖 as a whole: 今天要決定, the three columns with their steps, 01's 診斷／追蹤 views, the status line with its 臨床數值 fold and editor, the map's question folds, cards and column footers | **不顯示 on every route**: the switch offers 決策地圖 v2 and 三區塊 only; a stored 決策地圖 or 決策地圖 v2 opens v2 | 三區塊 (every input the first map placed — the questions, the editors, the diagnosis confirmation, the HFpEF calculator, the AF question groups, the prognosis models, the handoff card) | Owner, in chat 2026-10-01: 「決策地圖v2 心臟科醫師看了喜歡，那原本的決策地圖就可以整個拿掉了，留著v2跟三區塊」 | `visit-map-wiring` (the switch, the stored choice), `layout-preference.store`; 三區塊: `HeartFailureVisitFlow`, `af-visit-flow`, `cdss-sections` |
| HF 01 「診斷」 view: 懷疑 HF？／HFrEF 還是 HFpEF？ question card and the diagnosis confirmation | DP-01's phenotype table, tagged 「DP-01 · DP-34」 with no heading above it (as the Artifact): 選 HFrEF／選 HFpEF／還不確定 (確認 HFrEF where the LVEF decides), written as the same phenotype answer; one DP-01, no question card. ESC 2026 classes (no HFmrEF, owner choice 2026-09-30). The table is only read, as the Artifact's; the choice is one segmented row under it, 「你的判斷 [HFrEF] [HFpEF] [還不確定]」, drawn as the page's other answers. **不顯示 on 決策地圖 v2**: the 你的判斷 row inside the table, the 還不確定 pill beside it and the grey 「ESC 2026 取消 HFmrEF…」 note | 三區塊 | Chat 2026-09-30: 「這樣兩個DP01耶，留新的…但新的可能要讓醫師可以點」「原本的UI跟問題那些都廢棄了，包含DP03」; the row and the note: Owner, in chat 2026-09-30: 「都照著CDSS小麻式版面原形，不要使用任何原本的外觀」 | `visit-book-layout` DP-01 cases (both modes), 「draws nothing of the other layouts' look」 |
| HF DP-34 HFpEF criteria in 01's 診斷 view: symptom and sign questions, HFA-PEFF／H₂FPEF calculator, 確認 HFpEF | **不顯示 on 決策地圖 v2**, as the prototype: DP-34 has no row and no inputs of its own; DP-01's table stands for it (tag 「DP-01 · DP-34」), and its 確認 HFpEF／選 HFpEF settles DP-01 and DP-34 together. The calculator is not on this layout; since 2026-10-02 the symptoms and signs DP-34 reads are asked in DP-06's optional fold 「其他症狀與徵象」 (see the DP-03 row), not under DP-34 | 三區塊 (symptoms, signs, criteria, calculator, confirmation) | Owner, in chat 2026-09-30: 「Prototype 的DP34不用填症狀，完全照著prototype」 — after the #219 review asked for the input; the owner's call on this layout | `visit-book-layout` 「DP-34 is DP-01's table…」 (P1: no DP-34 inputs, the table's HFpEF settles both) |
| HF DP-03 asks card and 「其他症狀、徵象與 NYHA」 (symptoms, signs, NYHA, compensation, chief-complaint and weight follow-up) | The pack's asks as segmented rows, as the Artifact prototype, and — since 2026-10-02 — **顯示 on 決策地圖 v2** again: NYHA I–IV beside them (the pack's `examAsks`, written to the same `nyhaClass`), and the other symptoms and signs folded under DP-06 as 「其他症狀與徵象（選填）」 (the pack's `moreQuestions`, written to the same `signAnswers`). **不顯示 on 決策地圖 v2**: the separate compensation question (the DP-06 2×2 now names 代償／失代償), the chief complaint and the weight follow-up | 三區塊 | Hidden by the owner in chat 2026-09-30 (asked 「…兩頁 DP-03 的「其他症狀…」摺疊…要照 Artifact 拿掉嗎？」, answered 「照 Artifact 拿掉」); brought back by the owner in chat 2026-10-02: 「NYHA好像應該加回來？還有哪些要加回來呀? 其實症狀模組可以選填，完整一點也無妨」, and on the design canvas 「決策地圖 v2 · 今日評估」: 「可以，這新的prototype很棒，請做」 | `visit-book-layout` 「DP-03 asks the pack's every-visit questions and NYHA…」, 「DP-03 grades NYHA…」, 「DP-06 folds the other symptoms and signs…」 |
| AF DP-03 「其他症狀、出血與副作用」 | **不顯示 on 決策地圖 v2**: only the pack's asks, as the Artifact | 三區塊 | Owner, in chat 2026-09-30, asked 「決策地圖 v2 上次補回的摺疊（AF DP-07/08 下的中風／血管病史、目前活動性出血、血流動力學不穩定、抗凝不可逆禁忌；DP-13 其餘 HAS-BLED 項；DP-17 心率／節律策略題組；兩頁 DP-03 的「其他症狀…」摺疊），Artifact 裡都沒有。要照 Artifact 拿掉嗎？（原版決策地圖和三區塊都保留）」, answered 「照 Artifact 拿掉」 | `visit-book-layout` 「asks only what the Artifact asks there…」 |
| AF question groups under DP-07, DP-08, DP-13, DP-17, DP-21 (血栓風險病史, 抗栓適應症, 瓣膜與當下安全, HAS-BLED 因子, 心率與節律, 共病與生活型態) and the rate-or-rhythm choice | The pack's own questions on the point's row, in the Artifact's style (DP-07 HCM; DP-08 valves; DP-13 NSAID／抗血小板, 飲酒; DP-17 靜息量測; DP-21 打鼾, 飲酒, 吸菸). **不顯示 on 決策地圖 v2**: the rest of those groups (stroke／vascular history, active bleeding, instability, the OAC contraindication, the other HAS-BLED items) and the rate-or-rhythm choice with its questions | 三區塊 | Owner, in chat 2026-09-30, asked 「決策地圖 v2 上次補回的摺疊（AF DP-07/08 下的中風／血管病史、目前活動性出血、血流動力學不穩定、抗凝不可逆禁忌；DP-13 其餘 HAS-BLED 項；DP-17 心率／節律策略題組；兩頁 DP-03 的「其他症狀…」摺疊），Artifact 裡都沒有。要照 Artifact 拿掉嗎？（原版決策地圖和三區塊都保留）」, answered 「照 Artifact 拿掉」; the pack's questions on the rows: chat 2026-09-30 「抗凝畫面設計要長得跟prototype一樣」 | `visit-book-layout` 「asks only what the Artifact asks there…」, 「AF chapters 4–6…」 |
| HF／AF status line: rhythm and the record's other values (Na, Hb, SpO₂, BMI) with per-value edit, the LVEF echo-report link, and 「補填／修改」 with the clinical-values editor (AF: the clinic-vitals form) | The pack's key values in the header, as the Artifact's, only to read. **不顯示 on 決策地圖 v2**: 「補填／修改」 and the editor it opens, the per-value links and the echo-report link | 三區塊; the report in the 報告 tab | Header: chat 2026-09-30, 「請你逐dp檢查有沒有樣式長得跟prototype一樣」; 補填／修改: Owner, in chat 2026-09-30: 「都照著CDSS小麻式版面原形，不要使用任何原本的外觀」 | `visit-book-layout` 「draws nothing of the other layouts' look」 (both modes) |
| 看依據's 「原文與完整卡片」 fold: the guideline quotes and each module's full card | 看依據 opens the Artifact's panel alone: 本病人（紀錄）, the criteria, 「什麼會改變答案」, 指引重點 and the sources. **不顯示 on 決策地圖 v2**: the quotes and the module cards | 三區塊 | Owner, in chat 2026-09-30: 「都照著CDSS小麻式版面原形，不要使用任何原本的外觀」 | `visit-book-layout` 「draws nothing of the other layouts' look」 (no `cdss-visit-detail-module-*`, no `details`, after 看依據 is opened) |
| The chapter footers: HF 病程時間軸; AF 病歷與本次量測 and 其他問答; the outlook cards and HF 預後模型; 其他已完成檢查 and the clinical handoff card under the page | **不顯示 on 決策地圖 v2**: the page ends with 「今天的計畫」, as the Artifact | 三區塊 | Owner, in chat 2026-09-30: 「都照著CDSS小麻式版面原形，不要使用任何原本的外觀」 | `visit-book-layout` 「draws nothing of the other layouts' look」 (no `cdss-visit-hf-record-foot`, `cdss-visit-af-record`, `cdss-visit-prognosis`, `cdss-visit-completed-checks`, `cdss-visit-outlook-module-*`) |
| AF 「完整 AF 篩檢風險檢核」 under DP-04／05／06, and any other question group a point's card carries beyond the pack's own questions | **不顯示 on 決策地圖 v2**: a point asks only the pack's own questions on its row | 三區塊 | Owner, in chat 2026-09-30: 「都照著CDSS小麻式版面原形，不要使用任何原本的外觀」 | `visit-book-layout` 「draws nothing of the other layouts' look」 (no `[data-af-question-group]`) |
| 「複製的病歷文字」 fold under 今天的計畫 | **不顯示 on 決策地圖 v2**: 「複製到病歷」 stays and copies the same text | 三區塊 | Owner, in chat 2026-09-30: 「都照著CDSS小麻式版面原形，不要使用任何原本的外觀」 | `visit-book-layout` 「draws nothing of the other layouts' look」 (no `cdss-visit-summary`) |
| A point's decision buttons (the map's button row, its 「其他」 menu, the recorded-decision card) | The Artifact's: the recommendation as the one filled button, the rest beside it or behind 「其他」 opening in place when there are three or more; once recorded, ✓ the choice, 「改」, and what to recheck. The same actions and the same record | — (layout only; the first 決策地圖 is retired) | Layout only: Owner, in chat 2026-09-30: 「都照著CDSS小麻式版面原形，不要使用任何原本的外觀」 | `visit-book-layout` 「draws nothing of the other layouts' look」 (no `[data-slot="button"]`), the decision cases in both modes |
| 決策地圖's 「今天要決定」 queue and 01's 診斷／追蹤 switch | Each point decides on its own row or box; the decision-map rail marks what is open; 「今天的計畫」 lists what was decided | — (layout only; the first 決策地圖 is retired) | Layout only; owner added 決策地圖 v2 to the switch in 8273f5cb, 2026-09-30 | `visit-book-layout` 「records a chain in its box and marks it settled in the map」 |

## Adding or changing a gate

HF new-flow clinical information card: owner requested replacing the height tile with calculated BMI on 2026-09-12. Height remains editable in the shared clinical-values dialog; BMI is only displayed when positive height and weight are available, and its tooltip includes both measurement dates. Other values use two rows beside LVEF on desktop.

1. Decide the kind. If it is 不顯示, stop and ask the owner before writing code.
2. Put a `Visible behaviour changes:` section in the commit message that says,
   in one line per surface, what a user on which route can no longer see or
   do — or write `Visible behaviour changes: none`.
3. Add or update the row above in the same commit.
4. A test must cover the route where the surface is *kept*, not only the route
   where it is hidden (`__tests__/features/clinical-decision-support/pilot-pack-registry.test.ts`
   and `__tests__/application/hooks/use-beta-features.test.tsx` are the pattern).

- HF 門診流程：依使用者要求移除重複的「補完心超數值」按鈕；仍可點擊 HFA-PEFF／H₂FPEF 名稱開啟相同計算機並補填資料。

## HMC dyslipidemia pilot

2026-09-16: owner explicitly authorized the two pilot/hmc branches and preview overlay. The disease list now includes heart failure and dyslipidemia. Dyslipidemia retains its existing Beta/pilot visibility rule; the vghtpe hand-off honours Beta, while other unattended Medcloud routes continue to show released packs only. No existing clinical surface is removed.

## AF pilot preview

AF is listed alongside HF and lipid in the HMC host, including production builds for `/app-hmc/`. The existing Beta and unattended launch rules apply; HF remains the default. Owner authorized AF integration and deployment on 2026-09-19.

## CAD (coronary disease) preview

2026-10-18: the owner asked for the app side of the CAD CDSS (「接著做 app 端」). Coronary disease (`chronic-coronary-disease-cdss`) is listed after AF in the HMC host. The package ships it `enabled: false`, so it shows only under the existing Beta switch and pilot ids, and the unattended Medcloud rule applies as for the other unreleased packs; HF remains the default. No existing clinical surface is removed.

| Surface | Behaviour | Owner decision | Tests |
|---|---|---|---|
| 冠心病 in the disease switcher | Listed; visible with Beta or the pilot id, as dyslipidemia and AF | Owner, in chat 2026-10-18: 「接著做 app 端」 | `cad-host` |
| CAD 決策地圖 v2 asks: 「心絞痛比上次」 (更多／一樣／較少／沒有) and 「出血」 | Asked on the CAD page; the bleeding answer is the one the AF page asks, kept once per patient | Same | `cad-host` |
| 在地層：健保給付 lines under a point (CAD DP-12's P2Y12 reminder) | Drawn on every route of this host, which runs the Taiwan layer (`setLocaleLayer('taiwan')`); a deployment set to `'none'` draws none and nothing else changes | Owner, in chat 2026-10-18, asked that coverage be separable for deployment in other countries | `cad-host` |

## Optional private integrations (all routes)

2026-10-04，使用者指定 FHIR 讀寫暫只開放已登入 Firebase 的 CDSS 協作者。site=vghtpe 的有效CDSS結果保留人工儲存／歷史控制，firebase 模式沿用既有登入、由API查UID名單；不顯示額外FHIR登入鈕。只有明確 oauth2 設定提供「登入 FHIR 授權／斷開 FHIR 授權」。其餘臨床surface與既有Beta／院別規則保留，FHIR不經Gateway；詳見CDSS-FHIR-PILOT.md。

| Surface | Behaviour | Owner decision |
|---|---|---|
| CDSS「個人化照護指引」與 CDSS 試辦 pack 控制，在 `/`、`/app/`、`/app-hmc/` 及各啟動參數 | Build without the complete CDSS package group: omit the tab and pack controls. With the packages installed: retain all existing Beta, audience and hospital-launch rules. Main clinical reports, AI summary, calculators and FHIR imports remain available. | Explicit owner clarification in chat, 2026-09-30 |
| 健康存摺 SDK JSON 匯入，在 `/`、`/app/`、`/app-hmc/` 及各啟動參數 | Missing SDK browser artifact or declaration: advertise FHIR Bundle import only and reject SDK JSON with a clear message. With the vendored artifact: retain SDK conversion without requiring the private source repo. | Explicit owner clarification in chat, 2026-09-30 |
| 民眾模式（patient）＋ Beta「個人化衛教」，在 `/`、`/app/`、`/app-hmc/` 及各啟動參數 | Build without the complete education package group: retain the existing patient/Beta entry and show「此部署尚未安裝個人化衛教內容。」; personalized education content is unavailable. With the packages installed: retain the original education content and all existing audience/Beta launch rules. | Owner explicitly approved the unavailable-content notice on these three routes in chat, 2026-09-30 |

## HF calculator submission policy (2026-10-05)

The HF calculator remains visible on its existing clinician routes. Unset NEXT_PUBLIC_HF_AUTH_POLICY retains the Firebase caller requirement. Explicit intranet mode removes the Firebase requirement for HF input checks and explicit formal predictions, with network authorization enforced by the SaMD ingress/service; the owner approved all approved hospital network clients in chat. Unknown policy values disable submission with a configuration notice. No route, care pack, traditional calculator or result surface is hidden by this change.

2026-10-05 production activation: the owner authorized enabling HF at https://mediprisma.tw/app/. The /app build receives NEXT_PUBLIC_HF_GATEWAY_ORIGIN and NEXT_PUBLIC_HF_AUTH_POLICY from repository variables; its HF submission gate uses the approved intranet policy. The separate /app-hmc publisher and pilot branch remain unchanged.

## HF SaMD calculator hospital gate (2026-10-05)

| Surface | Behaviour | Owner decision |
|---|---|---|
| HF AI-SaMD calculator card, input checks, prediction and results on `/`, `/app/`, `/app-hmc/` | Offered in clinician calculator lists with exact `site=vghtpe`, OR after an explicitly configured intranet policy receives a valid HF catalogue from the existing network-authorized `/samd/v1/models` endpoint. A missing/other site and failed/unknown network discovery omit this hospital integration; the probe sends no patient data and does not use `/health` as authorization. The card carries 「北榮 SaMD」 and opens the full input-check/prediction/result detail. Traditional HF calculators retain their existing visibility. This presentation gate does not replace service authorization. | Owner explicitly requested 「僅限site=vghtpe才出現」 and the existing calculator UI, then added confirmed hospital-network clients as an alternative visibility condition in chat, 2026-10-05. |

The earlier HF activation entries describe their rollout at that time. Their unrestricted SaMD presentation is superseded by the hospital gate above; traditional HF calculator visibility is unchanged. The active surface is HfSamdCard with HfMedcloudDetail; HfMedcloudDryRun remains a compatibility wrapper.

## Remove duplicate HF prognosis panel (2026-10-05)

| Surface | Behaviour | Owner decision |
|---|---|---|
| 「HF 預後模型・公式待串接」 expandable panel in calculator lists on `/`, `/app/`, `/app-hmc/` | Removed entirely from the shared calculator list. Its panel-only SHFM/GWTG-HF pending-formula entries are no longer offered there. Existing registered MAGGIC and LIFE-Preserved calculators remain in the ordinary list, and the 北榮 SaMD card retains its site/intranet gate and detailed results. This supersedes earlier statements that the grouped HF panel remained visible. | Owner explicitly requested removal of this entire panel in chat with a screenshot, 2026-10-05. |

## HF SaMD detail navigation (2026-10-05)

The owner requested the same master/detail flow as ordinary calculators. The gated 北榮 SaMD card now opens an inline calculator detail page with 返回, rather than a modal dialog. Returning to the list or switching an already visited right-panel tab preserves in-flight validation/prediction and results in the existing mounted session; changing the patient/import still aborts and discards the old request. No clinical surface or authorization gate is removed. Page refresh or leaving the app does not guarantee that an in-flight operation continues. This supersedes earlier references to a SaMD result dialog.

## HF SaMD imported bridge sources (2026-10-05)

Owner requested health-bank and TVGH EHR bridge imports in addition to medcloud2.
The existing site/intranet and medical-audience entry gates remain unchanged.
New source formats can prepare model inputs; missing recognized index diagnoses
are shown explicitly and prevent uploading invalid inputs. Existing cloud input
eligibility is preserved. No previously visible clinical surface is removed.

## HF model action flow

| Surface | Behaviour | Routes | Owner decision |
|---|---|---|---|
| HF physician diagnosis | Step 2 of three, above the prediction action. Expanded until confirmed and while editing; after 「執行 HF 模型預測」 it collapses to one line naming the chosen basis and I50.9, with a 「修改」 button that reopens every choice. The physician attestation line stays visible in both states. Supersedes the 2026-10-07 always-expanded rule. | Every route where the HF research calculator is available, including `?site=vghtpe` and the authorized intranet-discovery path. | Owner approved the collapsed step in chat, 2026-10-07 |
| HF input validation action | Separate validation button removed. A single 「執行 HF 模型預測」 action validates first, automatically predicts only on acceptance, and displays missing-data issues and warnings. | Every route where the HF research calculator is available; existing calculator access rules remain unchanged. | Explicit chat request, 2026-10-07 |
| HF model horizon selector | Removed. The single action checks and scores the 1-month and 3-month outpatient models together from the same prepared input; both results are shown side by side, and a refusal or error in one horizon never hides the other. No horizon becomes unavailable. | Every route where the HF research calculator is available. | Explicit chat request, 2026-10-07 |
| HF result notes 「其他提示」 | Collapsed by default behind a toggle showing its count (for example 「其他提示 · 4」); one click shows every note. 「可能低估風險」, 「超出模型開發資料範圍」 and input-check warnings (「輸入檢查警告」) stay expanded. No note is removed. | Every route where the HF research calculator is available. | Explicit owner request in chat with a screenshot, 2026-10-07 |
| HF 「執行 HF 模型預測」 without an HF diagnosis | Disabled when the prepared input has no heart-failure diagnosis code (ICD-10-CM I50.x or ICD-9-CM 428.x), with 「未偵測到心衰診斷，請先在步驟 2 確認心衰病史」 under it; enabled as soon as step 2 supplies I50.9. With an existing HF code, step 2 stays optional and eligibility remains the API’s decision. | Every route where the HF research calculator is available. | Explicit owner request in chat with a screenshot, 2026-10-07 |
| HF observed-incidence basis (n and 依據族群) | Collapsed by default behind 「依據」 under each horizon; the rate line stays visible as 「同層實際發生率（群體）」 with its CI. One click shows n and the cohort. A toggle, not a tooltip, so it works without hover. | Every route where the HF research calculator is available. | Explicit owner request in chat with a screenshot, 2026-10-07 |
| HF 「整理模型資料」 button | Replaced by automatic local preparation when the detail opens (no network request) and a 「重新整理」 link in step 1. Nothing is sent until 「執行 HF 模型預測」. | Every route where the HF research calculator is available. | Explicit chat request, 2026-10-07 |
