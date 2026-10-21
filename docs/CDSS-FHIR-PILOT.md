# CDSS 獨立 FHIR 儲存與院內准入

## 來源姓名含未辨識字元

雲抓關閉「去識別化」後，使用 `source-medcloud-patient-id` 系統輸出來源原有的部分遮蔽身分證，例如合成值 `B123***789`。CDSS 只接受已確認的 bridge 命名空間下此來源系統及符合身分證形狀的部分遮蔽值；在 lookup tuple 中對應同一 bridge 的 `masked-tw-national-id` 系統，值不改寫。非身分證識別碼、未遮蔽值、未知系統及多重候選仍拒絕。

再次遮蔽的雲抓資料不得建立另一個儲存 key。`masked-medcloud-patient-id` 系統，或 bridge 的 source／masked-tw 系統下末四碼均遮蔽的值（例如 `B123XXXXXX`），即使缺少去識別化旗標，也拒絕儲存與查詢，並提示關閉雲抓「去識別化」後重新匯入。檢查先於姓名與生日驗證，以便舊匯出缺少完整生日時也能得到正確提示。既有儲存快照的讀取契約及其他 national-id 系統的 key 不改寫。

未標記去識別化的來源姓名可包含 `*`（全形 `＊` 會正規化為 `*`），例如合成姓名 `王小*`，但須至少保留兩個可辨識文字。不含 `*` 的姓名沿用既有至少兩個字元的驗證，保留含造字的姓名及既有 lookup key 相容性。明確去識別化標記及 `○` 等遮蔽姓名仍拒絕；生日與部分遮蔽身分證字號的驗證保留。

未辨識字元會原樣參與既有 v1 病人雜湊，不刪除、不猜補，也不退回只用生日或遮蔽身分證字號。完整姓名的既有雜湊保持不變。若日後來源修正姓名，會產生另一個 lookup key，既有紀錄不會自動合併。這仍是試行假名比對，未完成院內正式病人身分對應。送出的姓名維持遮蔽，自由文字中的來源姓名仍移除。

CDSS 外送自由文字的姓名遮蔽會將來源姓名中的每個 `*`／`＊` 比對為一個非空白 Unicode 字元（可附異體字選擇器），涵蓋其他報告寫出的實際字形與全半形星號；可能多遮蔽符合相同模式的文字。拉丁姓名採文字邊界比對，且萬用比對不套用於 pack_id 等結構欄位。此規則只用於遮蔽，不參與病人雜湊；身分證等其他欄位仍以字面值比對。

2026-10-05 最新使用者決定：CDSS 儲存與調閱綁定登入帳號，僅原儲存者可讀取。未登入、匿名與尚未確定帳號 UID 時，面板及全螢幕的儲存／歷史操作停用；儲存按鈕提示「請先登入後儲存」。`intranet` 保留院內 CIDR 限制，另要求 App 現有非匿名 Firebase token；不再只憑網段允許儲存與調閱。API 私有設定需補相同 `FHIR_FIREBASE_PROJECT_ID` 與核准 UID 名單。正式 VM／App 設定尚未變更。

後端以已驗證 issuer＋UID 衍生擁有者 security label，列出與調閱皆核對；patient hash、儲存 UUID、email 或 request body 不能代替擁有者授權。登出／切換帳號會取消待處理請求並清除已顯示的歷史；重試 UUID 亦按帳號隔離。沒有 owner label 的舊紀錄不會自動歸屬或出現在登入者歷史；恢復前須由維運以可信來源明確對應原儲存者。需先更新 FHIR 後端，才能提供伺服器端隔離。

2026-10-04 依使用者釐清：Gateway 只做 log／回報資料。App 直接呼叫獨立 FHIR API，沒有 Gateway／Collector FHIR fallback。原工作區衝突保留；未發布 App、未改 pilot/hmc 或 HMC 發布鏈。

## 儲存與歷史

唯一 site=vghtpe 且有效 CDSS 結果，人工按「儲存 CDSS 紀錄」才送 POST /cdss/v1/saves。201、status=stored、相同UUID才成功。保存當下profile/result、visitAnswers等輸入、決策、來源與事件。凍結按下時的輸入，未改內容重試保留UUID；準備階段也可取消，切病人／關頁清理。原始全名／生日留在瀏覽器內作文字遮蔽與既有v1假名hash，不等於EMR病人對應。

