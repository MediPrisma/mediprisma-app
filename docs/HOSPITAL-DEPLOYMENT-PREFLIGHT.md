# 院內部署設定 preflight 與到場清單

本文件是部署準備，不是上線核准。只改建置檢查／範本／測試，不改 UI、runtime sender、權限或預設地址。AI summary #237 不在本次範圍；正式發布另需本人批准。

## 今天先驗兩件事

本 PR 的 preflight 是選配工具，**既有已合併的 release 不需要等本 PR 才能依原維運程序驗證**。下面是兩條即時成功標準；長時間穩定性、備份還原和正式啟用另按後文驗收，不把 72 小時當成按連線測試前的新門檻。

| 目標 | 到場最短路徑 | 明確成功標準 |
| --- | --- | --- |
| 檢驗問題回報「僅連線測試」 | 登入 `/app?site=vghtpe`，開回報對話框並按既有測試。UI同時測團隊與機構；此目標看「院內」結果。使用 **`NEXT_PUBLIC_LAB_REPORT_INSTITUTION_URL`**（注意字序）指向Gateway完整 `/collector/v1/lab-reports`；POST body只有 `{"connectionTest":true}`，headers為JSON＋Firebase Bearer，無病人、token不貼聊天。 | 院內收到 HTTP2xx 且 JSON `success===true`、`connectionTest===true`，UI院內顯示成功；lab／usage資料列皆不增加。GET `/health`、團隊成功或「未設定／未聯絡」都不算院內測通。 |
| 本人登入後，手動存CDSS並讀回FHIR | 同站點用合成病人得到CDSS結果，按「儲存 CDSS 紀錄」。公開設定 `NEXT_PUBLIC_CDSS_ADMISSION=firebase`、`NEXT_PUBLIC_CDSS_API_ORIGIN=<核准獨立API的HTTPS origin>`。API private設定同Firebase project＋本人被核准的UID名單。App POST `/cdss/v1/saves`，再POST `/cdss/v1/history`、`/cdss/v1/history/read`。 | 存入回201、`status=stored`且相同save UUID；history可找到，單筆讀回同一快照且不覆蓋當次評估。一般未列UID拒403、匿名／無效token拒401。Firebase登入本身不等於已列入FHIR授權；不需要Gateway FHIR接線。 |

第一條先核對 **4組設定**：①App編譯進bundle的完整institution URL；②VM實際跑含#7的release；③Gateway既有Firebase project、`COLLECTOR_ALLOWED_ORIGINS`和**經owner決定**的 `COLLECTOR_LAB_REPORT_RETENTION_DAYS`；④工作站→443 nginx→8787的TLS／CORS／可信proxy路徑。App variable只在重建後生效，不能拿VM env當前端設定。只新增已核准lab policy，保留原key/DB；未配置lab store回503 `unconfigured`，儲存／容量不健康回503 `storage_unavailable`。不能自行填90天；連線測試刻意檢查收件準備，不改成假的成功。

第二條先核對 **3組設定**：①App上述2個public變數＋現有Firebase project；②獨立API private `FHIR_API_AUTH_MODE=firebase`、`FHIR_FIREBASE_PROJECT_ID`、`FHIR_FIREBASE_ALLOWED_UIDS`、工作站CIDR／精確App origin／proxy；③PG→HAPI→三個CodeSystem ready→API8098→專屬HTTPS。私有名單由管理員依核准直接在伺服器設定，不經公開env、PR或聊天。本輪未替任何帳號加權限。

2026-10-04本Mac唯讀測試文件所載 `https://collector.mediprisma.tw/collector/v1/lab-reports` 的OPTIONS，TCP connect於5秒逾時（HTTP000），尚未到TLS／CORS／receiver；**不能據此推定院內工作站也不通**。需現場確認DNS／hosts／路由及目前listener。既有文件曾記載其他工作站仍指舊筆電，不能把舊文檔地址當作已切换完成。

## 本機先做

在獨立 checkout 依 lockfile 安裝依賴，將 [`deploy/hospital.env.example`](../deploy/hospital.env.example) 的欄位合併到私有 `.env.production.local`，沿用已核准的 Firebase Web App 公開設定。不要覆蓋既有 env，也不要把 backend env 複製進 App。

