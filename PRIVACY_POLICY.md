# MediPrisma 隱私權政策

**生效／最後更新：2026-09-27**
**適用程式基準：v0.51.0**

本政策說明 MediPrisma 官方公開部署在目前 codebase 下如何處理資料。自行部署者會決定自己的 FHIR、AI、身分、郵件、logging、保留政策與法規角色，應發布自己的政策。本文件不能代替部署者的法律評估。

MediPrisma 為研究／教學用途，非醫療器材。本 repo 未宣稱已取得 HIPAA、GDPR、臺灣個資法或其他法規認證。

## 1. 資料來源與使用模式

您可以用三種方式載入臨床資料：

1. **SMART on FHIR**：從 EHR 啟動，經 OAuth 2.0 + PKCE 授權後由瀏覽器讀取目前病人的 FHIR 資源。
2. **本地匯入**：在瀏覽器選擇 FHIR Bundle JSON。
3. **示範資料**：載入 app 內建的去識別化 demo Bundle。

完整原始 Bundle 不會因載入畫面而自動上傳到 MediPrisma server。當您主動使用 AI、語音、雲端對話、共享範本、回饋或「回報檢驗資料問題」功能時，相關資料會依下列說明送往對應服務。

## 2. 我們處理的資料

### 2.1 FHIR 臨床資料

可能包含：病人基本資料、就診、診斷、用藥、過敏、疫苗、生命徵象、檢驗、影像／病理報告、處置、醫療器材、照護計畫、預立醫療決定與臨床文件。

用途：呈現臨床資料、產生趨勢、AI 摘要／解讀／安全提醒、回答問題、帶入計算機與產生 IPS。

### 2.2 Firebase session 與帳號

為了讓沒有登入的訪客使用有限免費 proxy 額度，app 會嘗試建立 Firebase 匿名 session；匿名 uid 不會建立一般使用者 profile。

當您選擇 Google 或 Email/Password 登入時，app 會處理：

- Firebase uid
- Email
- Display name
- Photo URL
- Email verification 狀態
- 帳號建立時間

用途：驗證身分、同步對話與範本、顯示／執行每日服務額度。密碼由 Firebase Authentication 處理，app code 不讀取或保存可還原的密碼。

### 2.3 AI 請求

依功能可能傳送：

- 您輸入的問題、提示詞與對話上下文。
- 您選擇的臨床資料摘要或 Agent tool 查詢結果。
- 報告文字、summary source catalog、必要的檢驗／用藥資料。
- 您主動附加的圖片。
- 您主動錄製、送出轉錄的音訊。
- 所選 model、語言、medical／patient audience 等執行參數。

傳送目的僅是完成當次生成、搜尋或轉錄。FHIR tools 會移除一部分結構化識別欄位，並以已知病人文字做 best-effort 遮罩；這不是保證不可重新識別的正式匿名化。

使用者也可以設定自訂 OpenAI-compatible endpoint，並明確選擇資料路徑。選擇「瀏覽器直連」時，提示、所選臨床內容、API key 與回應由瀏覽器直接送往該 endpoint，不經 MediPrisma proxy。若第三方 provider 不支援瀏覽器 CORS，使用者可選擇「Firebase Gateway」；此時上述資料會在當次請求中暫時經過 MediPrisma Firebase／Google Cloud，再轉送至白名單 provider。Gateway 不應保存 API key 或 prompt／response，但基礎設施仍可能處理一般 request metadata。

### 2.4 對話與個人設定

登入且非無痕模式時，文字對話會保存至 Firestore，包含：

- user id、patient id、FHIR server key
- title、文字訊息、時間、實際 model id
- Agent 狀態、reply reference、message count、可選 tags／summary

上傳圖片不保存到 chat history。無痕對話與訪客對話不寫入 Firestore。