歷史清單最近10筆／hasMore，單筆驗UUID、病人hash、pack與大小；唯讀原快照，不重新評估或寫回當次answer stores。標示醫師身分未驗證；不另存localStorage/IndexedDB、不執行HTML。可見臨床tab／卡片／既有控制保留。

歷史使用獨立、固定的 `src/shared/contracts/cdss-stored-save-v2.ts`，對齊 FHIR backend 的 `src/contract-v2.mjs`，不引用最新寫入 schema。v2 保留舊版 UUID 字面格式、分鐘精度與 `+0800` 等時間格式；日期、JSON 節點數／深度、4MiB、臨床快照結構及未知版本仍驗證。快照及事件中的原始 UUID／時間不改寫，只有畫面日期轉換副本以供顯示。單筆 envelope 的 savedAt 必須等於快照 saved_at。

歷史建議以唯讀方式呈現儲存的 title、moduleName、status、recommendation、rationale、patientEvidence、missingData、nextActions、safetyBoundary；人工輸入與決策仍可展開。這些是當時結果，調閱不重跑現有規則、不覆蓋目前評估。讀取相容性不放寬新寫入規格；未來新格式需另增 reader。

### 帶入上次紀錄

「帶入上次紀錄」查最近 10 筆中同病人、同疾病最新收到的紀錄。先查看快照，再勾選人工輸入／決策並按「確認並帶入」；僅同疾病、同指引版本可帶入。查看、取消或切換病人／帳號不會修改當次回答。疾病切換會清除歷史選取，不撤除現有 FHIR 授權。

帶入只補空白欄位，保留目前編輯；所有相關 store 已完成 hydration 且沒有待完成的讀取才允許寫入。門診非檢驗量測與心超數值保留原量測日、修改時間，已有匯入量測的欄位優先使用當次資料。血壓必須完整、同日期，不能與本次已填的半組合併。心超僅帶入同一最新檢查日的欄位；當次已匯入任何心超參數或 LVEF 時，不補入歷史心超，也不沿用舊分型或其確認。AF 診斷回答及有有效原始 reviewedAt 的人工血脂回答可沿用。決策僅接受相同 packVersion，保留 recordedAt、理由、備註。

本次問診症狀、理學檢查、證據選擇、PREVENT、檢驗數字、AF 副作用／追蹤症狀與 AI 回答不帶入。歷史 profile/result 永遠不套用，CDSS 透過現有 answer stores 用當次臨床資料重新計算。成功後顯示來源時間；沒有可補欄位時提示保留現況。帶入本身不 POST 儲存、不寫 EMR；確認本次結果後仍須人工按「儲存 CDSS 紀錄」。原始歷史快照不改寫。此功能仍依賴現有院內連線、登入及後端歷史存取政策；不新增身分隔離或院內 VM 部署。

## 建置設定

```text
NEXT_PUBLIC_CDSS_API_ORIGIN=https://<核准FHIR專屬主機>
NEXT_PUBLIC_CDSS_ADMISSION=firebase
```

目前使用者指定只開放已登入 Firebase 的 CDSS 協作者。App 取現有非匿名帳號的 getIdToken()，沒有第二次登入或額外授權按鈕；Firebase SDK 沿用既有 token 更新，FHIR 不另外存 token。登出／帳號切換／取 token 失敗停止傳送；一般登入者是否為協作者，由獨立 API 驗證 Google 簽章、相同 Firebase project 與明確 UID 白名單決定。Beta switch、email 或自稱角色不是權限。NEXT_PUBLIC_COLLECTOR_ORIGIN只用於log／回報，不能當FHIR URL。

FHIR 私有 env 設 FHIR_API_AUTH_MODE=firebase（院內使用 intranet 亦需以下 Firebase 設定）、FHIR_FIREBASE_PROJECT_ID 與 App 相同、FHIR_FIREBASE_ALLOWED_UIDS 為協作者 UID 名單。此名單不放 NEXT_PUBLIC，也不從 Gateway 執行時讀取；尚未設定正式名單或 Firebase claims。Firebase 模式限 CDSS 三個路由，不能 bootstrap 或 raw /fhir。名單變更後重啟 API；移除 UID 即撤除本服務權限。公開憑證驗證不查 Firebase session revoked/disabled，僅在 Firebase 撤销而保留 UID 時，既有 token 可能有效到原期限（最長一小時）。

intranet-pilot 已限 localhost 合成測試；API拒絕院內網段／公開 origin／trusted proxy 的免登入配置。正式醫師與病人對應仍不是本階段前置條件，Firebase 身分也不自動當作 Practitioner。

