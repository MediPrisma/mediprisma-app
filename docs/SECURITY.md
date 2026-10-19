# 安全性指南 / Security Guide

> 現行規格｜基準版本：v0.43.0｜最後核對：2026-07-22

本文件描述 app repo 已實作的控制與仍需由部署端承擔的責任。MediPrisma 是研究／教學用途軟體；本 repo 沒有宣稱已取得 HIPAA、GDPR、臺灣醫療器材或資安認證。

## 保護目標

- 病人 FHIR 原始資料不以明文長期留在共用工作站。
- SMART token、user API key 與完整 Bundle 不交給 AI 模型。
- AI 請求只帶完成當次功能所需的資料，並降低可識別資訊。
- 使用者、病人與 FHIR server 的雲端資料互相隔離。
- 生成內容可追溯來源，無來源或無法驗證時明確標示。
- Static host、Node host 與外部 Firebase Functions 的責任不混淆。

## 已實作控制

### SMART on FHIR

- Public client + OAuth 2.0 authorization code + S256 PKCE。
- 不接受 client secret；`NEXT_PUBLIC_SMART_CLIENT_ID` 是公開識別碼。
- EHR launch 與 standalone launch 使用不同 launch scope。
- 有有效 SMART token 時優先於舊 local bundle。
- 分頁搜尋超過 50 頁會明確失敗，不回傳靜默截斷的成功資料。

### 本地 Bundle

- Bundle 與 binary images 以 WebCrypto AES-GCM 加密後存 IndexedDB。
- 每個 tab 產生 256-bit session key，只放在 `sessionStorage`。
- 紀錄最多保留 12 小時；過期、無 key、解密失敗、清除資料或登出時刪除。
- WebCrypto／storage 不可用時不降級成明文 persistence，只保留當次記憶體能力。
- 舊版明文資料讀取後會嘗試原地加密 migration；加密不可用則不再持久保存。

### AI-derived cache

- Medical Summary、Safety、Report Interpretation 等衍生結果使用與 Bundle 相同的 session key envelope。
- 小型密文存在 localStorage，但新 tab 沒有 key，無法解密並會清除。
- cache 有 12 小時上限，並以病人、資料、prompt、model／audience 等 identity 隔離。
- 使用者清除本地資料時一併 purge `mediprisma:ai-result:*`。

### API keys

- OpenAI、Gemini、Claude、Perplexity key 在寫入 storage 前加密。
- 一般雲端 provider key 預設使用 `sessionStorage`，關閉視窗後消失；只有明確開啟「記住此裝置」才改為 localStorage。
- key 做 trim 與 header-safe 驗證，避免錯誤內容進入 Authorization header。
- 一般 provider user key 只在 direct-provider path 使用；owner-funded proxy interceptor 會先移除 provider credential header。
- 自訂 OpenAI-compatible connections 使用獨立的 localStorage v2 envelope；最多 10 個 profile，每把 key 分別以 browser-side encryption 加密，endpoint／model metadata 與密文原子保存。direct 模式只送往該 profile 的 endpoint；明確選擇 Firebase Gateway 時則以獨立 header 暫時經過 Firebase 後轉送。

### 自訂 OpenAI-compatible endpoint

