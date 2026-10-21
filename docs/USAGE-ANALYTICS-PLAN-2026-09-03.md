# 使用行為記錄（Firebase Analytics / GA4）規劃 — 最終版

> 文件分類（2026-09-08）：設計與實作時點紀錄。下列「未 commit」是原撰寫時狀態，不代表目前分支；現行功能見 [README](../README.md)，GA4 後台狀態未於本次清理核對。

日期：2026-09-03　狀態：已實作於工作樹（未 commit）；GA4 custom dimensions 尚未登記

## 0. 結論

- 方案 A（GA4）可行。**firebase-smart-on-fhir 不用改**：純前端 SDK，不經 Firestore、不需 Function。
- `measurementId` 已在 `.env.local` 與 `ci.yml` secrets，只是從沒被 `getAnalytics` 用過。
- App 端：1 個新檔（adapter）+ 10 個掛點（每處 1–3 行）+ CSP 加 1 個 host + 1 個測試檔。約 1.5 小時。
- GA4 後台：部署前先登記 custom dimensions（不回溯）。
- 三個事件、零 PHI、不送 uid、不送 URL。

## 1. 現況（已核對）

| 項目 | 現況 | 出處 |
|---|---|---|
| Firebase 初始化 | `initializeApp` 含 `measurementId`，未 import `firebase/analytics` | `src/shared/config/firebase.config.ts:32` |
| CSP | `script-src` 無 googletagmanager；`connect-src https:` 已足夠 | `app/layout.tsx:31-36` |
| 既有遙測 | 無。`users/{uid}/usage/{date}` 是 proxy 額度計數，非行為記錄 | `firestore.rules:67` |
| 受眾 / 登入 | `audience ∈ medical\|patient`；anonymous 或 Google | `audience.provider.tsx:8`、`auth.provider.tsx` |
| 「機構」 | app 無 organization 概念；只有 `?site=vghtpe`、`?medcloud2=auto`、SMART `iss`、demo、import | `medcloud-launch-context.ts:69-70`、`ai-data-source.ts:19` |

## 2. 事件定義

### 2.1 `view_open` — 使用者看到某一層的某一頁

語意是 **view 不是 click**：每層都有預設頁（左 `patient`、右 `medical-chat`、報告 `cumulative`、累積 `cbc`、用藥 `list`、摘要 `standard`），只記點擊會系統性低估預設頁。實作為 `useEffect` 監聽該層 active state（含初始值），手動 handler 在 setState 前把 ref 設 `user`，effect 讀到就帶 `trigger: user`，否則 `auto`（tour、引用跳轉、重設）。

| area | id 值域 | state | 手動 handler |
|---|---|---|---|
| `left` | `patient / visits / reports / meds / documents` | `LeftPanelLayout.tsx:67 activeTab` | `:221 onValueChange` |
| `right` | `medical-summary / medical-chat / ips-export / medical-calculator / settings` | `RightPanelLayout.tsx:279 effectiveTab` | `:284 changeTab` |
| `reports` | `cumulative / all / lab / imaging / pathology / vitals / procedures / uncategorized` | `ReportsCard.tsx:79 activeTab` | `:157 handleTabChange` |
| `cumulative` | `lab-categories.ts` 的 id：`cbc / coag / chem / endocrine / lipid / glucose / hep / tumor / urine / bloodgas / serology / microbio / other` | `ReportsCard.tsx:118 cumulativeCategoryId` | `:142 handleCumulativeCategoryChange` |
| `meds` | `list / timeline / remaining` | `MedListCard.tsx:82 view` | `:309 setView(v)` toggle |
| `meds` | `timeline-right`（時間軸移到右側並排；純 click，無 state） | — | `MedListCard.tsx:336 openTimelineRight` |
| `summary` | `standard / custom` | `medical-summary/Feature.tsx activeView` | `:828 onValueChange` |

- id 一律用 registry / 型別既有的字串，不另取名；改 registry 不用同步第二份。
- `microbio` 底下的 bacteriology / mycobacteriology / mycology 是 subgroup 不是 tab，不記。
- 計算機只記到 `right / medical-calculator`；**不記**哪一個計算機被開、不記計算機複製（2026-09-03 決定）。
- 用藥外層 `DataTab`（`medications / allergies / vaccines`，`MedListCard.tsx:273`）不在本次範圍；要加是同一模式再加一列。

- 時間軸內的分組 / ATC 層級 / 時間範圍切換**不記**（2026-09-03 決定：就算少人點也不會拿掉）。若日後要看，這三個偏好存 localStorage，要看開啟時的狀態分布而非點擊。

### 2.2 `chat_send` — 臨床對話送出

- 唯一使用者入口 `features/medical-chat/components/MedicalChat.tsx:498 handleSend`；打字與建議 chip（`:767`）都經此；重試走 `useAgentChat.ts:775` 不經此，不重複計數。
- 參數：`source: typed | chip`（`overrideText` 為字串即 chip）、`has_image: boolean`（只記有無）、`model_id`（`useModelPref('chat')`，`:139`）、`agent_mode: boolean`（`:710 agentModeActive`）。
- **絕不記 prompt、回覆、reply 引用、模板內容。**

### 2.3 `handoff_copy` — 複製 tab 的三顆按鈕

