# TVGH 旁路紀錄試行

## 發布相容性檢查（2026-10-07，尚未啟用）

master CI 及正式 /app 自動／手動同步共用 collector-compatibility.yml：真正 sender 經隨機 loopback HTTP 傳給真正 Gateway，僅合成資料／臨時加密 DB。Gateway checkout 預設 main，可用 COLLECTOR_GATEWAY_COMPAT_REVISION 指定已審核 SHA；CI 記錄實際 SHA。不繼承發布金鑰、不改 HMC 發布鏈。先合併 Gateway v6，否則這個檢查應拒絕新版 sender 發布。

此 CI 不等於 VM 驗收。院內部署後仍須執行 Gateway scripts/check-collector-readiness.mjs 的 HTTPS /health v6 預檢，並确认 DNS／工作站連線。GitHub runner 無法連私有 VM，尚未自動串接實機 readiness；沒有偷偷停用 sender 或影響臨床功能。

Gateway repo 已確認是 private；合併前在本 APP repo 設定 COLLECTOR_GATEWAY_READ_TOKEN secret：fine-grained PAT 僅選 MediPrisma/tvgh-mediprisma-gateway，Contents=Read，Metadata 隱含。不要貼在 chat，不使用 owner token；workflow 只傳此 named secret、不 inherit 發布金鑰。未建立 secret，fork PR 沒有 secret 時不可繞過 gate／改 pull_request_target。

## 2026-10-07：一次操作一筆，內嵌 AI 請求明細（未發布）

Gateway canonical wire contract 產生本 repo 的 src/shared/contracts/collector-event.ts；不要手改 copy。兩端 checksum test 與 Gateway scripts/sync-collector-contract.mjs --check --app <checkout> 檢查漂移。這不是依賴 live Gateway 的建置，也沒有新增 private package／第三個 repo。

Feature sender 使用 v6，operation capability 以 CollectorContext 傳到 query/stream。共同 slot engine 的 scoped AI wrapper 收集摘要／安全功能及其應用層重試；報告解讀與 NHI lipid 明確傳 capability，不依 operationKey、病人資訊、時間或模型猜測配對。Feature 一筆包含其觀察到的 request 明細，不另外送子事件；無父操作的 query/stream／語音／文獻仍獨立 v5。直接 agent/provider 內部呼叫並未全面 instrument；requests 省略表示未觀察，不是零次呼叫。

最多64筆，保留開始順序、失敗與重試、精確 omitted count；未觀察終態標 incomplete，不偽造成功。Feature 最終 parse/validation status 與 transport 成功分開。無 prompt、response、raw errors、新身分欄位或臨床結果/cache 改動；site=vghtpe／既有權限／auth／旁路可用性不變。

先部署 Gateway v6 reader，再發布 APP。舊 v1-v5 rows 保留，不回填或猜合併；rollback sender 時保留 v6 reader和原 DB/key。沒有更改正式 collector URL、VM、DNS、retention、AI endpoints、HMC發布流程或 pilot/hmc。此分支尚未發布，現有線上網站仍是舊行為。

Visible behaviour changes: none（臨床 APP）。

初始紀錄（2026-09-22）：先 pull 最新 origin/master `338a5d70`，於 `codex/vghtpe-collector-telemetry` 修改。當時使用者授權跨 repo sender 與 Gateway 契約擴充，尚未發布網站或啟用真實紀錄。以下保留各階段的驗證範圍；最新狀態以日期較新的段落為準。

## 2026-09-23：已授權才送、不觸發區域網路詢問（本次修改，尚未發布）

使用者授權先修改 sender，避免院內使用者的正常操作觸發瀏覽器 Local Network Access 詢問。修改前已在隔離分支 pull 最新 master `fc7970e509ac`；原工作目錄的 CDSS 變更與 `pilot/hmc` 不在範圍內。本次不修改正式站、Collector 設定、port、保存期限或院方瀏覽器政策。