登入使用者的 chat templates、custom summary modules 與其設定可能同步至 Firestore；訪客版本留在 localStorage。使用者分享至 Prompt Gallery 的內容、分類、受眾、作者顯示／匿名選項與 usage count 會存於 `sharedPrompts`，並可能讓其他使用者讀取。

### 2.5 使用額度

Firebase／Functions 會以匿名或登入 uid 與日期記錄 AI chat、Perplexity、Whisper 等服務的使用次數，以執行與顯示每日 quota。實際後端欄位、期限與限制由 `firebase-smart-on-fhir` 部署設定決定。

### 2.6 回饋

若您使用「回報問題」，會傳送：

- 您提供的 Email、問題類型、影響程度、描述與重現步驟。
- 您主動附加的問題畫面圖片（選填，最多三張且合計 8 MB）。
- 時間、user agent、螢幕與視窗大小、像素比、根字級、主題、時區、瀏覽器語言、目前 path／檢視、app 版本、啟動來源／站點與 FHIR server origin。

表單刻意不收 patientId、完整 FHIR URL、launch query 或圖片本機檔名，並提醒不要輸入或保留姓名、病歷號等個資；自由文字與圖片內容仍由您控制。瀏覽器會先重編碼附圖以移除 EXIF 等中繼資料，介面不另設遮蔽確認勾選。附圖只在送出時傳給 feedback Function，通過格式與大小驗證後作為 Resend 郵件附件寄給維護者，不寫入 app storage、Firebase Storage 或 Firestore。郵件及服務端備份的保存期限由部署者與 Resend 政策決定。

為限制濫用，正式 feedback Function 會以雜湊後的 Firebase uid 記錄每小時送出次數；該紀錄不包含回報文字、Email 或圖片。

### 2.7 一般裝置與網路資料

Hosting、Firebase、AI provider、郵件服務或網路基礎設施通常會在安全與營運 log 中處理 IP、timestamp、request metadata、錯誤與 user agent。其實際內容與期限由各服務與部署者政策決定。

### 2.8 使用統計（Firebase Analytics／GA4）

官方部署**會**初始化 Firebase Analytics（GA4），用來了解各功能實際被使用的情形。啟用條件嚴格：只在正式網域 `mediprisma.tw` 與 `voho0000.github.io` 執行；localhost、Firebase emulator、E2E 測試與伺服器端渲染一律不送。SDK 於瀏覽器閒置時才延遲載入，載入前的事件先排隊。

**記錄的事件（十個）**

| 事件 | 意義 |
|---|---|
| `view_open` | 看到某一層的某一頁（左右面板、報告、累積報告、用藥、摘要） |
| `chat_send` | 送出一次臨床對話（只記來源、有無圖片、model、是否 Agent 模式） |
| `handoff_copy` | 複製「帶回紀錄」的檢驗／報告／全部區塊 |
| `tour_start` | 開始一次導覽 |
| `tour_end` | 結束一次導覽（完成或中途離開、停在哪一步） |
| `report_interpret` | 要求或重新產生一份報告的 AI 翻譯解讀 |
| `app_launch` | 每次開啟 app 一次（啟動來源、院所、工作站代碼） |
| `ai_result` | 每次 AI 呼叫的結果（成功／逾時／額度用盡／取消…）與耗時分級 |
| `source_nav` | 點擊 AI 引用跳到原始資料（只記 FHIR 資源類型） |
| `summary_copy` | 複製醫療摘要的區塊 |

**記錄的使用者屬性（十個）**：`launch_source`（啟動來源）、`site`（`?site=` 院所標記）、`audience`（醫事人員／民眾模式）、`auth_kind`（匿名或 Google 登入）、`app_version`、`auto_summary`（摘要是否自動產生）、`locale`（介面語言）、`key_mode`（自帶金鑰或內建 proxy）、`workstation`、`browser_id`。

