# CDSS 病人紀錄與跨電腦同步實作規劃

狀態：規劃草案，尚未修改 App、CDSS 套件或 Firebase 程式。  
初稿：2026-09-11；更新：2026-09-12，改以最新已取得的 `origin/master` 為實作基準。  
已確認需求：同一登入帳號在不同電腦開啟同一病人時，可查看之前 CDSS 的選擇、輸入與操作日期；HF 先接入，資料架構須支援其他 CDSS 與既有 CDSS 改版。

## 1. 建議方案

建立共用的 CDSS 病人紀錄服務，以「帳號 → 病人 → 疾病／共用欄位」隔離資料。依使用者確認，每位病人每天只保留一份最新狀態；同日修改覆蓋每日快照，另以獨立欄位修改歷程保留每次實際更動，包括同一天的多次更動。不同日期的每日紀錄也保留。Firebase 是已同步紀錄的保存來源，前端負責即時顯示與加密的待同步佇列。

病人比對、操作保存、跨裝置同步與歷程顯示共用；欄位意義、可接受的值、沿用條件與版本轉換由 CDSS 套件定義。新增疾病不另做一套 Firebase 儲存。

回診自動帶入同帳號、同病人最近保存的欄位值，逐欄位顯示真正的最後修改日期。自動帶入、開啟頁面或修改其他欄位均不能重設日期。「帶入顯示」與「可以拿來判讀本次病況」仍分開處理：原量測日期與來源資訊保留，是否作為本次有效輸入由 pack 的沿用規則決定。

## 2. 實作基準更新：origin/master（2026-09-12）

依使用者本次要求，已重新 fetch App 的 `origin/master`，固定核對 SHA `1c17761f4a12712efc0d8f9a74afeffced846770`（PR #83，2026-09-12 11:12 +08:00）。該版本使用已發布 `@voho0000/personalized-care` **2.0.0**、FHIR adapter **1.6.0**，HFpEF 計算機另有 `HFPEF_CALCULATOR_VERSION = 'v1'`。不再以先前 pilot/hmc、目前工作目錄或本機 node_modules 判定現況；未核對線上部署版本。

| 資料來源 | master 現況 | 保存服務接入重點 |
|---|---|---|
| `clinic-vitals.store.ts` | 六個量測欄位已有各自 measuredOn／modifiedAt；NYHA、症狀／徵象、代償各自有 modifiedAt；採 partial patch | 保留既有同值不改日期行為，增加帳號／穩定病人識別、每日快照、事件與撤回狀態 |
| `phenotype-answer.store.ts` | HF 懷疑、分型與 HFpEF 確認分三組修改時間；choice／LVEF／檢查日仍共用一個 phenotype 時間 | 新紀錄拆成固定語意欄位；一次回答以同一 operationId 原子提交，舊組合時間標示精度，不能補造獨立歷史 |
| `hfpef-inputs.store.ts` | 新增手動心超補填，字串值、measuredOn、modifiedAt，局部更新 | 納入 11 個實際可編輯欄位；自動帶入的計算機輸入不是醫師修改 |
| `physician-decisions.store.ts` | 已有六種處置、理由、備註、recordedAt、packVersion，以 moduleId 為 key | 不另造第二套處置 store；改接固定 decisionTargetId、逐欄位差異與修改事件 |
| 上述四個 store | 已使用 AES-GCM 分頁 session 金鑰加密的本機 cache，可同分頁重整還原 | cache 不是跨電腦保存，也不是不可漏失的事件佇列；保留為加密暫存，新增可確認成功／失敗的同步 outbox |
| `evidence-overrides.store.ts` | 仍為 patientId → itemId → boolean 的明文 localStorage | 遷移到共用服務；保存原證據脈絡、時間及恢復預設事件 |
| `layout-preference.store.ts` | flow／board 等介面偏好，本機保存 | 不寫入病人臨床快照或修改歷程 |

原先「setVitals 整份替換會清掉其他答案」「僅有共用 measuredOn」「沒有 physician-decisions store」的缺口，已不適用這次 master。不可按舊盤點重做或退回它的資料形狀。