- 掛點 `features/ips-export/components/EmrHandoffPanel.tsx:206 doCopy(key, text)`，在 `copy(text)` 成功後送。
- 參數：`mode: labs | reports | all`（就是既有的 `CopyKey`）。
- 只記 mode；`text` 是病人檢驗內容，**不進事件**。
- 同 tab 的 AI 交接複製（`AiHandoffPanel.tsx:236`）與 IPS 預覽複製（`IpsExportPreview.tsx:283`）不在範圍。

### 2.4 `tour_start` / `tour_end` — 導覽（2026-09-03 追加）

- 掛點不在導覽元件裡，而是訂閱兩個 zustand store：`src/shared/config/tour-analytics.ts` 的 `useTourAnalytics()`，由 `audience.provider.tsx` 掛一次（全程唯一實例）。這樣導覽元件一行都不用改（當時正被另一條線編輯中）。
- 只 import store 模組（`*.store.ts`），不 import feature barrel — barrel 會把導覽元件與整個 Firebase SDK 拉進 provider 的 module graph。
- 放在 `src/shared/config/` 是因為 eslint 禁止 `src/application/**` 與其餘 `src/shared/**` import `@/features/*`；`src/shared/config` 是既有的 composition root 例外（feature-registry / right-panel-registry 同理）。
- `tour_start { tour: left | right | custom-summary }`：`session` 遞增即視為開始；右側依 `kind` 分 `right` 與 `custom-summary`。
- `tour_end { tour, tour_outcome: finish | abandon, step }`：`prev.active && !state.active` 視為結束；`tour_outcome` 由 `prev.stepId` 是否為 `finish` / `custom-summary-finish` 判定；參數刻意不叫 `outcome` — GA4 的 custom dimension 以**參數名**註冊，與 `ai_result.outcome`（七個值）同名就會擠進同一個 dimension；`step` 取 `prev.stepId`（`stop()` 會在同一個 set 內把 `stepId` 清掉）。`openCustomSummaryGuide()` 只有在導覽正在跑時才算結束。
- **尚未區分啟動來源**（首次自動邀請 vs. 說明選單），因為那個資訊只存在導覽元件裡；要區分就在 store 的 `start()` 加參數。


> 2026-10-19 更新：導覽改為「導覽中心」＋任務小導覽。`tour` 的值改為導覽 id（`getting-started`、`labs-reports`、`medications`… 與 `custom-summary`，清單在 `src/infrastructure/telemetry/usage-analytics.ts` 的 `ANALYTICS_TOURS`，測試保證與 `features/guided-tour/guided-tour.tours.ts` 一致）；`left` / `right` 不再送出。訂閱改為 `useGuidedTourStore`（`session` 遞增＝開始；`tourId` 轉為 null＝結束，`tour_outcome` 取 store 的 `lastOutcome`，只有在最後一步按「完成」才是 `finish`；導覽進行中改開另一個導覽，前一個記為 `abandon`）。左右兩個 tour store 現在只是畫面切換的通道（`scene`），不再回報；自訂摘要詳盡導覽仍由右側 store 的 `custom-summary` 回報。

### 2.5 `report_interpret` — 民眾一鍵「AI 翻譯解讀」（2026-09-04 追加）

- `report_interpret { host: report-row | document-card | document-dialog, action: open | regenerate }`
- `open` = 使用者按下按鈕展開解讀面板。**快取命中也算**：面板未快取時是 mount 即自動產生，所以按下去就是「使用者要這份解讀」的時刻；收合不記（否則每次使用都被算兩次）。
- `regenerate` = 面板內的「重新產生」（錯誤重試鈕與 footer 兩處同一個意思，都記）。
- manual 模式（`autoGenerate={false}`，向右展開的停靠檢視）面板內那顆「AI 翻譯解讀」觸發鈕記為 `open` — 它就是該 host 的入口，不是重新產生。
- 自動產生的 effect **不記**，那是 host mount 的後果，按鈕已經記過。
- 掛點：`ReportInterpretationButton` 新增必填 `analyticsHost`、`ReportInterpretationPanel` 新增選填 `analyticsHost`（不給就完全不記）。Host 端：`ReportRow` 與 `MultiRegionStudyCard` → `report-row`；`DocumentSummaryCard` → `document-card`；`DocumentDetailDialog` → `document-dialog`。
- `EmrHandoffPanel` 用的是 hook 不是這個面板，且其翻譯由複製流程驅動，已由 `handoff_copy` 涵蓋 — 不另外記。
- **絕不記**報告原文、翻譯結果、解讀內容、reportId。

### 2.6 `app_launch` — 每次開啟（2026-09-04 追加）