`workstation` 是啟動網址中可選的 `?ws=` 參數，由院內 launcher 填入的**診間／工作站代碼**（格式限制為英數與 `_`、`-`，最多 32 字元，刻意排除 `@`、`.` 與空白，使帳號或人名無法通過）。**目前尚未有任何 launcher 實際使用此參數**，因此實務上一律為 `unknown`。

`browser_id` 見 §3.4。

**明確不記錄**：任何病人資料或 FHIR 內容（姓名、病歷號、檢驗值、報告與文件文字、翻譯與解讀結果、被引用資源的 id 與標題）、送給 AI 的提示詞與 AI 的回覆內容、複製到剪貼簿的文字、Firebase uid（從不呼叫 `setUserId`）、完整網址與其 query 參數。自動 `page_view` 已關閉（正是因為 SMART 啟動網址帶有 `iss` 與 OAuth `code`），Google Signals 與廣告個人化亦已關閉。依 Google 說明，GA4 不會記錄或保存個別 IP 位址（僅於伺服器端用於推導概略地理位置後即丟棄）；此為 Google 的產品行為，非本 app 可驗證或控制的部分。§2.7 所述的 hosting／Firebase 營運 log 不受此影響。

程式端以白名單強制上述邊界：事件名稱、參數名稱與參數值都逐一比對允許清單，字串上限 64 字元，任何不符者整筆丟棄。相關程式集中在 `src/infrastructure/telemetry/usage-analytics.ts`。

### 2.9 TVGH 診斷 Collector（指定站點自動紀錄）

當前網址恰有一個 `site=vghtpe` 時，自動向部署指定的 Collector 位址背景傳送功能／請求的結果與效能紀錄，不需使用者手動啟用。資料包含隨機事件 UUID、操作時間、版本、固定功能／模型／錯誤分類、耗時，以及可量測時的就診、用藥、檢驗、報告、文件精確筆數、輸入 token 估計區間與裁切狀態。

為排查診間電腦問題，此資料流使用 localStorage 保存隨機瀏覽器識別碼，並將其隨事件傳送；儲存受限時退回單頁識別碼。Gateway 接收現有 Firebase ID token 作驗證，記錄驗證成功的 UID、email（匿名帳號通常沒有 email）、連線來源 IP，以及管理員對照出的診間／電腦名稱。UID 不等於 Windows 或院內職工帳號，IP 也可能是共用出口。原 token 不保存。上述識別與事件內容一起加密，事件 UUID 與收件時間為明文索引；僅授權管理員可解密讀取，保存期限由部署者明確設定。

此資料流不傳 prompt、AI 回覆、病歷內容、音訊、圖片、病人識別碼或其雜湊。不宣稱診斷資料不可識別。Firebase SDK 自動提供／更新憑證，Collector 不另存 token，也不要求使用者額外登入；Gateway 定期向 Google 取得公鑰，不將紀錄傳給 Google。認證、網路失敗或關頁可能漏記，但不影響原本 AI 或臨床功能。實作與限制見 [Collector 試行說明](docs/COLLECTOR-PILOT.md)。程式碼存在不代表正式部署已啟用。

### 2.10 檢驗資料問題回報（醫師主動送出）

累積報告工具列有一個「回報」按鈕，供醫事人員回報檢驗資料轉換錯誤（例如 CBC 項目出現在尿液、同一格出現重複值）。這是本政策中**唯一**把臨床衍生資料寫入 MediPrisma server 的例外，範圍只限於此：