```sh
npm run check:deployment
npm run test:deployment
npm run build:mediprisma
```

`MEDIPRISMA_DEPLOYMENT_PROFILE=hospital` 才啟用院內規則；未設定時不限制既有 local／OAuth／其他部署。profile 拼錯會拒絕。CLI 使用已安裝 Next 的 `@next/env`，與 production build 相同優先序：shell → `.env.production.local` → `.env.local` → `.env.production` → `.env`；空 shell 變數仍會覆蓋檔案。不要在這個 checkout 留用開發／emulator 設定。

`build:mediprisma` 在移動 `app/api` 前執行檢查。失敗不執行 Next，也不搬動／恢复舊 stash；先修設定再重跑。檢查不連網，不讀 UID 名單，不輸出 env 值，不驗 TLS／DNS／服務是否存在。通過只代表設定格式符合這個 profile。

未選 profile 時，讀不到個別 env 檔仍交由原 Next build 處理，不新增 hard failure；選用 profile 時才拒絕不完整的 env 讀取。已填值但疑似誤命名的院內／Collector URL，以及上述服務變數的字序錯誤，會在 hospital profile 拒絕，避免把錯字誤當成服務尚未設定；其他不相關公開變數維持原行為。這是窄範圍辨識，不保證找出所有拼字錯誤。

| 公開設定 | 用途與規則 |
| --- | --- |
| `NEXT_PUBLIC_CDSS_ADMISSION` + `NEXT_PUBLIC_CDSS_API_ORIGIN` | App 直連獨立 FHIR API；啟用此部署設定時須明確 `firebase` + HTTPS origin，不能用 Collector 代替。FHIR 尚未準備可兩者皆留白，保留既有 admission 行為。其他 OAuth 部署不要選 hospital profile。 |
| `NEXT_PUBLIC_COLLECTOR_ORIGIN` | 一般 logs/events 的 HTTPS origin，runtime 加 `/collector/v1/events`。可留白，但既有 runtime 仍用 localhost；這不是停用开關，也不是跨工作站收件已完成。 |
| `NEXT_PUBLIC_LAB_REPORT_INSTITUTION_URL` | 獨立完整 HTTPS 回報端點；留白不聯絡機構。不從 Collector 推導，不能填 events 或 CDSS saves 路徑。其他合法 reverse-proxy path 可用，須人工驗證。 |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | 有設定任一院內服務時必填；與 FHIR/Gateway 的 private project 設定人工核對。Web App API key 是公開設定，不是伺服器密鑰。 |

網址拒絕 credentials、query、fragment、loopback、未指定主機與文件用 placeholder。允許核准的內網 hostname、IPv4／IPv6、port；IP 仍需可信 IP SAN 憑證。共用 HTTPS origin 可由已驗證的 reverse proxy 分流到獨立 backend，不強制不同網域。私有 UID allowlist／token／client secret／private key 不能放 `NEXT_PUBLIC_*`；检查常見誤置名稱不是完整 secret scanner。

正式 `/app` workflow 可讀公開 variable `MEDIPRISMA_DEPLOYMENT_PROFILE`。只有日後明確設為 `hospital` 才啟用；本次未修改 GitHub variables、secrets 或 environment。repository 與 `mediprisma-site-publish` environment 的同名變數須核對。其他 build wrapper 可先獨立跑 `check:deployment`；本次不接入 HMC 發布鏈。所有 `NEXT_PUBLIC_*` 改值後均需重建，舊分頁須重新載入。

## 程式／交付狀態（2026-10-04 唯讀核對）