- `app_launch { launch_source: medcloud2 | smart | demo | import | none, site: vghtpe | unknown, workstation }`
- **為什麼要有這個事件**：同樣兩個值也會送成 user property，但那是在 auth listener 之後非同步設定的，GA 的自動 `session_start` 通常搶在前面 → 「`?medcloud2=auto&site=vghtpe` 被開了幾次」用 user property 算不準。事件自己帶值就與屬性時序無關。
- 一次 page load 只送一次：`auth.provider.tsx` 的 module-level `launchReported`（不是 uid ref — uid ref 在登出/登入會重設而重複送）。送在同一個 `.then` 裡、`setUserProps` 之前。
- 判定邏輯抽到 `src/application/telemetry/launch-context.ts`（`detectLaunchSource` / `detectSite`），user property 與事件共用同一份優先序，dynamic import 與 try/catch 都保留。
- **已知缺口（不處理）**：若整個 load 都沒有任何 Firebase user（匿名登入被關且未登入），這次 load 不會送 `app_launch`。範圍內的正式路徑都有 session。
- 一律不送 `iss`、import id、完整 URL；`site` 只認 `?site=vghtpe`，其餘一律 `unknown`。
- `workstation`：`?ws=<code>`，診間／工作站代碼，取自 `getLaunchWorkstation()`，沒有或不合法一律 `unknown`。同時也送成 user property（見 §2.11）。

#### extension 端需要做的事

- 開啟網址時附上 `&ws=<code>`，例如 `https://mediprisma.tw/app/?medcloud2=auto&site=vghtpe&ws=OPD-3F-01`。
- `<code>` 必須符合 `WORKSTATION_CODE_PATTERN` = `/^[A-Za-z0-9_-]{1,32}$/`（英數、`_`、`-`，1–32 字元）。
- **請用診間或工作站代碼**（`OPD-3F-01`、`ER-BAY2`、`WS-1042`），**不要**用使用者名稱、員工編號，也不要用含人名的電腦名稱。字元集刻意不含 `@`、`.` 與空白，正是為了讓「順手塞帳號」這件事直接失敗。
- **fail-closed**：`ws` 格式錯誤、出現兩次、或帶了其他未知參數，整個 launch URL 會被判為無效（`parseMedcloudLaunchOptions` 回 null）→ 連 `medcloud2=auto` 與 `site=vghtpe` 都不會生效。extension 必須在開啟前自己驗證，不要送沒把握的值。
- 解析只信任 `https://mediprisma.tw/app/`（origin + path 完全相符、無 hash）。github.io 鏡像不是 medcloud 的啟動目標，在那裡 `?ws=` 會被視為 `unknown`。


#### 全院部署時 `ws` 怎麼做到每個診間唯一（給 extension 端，2026-09-04）

「唯一」與「有意義」分開解：

- **唯一、零協調**：extension 首次在某台電腦啟動時產生隨機 id（UUID 去連字號 = 32 hex，符合 `WORKSTATION_CODE_PATTERN`），存 `chrome.storage.local`，之後每次啟動帶同一個。全院每台電腦自動不同，資訊室不用填。
- **有意義**，由準到麻煩：
  1. HIS 畫面／session 的診間號（最準，醫師換診間會跟著變）。
  2. Chrome 企業政策 `chrome.storage.managed`，資訊室按機器／OU 設定代碼。
  3. 首次啟動手動填，存本機（最簡單，靠人）。

**建議優先序**：HIS 診間 → 企業政策代碼 → 自動隨機 id。第一天就有唯一性，對照表之後再補，app 端不用改。

註：隨機 id 代表「這台電腦」，HIS 診間代表「這個診次」，同一台電腦跨科使用時兩者不同。若兩者都要，extension 帶兩個參數、app 端多開一個 `room` 屬性，目前不做。

### 2.7 `ai_result` — 每次 AI 呼叫的結果（2026-09-04 追加）

- `ai_result { surface, outcome, model_id, duration_bucket, context_tokens?, resource_count?, obs_count?, med_count?, doc_count?, encounter_count?, report_count?, fed_resource_count?, fed_obs_count?, fed_med_count?, fed_doc_count?, fed_encounter_count?, fed_report_count? }`
  - `surface`: `summary | safety | med_recon | insights | report_interp | chat`
  - `outcome`: `ok | error | timeout | aborted | context_overflow | quota | parse_failed`
  - `duration_bucket`: `lt5 | 5to15 | 15to45 | gt45`（秒）。**原始耗時不送。**

#### 資料量欄位（十三個選填數值，2026-09-04 追加）

**擁有者決定（2026-09-04）：資料量只在「AI 真的被使用」時記錄，單純載入病歷一律不記。** 曾規劃過獨立的 `patient_loaded` 事件（每次病歷載入完成送一次），已**取消並移除**——那會讓每個開啟病人的動作都留下一筆資料量紀錄，而這些數字唯一的用途是替 AI 的成敗與延遲提供對照基準，附在 `ai_result` 上即可完整達成，範圍卻小得多。

十三個欄位都是**非負整數、精確值不分桶**（見 §5 取捨列），且**各自獨立選填**：測不到就整個省略該參數，絕不送 0——否則「無法測量」會和「真的測到 0」在報表裡混成同一件事。實作一律用 spread（`...(x !== undefined ? { k: x } : {})` / `...(counts ?? {})`），不直接指派。