- 接受 HTTPS hostname、IPv4／IPv6、port 與同源 `/ai/v1`；HTTP 僅允許 loopback 開發環境。
- 設定畫面接受完整 `/chat/completions` 或舊版 Base URL，兩者都先正規化成 canonical Base；仍拒絕 URL userinfo、query、fragment 與非 HTTP(S) scheme。
- direct 連線測試完全在 browser 執行；不會自動 fallback 到 Firebase。
- Agent 能力測試送出與正式自訂 Agent 相同的完整 FHIR tool schemas，但資料來源綁定為空，並將強制呼叫的 `getDataOverview` 執行函式替換成只回傳隨機 nonce 的記憶體內版本；它不讀取病歷、不呼叫 FHIR server。測試會驗證串流 tool call、local execute、tool result 與第二輪文字；`auto` 僅在完整往返成功後啟用深入對話，無法判定時 fail closed 為標準對話。端點、模型、transport 或 key 改變會清除既有驗證。唯一例外是受控 Medcloud 啟動在 `site=vghtpe` 路徑建立的 runtime-only TVGHBRAIN 3.5 profile：該路徑才允許加密 VGH credential，程式以不持久化的 site launch context 直接啟用 Agent，且仍保留 `agentCapability=unknown`，不偽裝成 probe 結果。沒有 `site=vghtpe` 的 `medcloud2=auto` context 必須不含 VGH credential；若夾帶即拒絕，正常流程只使用一般預設模型且不呼叫北榮 endpoint。
- Firebase Gateway 是 explicit opt-in；目前對使用者公開支援 NVIDIA、OpenRouter、Cerebras，只接受部署白名單中的公開 HTTPS Base URL、固定 `models`／`chat/completions` path 與對應 method；拒絕 IP、非 443 port、redirect、URL credentials、query 與 fragment，避免形成 SSRF／通用轉送器。
- Gateway 的 `Authorization` 專供 Firebase ID token；使用者 provider key 以 `X-Upstream-API-Key` 在單次 request memory 中轉送，不寫入 Firestore 或 logs。Gateway Function 明確使用 `secrets: []`，無法取得 owner-funded provider keys。
- 每個自訂 profile 有穩定 logical model id（舊 profile 保留 `openai-compatible-custom`，新增 profile 使用帶 profile id 的 dynamic id）；transport／endpoint／model fingerprint 納入 AI cache identity。
- 自訂 endpoint unavailable 時 fail closed，不 fallback 到 owner proxy。
- 自訂 profile 被修改、停用、刪除或畫面卸載時，進行中的文字／語音請求會中止；後續與排隊請求在送出前重新解析 live profile，不沿用舊 endpoint 或 key。
- 對話跨自訂 endpoint 身分邊界（自訂 profile 之間、或自訂↔雲端）切換時會先中止並清空目前對話與 session pointer，避免舊端點的訊息或 FHIR tool result 被送往另一個端點，亦避免切回雲端後將混合來源對話寫入 Firestore。雲端模型之間切換屬同一信任域，保留對話（訊息逐則標記產生它的 modelId），進行中的串流由原模型完成。
- 自訂模型停用 Firestore chat auto-save／smart title、移除 Perplexity tool；通過驗證的深入對話只暴露 browser-bound FHIR tools。direct 模式可使用相同 endpoint 的語音功能，Firebase Gateway 目前只支援模型清單與文字 Chat Completions。

瀏覽器端加密無法防禦已執行在同一 origin 的惡意 JavaScript／XSS；它主要降低 storage 被直接讀取或共用工作站殘留的風險。

### Owner-funded AI proxy

- Proxy request 需要 Firebase ID token；匿名 session 與登入 session 都可依後端 quota 使用。
- 有設定時加入 Firebase App Check token。
- `NEXT_PUBLIC_PROXY_KEY`／`x-proxy-key` 位於公開前端，不能當真正身分驗證；後端必須驗 ID token、App Check、quota、allowed model 與 CORS。
- Upstream provider keys 只存在後端 secrets。
- 另有使用者自備 key 的 Firebase Gateway；它與 owner-funded proxy 分離、強制 App Check、Firebase Auth、per-uid quota 與 upstream allowlist，且 UI 必須明示資料會經過 Firebase。

### PII minimization

- FHIR tools 不回傳 patient name、id、完整 birth date 或 provider display。
- Tool payload 的每個字串會再做 patient literal／常見識別格式 scrub。
- User message 在 UI／history 保留原文，但傳給 AI 的副本先遮罩已知病人識別文字。
- 回饋表單不收 patientId 或完整 FHIR URL；附圖在瀏覽器重編碼以移除中繼資料，且不額外設置警示或遮蔽確認勾選。
- Chat history 不儲存上傳圖片。

這些是 best-effort minimization，不是正式匿名化。病摘、影像文字或使用者自由輸入仍可能含未辨識的 PHI。