最新欄位、來源對照、Firebase 變更與驗收清單見 [2026-09-12 儲存欄位清單](CDSS-STORAGE-FIELD-CATALOG-2026-09-12.md)。先前 [pilot/hmc 盤點](HF-CDSS-USER-INPUT-SURVEY-2026-09-11.md) 留作歷史參考。

`phenotype-answer.firestore.ts` 仍是呼叫即拋錯的未實作接縫。master 的舊 `docs/HF-DP01_phenotype-answer-persistence-proposal.md` 中「只在記憶體」「等待選擇帳號隔離／共享」「統一 N 天」描述，不是本次需求定案：使用者已選同帳號跨電腦；歷史保存、欄位可否沿用與臨床有效期需分開，不能用統一到期刪除替代。本次只更新規劃文件，尚未修改 App 或 Firebase 程式。

## 3. 病人辨識：三欄位可以比對，不能保證絕對唯一

使用使用者目前能取得的三項：遮蔽後身分證、全名、完整生日。

1. 明確辨認 national-id identifier；不能把病歷號、任意 identifier 或匯入 patient.id 當成身分證。
2. 使用版本化正規化程序：Unicode NFKC、首尾空白、已確認的遮蔽格式與生日格式。姓名不做模糊比對、不隨意刪除中間字元；多個候選識別值衝突時不自動選一個。
3. 要求完整姓名與 YYYY-MM-DD 生日。僅出生年、遮蔽姓名、空白或占位文字均不能形成跨次就醫的比對鍵。
4. 瀏覽器以帳號專用祕密金鑰計算 `HMAC-SHA-256(canonicalTuple)`。canonicalTuple 包含辨識規格版本及來源遮蔽規格 namespace，使用明確的結構序列化，避免直接串接造成歧義。
5. 雲端只接收 matchKey，將它對應到隨機 patientRef。姓名、身分證與生日原文不進入新增 CDSS 文件、文件路徑、URL、錯誤訊息或遙測。

帳號 HMAC 金鑰由受驗證的後端服務首次建立，跨電腦取得同一把；瀏覽器只在記憶體持有。不得把金鑰放在前端設定或由每台電腦自行重建。金鑰版本獨立管理，不能因登出、換電腦或更新 App 重設。一般 CDSS 改版不輪替辨識金鑰。

matchKey 與病人主鍵分開，讓未來更換遮蔽規格、取得正式病歷識別碼或進行金鑰輪替時，可以新增經確認的 alias，保留同一 patientRef。alias 建立需 transaction 保證不指向兩名病人，不能默默合併既有病人；金鑰輪替需在舊版仍可解析期間遷移 alias。

限制必須保留：兩名不同病人若三項輸入完全相同，HMAC 也無法區分。這是來源辨識資訊不足，不是換雜湊演算法可以解決。首次帶入跨次歷史時，畫面列出比對方式與歷史日期，讓醫師核對；若辨識欄位缺漏或衝突，保留本次操作能力，明示不能跨電腦比對，不退回較弱的姓名＋生日比對。

相同三欄位在不同帳號下得到不同 matchKey；第一版不共享不同醫師帳號的紀錄。姓名更正或遮蔽方式變更可能造成無法自動命中，不能以猜測方式補連結。

HMAC 是假名化，不是匿名化或醫療內容加密。Firebase 管理權限與後端執行身分仍屬資料信任邊界。

## 4. Firestore 資料模型

以下均位於具名資料庫 `mediprisma`：

```text
users/{uid}/cdssIdentityKeys/{keyVersion}         帳號辨識金鑰，後端管理
users/{uid}/cdssPatientKeys/{matchKey}            → patientRef 的對照
users/{uid}/cdssPatients/{patientRef}             建立／更新時間等最小 metadata
  currentScopes/{scopeId}                       該疾病／共用 scope 的目前版本與最近日期
    fields/{fieldId}                            跨日最新欄位狀態，含撤回標記
  commits/{operationId}                         重送去重、提交結果；後端專用
  events/{eventId}                              每次直接修改的歷程，追加保存
  days/{recordDate}                             每日紀錄，YYYY-MM-DD
    scopes/{scopeId}                            各疾病／共用資料的當日 metadata 與最新摘要
      fields/{fieldId}                         當日各欄位最新狀態，同日覆寫
```