| 欄位 | 是什麼 | 有帶的 surface |
|---|---|---|
| `context_tokens` | 這次**送出去**的臨床脈絡 token 估算。用 `estimateTokens()`，與資料選擇 token 計量表、context 預檢守門同一支估算器，所以各 surface 可互相比較 | `summary`（估**適配後**的 `clinicalContext`，即所有縮減層級套完後真正送出的那份）、`report_interp`（估 `prepareReportText()` 的**截斷＋去識別後**文字，不是原始報告）、`chat` 的 standard chat 且該回合含病人資料時（估 `selectedClinicalContext`）。**Agent 模式聊天與 `turnDataScope === 'general'` 的回合不帶**：agent 起手是空 context、資料靠 tools 現拉，沒有可比的前置數字 |
| `resource_count`、`obs_count`、`med_count`、`doc_count`、`encounter_count`、`report_count` | 目前載入的病歷**本身有多大**（不是這次選了多少）。取自 `useClinicalDataQuery().data`，沒有載入完成的病歷就六個全省略 | **全部三條路徑都帶**，包含 Agent 模式與 general scope 的聊天回合——它描述的是「這位病人的病歷」，與該回合送了什麼無關 |
| `fed_resource_count`、`fed_obs_count`、`fed_med_count`、`fed_doc_count`、`fed_encounter_count`、`fed_report_count` | 經過**資料選擇＋context 縮減層級之後，真正送進模型**的那份 context 裡有幾筆資源 | `summary`（數 `scopedClinicalData`）、`chat` 的 standard chat 且含病人資料時（數 `fittedClinicalInput.clinicalData`）、`report_interp`（該 surface 從來就不吃整份病歷，fed set 就是使用者按下去的那一份報告 → 只送 `fed_resource_count: 1` 與 `fed_report_count: 1`，其餘四欄**省略**）。**Agent 模式與 general scope 的聊天回合全省略**：沒有前置 context 可數 |

**配對才是重點。** 每一筆 `ai_result`（成功或失敗）都同時帶「病人本來多大」與「實際餵進去多少」，於是可以直接讀出：

- `resource_count − fed_resource_count` 很大 → context engineering 有大幅修剪；此時**仍然**失敗，就不是資料量的問題，要往別處查。
- 差值接近 0 而 `resource_count` 很大 → 幾乎沒修剪，大病歷原封不動送出去，失敗多半就是塞爆。
- 依 `fed_resource_count` 分群看失敗率 → 直接看出**失敗是不是集中在某個餵入規模**，也就是縮減目標該訂在哪。
- `context_tokens` 是「送出去的位元組大小」、`fed_*` 是「送出去的資源筆數」，兩者不可互推（30 份長病摘與 300 筆檢驗值 token 數可以一樣），所以都送。

- **兩份計數走同一份欄位清單，可以直接相減**：`resource_count − fed_resource_count` 就是「被資料選擇＋context 縮減丟掉的資源筆數」，沒有任何修正項；逐欄相減（`obs_count − fed_obs_count`…）同樣成立，整份餵進去時兩邊會完全相等。程式上兩個 counter 共用同一個 `COUNTED_COLLECTIONS`，就是為了讓這個減法不可能因為清單漂移而失效。
  - 該清單刻意排除兩項：`vitalSigns`（Observation 查詢順帶產出的生命徵象子集，計進去會把同一批資源算兩次）與 `medicationRemainingSummaries`（app 自己算的餘藥檢視，不是病人資料、也從來不會進 prompt——只在 loaded 側計會產生一個永遠存在、長得跟「被修剪」一模一樣的假差值）。
- **`fed_*` 在最後一層是上界**：最末的縮減層級是把序列化後的**文字**裁到 token 預算，可能剪掉仍存在於這份結構化輸入裡的尾端紀錄。所以在那一層 `fed_*` 是上界，`context_tokens` 才是真正送出去的精確大小——這也是兩者都要送的原因之一。
- 計數口徑（`src/application/telemetry/patient-resource-counts.ts` 的 `countPatientResources` / `countContextResources`）：
  - `resource_count` = `conditions / medications / allergies / observations / diagnosticReports / imagingStudies / procedures / encounters / documentReferences / compositions / immunizations / consents / devices / carePlans` 總和；`fed_*` 走的是**同一份**清單（見上）。
  - `med_count` = `medications.length`，**MedicationRequest 與 MedicationStatement 合計**：兩者由同一個 fetcher 取得、在 app 內合併成同一份用藥清單，分開計會描述一個 UI 本來就不存在的區別。
  - `doc_count` 只計 `DocumentReference`（不含 `Composition`）。
  - 「載入完成」沿用 app 自己的定義：`useClinicalDataQuery().data` 在**每一個** resource type 都 settle 前是 `undefined`（IPS 匯出、FHIR tools 用的就是這個 gate），所以半載入的病歷不會送出一個偏小的假數字。
- **不逐層 threading，每個 surface 就地讀本來就有的東西**：
  - loaded counts：`summary` 與 `chat` 取自 `useClinicalAiInput()` 新增回傳的 `patientCounts`——該 hook 本來就持有整份病歷（`useClinicalData()`）也本來就有 `rawDataReady` 這個「全部 settle 且無阻斷性問題」的 gate，所以不需要第二個 React Query 訂閱；半載入的病歷回 `undefined`，六欄就整組省略。`report_interp` 不走那個 hook，改用 `useLoadedPatientCounts()`（包 `useClinicalDataQuery()`），它本來就因 `usePatient()` 而位於 React Query 樹內。
  - fed counts：直接數各 surface 手上已有的 scoped input（`scopedClinicalData` / `fittedClinicalInput.clinicalData`），不另外取資料。
  - 這個放法**沒有為任何既有測試引入新的 provider／mock 需求**——這是選它而不是在每個 surface 各開一個 `useClinicalDataQuery()` 的直接原因。