- **只在您按下按鈕並在二次確認視窗按「確定送出」後送出**。有問題的分類（可複選）、問題類型與說明都可不填；送出前可展開逐列預覽與完整傳送內容（JSON）。不會自動送出，也不會跳出提示、通知或導覽邀請您回報；所有啟動路由（含北榮雲端病歷路由 `site=vghtpe`）行為相同。
- **只含檢驗**：送出這位病人累積報告中所有 FHIR 類別為 laboratory 的 Observation（同一筆結果常同時出現在兩個分類，必須一起看），最多 3,000 筆；超過時您勾選的分類全數保留、其餘由新到舊。不含影像、檢查、病理或其他報告、臨床文件與任何報告文字；判斷只看 FHIR 類別，不看項目名稱：生命徵象、問卷、身體檢查等類別不是 laboratory（或除 laboratory 外還帶有這類類別）的資料，以及沒有類別的 Observation，即使出現在檢驗分類也不送，服務端也會拒收。
- **每列送出的內容**：醫院（來源標示的檢驗院所名稱；夾帶的 10 位數醫事機構代碼會先移除）、項目名稱與代碼（system／code／display，其中健保醫令的 display 即醫令名稱）、Observation 類別代碼、檢體名稱、狀態、單位、數值的型態（位數、小數位、比較符號、字串長度）、相同結果的群組編號、異常旗標代碼、參考值（上下限、單位、短文字）、白名單內的橋接器來源標記（雲端病歷的檢驗類別、檢體方式、日／月檔標記、合併筆數與來源端點路徑；轉換版本、來源模組、去重方式等 tag），以及 app 的處理結果（放進哪個分類、由哪條規則決定、欄位名稱）。
- **數值**：「附上檢驗數值」預設勾選；勾選時另送數值本身與短結果文字（例如 Negative、1+）。取消勾選則只送上一點所述的型態資訊。長段結果文字無論是否勾選都不送。
- **時間**：不送任何日期。每列只送「相對天數」（本次回報中最早一列為第 0 天）與當天時間（時:分:秒）；雲端病歷的來源報告時間也只送與該列相差的天數與時間。
- **說明**：您可選填有問題的分類、問題類型與一句說明（最多 1000 字）。畫面會提醒不要輸入病人資訊；若說明含疑似身分證號、遮蔽身分證號、Email、電話、日期或 7 位以上數字，app 與服務端都會拒絕送出並顯示原因。
- **明確不送**：病人姓名、身分證號、生日、病歷號、任何 FHIR resource id 與 reference（列以 1、2、3… 編號）、絕對日期、`nhi-visit-date` 等日期標記、Observation.note、報告敘述，以及橋接器用來比對的來源列雜湊。來源字串若含疑似身分證號、遮蔽身分證號、Email、手機號碼、日期（西元或任何年份的民國日期）或 7 位以上連續數字（例如病歷號），會在瀏覽器端（服務端再檢查一次）整段移除並計數；說明欄與來源字串使用同一套規則。
- **雲端病歷原始檢驗列（僅限從雲端病歷擴充套件 0.12.19 以上開啟的病人）**：對話框多一個「附上雲端病歷原始檢驗列」（預設勾選）。勾選時，只有在您按「送出」（或在預覽中按「讀取原始列預覽」）之後，app 才向擴充套件讀取同一次取得的原始資料——擴充套件只保留 1 小時、原雲端病歷分頁須仍開著同一位病人，讀取不會延長保留時間，也不會跳出任何提示。app 在瀏覽器內立即只留下檢驗（IMUE0060 明細與歷史）列，其餘原始資料不保留、不送出，讀到的內容在關閉對話框或到期時即丟棄。每列只送白名單欄位：醫令代碼與名稱、項目名稱、數值與短結果文字（「附上檢驗數值」勾選時）、單位、參考值、異常標記、檢驗方法、檢驗類別、檢體方式、日／月檔標記、院所名稱（10 位數醫事機構代碼先移除）、科別代碼、來源列序號；開單、檢驗、處方日期改為與轉換後資料同一軸的相對天數與時間。**不送**遮罩身分證號、醫事機構代碼欄、費用年月、診斷（ICD 與病理診斷）、紀錄時間、長段報告文字（只送長度），以及白名單以外的任何欄位（只送欄位名稱，供察覺來源格式變動）。每個字串同樣經過身分資料樣式檢查，服務端再檢查一次並拒收白名單以外的欄位。讀不到時（過期、分頁已關、換病人等），只送轉換後的結果並記下原因代碼。
- **其他**：app 版本、資料來源類型（雲端病歷／健康存摺／SMART／示範／匯入）、`site` 院所標記、介面語言、名稱模式；以及驗證用的 Firebase ID token（匿名亦可）與 App Check token（均不保存）。