- 每次送件前僅使用 `navigator.permissions.query()` 讀取既有權限，只有 `granted` 才可 fetch；`prompt`、`denied`、API 缺失／不支援／查詢失敗都靜默略過，不以 health probe、fetch、beacon 或其他傳輸方式要求授權。
- Chromium 145+ 依 endpoint 查詢 `local-network` 或 `loopback-network`；僅在新版 descriptor 不支援（TypeError）時查詢舊版 `local-network-access`。已回傳的拒絕／未決定不得用另一權限的允許覆蓋。參考 [Chrome 145 權限拆分說明](https://developer.chrome.com/release-notes/145#local-network-access-split-permissions)。不支援這些查詢的瀏覽器即使可能連通，也不送 Collector。
- 送件前再次讀取該 `PermissionStatus.state`，檢查等待 Firebase 憑證期間的權限撤回；原有 site、pagehide、並行上限與五秒截止仍生效。這是送件前檢查，不宣稱可與瀏覽器外部權限變更原子化。
- 權限略過增加 `dropped`，不當成 HTTP 失敗累積冷卻；權限日後變成允許時，下個新事件自動恢復，舊事件不補送、不新增手動啟用開關。`enabled` 仍僅表示 site 與 endpoint 有效，不表示已獲瀏覽器授權。
- AI、摘要、語音、搜尋不等待權限查詢或 Collector。此取捨是「未授權的電腦暫無紀錄」，不是全院完整收件保證。

先前正式版 `fc7970e509ac` 已使用 `https://collector.mediprisma.tw:8787`，2026-09-23 已核對兩個不同瀏覽器 ID 的跨工作站成功收件；其中一台 Chrome 的 uBlock 移除後才送達。這些是舊 sender 的連線證據，不能當作本次「不觸發詢問」修改的實機驗收。新程式須經審查、重建、發布後才生效，已開啟的舊頁面需重新載入。合併前後的正式狀態不得混為一談。

本次驗證：修改前先用新測試重現舊 sender 在權限不足時仍 fetch；修改後相關 **17 suites／193 tests** 與 **4 項 Chromium E2E** 通過。E2E 使用合成病例／Firebase／AI、模擬權限與攔截 Collector HTTP，覆蓋 prompt、denied、不支援時零收件請求、聊天成功、授權後新事件自動恢復，以及已授權但 Collector 離線的失敗隔離；不宣稱已在正式站或院內受管理 Chrome／Edge 驗收此修正。修改檔 ESLint、lockfile 檢查與正式 `/app` 模式的本機 build 通過；無依賴版本／lockfile 變更，未發布網站。

## 行為與啟用

AI、Whisper、文獻搜尋使用原本 endpoint、身份與額度流程；紀錄沒有 await 依賴、沒有失敗 toast、不會重叫模型。

使用者已要求自動傳送：當前 URL 恰有一個 `site=vghtpe` 就自動觀察，瀏覽器既有區域網路權限為允許時才背景傳送，不需手動啟用、不新增登入提示，也沒有八小時後手動重開的限制。觀察開始、完成、取得憑證前後與實際 fetch 前皆檢查 site。缺少、不同大小寫、其他站點或重複 site 參數都不送，也不做 discovery/health probe。site 是 client 標記，不是醫院身分認證。

判斷與 URL 路徑無關：`/app/?site=vghtpe`、`/app-hmc/?site=vghtpe` 都在瀏覽器已有權限時自動傳送。`/app-hmc/` 不代表 `site=hmc`；site 參數改成 `hmc`（或其他不符合值）即停止觀察，權限不足則略過送件。此處描述本次 sender 的規則，不代表已將變更發布至 app-hmc；未修改協作者的 `pilot/hmc` 分支。

筆電預設 endpoint 為 `http://127.0.0.1:8787/collector/v1/events`。其他主機由建置設定 `NEXT_PUBLIC_COLLECTOR_ORIGIN=https://<核准主機>:8787` 指定，只接受 origin，不接受帳密、path、query 或 fragment。HTTP 僅限 loopback，其他主機要求 HTTPS。不從 `gw=`、launch URL、localStorage 或任意 runtime endpoint 讀取收件位置。

既有 Firebase session（含匿名）提供憑證，直接送原 POST API；Gateway 驗證 project、簽章、issuer/audience 與有效期限。不新增 token 發放端點、不把共用 ingest secret 放進公開 build。原本的 SDK 負責 token 更新；Collector 不另存 token。觀察所捕捉帳號在送件前若已切換／登出，就丟棄該紀錄，避免誤記到另一帳號。沒有 Firebase session 時只漏記，不跳登入視窗。

只有唯讀的診斷介面，無 enable/disable 操作需求：

```js
window.mediprismaCollector.status()
```

每個 origin／瀏覽器設定檔自動產生 UUID，存於 localStorage 的 `mediprisma.collector.browser-id.v1`；不含病人或帳號資料、不跨裝置同步。儲存被封鎖時退回 page scope，清資料／更換瀏覽器會換 ID。不是硬體指紋，不保證一台電腦只有一個 ID。

上傳最多兩筆 in-flight，沒有等待佇列；滿載丟棄新紀錄。每筆權限查詢、取得憑證與 HTTP 合計五秒逾時；連續三次失敗冷卻六十秒，之後新事件自動恢復嘗試，401/403 不要求手動重開。已確定未授權／不支援的略過不累積失敗；權限查詢卡住仍受五秒截止與冷卻保護。無自動重送舊事件、磁碟補送或 unload beacon。pagehide 取消舊觀察；新頁自動開始。status 只回 enabled/in_flight/sent/dropped/cooling_down；enabled 表示站點與 endpoint 條件成立，不代表瀏覽器已授權、Firebase 或 Gateway 已連通。不可用、關頁、同時多個事件都可能漏記，不可當作完整帳務 audit。

## v5 資料契約

`src/shared/contracts/collector-event.ts` 與 Gateway `src/collector-event-v2.ts` 保持一致；route 仍為 `/collector/v1/events`，新 payload schema_version=5，保留 v4 的 browser_id/browser_id_scope 與精確 loaded/prepared 資源筆數，新增摘要卡片成功／失敗數。Gateway 保留 v1-v4 支援，SQLite table/envelope 不變。舊 flat rows 仍可讀，舊區間不換算成臆測的精確數字。部署時先更新 Collector 再更新 sender；舊 Collector 不接受 v5，但只影響紀錄，不影響臨床功能。

固定欄位：UUID、操作結束時間、site、feature/provider/model 白名單、model_source、sample_kind、耗時、結果、固定 error_class、response_complete、app_version、build_revision、diagnostics。所有物件拒絕未知欄位。

| 診斷 | 實際意義 |
|---|---|
| loaded / prepared | total、encounters、medications、observations、reports、documents 的精確筆數。未知省略，確定零筆才填數字 0 |
| 資源筆數 | 非負整數，例：就診 23、用藥 47。發送端不分桶、不四捨五入、不將負數取絕對值；無效測量省略，Gateway 拒收非整數／負數／字串。上限為 JavaScript 可精確表示的整數 9,007,199,254,740,991 |
| prepared_count_basis | structured_input_upper_bound；最後文字裁切可能減少實際送出筆數 |
| context_tokens_bucket | 0、1-2000、2001-8000、8001-32000、32001-128000、128000+；估計值，非帳務 usage |
| context_trimmed | 有實際裁切資訊才提供，其他省略 |
| phase / mode | 固定階段與執行方式代碼；未知階段不猜测 |
| first_chunk_ms | 第一個非空文字 callback 耗時，不是 provider 原生 TTFT |
| http_status | 明確取得 HTTP response 時才提供，網路錯誤不猜狀態碼 |
| summary_cards | 只在 summary feature 本次卡片處理結束時提供 succeeded/failed，均為 0..6 精確整數，合計 1..6。本次目標卡片經自動重試後各算一次；手動重試不把先前成功、沿用的卡片再算一次。取消／整個 run 提早拋錯時省略，不猜零 |

用藥是紀錄數，不是正在服用的藥物種類；就診是本次已載入 Encounter 數。自訂模型一律 custom，未知 upstream model 為 unknown，不傳 profile ID、名稱或 endpoint。app_version/revision 是編譯版本，未提交修改不會反映於 Git hash；發布前須提交重建。

v2 response_complete 可為 null（功能層未知）；true 只表示傳輸完成，解析/驗證仍可失敗，不代表臨床正確。

## 掛點與口徑

| 流程 | 觀察層級／可用數字 |
|---|---|
| 摘要（含安全／用藥卡片）、報告解讀 | runGenerationJob 功能終態：loaded/prepared 精確筆數、token 估計區間、裁切；另有 unified request |
| 聊天 | turn 的 feature 終態與第一段文字耗時；標準病人對話提供 counts，Agent／一般問題省略病歷數量 |
| 自訂摘要、IPS 推論、後續問題、範例生成 | useUnifiedAi request 終態與 stream 第一段文字耗時；缺少筆數不假造 |
| NHI 血脂 AI | query request + feature 驗證終態；不傳答案、日期、證據或 catalog |
| Whisper | request 終態與 HTTP status；不傳音訊、轉錄文、檔名或 key |
| Perplexity | request 終態與 HTTP status；不傳 query、內容、citations 或 key；後端決定模型，記 unreported/provider-managed |

feature 和 request 不可加總成使用次數。request 是應用層呼叫，SDK retry 與 Agent 內部多輪未逐筆計數，不能換算帳单。快取命中不製造新的 AI 呼叫事件。目前沒有跨事件 parent/child ID、retry/tool 次數、FHIR 載入失敗事件、模板版本或全階段 timing；不聲稱全流程 tracing。

v5 摘要 feature 只有本次目標卡片全部成功才 completed；部分／全部失敗都是 error，從 succeeded/failed 區分，例如 3/3 與 0/6。失敗原因全為解析失敗則 error_class=parse_failed／phase=parse；全為 timeout 則 timeout；混合原因為固定 error，不傳原始錯誤。取消／失效 run 仍優先 aborted。request completed 仍只表示傳輸成功，可與 feature parse_failed 並存。部分結果、錯誤提示、加密快取與重試保留，沒有因 telemetry 分類而丟棄臨床結果；不是臨床正確性評分。卡片數只送 Collector，不擴充既有 GA4 欄位（ai_result 的錯誤 outcome 同步更正）。

## 診間、電腦與使用者

使用者已授權新增識別資訊。Gateway 在收件時補入以下 `receipt`，前端不可以自填這些欄位：

| 欄位 | 來源與意義 |
|---|---|
| source_ip / source_ip_basis | socket peer IP／固定 socket_peer；IPv4-mapped IPv6 正規化。忽略 X-Forwarded-For 等自報 headers |
| auth_type / user_id / email | firebase 或相容工具的 ingest_token；Firebase UID/email 僅取驗證成功憑證。匿名 UID 的 email 為 null；ingest_token 兩者為 null |
| room / workstation / mapping_basis | 管理員對照表快照，browser_id 優先，其次來源 IP；未對應為 null/unmapped，不猜診間 |

UID 是網站 Firebase 帳號，不是 Windows 或院內員工帳號；已簽章 email claim 不代表另做 email 所有權驗證。Browser ID 是 client 自述，可被複製，不是設備認證。IP 經 NAT/代理可能只代表共用出口，DHCP 也可能換機；127.0.0.1／::1 不以 IP 配對診間。

依使用者最新決定，現在不尋找、不建立診間對照表，也不將其當作部署前提；先記 IP／瀏覽器 ID，room/workstation 保持未對應，日後有需要再對照。

預留能力：管理員可在 Gateway 的 `COLLECTOR_WORKSTATION_MAP_PATH` 設定 JSON 清單，每項包含 `room`、`workstation`，以及 `browser_id` 或 `ip`（可同時指定，兩者皆須相符）；重啟載入。範例見 Gateway `deploy/collector-workstations.example.json`。首次收件的歸屬固定，不因之後更新對照而改寫舊 log。

## 保護與部署

不傳病歷全文、病人 ID 或其 hash、就診日期、診斷碼、藥名、檢驗值、FHIR、raw error、URL 或完整 headers 副本。唯一新增認證傳輸為 Authorization 的 Firebase ID token，Gateway 不保存原 token。UID/email、IP 與設備對照按上述授權加密落地。Collector 不訂閱或複製現有完整 AI diagnostics store。既有 GA4 資料流不擴充。

counts 是病歷衍生的精確統計，搭配時間／設備／帳號可能交叉比對，不宣稱正式匿名化。Gateway AES-GCM 加密 payload；UUID/received_at 索引仍明文；沿用管理 Basic Auth。2026-09-23 使用者決定 Collector 紀錄暫不自動刪除（Gateway D-045：COLLECTOR_RETENTION_DAYS=0／Windows -RetentionDays 0），包含已授權的 UID/email/IP/browser ID；之後另行決定天數。這不是硬碟容量或資料永久不失保證，仍需持久金鑰與備份。由 0 改有限天數會刪除超齡資料，不能以回退名義自行變更。

正式網站、Gateway 正式排程與真實收件均未啟用。Gateway 需設定 `COLLECTOR_FIREBASE_PROJECT_ID`；本 repo Firebase project 為 `smart-on-fhir-ac97d`，部署時確認與網站一致。Gateway 定期向 Google 下載公鑰，不上傳紀錄；公鑰不可用且無有效快取時拒收，前端只漏記。院內 TLS/CORS/DNS、防火牆與瀏覽器私網權限須實機確認。跨電腦收件必須將網站的 NEXT_PUBLIC_COLLECTOR_ORIGIN 設成筆電／VM 的共用 HTTPS 位址；127.0.0.1 只會指向使用者自己的電腦。CSP 本次未放寬。

## PR #149 交付時規劃與正式 /app 驗收（歷史紀錄）

- 更新現有 MediPrisma PR #149 與 Gateway PR #2，不另開重複 PR；使用者自行審查／merge。本次不觸發正式部署，不改 pilot/hmc。
- 正式 /app 的建置 workflow 讀取 GitHub Actions variable `NEXT_PUBLIC_COLLECTOR_ORIGIN`（repository 或 `mediprisma-site-publish` environment）。這是公開 HTTPS origin，不得填 token／帳密／path。尚未設定真實值；空值保留既有 loopback fallback，不能當跨機設定完成。變更值後必須重建網站，現有靜態 bundle 不會即時更新。不新增前端開關或 API，也不改 workflow trigger、HMC publisher 或 pilot 分支。
- 先部署支援 v5 的 Collector，明確設定 retention=0、持久 DB/key、Firebase project、https://mediprisma.tw CORS 與院內來源網段；再設定共用 HTTPS origin，合併／建置 sender。未完成收件位址／憑證與網路設定時，merge 不等於跨機接通。
- 驗收使用正式 `https://mediprisma.tw/app`（沿用 `site=vghtpe`），不是其他預覽網址；所有符合 site 的使用者會自動嘗試，不只測試者。Chrome 的 [Local Network Access](https://developer.chrome.com/blog/local-network-access) 可能顯示權限提示，不是應用程式啟用開關。需測試允許／拒絕／未回應、Collector 正常／離線時的聊天、摘要、語音與搜尋，以及非 vghtpe 不送事件。localhost 證據不能代替這項驗收。
- 本次只提交 Collector 相關檔案。開發中的 CDSS 手動儲存／病歷內容上傳及其 stores、UI、契約、tests 均排除；原有 NHI lipid AI 的固定結果 metadata 掛點仍屬既有 Collector 範圍，不傳 CDSS 內容。
- 發布前保留上一版網站 commit／artifact。若新前端主功能異常，回退網站版本；停止 Collector 只能停止收件，不能撤回已載入的前端程式。保留原 DB/key 與 v5 reader，不刪紀錄。
- 2026-09-23 PR 交付複驗：pull 後以獨立 worktree 同步最新 master 4edcf8cd，只包含已提交的 Collector 變更。**24 suites／239 tests**、全 repo TypeScript、PR 修改程式檔 ESLint、lockfile／diff／新增行常見憑證格式檢查通過。正式 `npm run build:mediprisma`（/app 靜態輸出）通過，使用合成 HTTPS origin 確認設定確實編入 browser bundle；沒有發布產物。Gateway 同步 main 後 82/82、typecheck/build 再次通過。包含離線、5 秒逾時、有界並行、401/403、自動恢復與 site gate；不是全 repo Jest 或正式站跨機驗收，亦未消除下述既有 dependency audit findings。
- 計數更正：前次主工作區輸出的 36 suites／353 tests 含 `tmp/release-scope-perf` 內 12 組／114 項重複副本，不能當成 353 個獨立測項；本次以乾淨 worktree 的 24／239 為準。下方歷史工作區測試總數不代表排除副本後的獨立測項數；未刪除任何測試或變更 assertions。

## 驗證與回復

2026-09-23 v5 摘要修正：修改前兩個工作分支已 pull --ff-only。MediPrisma 32 suites／312 tests、TypeScript、修改檔 ESLint、production build、lockfile 通過；Gateway 全套 78/78、typecheck/build 與雙端契約一致性通過。涵蓋全敗／部分／全成功、timeout／混合原因、內部與手動重試、取消／失效優先、臨床結果／cache 保留與新舊契約加密重啟。

現場 Chrome 沿用真實 Firebase 登入及合成病例，localhost:3011/?site=vghtpe → 真實 localhost Collector → SQLite（非攔截 HTTP）。synthetic-local 刻意回非 JSON：3 筆 request completed、1 筆 summary feature error/parse_failed，succeeded=0、failed=6；四筆皆 201，重啟後仍可解密讀取。畫面保留原解析失敗提示與重試。驗證 UID/email/browser ID 有值，紀錄沒有病例姓名或測試 prompt/reply；未印出身分原值。這是錯誤分類回歸，不表示有效摘要品質已驗收；未呼叫外部 AI、未部署正式網站／排程或改 pilot/hmc，跨工作站 HTTPS／院內 VM 仍待驗證。此次 e2e spec 同步 v5，但本輪瀏覽器證據來自實際手動式 UI 自動操作與真實收件，不是該攔截式 spec。

2026-09-22 PR 前複驗：MediPrisma 14 suites／186 tests、TypeScript、全部修改的 TS/TSX/MJS 檔 ESLint、正式 build、lockfile 與契約一致性檢查通過；Chromium 合成瀏覽器測試 1/1 通過。新增 `/app-hmc/?site=vghtpe` 會傳送、保留 site 切換路徑不抑制觀察、其他 site 不傳送的回歸案例。維持 Firebase 驗證，不改成前端自述 UID/email。網段限制須在部署環境另外驗收，記錄 IP 不等於已設防火牆白名單。提交 PR 不代表正式部署。

2026-09-22 v4 精確筆數版：MediPrisma 9 suites／119 tests、Gateway collector/identity/auth 12 tests、Chromium 1/1、兩 repo 型別檢查與建置、修改檔案 lint、契約一致性與 diff whitespace 檢查通過。覆蓋全部六類 loaded/prepared 精確筆數、零／未知／無效值、儲存與重啟保持原值，以及 v3 歷史區間相容。尚未 commit/push/部署。

單元/整合驗證 site gate、自動啟用、途中導航/換帳號、精確筆數／零／未知／無效值、token 區間、內容排除、browser ID、最大併發、逾時、冷卻、pagehide，以及 Collector 離線仍能完成 query/stream/Whisper/搜尋。Gateway 驗證簽章認證、來源 IP／診間對照、加密、重啟、去重與拒收。瀏覽器 spec：`e2e/tests/collector-pilot.spec.ts`，使用合成 Firebase session/Bundle/AI 及攔截的 Collector HTTP，不代表院內實際 TLS 通過。

2026-09-22 自動收件版：MediPrisma 9 個相關 Jest suites／118 tests、TypeScript、修改檔案 ESLint、正式 build 與 lockfile 檢查通過；Gateway typecheck/build 與 collector/identity/auth 共 11 tests 通過。Chromium 瀏覽器測試 1/1 通過，全程沒有人工啟用，Collector 離線與將查詢參數切換成 `?site=hmc` 後聊天都能完成，後者不再送出事件；該案例不是切換至 `/app-hmc/` 路徑。Windows installer PowerShell parser 通過，兩 repo 契約一致。未執行整個 repo 的所有測試，也未發布網站或啟用正式收件。

Windows 的 `packages:ci` wrapper 另修正 `npm.cmd` spawn EINVAL，改由 Node 執行 npm CLI；沒有變更套件或 lockfile。安裝回報既有 11 個 dependency audit findings（6 low、1 moderate、4 high），本次沒有進行相依版本升級或宣稱消除這些風險。

回復可停止 Collector 或回復網站 sender，主要功能持續。保留原 DB/key 及新版 reader；舊 binary 無法讀新 envelope，勿刪除／重寫既有紀錄。新版可讀舊 flat v1/v2，舊事件不回填新增識別資料。

Visible behaviour changes: none（未隱藏或停用臨床畫面）。