- **絕不記**：任何 id、姓名、日期、代碼、數值、文字。只有總數與大小，兩者都無法反推回病歷。
- 分類與分桶集中在 `src/application/telemetry/ai-outcome.ts`（`classifyAiOutcome` / `bucketDuration`），兩條完全不同的管線共用同一份判定，否則各 surface 的失敗率無法互相比較。
- 判定順序：abort（使用者按停止，**不算失敗**）→ context overflow（本地 `ContextOverflowError` 或 provider 端拒絕）→ quota → timeout（stream idle watchdog 與報告解讀總時限）→ 其他 `error`。
- 掛點一：`run-generation-job.ts` 新增選填 `analytics: { surface, modelId, contextTokens?, counts?, fedCounts? }`（型別 `AiResultAnalytics`），不給就完全不送。它只是觀察者，不改變任何既有行為；`PARSE_FAILED` 分支 → `parse_failed`，被取消／被新 Bundle 取代 → `aborted`。
  - 目前經由此路徑的只有 `useAiSlotGeneration`（唯一消費者 `use-medical-summary.hook.ts`，摘要與安全掃描是**同一個 job**，因此以 `summary` 回報一次）與報告解讀（`report_interp`）。`med_recon` / `insights` 走各自的 runtime，enum 先保留，掛點待補。
- 掛點二：聊天不走 `runGenerationJob`，`useAgentChat.handleSend` 自己計時，六個結束分支各回報一次（同一 turn 以旗標保證只送一次）。
- **絕不記** prompt、回覆、工具軌跡、原始耗時。

### 2.8 `source_nav` — 醫師會不會去驗證 AI 引用（2026-09-04 追加）

- `source_nav { target_type, from }`；`target_type` = FHIR resourceType 字串（`Observation`、`MedicationRequest`…，非 PHI）；`from`: `summary | safety | chat | unknown`。
- 掛點：`resource-navigation.store.ts` 的 `navigate()` — 所有引用跳轉的唯一漏斗，一處涵蓋全部。
- `ResourceNavTarget` 新增選填 `origin`，只供分析用，不影響路由。目前只有 `medical-summary/Feature.tsx` 的 `navigateToResource` 標成 `summary`（摘要卡與安全掃描共用同一個 helper，未再細分）。
- **未標註的呼叫端**（皆回報 `unknown`）：`ClinicalDecisionSupportView.tsx`、`medical-calculator/CalculatorDetail.tsx`、`MedListCard.tsx`（餘藥回查）— 這三個都不屬於 `summary|safety|chat` 三選一，硬塞會讓語意變髒。聊天目前沒有任何引用跳轉呼叫端。
- **絕不記** resourceId、display、日期、evidenceQuote。

### 2.9 `summary_copy` — 醫療摘要複製（2026-09-04 追加）

- `summary_copy { block: hero | custom_module }`，只在 `copy()` 成功後送。
- 已掛：`CurrentPrioritiesCard.tsx` 的 `handleCopy` → `hero`。
- **待補**：`CustomInsightModulesSection.tsx`（~66）→ `custom_module`。該檔目前是另一條工作線的未提交修改，這次刻意不動；enum 值已在白名單，之後補一行即可。
- **絕不記**複製的文字。

### 2.10 可選：`model_switch`

`src/shared/components/ModelPicker.tsx` onChange → `{ from_model, to_model }`。一個掛點，要不要由你決定；不影響其他部分。

### 2.11 使用者屬性（登入後設一次，`auth.provider.tsx onAuthStateChanged` 之後）

| property | 值域 | 來源 |
|---|---|---|
| `launch_source` | `medcloud2 / smart / demo / import / none` | `isMedcloudLaunchRoute()` + `getAiDataSourceState()` + SMART client 存在 |
| `site` | `vghtpe / unknown` | `?site=` 參數；**不送 `iss`** |
| `audience` | `medical / patient` | `useAudience()` |
| `auth_kind` | `anon / google` | `user.isAnonymous` |
| `app_version` | `0.48.0` | 執行時抓 `/version.json`（`useAppVersion()`），與版本 chip 同源 |
| `auto_summary` | `on / off` | `medical-summary-prefs.store` 的 `autoGenerate` |
| `locale` | `zh-TW / en` | `useLanguage()`（與瀏覽器語言不同，這是使用者實際選的） |
| `key_mode` | `own / proxy` | `useApiKey()` / `useGeminiKey()` / `useClaudeKey()` 任一非空即 `own` |
| `workstation` | 自由字串（≤ 64；實際受 `/^[A-Za-z0-9_-]{1,32}$/` 限制） | 啟動網址的 `?ws=` 參數（`getLaunchWorkstation()`）；缺少或不合法為 `unknown`。**裝置／診間代碼，不是人**。 |
| `browser_id` | 32 字元小寫 hex（隨機） | adapter 自己產生並存在 `localStorage['mediprisma.analytics.browser_id']`。回答「到底有幾台機器／幾個瀏覽器在用」——`workstation` 只有 launcher 帶參數時才有，GA session 也無法跨天串接。**不是**帳號、uid、人或指紋，就是一個隨機數字，意義只有「跟上次同一個瀏覽器」。**限制**：清除網站資料／無痕／擋 storage 會產生新 id（機器數會高估）；共用漫遊設定檔會讓多台機器看起來像一台。只能當數量級看。 |