資料由 `submitLabDataReport` Function 驗證格式、重新檢查身分資料樣式與大小（上限 4 MB）後，寫入 Firestore `labDataReports`（資料列與原始檢驗列分段存於其下的 `labDataReportRows`），連同回報者的 Firebase uid、是否匿名、建立時間與到期時間。Firestore 規則禁止任何人從 client 新增或修改回報，回報者本人也無法讀回；只有開發團隊的管理帳號（Google 登入、已驗證的開發者信箱）能在回報檢視頁讀取，並只用於找出與修正資料轉換錯誤。新回報送達時，開發團隊會收到一封經 Resend 寄出的通知信，只含回報編號、勾選的分類、問題類型、各分類列數與資料來源，不含說明文字、醫院、檢驗項目、代碼或數值。開發團隊處理完該筆回報所指的問題後即刪除該筆回報；尚未處理者最長保存 90 天，到期由 Firestore TTL 自動刪除（TTL 通常在到期後 24 小時內執行）。送出後畫面顯示回報編號，聯絡開發團隊時可提供此編號。為限制濫用，Function 以加鹽雜湊後的 uid 與 IP 記錄每小時送出次數，該紀錄不含回報內容且一小時後到期。為避免逾時後重按「送出」造成重複，瀏覽器會附上整份內容的指紋（SHA-256）；Function 以「加鹽雜湊後的 uid＋指紋」記下對應的回報編號（不含回報內容），1 天後刪除，同內容重送時直接回傳原編號。

## 3. 瀏覽器端儲存

### 3.1 完整本地 Bundle 與影像

- 儲存：IndexedDB 中的 AES-GCM 密文。
- 金鑰：tab 的 `sessionStorage`。
- 期限：最多 12 小時；無金鑰、過期、解密失敗、清除資料或登出時刪除。
- 若加密或儲存不可用，不以明文 fallback 持久保存。

### 3.2 AI 衍生結果

Medical Summary、Safety、Report Interpretation 等結果可能以加密形式放在 localStorage，使 reload 後不需重付模型成本。它們使用 tab session key，最多 12 小時；新 session 無法解密時會清除。

### 3.3 API keys

自備 OpenAI、Gemini、Claude 或 Perplexity key 會先加密：

- 預設存在 `sessionStorage`，關閉視窗後消失。
- 您可明確選擇「記住此裝置」，改存 localStorage。
- 登出會清除 app 管理的 keys。

瀏覽器端加密不能防禦同 origin 的惡意程式碼、惡意 extension 或已被控制的裝置。

自訂 OpenAI-compatible profiles（Chat Completions URL 會正規化為 Base URL）以 localStorage v2 envelope 保留於目前裝置；最多 10 個。每個 profile 的 model id、transport、endpoint metadata 與各自加密的 optional key 原子保存，不會同步或持久化至 MediPrisma Firebase，直到使用者刪除 profile、清除 app keys 或移除網站資料。只有在使用者明確選擇 Firebase Gateway 時，key 才會在每次請求中暫時經過該 Function。

### 3.4 偏好與必要狀態

LocalStorage／sessionStorage 也會保存語言、受眾、主題、字級、onboarding、資料選擇、模型偏好、卡片版面、template、media consent 與 SMART OAuth session 等必要狀態。Firebase Auth／Firestore／App Check 也可能使用瀏覽器 storage、cookie 或 IndexedDB 維持 session 與防濫用。