### HTML 與輸出

- Markdown rendering 經 DOMPurify sanitization。
- Feedback email 對所有 attacker-controlled 欄位做 HTML escape，badge class 使用 allowlist。
- Structured Medical Summary 以 Zod 驗證固定 schema；來源 key 由 app 建立，日期／機構／resource type 由 app 端回填。
- Unknown citation 顯示未驗證，不應被 UI 靜默包裝成可信來源。

### Feedback endpoint

內建 `/api/feedback`：

- 檢查 Origin／same-host。
- 每個 server instance 對來源 IP 做每小時 5 次的記憶體 rate limit。
- 驗證必要欄位、allowlist 類型與長度。
- 附圖限制三張、解碼後合計 8 MB，並驗證 canonical base64、MIME allowlist 與實際檔頭；附件不寫入 app storage 或 database。
- 對 caller 回傳 generic 500，詳細錯誤只留 server log。
- 收件人與寄件人由 `FEEDBACK_TO_EMAIL`、`FEEDBACK_FROM_EMAIL` 設定，不硬編個人信箱。

限制：instance-local rate limit 不是分散式強制，也沒有登入驗證。正式 static deployment 使用外部 Firebase Function，在後端驗 Firebase ID token／App Check，並以雜湊 uid 做集中式 rate limiting，避免院內共用 IP 互相影響。

### Browser security headers

`next.config.ts` 在 Node host 提供：