`browser_id` 由 adapter 在 `initializeAnalytics()` 之後、`flush()` 之前直接寫上去（不走 `setUserProps` 佇列）——順序就是重點，晚一步排隊中的事件就會少帶這個屬性。存 localStorage 而不是靠 GA 自己的 cookie `client_id`：院內是在 HIS 的 iframe 裡跑，GA cookie 屬於第三方，可能每次載入就被丟掉或重設；Chrome 的 storage partitioning 下 localStorage 以 top-site + origin 為鍵，對同一台診間電腦是穩定的。

`audience` 在 `audience.provider.tsx` 設（Medcloud 路徑會強制醫事人員模式，從 auth.provider 讀 storage 會讀到錯的值）；後三項在 `use-preference-props.ts`，三個 effect 各自在變動時重送，同樣掛在 `AudienceProvider`（位於 `LanguageProvider` 之內，`locale` 需要）。

### 2.12 明確不記

patient id / 姓名 / 病歷號 / 任何 FHIR 內容、prompt 與回覆、複製的文字、Firebase uid（不呼叫 `setUserId`）、完整 URL（關掉自動 `page_view`，因為 URL 帶 SMART `iss` 與 callback `code`）、Google Signals / 廣告個人化（明確關）。

## 3. 改動清單（App repo）

1. **新檔 `src/infrastructure/telemetry/usage-analytics.ts`**（唯一碰 `firebase/analytics` 的地方）
   - 對外只有 `trackEvent(name, params)`、`setUserProps(props)`、`markUserTrigger()`。
   - 啟用條件全部成立才送：瀏覽器端、`measurementId` 存在、`isSupported()`、hostname ∈ {`mediprisma.tw`, `voho0000.github.io`}、非 emulator。否則 no-op（localhost、E2E、SSR 不污染資料）。
   - `initializeAnalytics(app, { config: { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false } })`
   - 懶載入：`import('firebase/analytics')` 排在 `requestIdleCallback` 之後；就緒前事件排隊，就緒後 flush。首屏 bundle 不變。
   - **白名單防線**：event 名稱、param key 走白名單，value 只接受 ≤ 64 字元字串 / 數字 / boolean，否則丟棄並 `console.warn`（dev）。就算日後有人把 prompt 或複製文字傳進來也送不出去。三條件（模型無關、app 有特權知識、不加會無聲出錯）全中，符合 guard discipline。
   - 介面做成 adapter：若院內擋 GA 要換 Firestore，只換這一檔。

2. **掛點 10 處**（§2 表格已列行號）：左右 layout 各 1、ReportsCard 2、MedListCard 2、summary Feature 1、MedicalChat 1、EmrHandoffPanel 1、auth.provider 1（user props）。可選 ModelPicker 1。

3. **CSP `app/layout.tsx:31`**：`script-src` 加 `https://www.googletagmanager.com`。SDK 動態插 gtag.js，不加會被擋且**完全無聲**。`connect-src https:` 已涵蓋 GA 上報 host。

4. **測試** `__tests__/infrastructure/telemetry/usage-analytics.test.ts`：白名單拒未知 key / 長字串、未啟用 no-op、就緒前排隊後 flush、`markUserTrigger` 一次性。各掛點的既有元件測試加一個「切換會呼叫 trackEvent 且 trigger 正確」斷言。

5. **文件** `docs/SECURITY.md` 加「使用統計」段：收什麼、不收什麼。

## 4. GA4 後台（一次性，部署前）

> ✅ **2026-09-04 已登記完成**：資源 `smart-on-fhir-ac97d`（property 517699592）共 30 個 custom dimensions（21 event-scoped + 9 user-scoped；`workstation` 兩個 scope 依決定暫不登記）。GA4 顯示名稱不能含括號，同名雙 scope 用「launch_source event / launch_source user」「site event / site user」。資料保留期與 BigQuery 尚未處理。

1. 登記 custom dimensions（不回溯，先做）：
   - event-scoped：`area`, `id`, `trigger`, `source`, `has_image`, `model_id`, `agent_mode`, `mode`, `tour`, `tour_outcome`, `step`, `host`, `action`, `launch_source`, `site`, `surface`, `outcome`, `duration_bucket`, `target_type`, `from`, `block`, `workstation`（可選再加 `from_model`, `to_model`）
     - `launch_source` 與 `site` **要登記兩次**：GA4 的 event-scoped 與 user-scoped custom dimension 是兩份獨立清單，同名參數在兩個 scope 各要一筆。顯示名稱請標明 scope（例如「launch_source (event)」/「launch_source (user)」），否則報表裡兩者長得一模一樣。
   - user-scoped（十個）：`launch_source`, `site`, `audience`, `auth_kind`, `app_version`, `auto_summary`, `locale`, `key_mode`, `workstation`, `browser_id`
     - `workstation` 同樣要 event-scoped 與 user-scoped 各登記一次（同 `launch_source` / `site` 的處理）。