其中 `browser_id`（localStorage 鍵值 `mediprisma.analytics.browser_id`）是第一次使用時產生的 32 字元隨機十六進位值，僅用於使用統計，用來估算「有多少個瀏覽器／機器在使用」。它是隨機數字，**不由裝置特徵推導**，也**不與任何帳號、Firebase uid、使用者或病人關聯**。清除網站資料（或使用無痕視窗）即會重置為新值；無法寫入時（無痕、封鎖 storage）則完全不送這個屬性。

## 4. 第三方與資料接收者

只有啟用對應功能時才會使用相關服務：

| 類別 | 可能服務 | 目的 |
|---|---|---|
| EHR／FHIR | 啟動 MediPrisma 的醫療機構／FHIR server | 取得經授權的病人資料 |
| 身分、同步、代理 | Google Firebase Auth、Firestore、Functions、App Check／reCAPTCHA | 登入、同步、quota、AI／語音代理、防濫用 |
| AI | OpenAI、Google Gemini、Anthropic Claude | 生成摘要、解讀、對話 |
| 文獻搜尋 | Perplexity | 即時醫學文獻／網路搜尋 |
| 語音 | Whisper 相容 endpoint／proxy | 音訊轉文字 |
| 回饋郵件 | Resend 與部署的 feedback function | 傳送問題回報 |
| 檢驗資料問題回報 | Google Firebase Functions（`submitLabDataReport`）、Firestore；僅 MediPrisma 開發團隊的管理帳號可讀；通知信經 Resend（只含摘要） | 找出並修正檢驗資料轉換錯誤（見 §2.10；去識別、只含檢驗） |
| Hosting | GitHub Pages；可選 mediprisma.tw host | 提供靜態 app |
| 使用統計 | Google Analytics 4（Firebase Analytics） | 了解功能使用情形與 AI 可靠性（見 §2.8；不含病人資料） |
| 自訂 AI | 使用者／醫療機構設定的 OpenAI-compatible endpoint；可選 MediPrisma Firebase Gateway | 依使用者明確選擇直接處理，或經受限 Gateway 轉送 |

自備 API key 的請求通常由瀏覽器直接送到該 provider；自訂 OpenAI-compatible endpoint 可由使用者明確改選 Firebase Gateway；免費內建模型通常經 MediPrisma Firebase Functions proxy。各接收端會依自己的條款或機構政策處理資料，部署者應確認資料地區、保留、訓練使用、subprocessor、刪除與契約條件。

我們不出售個人資料，也不以病人資料進行廣告 targeting。依法令、法院命令或保護權利／安全所必要時，部署者可能依法揭露資料。

## 5. 保存期限與刪除

| 資料 | 目前 app 行為 |
|---|---|
| Local Bundle／images | tab session 且最長 12 小時 |
| 加密 AI cache | 最長 12 小時 |
| Session API keys | 關閉 session 或登出 |
| Remembered provider API keys | 直到清除、改保存模式、登出或瀏覽器資料被移除 |
| 自訂 endpoint profiles／keys | 直到刪除 profile、清除 app keys 或瀏覽器網站資料被移除 |
| Firestore chat history | 直到使用者在 history 刪除或依部署者政策刪除；codebase 無自動 TTL |
| User templates／modules | 登入時可同步至帳號；訪客保留於目前瀏覽器，直到使用者刪除、重設或移除網站資料 |
| Shared prompts | 直到作者／管理者刪除或依社群政策移除 |
| Feedback email／附圖附件／service logs | 由部署者、Resend 與服務政策決定 |
| 檢驗資料問題回報（Firestore `labDataReports`） | 問題處理完即刪除；最長保存 90 天，到期由 Firestore TTL 自動刪除；限流紀錄 1 小時後到期 |

點選「清除本地資料」可刪除 app 管理的 Bundle、影像與 AI result caches。清除瀏覽器網站資料也可移除 local storage；這不會自動刪除 Firestore 或第三方已收到的請求。

## 6. 您的選擇與權利

依適用法律與部署者角色，您可能可要求存取、更正、刪除、限制處理、反對處理或取得資料副本。App 目前提供：