`scopeId` 為穩定 packId，例如 `heart-failure-cdss`；真正共用的量測可放 `shared`。血壓、體重等共用值由明確的欄位目錄管理；HF 診斷、分型與處置不因此成為其他疾病的答案。

`fieldId` 表達臨床輸入或決策的固定意義，例如 `hf-suspicion`、`nyha-class`、`sglt2-prescribing-decision`。它不能使用按鈕中文、卡片順序或會因版面調整變動的 module id。既有 module id 可以透過 adapter 對應，並作為每日紀錄的來源 metadata 保留。

`currentScopes` 是跨日還原與 revision 檢查的索引，不是另一份就醫紀錄。不能只讀「最新的一天」就假定所有疾病都在該日被修改；HF 今天沒有操作、另一 CDSS 有操作時，仍能找回 HF 的最新值。revision 對同帳號／病人／scope／field 跨日單調增加，不能每天歸零。

每日 scope 首次有效儲存時，以 transaction 讀取的完整 scope 基準建立當日快照（包含未修改欄位與撤回標記），再套用 patch。每日沒有操作的 scope 可由明確的基準日期索引解析，不複製成新修改；實作須限定每個 scope 的欄位／大小上限並檢查首次快照的交易容量，不能部分複製後就標示已完成。單一操作涵蓋多 scope 時，沿用同一 operationId。

每個目前狀態記錄至少包含：

| 欄位 | 用途 |
|---|---|
| schemaVersion | 共用儲存格式版本 |
| inputSchemaVersion | 該疾病的輸入資料契約版本 |
| fieldId、value、unit（適用時） | 保存的實際選擇／數值，經契約驗證 |
| modifiedAt、modifiedTimeZone | 該欄位值最後實際修改時間及時區；回診帶入與其他欄位修改均不更新 |
| confirmedAt（選用） | 若有「本次已確認」操作，另記確認時間；不覆蓋 modifiedAt |
| measuredAt（適用時） | 檢驗、量測或觀察真正發生的時間 |
| measuredOn、datePrecision（適用時） | 來源只有 YYYY-MM-DD 時保留日期與精度，不捏造午夜時刻；與 measuredAt 擇適用形狀 |
| receivedAt | 伺服器接收時間，與離線操作時間分開 |
| recordDate、packVersion | 所屬日期及當時規則版本 |
| appVersion、calculatorId／calculatorVersion（適用時） | master 新增的宿主計算機與規則套件可各自改版，分開追溯 |
| revision、lastEventId | 同步衝突、重送辨識與欄位修改歷程連結 |
| status | 已記錄／已撤回等保存狀態，不等同 CDSS 臨床結果 |
| origin、sourceRef／sourceFingerprint（適用時） | 醫師輸入、手動覆寫或來源證據的版本化參照；不以中文標籤或 raw patient.id 識別 |
| actorUid、operationId、timestampProvenance | 伺服器驗證的操作帳號、一次操作關聯，以及時間是否為裝置原值／舊組合時間／未知 |

每日欄位另保留最後操作類型、來源及當時的欄位／選項文字。每日快照可以覆寫，但每次醫師直接修改另外追加事件，不能因快照覆寫而刪除事件。事件包含 eventId、recordDate、scopeId、fieldId、action、修改前值與修改後值、原值是否存在、修改時間與時區、伺服器接收時間、baseRevision／revision、來源及資料／規則版本。量測日期或來源被直接更正也記錄前後差異。

一次儲存變更多個欄位時，以同一操作 ID 關聯各欄位的修改，確保能逐欄位查看歷史。未變更的欄位不新增事件。明確清空、撤回及更正均保留；自動帶入、重開頁面與原值儲存不視為修改。若將來提供主動確認或系統遷移紀錄，需以不同 action 標示，不混為醫師修改。