| 狀態 | 證據與界線 |
| --- | --- |
| 已確認 | App [#238](https://github.com/voho0000/medical-note-smart-on-fhir/pull/238)、[#239](https://github.com/voho0000/medical-note-smart-on-fhir/pull/239) merged。此輪起點 `887e28ee`。架構依 [CDSS-FHIR-PILOT](CDSS-FHIR-PILOT.md)：App → 獨立 API → HAPI → PostgreSQL；Gateway 只收 logs/reports。 |
| 已確認 | Gateway [#5](https://github.com/voho0000/tvgh-mediprisma-gateway/pull/5)、[#7](https://github.com/voho0000/tvgh-mediprisma-gateway/pull/7) merged；main `891ef43663fd2c4df82fe1faa175bd44dd9b3bb5` 的 [CI](https://github.com/voho0000/tvgh-mediprisma-gateway/actions/runs/37168971484) success，已有同 SHA 的 [Windows Release](https://github.com/voho0000/tvgh-mediprisma-gateway/releases/tag/collector-891ef43663fd2c4df82fe1faa175bd44dd9b3bb5)。 |
| 已確認 | Gateway [#6](https://github.com/voho0000/tvgh-mediprisma-gateway/pull/6) 已 CLOSED、未 merge，標記被獨立 API 取代；不可部署其 FHIR 接線。 |
| 已確認 | FHIR [#1](https://github.com/MediPrisma/mediprisma-fhir-server/pull/1) merged；main `64c3172c278e6a97d18707dd52f41abb8f63c948` 的 [FHIR CI](https://github.com/MediPrisma/mediprisma-fhir-server/actions/runs/37169660416) 與 [Native Windows CI](https://github.com/MediPrisma/mediprisma-fhir-server/actions/runs/37169660439) success。workflow 提供 7 天保留的 `fhir-native-candidate`；未讀到 GitHub Release。取得 artifact 後仍需核對 manifest／hash；候選包不是部署核准。 |
| 需 VM 驗證 | Server 2016、Java／Node／PG 啟動、容量、重啟／登出／超過 72h、真 Firebase 帳號。Win2022 CI 不替代以上項目。 |
| 尚未讀到 | 現場目前的 private env、UID 名單、服務帳號、task XML、listener、TLS binding、可用 RAM 或成功部署證據；本次不讀取秘密、不變更 VM。 |

## 依賴順序與现场驗收

兩條 backend 鏈可分開準備。**各收件端先驗收，再在另行核准後重建 App**，不讓未準備好的端點進正式 bundle。

| 順序／項目 | 已確認 | 需 VM 驗證／尚未讀到 |
| --- | --- | --- |
| 1. 唯讀盤點 | Gateway `deploy/test-collector-vm.ps1`、FHIR `deploy/windows/test-fhir-vm.ps1` 已存在，不重寫。 | 需 VM 驗證：Server2016 x64／待重啟／磁碟／RAM／既有 ICD 業務及 443、8787、8098、8095、15432 listener。尚未讀到現況。 |
| 2. Gateway 交付 | 固定 SHA ZIP＋checksum＋`verify-collector-windows.ps1`；包含 portable Node22，VM 不需 Git/npm。既有 collector.env/key/DB 應保留。 | 需 VM 驗證：Node 在 Server2016 可執行、排程 principal／state／ACL、無人登入仍收件。不能重裝以重產金鑰；殘留 child process 先查 ownership。 |
| 3. FHIR DB → HAPI | 文件指定独立 PG15.19 cluster/service（loopback15432）、Java21＋核准 WAR（HAPI8095），與 Gateway 分目錄。`bootstrap-terminology` 建三個 CodeSystem，再 `record ready`。 | 需 VM 驗證：runtime與容量、DB service identity、private state ACL；FHIR Node要求 ≥22.20，不能只因 Gateway 有 Node22 就推定版本相符。尚未讀到現場版本／RAM。 |
| 4. 獨立 FHIR API | Node API loopback8098，private `FHIR_API_AUTH_MODE=firebase`、相同 Firebase project、明確 `FHIR_FIREBASE_ALLOWED_UIDS`。不需第二個 IdP。 | 需 VM 驗證：核准 CIDR／精確 origin／trusted proxy、Google簽章公鑰下載、時間同步；範本 CIDR 不是現場參數，不能直接照抄。尚未設定正式名單。 |
| 5. 長時間服務 | FHIR 使用獨立 task/service；文件要求 `ExecutionTimeLimit=PT0S`，保留 restart 設定，不能借用／重裝 Gateway task。 | 需 VM 驗證：HAPI/API/PG/Gateway 登出、開機、shutdown 與 T0/T+24/T+48/T+73h 資源量測；無人值守更新／停止仍未完整驗收。 |
| 6. TLS／CORS／網路 | 前端只用核准 HTTPS；HAPI／PG 不對外開放。FHIR與Gateway各有 nginx 範本；FHIR樣板未代理 `/health`。 | 需 VM 驗證：選IP或DNS、SAN／信任鏈／到期、443既有binding與ICD/WebSocket、覆寫可信forwarding headers、精確origin＋Authorization/Content-Type OPTIONS。舊文件的 wildcard 憑證不能驗證IP；最新SAN／DNS尚未讀到。工作站 Chrome/Edge Local Network Access 允許／拒絕都需實測，不以TLS代替。 |
| 7. 健康檢查 | Gateway `/live` 存活，`/health` 為usage readiness；lab receiver需授權 `{ "connectionTest": true }`。FHIR `record ready` 檢查metadata＋CodeSystem；API `/health` 有來源限制。 | 需 VM 驗證：从VM loopback查API health，工作站透過已核准路徑驗證。lab連線測試成功且資料列不增；usage health不代表lab可用。尚未驗证任何實際收件端。 |
| 8. 合成資料 E2E | 已有 `playwright.fhir.config.ts`／Firebase synthetic harness，不重寫、不用真病人或外部模型。 | 需 VM 驗證：協作者儲存201且UUID相符→history→同快照；重送去重、衝突409、換病人隔離、一般UID403／匿名401／錯project／過期拒絕；登出與移除UID重啟後拒絕。合成lab「僅機構」只送院內、重送同ID、admin可讀；logs/report/FHIR互不混送。真帳號驗收只用合成內容。 |
| 9. 故障／rollback | 保留舊版 binary／artifact 與原 env/key。FHIR還原只建新的 `mediprisma_restore_*`，不覆蓋active DB。App變數需重新建置才生效。 | 需 VM 驗證：單一backend停用不影響其他功能、失敗不得宣告儲存成功；備份還原後snapshot/ID/version一致。回退不可用舊backup覆蓋新紀錄；Collector空值不是停用。正式切換／rollback均須另行授權。 |

原生操作、帳號 ACL 與停止界線以 FHIR [WINDOWS-VM](https://github.com/MediPrisma/mediprisma-fhir-server/blob/64c3172c278e6a97d18707dd52f41abb8f63c948/docs/WINDOWS-VM.md)、[VM-ACCEPTANCE](https://github.com/MediPrisma/mediprisma-fhir-server/blob/64c3172c278e6a97d18707dd52f41abb8f63c948/docs/VM-ACCEPTANCE.md)、[INDEPENDENT-API](https://github.com/MediPrisma/mediprisma-fhir-server/blob/64c3172c278e6a97d18707dd52f41abb8f63c948/docs/INDEPENDENT-API.md) 與 Gateway [WINDOWS-VM-ROLLOUT](https://github.com/voho0000/tvgh-mediprisma-gateway/blob/891ef43663fd2c4df82fe1faa175bd44dd9b3bb5/docs/WINDOWS-VM-ROLLOUT.md)、[LAB-REPORTS](https://github.com/voho0000/tvgh-mediprisma-gateway/blob/891ef43663fd2c4df82fe1faa175bd44dd9b3bb5/docs/LAB-REPORTS.md) 為準。舊拓撲段落需對照上述獨立FHIR決策，不用Gateway #6補線。

## 到場只需確認的參數

| 狀態 | 最少資料（不在聊天貼秘密） |
| --- | --- |
| 尚未讀到 | 本輪準備啟用哪些服務；每項的核准 HTTPS origin／報告完整 endpoint；IP或DNS及相符可信憑證。 |
| 尚未讀到 | App公開Firebase project ID；FHIR/Gateway使用相同project。核准協作者UID名單由管理員直接寫入FHIR private env，不放App／GitHub公開variable。 |
| 尚未讀到 | 實際工作站CIDR、App origin、proxy來源IP；由IT核對CORS和網路准入，不新增管理通道。 |
| 尚未讀到 | IT指定服務帳號、完整runtime路徑、release/state/DB/backup目錄、可用RAM／磁碟及既有task/port ownership。密碼／private key不需提供給本任務。 |
| 需使用者決定 | **lab report保存天數**：`COLLECTOR_LAB_REPORT_RETENTION_DAYS` 無預設。0永久／正數到期刪除，未決定前不啟用lab收件；不能把usage既有0或測試90天套過來。 |
| 需另行批准 | 正式切換與維運時段、核准artifact SHA、回退版本及備份還原證據。本輪程式需Claude review後再由本人決定後續；不merge/release/deploy。 |