- 不登入仍可使用本地資料閱讀與自備 key 的部分能力。
- 切換為無痕對話，避免新增 Firestore chat history。
- 在 history 刪除個別對話。
- 清除本地 Bundle／cache／keys。
- 管理個人 chat templates、custom summary modules 與 shared prompts。
- 不使用「回報檢驗資料問題」即不會送出任何檢驗資料；使用時可縮小檢驗項目、取消「附上檢驗數值」，並在二次確認前取消。已送出的回報無法由 client 自行查看或刪除，如需提前刪除請提供回報編號聯絡部署者。

關於使用統計（§2.8）：這些資料在使用者開啟 app 時即開始收集，**不會另外跳出詢問視窗，目前也沒有提供關閉的開關**。可用的做法是清除網站資料（會一併重置 `browser_id`），或使用會封鎖 GA 的瀏覽器／擴充套件——後者只影響統計，不影響 app 功能。本段刻意如實描述現況，不主張存在尚未實作的同意機制。

<!-- TODO(owner): decide opt-out -->

Codebase 尚未提供完整的「刪除 Firebase 帳號及所有子 collection」自助流程。如需帳號層級存取或刪除，請聯絡部署者；部署者必須核對身分、適用法律與第三方備份／保留限制。

## 7. 資料安全

目前控制包括 SMART PKCE、本地 AES-GCM、session-scoped key、Firebase Auth token／可選 App Check／Firestore Rules（由後端 repo 部署）、PII minimization、DOMPurify、generic error、feedback HTML escaping／origin check／rate limit、檢驗資料回報的雙端身分資料樣式檢查與 schema 白名單、CI、CodeQL 與 dependency monitoring。

沒有任何系統能保證絕對安全。使用者與部署者應避免在未經授權的裝置、瀏覽器 extension 或網路環境處理真實病人資料，並建立事件應變與通知程序。更多限制見 [Security Guide](./docs/SECURITY.md)。

## 8. 兒童與代理使用

本工具不是直接面向兒童的消費者服務。若處理兒童或無法自行同意者的資料，醫療機構／部署者必須確認合法基礎、監護人授權與必要保護。

## 9. 跨境處理

Firebase、GitHub、AI providers、Perplexity、Resend 或其他 subprocessor 可能在您所在司法管轄區之外處理資料。部署者在啟用真實病人資料前應確認適用的傳輸機制、契約與資料地區設定。

## 10. 法規角色與合規邊界

法規角色取決於實際部署與資料用途，不由這份 open-source repo 自動決定。依官方資料：GDPR 的 controller 決定處理目的與方式，processor 代表 controller 處理；HIPAA Privacy Rule 適用於特定 covered entities，涉及 PHI 的受託服務可能需要 business associate 安排；臺灣個資法規範個人資料的蒐集、處理與利用。

- [European Commission：controller／processor](https://commission.europa.eu/law/law-topic/data-protection/rules-business-and-organisations/obligations/controllerprocessor/what-data-controller-or-data-processor_en)
- [U.S. HHS：HIPAA covered entities／business associates](https://aspe.hhs.gov/standards-privacy-individually-identifiable-health-information)
- [臺灣法務部：Personal Data Protection Act](https://mojlaw.moj.gov.tw/NewsContentE.aspx?id=29&lan=E)

醫療機構或其他部署者應自行判定角色、合法基礎、notice／consent、DPA／BAA、DPIA、資料主體流程、保存與 breach notification；必要時諮詢合格法務與資安人員。

## 11. 政策變更

當資料流、providers、保存期限或功能有重大改變時，應更新版本與日期。重大變更不應只靠 repo commit 隱性生效；正式部署者應以適當方式通知使用者。

## 12. 聯絡方式

隱私或資料處理問題請聯絡：<voho0000@gmail.com>。若您使用的是第三方自行部署版本，請優先聯絡該部署者；其政策與本官方部署可能不同。