最新 master 已把「還沒問」與明確選擇 `not-assessed` 分開；新契約必須保留這項差異。正向、負向、刻意未評估、從未填寫、曾填後撤回不能都存成 null 或 false。HFpEF 的 `not-assessed` 表示「暫不確認」，不代表排除 HFpEF。心超清空則代表撤回人工覆寫、回到當下可用報告值；事件仍保留人工值被撤回的日期，不能再次帶入舊人工值。

一次操作可以原子變更數個相關欄位，例如儲存血壓的兩個數字。一般操作只送真正改變的欄位；打開視窗後直接按儲存，不會把所有舊值重新標成今天。若醫師要確認今天同樣的值，使用明確的「本次已確認」操作並更新獨立 confirmedAt；值未改變時仍保留原 modifiedAt。

每日紀錄以 `recordDate = YYYY-MM-DD` 為 ID，固定使用 Asia/Taipei 日期；同帳號、同病人、同日期始終是同一份邏輯紀錄。同一天重新匯入、換電腦或多次開啟都使用這份每日快照，不另建評估 ID；直接修改則各自保留事件。不同 CDSS 分 scope 保存，修改 HF 不會清掉其他疾病；只更新變更欄位，不刪除未操作或新版未知欄位。跨日後的新操作寫入新日期，前一天最後狀態保留；離線請求綁定原操作日期，隔天同步不能誤寫到隔天。來源 Bundle 的匯入編號不作為永久主鍵。

### 回診自動帶入、逐欄位日期與修改歷程（使用者已確認）

- 新日期首次開啟時，自動帶入最近保存的每日狀態，包含各欄位 value、modifiedAt、measuredAt 與來源；先完成讀取，再處理當日修改，避免空畫面覆蓋歷史。
- 每日邏輯紀錄保存一份完整的有效欄位快照。跨日建立快照時，未修改的欄位連同原 modifiedAt 一起複製；不能以當日 recordDate、文件 updatedAt 或 receivedAt 代替欄位修改日期。
- 開啟頁面本身不算修改，也不必建立新每日文件；當日首次有效儲存才建立當日快照。同日已有紀錄時，優先載入當日最新狀態。
- 只有實際改變的欄位更新 modifiedAt。打開表單直接儲存、相同值再次儲存或修改其他欄位，都保留原日期；相同值的主動確認若有需求，用獨立 confirmedAt。
- 欄位值或其量測日期／來源經醫師更正，視為該欄位紀錄修改；系統自動帶入、schema migration 不算醫師修改，另記系統 metadata。
- 明確清空／撤回要保存空值狀態與當次 modifiedAt，不能因欄位不存在而回頭找出更早的值，自動復活已撤回答案。新版本從未填過的欄位仍為未填。
- 畫面每個帶入欄位顯示完整年月日，例如「最後修改：2026/01/01」；量測日不同時另列。每日紀錄的最後更新時間僅代表整份資料，不取代任何欄位日期。

例：2026/01/01 修改欄位 A，02/01 只修改 B，03/01 只修改 C；04/01 回診帶入時，A 顯示 2026/01/01、B 顯示 2026/02/01、C 顯示 2026/03/01。若 04/01 修改 A，只有 A 改為 2026/04/01；01/01、02/01、03/01 的每日紀錄維持原樣。若 B 又在 04/01 修改，B 的最新日期顯示 04/01，展開 B 的修改歷程可看到 02/01 與 04/01 的值及修改時間。同一天多次修改亦逐筆可查，當日快照仍只有最後一份。