2. **登記 custom metrics（自訂指標，event-scoped，2026-09-04 追加）**：`resource_count`, `obs_count`, `med_count`, `doc_count`, `encounter_count`, `report_count`, `fed_resource_count`, `fed_obs_count`, `fed_med_count`, `fed_doc_count`, `fed_encounter_count`, `fed_report_count`, `context_tokens`（共 13 個）
   - **參數名稱不受 `patient_loaded` 取消影響**：`resource_count` 那六個原本就是以參數名（而非事件名）登記，改成掛在 `ai_result` 上之後**名稱與 scope 完全不變，GA4 後台不需要任何調整**。event-scoped custom metric 是跨事件共用的一份清單，登記一次即涵蓋所有帶該參數的事件。
   - 這十三個必須登記成 **METRIC（指標／自訂數值），不是 DIMENSION**。GA4 的 dimension 每個報表有基數上限，超過就把尾巴全部收進 `(other)`；而這些是精確計數，一個院區跑幾天就會產生上千個相異值，登成 dimension 等於報表一開就崩成 `(other)`，數字直接作廢。登成 metric 則 GA4 只做加總／平均，不做分群，基數完全不是問題。
   - 計量單位選「標準」（standard，無單位計數）。`context_tokens` 同理，它是 token 數不是時間或貨幣。
   - 想看**分佈**（幾成的病歷 <500 筆 / 500–5,000 / >5,000）就在 Explore 的自由格式報表用「數值分組（bucket）」，或直接在 BigQuery 匯出上 `CASE WHEN`。分桶留到判讀時再做的好處是分界可以照真實資料調，不必在部署前先猜死；也因此原始事件刻意送精確值。
   - GA4 event-scoped custom metric 上限 50，目前用 13，餘裕仍充足。
3. 資料保留期 2 個月 → 14 個月。
4. 可選：BigQuery Links 開免費每日匯出。

## 5. 已決定的取捨

| 項目 | 決定 | 理由 |
|---|---|---|
| view vs click | view + `trigger` 參數 | 預設頁不低估；想看純點擊篩 `trigger=user` |
| 資料量**什麼時候**記 | **只在 AI 被使用時記**（掛在 `ai_result` 上），擁有者 2026-09-04 明確決定；原先規劃的獨立 `patient_loaded` 事件**取消** | 這些數字唯一的用途是替 AI 的成敗與延遲提供對照基準（「timeout 發生在多大的病歷上」）。附在 `ai_result` 上就完整達成這個目的，而獨立事件會讓**每一次開啟病人**都留下一筆資料量紀錄——涵蓋範圍大得多，換來的資訊卻是同一個問題答不到的部分。代價是看不到「開了但沒用 AI」的病歷分佈；擁有者判定那不值得為它擴大記錄範圍 |
| 資料量用精確值還是分桶（六個計數 + `context_tokens`） | **精確值**，擁有者 2026-09-04 明確決定 | 這些數字**會隨時間漂移**——同一位病人每回診都多幾筆，同一台診間電腦每天看到的分佈也在動——所以它不是任何人身上的穩定屬性，不具備指紋該有的「穩定＋唯一」兩個條件；而分桶要有意義就得先知道真實分佈長怎樣，部署前先猜死分界只會逼著日後改 schema、還讓新舊資料接不起來。精確送、Explore／BigQuery 端再分桶，是先取得資訊再決定怎麼看。代價是接受這些欄位在單筆事件上比分桶更細；接受的前提是它們只有總數、沒有任何 id／時間／內容，也不與 uid 或病人關聯（`browser_id` 之外本規劃不做任何跨 session 串接） |
| 自動 page_view | 關 | URL 帶 `iss` / `code` |
| 民眾端 | 記，`audience=patient`，不做開關只寫文件 | 無識別子、IP 匿名化 |
| 摘要 / 安全掃描 / 報告解讀 | 不記 | 多為自動或一鍵觸發，行為訊號弱 |
| 計算機細項 / 計算機複製 | 不記 | 使用者決定 |
| `browser_id`（持續性裝置識別子） | 記 | 這是本規劃裡唯一會「跨 session 認得同一個瀏覽器」的值，所以獨立列出：沒有它就答不出「幾台機器在用」（GA session 無法跨天串、`workstation` 只有 launcher 路徑有）。接受的理由是它識別**瀏覽器設定檔不是人**、內容是隨機數而非任何推導值、不與 uid／帳號／病人資料關聯、使用者清除網站資料即重置。 |

## 6. 上線前必驗

1. **院內連線：✅ 已驗證（2026-09-03，北榮院內 Chrome）**。`googletagmanager.com/gtag/js` 載得到；`www.google-analytics.com` 與 `region1.google-analytics.com` 的 `/g/collect` POST 均 OK。方案 A 確定可用，不需 Firestore adapter。
2. 本機：hostname 白名單暫加 localhost + `debug_mode: true` → GA4 DebugView 即時看事件與參數。
3. 部署 github.io 後：Realtime 30 秒內看到 `view_open`；標準報表等 24–48 小時。

## 7. 已知低估

ad blocker 會擋 GA，醫師個人電腦裝的比例不低，絕對數低估 10–30%。看相對分布（哪個 tab 多）不受影響。

## 8. 順序