- `Content-Security-Policy: frame-ancestors ...`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(self), geolocation=()`
- legacy `X-XSS-Protection`

`X-Frame-Options` 刻意不用，因 app 需由 allowlisted HIS／Bridge iframe 嵌入；frame policy 由 CSP `frame-ancestors` 管理。

GitHub Pages 不會執行 Next `headers()`，因此上述 header 不會由 static export 自動送出。若 production 必須強制 CSP，需在 CDN／reverse proxy 層設定或改用可控 header 的 host。

### Quality controls

- ESLint boundary rules 阻止主要跨層依賴回歸。
- GitHub Actions 執行 typecheck、lint、Jest 與 static build。
- CodeQL 在 push、PR 與每週排程分析 JavaScript／TypeScript。
- Dependabot 監控 npm／Actions dependency。
- Playwright 以合成資料測 client flows，另有 Firebase emulator chain。

## 部署端責任

### Firebase

本節適用於正式 Firebase 部署。

- 部署並版本控制 Auth policy、Firestore Rules、indexes、Functions CORS、quota 與 App Check enforcement。
- 確認 Firebase Authorized Domains，repo 的 daily auth-domain guard 只做 drift detection。
- 對 `users/{uid}` collection 強制 uid ownership。
- 對 `sharedPrompts` 強制 author ownership、schema、長度與安全欄位。
- 設定 data retention、刪除流程、audit log 與 incident response。

### Secrets 與環境變數

- 所有 `NEXT_PUBLIC_*` 都會進瀏覽器 bundle，不可放 server secret。
- `RESEND_API_KEY`、AI provider proxy keys、service credentials 只能放 server／Functions secret store。
- 輪替曾暴露或疑似外洩的 key，不以刪除 Git history 當成輪替替代品。
- Production 與 dev proxy URL／CORS 應分離。
- `NEXT_PUBLIC_*` 是公開 browser configuration，不可放真正 secret。

### 組織政策

- 在傳送真實病人資料給第三方 AI 前完成法務、資安、DPA／BAA、資料地區與保留政策審查。
- 共用工作站仍應有 OS 帳號、螢幕鎖定、瀏覽器 profile 與 session timeout。
- 將 AI 輸出定位為 decision support，要求臨床人員回查來源與確認。
- 建立資料主體請求、匯出、刪除與 breach notification 程序。

## 使用統計 (usage analytics)

App 以 Firebase Analytics / GA4 記錄極小量的介面使用統計，用來知道哪些功能真的被用。唯一接觸 SDK 的檔案是 `src/infrastructure/telemetry/usage-analytics.ts`，事件名稱、參數 key、列舉值與型別（字串 ≤ 64 字元／數字／boolean）都走白名單，不符合就整筆丟棄。

**收集的事件（十個）**

| 事件 | 參數 |
|---|---|
| `view_open` | `area`（left / right / reports / cumulative / meds / summary）、`id`（該層的頁面 id）、`trigger`（user / auto） |
| `chat_send` | `source`（typed / chip）、`has_image`、`model_id`、`agent_mode` |
| `handoff_copy` | `mode`（labs / reports / all） |
| `tour_start` | `tour`（導覽 id，如 getting-started / labs-reports / custom-summary；完整清單見 `ANALYTICS_TOURS`） |
| `tour_end` | `tour`、`tour_outcome`（finish / abandon）、`step`（導覽關閉時的步驟 id） |
| `report_interpret` | `host`（report-row / document-card / document-dialog）、`action`（open / regenerate） |
| `app_launch` | `launch_source`（medcloud2 / smart / demo / import / none）、`site`（vghtpe / unknown）、`workstation`（診間／工作站代碼），每次開啟一次 |
| `ai_result` | `surface`（哪個 AI 功能）、`outcome`（ok / error / timeout / aborted / context_overflow / quota / parse_failed）、`model_id`、`duration_bucket`（<5s / 5-15 / 15-45 / >45，**不送原始耗時**），以及下述選填的資料量數字 |
| `source_nav` | `target_type`（FHIR resourceType 字串）、`from`（summary / safety / chat / unknown） |
| `summary_copy` | `block`（hero / custom_module） |

**`ai_result` 上的資料量數字（十三個選填欄位）**：`context_tokens`（送出的臨床脈絡 token 估算）、`resource_count` / `obs_count` / `med_count` / `doc_count` / `encounter_count` / `report_count`（目前載入的病歷有幾筆資源）、`fed_resource_count` / `fed_obs_count` / `fed_med_count` / `fed_doc_count` / `fed_encounter_count` / `fed_report_count`（經資料選擇與 context 縮減後，**實際送進模型**的那份 context 有幾筆資源）。

這些數字**只在 AI 真的被呼叫時記錄**（擁有者 2026-09-04 決定），單純開啟或瀏覽病歷不會產生任何資料量紀錄。用途是替 AI 的成敗與延遲提供對照基準——沒有它們就答不出「AI 失敗是不是發生在特別大的病歷上、修剪之後是否仍然失敗」。

兩組筆數走**同一份資源類別清單**，所以 `resource_count − fed_resource_count` 就是「被資料選擇與 context 縮減丟掉的筆數」，可以直接相減；該清單不含 `vitalSigns`（會與 observations 重複計）與 `medicationRemainingSummaries`（app 自己算的餘藥檢視，不是病人資料，也從不進 prompt）。

全部十三個都是**總數與大小，不是識別子**：不含也無法推得任何 resource id、姓名、病歷號、日期、診斷／檢驗代碼、數值或文字；`fed_*` 同樣只是筆數，不透露被選中的是哪些資源。一個計數無法反推回病歷內容，也不與 Firebase uid 或任何帳號關聯。測不到就整個省略該欄位，不送 0。計數送精確值而非分桶（同一決定）：筆數會隨每次就診增加，是會漂移的量而非穩定屬性，分桶留到報表端再做。

**收集的使用者屬性（十個）**：`launch_source`、`site`、`audience`、`auth_kind`、`app_version`、`auto_summary`（摘要是否自動產生）、`locale`（介面語言）、`key_mode`（自帶金鑰或用內建 proxy）、`workstation`（診間／工作站代碼）、`browser_id`（每個瀏覽器一組隨機值）。

`workstation` 只來自啟動網址的 `?ws=` 參數，由院內 launcher（medcloud2 extension）自行填入，**不是**從瀏覽器、裝置指紋或任何本機環境推導出來的。它識別的是**一台機器或一間診間，不是一個人**：格式限制為 `/^[A-Za-z0-9_-]{1,32}$/`，刻意排除 `@`、`.` 與空白，讓帳號、e-mail 或人名這類值無法通過；格式不符時整個啟動網址會被判為無效（fail-closed），不會被默默接受。

`browser_id` 是一組 32 字元的隨機十六進位值，第一次使用時由前端產生並存在該瀏覽器的 localStorage，用來估算「有多少台機器／瀏覽器在使用」。它**不綁定任何帳號、Firebase uid、使用者或病人**，也不是從裝置特徵推導出來的指紋——就是一個隨機數字。使用者清除網站資料（或用無痕視窗）即會重置為新值。

**明確不收集**：任何病人資料或 FHIR 內容（姓名、病歷號、檢驗值、報告文字、翻譯與解讀結果、reportId、被引用資源的 id 與標題）、AI 呼叫的原始耗時、AI prompt 與回覆內容、複製到剪貼簿的文字、Firebase uid（從不呼叫 `setUserId`）、完整 URL 或任何 query 參數（SMART `iss`、OAuth `code` 都在 URL 上）。

**執行範圍**：只在 `mediprisma.tw` 與 `voho0000.github.io` 兩個正式 hostname 上啟用；localhost、E2E、Firebase emulator、SSR 一律 no-op。自動 `page_view` 關閉、Google Signals 關閉、廣告個人化關閉（`send_page_view` / `allow_google_signals` / `allow_ad_personalization_signals` 皆為 `false`）。SDK 於 idle 時才動態載入，載入前的事件排隊（上限 50 筆），任何錯誤都靜默丟棄，不影響臨床流程。

## 已知限制與剩餘風險

- Client-side app 無法抵抗同 origin XSS、惡意 extension、已被控制的裝置或使用者主動外洩。
- PII scrub 可能漏掉自由文字中的非典型姓名、院內編號或影像 burned-in annotation。
- Firestore chat history 可能包含 PHI，內容目前不是 app-level end-to-end encryption。
- Anonymous Firebase token 降低裸 API 濫用，但攻擊者仍可能自動建立 session；需 App Check、quota 與 rate limit 配合。
- Static GitHub Pages 無自訂 response headers 與 server API route。
- Source key 存在只證明引用可定位，不自動證明每一個自然語言 claim 完全由該來源支持。
- 第三方 AI、Firebase、Resend、GitHub Pages 各有自己的處理條款與 availability。

## 發布前檢查

- [ ] `npm audit` 與 CodeQL findings 已檢視；風險有 owner／期限。
- [ ] `npx tsc --noEmit`、`npm run lint`、Jest、E2E、build 通過。
- [ ] `npm run build` 與 `npm run build:gh` 都通過。
- [ ] Firebase Rules／indexes／Functions 與 app 版本相容。
- [ ] Authorized domains、CORS、App Check、quota、allowed models 已驗證。
- [ ] Production `NEXT_PUBLIC_FEEDBACK_URL` 指向真正可用的外部 endpoint。
- [ ] CDN／host 的 CSP、HSTS、referrer、permissions headers 實際回應已檢查。
- [ ] Demo Bundle 保持去識別化，未將 `.env.local`、真實 Bundle、trace、screenshots 加入 Git。
- [ ] 隱私政策與 UI consent 反映實際啟用的 providers 與資料流。

## 發現問題

不要在公開 issue 放病人資料、token、key 或完整 request body。一般問題可用 GitHub Security Advisories／私密管道或聯絡 <voho0000@gmail.com>。

## 相關文件

- [TVGH Collector 試行與資料契約](COLLECTOR-PILOT.md)：vghtpe-only 自動背景紀錄，沿用 Firebase session 驗證；包含經授權的瀏覽器 ID、來源 IP、UID/email 與管理員診間對照，皆加密保存。固定欄位／精確資源筆數／token 估計區間及失敗隔離，不複製完整 AI diagnostics、不保存 raw token；不宣稱匿名化。

- [Privacy Policy](../PRIVACY_POLICY.md)
- [Architecture](ARCHITECTURE.md)
- [AI Agent](AI_AGENT_IMPLEMENTATION.md)
- [Feedback setup](FEEDBACK_SETUP.md)