歷程分頁載入，主畫面只訂閱目前病人所需的 state。不得將所有疾病、歷年操作與結果塞入同一份文件；Firestore 每份文件上限為 1 MiB。[官方限制](https://firebase.google.com/docs/firestore/quotas)

判讀摘要每個疾病每天也只保留最後一份，與對應輸入版本一致；輸入更新後舊摘要需失效或一起更新。摘要只保存可追溯所需資訊：當時 packVersion、使用的欄位 revision、評估時間與必要輸出文字／狀態。不保存整份 FHIR Bundle 或整個 React 畫面。它標示為「當時判讀」，本次建議重新計算；若未保留完整來源資料，不能宣稱可完整重現當時所有計算。

## 5. Firebase 寫入與跨裝置衝突

建議新增 callable Functions：

- `getOrCreateCdssIdentityKey`：依登入身分取得帳號金鑰；不能接受任意 uid 指定另一帳號。
- `resolveCdssPatient`：依 matchKey 查找／原子建立 patientRef。
- `commitCdssChanges`：驗證版本與輸入，原子追加修改事件並更新當日各欄位 state。
- `deleteCdssPatientHistory`：依使用者明確刪除要求清理對照、state、歷程、評估與子集合；實作可採批次背景工作並顯示進度。

寫入流程：前端攜帶 recordDate、operationId 和每個欄位的 baseRevision → 後端驗證登入、日期與資料契約 → transaction 比對跨日 current revision、重送紀錄與每日基準 → 原子追加逐欄事件、更新 current state 與當日快照、保存提交結果 → 回傳確認 → 其他電腦透過 snapshot 得到更新。修改前值由後端讀取，不能信任 client 自行提交的 before。

相同 eventId 與相同內容重送回傳既有結果，不重複新增歷史；同 ID 不同內容拒絕。較舊且未提交的請求依 baseRevision 偵測過期衝突，不直接覆寫最新狀態。同一欄位在兩台電腦被修改時回傳衝突，並列顯示值與日期讓醫師選擇，不依裝置時鐘偷偷覆蓋。不同欄位可獨立更新。一台電腦快速連點時，佇列需按欄位順序送出，接續已確認的 revision；不得把自己的後續操作誤判成另一裝置衝突。

同一 operationId 必須對應固定內容與固定事件集合；提交成功但回應遺失時，重試仍取回同一結果。不得沿用目前 encrypted-answer-cache 的「只留下最後一個 write token」當事件 outbox，否則中間直接修改會遺失。每次已套用的按鈕選擇、理由切換、備註儲存都需逐筆排隊；未套用的表單草稿與每個打字鍵不建立事件。

晚到的前一日離線操作只可寫原 recordDate；如果更新欄位後已有較新日的相依快照，回傳衝突供確認，不回頭改動已封存日期或把舊值蓋上目前狀態。若無相依快照／同欄位更新，才依 transaction 的基準檢查接受原日期變更。同日不同欄位可合併；跨日快照初始化與晚到操作的競態須另驗收。

採用這層寫入服務，是因為 Firestore 同一文件的離線多次變更預設最後寫入者勝出，而 transaction 在離線時無法完成。這裡需要避免舊離線資料覆蓋已更新的當日狀態；正常順序的修改仍覆蓋當日舊值。[離線行為](https://firebase.google.com/docs/firestore/manage-data/enable-offline)、[Transaction 行為](https://firebase.google.com/docs/firestore/manage-data/transactions)

前端狀態分為「同步中」「已同步」「離線待同步」「同步失敗／需處理衝突」，只有伺服器確認後才顯示已同步。等待首次雲端讀取時，不可把本機空狀態寫回去覆蓋資料；使用者同期的新操作要另外排隊。

離線佇列採用符合現有安全設計的加密 session 儲存，不新增明文 localStorage 醫療資料。不把操作歸到後來登入的另一帳號。未同步前的資料只保證在可解密的當次 session 內可恢復；關閉 session、登出或清除資料前明示待同步數量，不能宣稱已跨電腦保存。加密不可用時只保留記憶體並清楚顯示限制。

## 6. Firebase 權限與部署

Firebase 設定位於另一個專案 `../firebase-smart-on-fhir`，不是本 App。2026-09-12 只讀核對其本機乾淨 checkout `327dd62a34161b09972860a4cb555028dcdef1db`：`firebase.json` 指向 `mediprisma`，`firestore.rules`、`firestore.indexes.json` 尚無 CDSS 路徑／索引；未查驗線上部署，也未宣稱這是該 repo 最新遠端版本。實作前應更新並記錄該 repo 基準。

- 使用新集合的精確路徑規則，不新增 `users/{uid}/{document=**}` 任意開放規則。
- CDSS 讀取僅限真正登入的擁有者；匿名與其他 uid 均不能讀取。
- 身分金鑰與 patient alias 由後端管理；金鑰不直接開放 Firestore client 讀寫，而透過驗證服務取得。
- 每日 clinical state、摘要與修改歷程由後端寫入，client direct write 禁止；歷程追加後不原地改寫，撤銷也是新事件。使用者明確刪除整份病人紀錄的流程仍可清理相應歷程。
- 新增 currentScopes、commits 的精確規則；current state 只允許 owner 讀取，commits 僅後端可讀寫。刪除流程一併清理這兩種資料，不放寬現有 users 的子集合權限。
- Functions 自行驗證 uid、App Check、payload 大小、欄位目錄、型別、版本、revision 與頻率。不能依賴 Firestore Rules 代替後端驗證，因為 Admin SDK 會略過 Rules。[官方安全規則說明](https://firebase.google.com/docs/firestore/security/rules-structure)
- 調整 indexes：目前病人的每日紀錄依 recordDate 分頁；依日期讀取所需 scope；欄位歷程依 scopeId、fieldId 與 revision／receivedAt 分頁。未查詢的大型值與摘要欄位免索引，避免不必要成本。
- 不記錄原始辨識欄位、完整 payload 或醫療內容於 Functions logs；錯誤以可診斷的代碼表達。
- 刪除工作必須包含子集合。刪掉 parent 文件不會自動刪除子集合。[官方刪除說明](https://firebase.google.com/docs/firestore/manage-data/delete-data)
- 更新兩個 repo 的安全／資料保存文件，明列新雲端資料種類、用途、讀取範圍與刪除方式。雜湊比對鍵不代表醫療內容已匿名化，也不代表端對端加密。

部署順序為：契約與相容的後端驗證器 → Functions、indexes、rules → 前端。後端先接受目前與過渡期舊版契約，再逐步停用。依現有專案注意事項，部署須明確針對 `mediprisma`，確認實際 release 與讀寫結果，不能只看 CLI 顯示成功。App 和 Firebase 的正式部署另作發布步驟；本文件不執行部署。

## 7. 回診時如何呈現與使用

主畫面在既有臨床內容旁增加簡潔的同步狀態與「過往紀錄」。回診自動帶入先前保存的選擇與數值，逐項顯示原 modifiedAt、來源及本次判讀是否採用；每日快照可依日期／疾病查看，每日只顯示最後一份；每個欄位另提供「修改歷程」，列出每次修改的日期時間與前後值，包括同日修改。登入與否不改變目前 Beta tab、care pack、卡片或按鈕可見性。

| 資料類別 | 回診顯示 | 送進本次 pack 的原則 |
|---|---|---|
| 數值與量測 | 顯示原量測日、輸入日與來源 | 不重新標成今天；依欄位來源優先序、原日期及 pack 的有效期限處理。舊門診值不默默覆蓋更新的病歷值 |
| 症狀、NYHA、本次觀察 | 顯示上次答案與日期 | 預設需本次確認；逐欄位規則由 pack 宣告 |
| 診斷確認／分型 | 顯示過往確認及依據版本 | 由 pack 宣告可沿用條件；與新資料不一致時保留歷史並待確認 |
| 「已開立」等處置 | 顯示曾作此決定的日期 | 不把過去一次處置當成現在仍持續用藥，也不永久關閉將來重新出現的缺口 |
| 證據納入／排除 | 顯示過去選擇與所對應證據 | 綁定原證據或資料情境；重新匯入不同證據時不因 item id 一樣而盲目沿用 |

每個欄位具有 `carryForwardPolicy` 與必要來源相依資訊。第一版只提供框架；HF 的實際規則須逐項列出供臨床審閱，不由 UI 或保存層自訂疾病門檻。新的欄位未宣告沿用政策時，預設歷史可見但需本次確認。

## 8. 新增 CDSS 與資料結構改版

需要分開的版本：

- `identityVersion`／keyVersion：病人比對算法與金鑰版本。
- `schemaVersion`：共用儲存 envelope。
- `inputSchemaVersion`：某個 CDSS 的輸入欄位／型別／語意。
- `packVersion`：臨床規則版本。
- `revision`：某一筆欄位狀態的修改次數，用於同步衝突；不是資料格式版本。

在 `mediprisma-cdss` 建立每個 pack 的 persistence manifest，描述固定欄位碼、型別、單位、選項碼、來源依賴、沿用政策及 migrations。manifest 可提供病種差異；前端共用 transport／history，後端共用 envelope 驗證和同來源產生的欄位驗證器。第一版不必重寫所有疾病 UI。

| 改動 | 相容策略 |
|---|---|
| 按鈕換文字、卡片移位置、module 拆分 | 語意相同時保留 fieldId／optionId；歷史保留原文字；adapter 更新映射 |
| 新增資料欄位 | 舊紀錄顯示未填，不能補成否、正常或已完成 |
| 選項或欄位停用 | 歷史仍可讀；不再自動送入新判讀 |
| 欄位改名或資料型別變更 | 明確、可測試且可重複執行的 migration；保留來源版本與未遷移的歷史日期資料 |
| 單位改變 | 有明確無損轉換才自動轉換；有歧義則需確認 |
| 一個答案拆成多個、臨床意義改變 | 新增欄位碼，不猜測舊答案如何分配 |
| 僅臨床規則更新 | 用相容的輸入重算本次結果，過往結果仍標示當時版本 |
| 舊 App 讀到新版資料 | 保留未知資料，避免以整份文件覆寫；不支援的欄位呈現需更新提示，其他相容功能照常 |

migration 使用逐版本的純轉換函式與歷史 fixture 測試；需要寫回雲端的轉換由後端以 revision 檢查進行並保存來源版本與 migratedAt，不新增當日多份版本。失敗的欄位保留舊資料與說明，不重設整位病人的紀錄。後端拒絕不能理解的寫入版本，不允許舊 App 降版寫回。

## 9. 舊本機紀錄遷移（包含 master 的加密 session cache）

master 有四種可解密的 session cache 與一種明文 evidence override。現有 store 的 patient.id 沒有可靠的帳號／三欄位綁定證明，不能在登入後自動全部上傳，尤其共用工作站可能留有另一位使用者的資料。只能匯入目前 session 實際可解密且歸屬已確認的紀錄；不能重用加密 key 跨電腦或承諾恢復已關閉 session 的資料。現有 cache 的七天上限不是雲端歷史的保存期限。

第一版提供明確的「匯入這位病人的舊本機紀錄」流程：列出可讀的舊選擇和日期，由使用者確認歸屬後才寫入目前帳號與 patientRef。雲端已有資料時做逐欄位比對，不整份取代。

保留已知原日期；沒有原操作日的 evidence boolean 記為「原日期未知」，另記 migratedAt，不能把匯入日期偽裝成按鈕點擊日。有已知日期的舊資料歸入對應日期；未知日期資料經確認後歸入匯入當日，但原操作日期仍標未知。同日多個舊值只取可判定的最新值；不能判定先後時交由使用者確認。migration 使用固定操作 id 防止重複匯入。僅匯入實際存在的舊資料，不能補造舊系統未保存的修改歷程；匯入事件明確標示來源與原日期是否已知。未確認歸屬的資料不搬移，也不因上線新版而直接刪除。

master 的 phenotype 共用時間只可標成「該組回答最後修改」，不能宣稱是 LVEF／分型各自的精確修改時間；舊處置 `recordedAt` 亦只是最後記錄時間。心超 cache 的 measuredOn 可能是套用日而非真正檢查日，匯入後應標記日期來源待確認，保留原值作追溯；不能把它直接當成已核實的檢查日期。

## 10. 實作順序與驗收

1. **契約與 HF 清單**：以 2026-09-12 欄位清單及 master 五種 store 為準，確定 fieldId、日期語意、沿用政策與 schema；補一個非 HF 的契約 fixture 驗證通用設計。
2. **Firebase**：完成 identity mapping、commit transaction、rules、indexes、刪除流程與 emulator 測試。
3. **共用前端服務**：病人／帳號 scope、hydration、加密 outbox、snapshot 更新、狀態與衝突處理。不得把另一位病人或登入前的結果短暫顯示給新 scope。
4. **HF 接入**：現有處置、證據切換、結構化回答、量測、HFpEF 手動補填全部改走共用服務；flow／board／證據表共用同一份狀態，未完成讀取前的修改逐欄合併；日期逐欄位保存，歷史與本次採用分開。
5. **改版／舊資料**：測試 migrations、舊 client、新欄位與明確匯入流程；更新開發文件，讓新增 pack 只需補 manifest 與 adapter。
6. **整合驗證與發布準備**：相關單元與整合測試、型別檢查、lint、production build、真實瀏覽器和 Firebase emulator 雙裝置測試，再整理可審閱變更。

最低驗收情境：

- 同帳號兩個獨立瀏覽器、同病人不同匯入 patient.id，能自動帶入選擇與原 modifiedAt。
- 01/01 改 A、02/01 改 B、03/01 改 C，04/01 帶入時逐欄位仍顯示 01/01、02/01、03/01；同值儲存、重開與換電腦不改日期。
- 清空過的欄位在後續回診仍為空，不從較早日期找回已撤回值；migration 保留原修改日期。
- 改一項回答不改動其他回答的日期；相同數值的視窗儲存不重新定日；主動本次確認只更新獨立 confirmedAt，值未改變時保留 modifiedAt，且不產生第二份紀錄。
- 同 patient.id 但姓名／生日不同，不會錯帶資料；缺欄位、遮蔽格式衝突與多 identifier 歧義有明確結果。
- 另一帳號、匿名、登出重登及快速切病人都不會取得前一 scope 的資料；晚回應不會套到目前病人。
- 兩台同時修改不同欄位都保存；修改同一欄位顯示衝突；離線重送、快速連點與重複 eventId 不會重複操作。
- 同日多次修改與撤銷：每日快照只有最後狀態，但欄位歷程逐筆保留前後值與時間；重開、自動帶入、原值儲存不新增事件。
- B 在 02/01 與 04/01 修改後，最新值顯示 04/01，修改歷程同時可見 02/01 與 04/01；兩次同日修改也可分辨。
- 每日快照與事件原子提交；失敗不會出現只有新值沒有歷史，或只有歷史沒有更新狀態；重送不新增重複紀錄。
- 台灣午夜前後的操作分屬正確日期；相同日期在不同電腦命中同一份資料；前一日離線請求不寫入翌日。
- 新增疾病、新欄位、移動卡片、選項停用、改單位與不可轉換的新版本都不會丟失舊資料。
- 上次量測不被重新標成今日，不覆蓋較新的病歷量測；本次 pack 只接收沿用規則允許的輸入。
- rules 拒絕跨帳號／匿名讀取及直接 client 寫入；Functions 對使用 Admin SDK 的寫入獨立驗證。
- 刪除工作完成後，alias、所有子集合與可讀取歷程均已清理。
- 原 `/`、Medcloud／vghtpe 及未登入使用的臨床介面可見性維持既有行為；不同螢幕尺寸的新增歷史介面可操作。

上線前仍需產品／臨床確認的具體項目是：HF 各欄位沿用政策、雲端歷程保存期限與刪除規則，以及可接受的來源遮蔽格式。這些不妨礙先完成共用契約、後端與測試設計，但不能由程式默默替使用者決定臨床語意或資料保留政策。