後續其他系統需要時可選OAuth（與目前 Firebase 模式互斥）：

```text
NEXT_PUBLIC_CDSS_ADMISSION=oauth2
NEXT_PUBLIC_FHIR_OAUTH_ISSUER=https://<核准IdP>/realms/<realm>
NEXT_PUBLIC_FHIR_OAUTH_CLIENT_ID=mediprisma-app
```

Public client使用Authorization Code + S256 PKCE，state、issuer及精確popup來源核對。callback註冊為`https://mediprisma.tw/app/fhir-auth/callback`（其他artifact使用自己的origin/basePath），Keycloak webOrigin亦精確註冊。不能放client secret進公開變數。新「登入 FHIR 授權」按鈕不會自動存病歷或清掉當次病人／評估；授權失敗、過期或未登入不能退回Firebase／匿名FHIR。授權、verifier、token僅記憶體，300秒token提前30秒停用；不使用refresh token。斷開FHIR授權清除本Apptoken，IdP SSO仍可能有效，已簽token可用至到期。

API需要RS256、opaque sub、正確issuer/audience、300秒以下期限、client ID及read/write scope；read/write不能取得bootstrap。Keycloak要配置basic scope或oidc-sub-mapper；登入帳號尚未對應院內醫師，不推定Practitioner／病人consent。FHIR repo的INDEPENDENT-API.md列出完整權限與受信任主機界線。

所有設定皆在建置時固定，變數更改需重建。/app workflow只讀新增公開設定，未設定GitHub variables或部署；HMC鏈原樣保留。所有傳輸omit cookies、no-referrer、no-store、redirect=error，patient key／UUID在POST body；save4MiB/15秒、history5MiB/15秒、最多10筆。

## 本機重現

先啟動FHIR repo的本機HAPI/PG、獨立 localhost `intranet-pilot` API28098（僅合成測試；App 也模擬非匿名登入）。OAuth測試另啟動私有Keycloak28080與API8098；Collector origin刻意設定為無法使用的127.0.0.1:1，確認臨床流獨立。

```powershell
node node_modules/@playwright/test/cli.js test --config playwright.fhir.config.ts
# 合成 Firebase SDK 登入＋簽章驗證＋真實 HAPI（沒有連正式 Firebase）：
# FHIR repo 先用私有 runtime 新檔，啟動 tests/helpers/serve-synthetic-firebase.mjs <新檔完整路徑>
$env:FHIR_E2E_AUTH_MODE='firebase'
$env:FHIR_E2E_FIREBASE_STATE='<FHIR repo>\runtime\firebase-browser\<新測試狀態>.json'
node node_modules/@playwright/test/cli.js test --config playwright.fhir.config.ts
# 真實本機Keycloak PKCE（路徑只指向本機新建的合成秘密檔）：
$env:FHIR_E2E_AUTH_MODE='oauth2'
$env:FHIR_E2E_SECRETS_FILE='<FHIR repo>\runtime\oauth-local\secrets.json'
node node_modules/@playwright/test/cli.js test --config playwright.fhir.config.ts
```

專用profile使用localhost3007，不借用devserver；關閉trace/video以免記錄token/帳密。只有成功授權後的App與歷史快照畫面截圖，不截登入密碼或callback URL。預設e2e跳過本機專用測試。

Firebase E2E 另以合成帳號直接儲存兩筆 v2 歷史格式：舊版 patient_session_id UUID，以及 saved_at=`2026-10-03T12:34+0800`。再由真實 App 查清單／調閱，驗證 HAPI 回傳的快照原樣保留、日期可顯示及建議可讀取；App 不額外發送儲存。這些格式由測試直接送至後端，最新 App writer 的限制維持原狀。

Jest驗hash/遮蔽/retry/準備中取消、來源、history錯病人/UUID/size及LiveFeature；`cdss-history-detail.test.tsx` 驗後端支援的舊版 UUID／時間／事件格式、快照原樣保留、損壞資料拒絕、最新 writer 仍維持限制，以及中英文歷史建議完整顯示且不發儲存請求。真實Chromium在三種配置儲存→201→history→同snapshot/version1，亦核對畫面中的建議各欄位與實際儲存內容，手機320/390/430、平板768、桌面1024/1440與橫向檢查。VM容量、專屬HTTPS、開機/登出/>72h/備份還原仍待FHIR VM-ACCEPTANCE.md實機執行。正式病人、醫師綁定與EMR寫回延後。