1. GA4 登記 custom dimensions
2. ~~院內連線驗證~~ 已完成
3. 實作 §3
4. DebugView 驗 → 部署 → Realtime 驗
5. 一週後看第一批數字

---

## 11. Audit：還沒記、但能更了解使用情境／偏好／習慣的訊號（2026-09-04）

已有：10 事件 + 8 使用者屬性（P1 三項已於 2026-09-04 落地）。GA4 免費自帶：裝置類別、瀏覽器、國家、新／回訪、session 長度、engagement、星期／時段、瀏覽器語言。
以下依「回答什麼問題」分組，每項標價值與成本；**建議先做 P1 三項**，其餘等第一批數字出來再決定。

### P1 — 現在最缺、且便宜

| # | 訊號 | 回答的問題 | 做法 | 成本 |
|---|---|---|---|---|
| 1 ✅ **已實作（2026-09-04，見 §2.7）** | `ai_result { surface, outcome, model_id, duration_bucket }` | 各模型在各院的**真實失敗率與延遲**；「AI 卡住」到底多常發生、發生在誰身上 | 掛在 `run-generation-job.ts` 的完成／錯誤分支一處，所有 AI slot 共用；duration 分桶（<5s / 5–15 / 15–45 / >45）不送原值 | 1 掛點 |
| 2 ✅ **已實作（2026-09-04，見 §2.8）** | `source_nav { from, target_type }` | 醫師**會不會去驗證 AI 引用**（點引用跳到原始資料） | `resource-navigation.store.ts` 的 `navigate()` 一處；`target_type` = FHIR resourceType 字串（非 PHI） | 1 掛點 |
| 3 ✅ **已實作（2026-09-04，見 §2.11）** | 使用者屬性 `auto_summary: on\|off`、`locale: zh-TW\|en`、`key_mode: proxy\|own` | 三個最重要的**偏好**：要不要自動摘要、介面語言（與瀏覽器語言不同）、是否自帶金鑰（power user 指標） | 分別從 `medical-summary-prefs.store`、`useLanguage`、`useApiKey/useGeminiKey` 設；同 `audience` 的模式 | 3 個 effect |

### P2 — 有價值，但先看 P1 數字再決定

| # | 訊號 | 回答的問題 | 備註 |
|---|---|---|---|
| 4 | `chat_send` 加 `reply_to: boolean`、`template_used: boolean` | 「引用回覆」和「斜線模板」兩個特色功能有沒有人用 | 送出當下都知道，各 1 行；`voice` 因為轉成文字後送出無法分辨，另需 `voice_record` 事件 |
| 5 | `data_preset { preset_id, consumer: summary\|chat }` | 資料選擇三個 preset 哪個被用；有沒有人改預設 | 掛在 preset 套用處；只送 preset id 不送 filter 內容 |
| 6 | `ips_export { action: copy\|download\|pdf }` | `複製` tab 除了 EMR 三顆按鈕，IPS 匯出本體有沒有人用 | `IpsExportPreview.tsx:166/283` 的 `requestAction` |
| 7 | `import_bundle { format: json\|txt\|claim\|roche }` | 匯入來源的組成（`launch_source=import` 只知道有匯入，不知道哪種） | 匯入成功後 1 行 |
| 8 | `chat_history_open` | 有沒有人回頭看舊對話（習慣） | 1 掛點 |
| 9 | `safety_alert_expand { severity }` | 安全警示**有沒有被讀**（安全網不該用點擊判生死，但「從來沒人展開」還是要知道） | 展開處 1 行；只送 severity |
| 10 | `custom_module_save { action: create\|edit\|delete }` + 使用者屬性 `custom_module_count`（分桶 0/1–2/3+） | 自訂模組是少數人的重度工具還是沒人用 | manager 儲存處 |
| 11 | `view_open` 加 `area: 'expand'`（報告全螢幕、聊天展開） | 版面偏好：誰需要大畫面 | 兩顆按鈕各 1 行 |

### P3 — 可以做，但建議先不要（噪音或另有更好來源）

| 訊號 | 不做的理由 |
|---|---|
| 每個 tab 的停留時間（`view_close` + duration） | 用 BigQuery 匯出後從相鄰 `view_open` 的時間差算即可，不用多送事件；GA4 免費匯出一鍵開 |
| 報告搜尋框輸入內容 | 內容可能含檢驗名稱以外的東西，只記「用了搜尋」的次數（`report_search`）就好，值不送 |
| 每個計算機、時間軸分組 | 使用者已決定不記 |
| 滑鼠軌跡／捲動深度 | 醫療場景不需要，且成本高 |
| Firebase uid 對應 | 明確不做；要看「同一個人」的行為用 GA 自己的匿名 client_id 即可 |

### 判讀提醒

- **P1-1 是唯一一個「監控」而非「使用」的事件**，它回答的是可靠性問題，對北榮 tvghbrain 路徑尤其重要（過去「複雜病人摘要必敗」的問題目前沒有任何正式環境的數字）。
- 使用者屬性上限 25、事件參數維度上限 50；P1+P2 全做完約 20 個事件維度、8 個使用者屬性，還有餘裕。
- 每加一個事件都要同步：adapter 白名單、GA4 登記、SECURITY.md 表格。
