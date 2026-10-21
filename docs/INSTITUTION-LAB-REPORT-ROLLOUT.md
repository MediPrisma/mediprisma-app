# /app 院內檢驗問題回報：發布交接

## 範圍與目前狀態

這次讓 `.github/workflows/sync-mediprisma-app.yml` 的 `/app` 靜態建置讀取
GitHub Actions 公開變數 `NEXT_PUBLIC_LAB_REPORT_INSTITUTION_URL`，並加上院內
sender 的 64 MiB wire JSON 上限與測試。不修改 UI、
AI 呼叫、一般使用紀錄 sender、其他 workflow 或 `/app-hmc` 發布流程。
沒有設定任何正式變數，也沒有部署或驗收 VM 收件功能。

提出的院內收件網址（須先由 Gateway 實作、部署並驗證，不是已可使用的端點）：

```text
https://collector.mediprisma.tw/collector/v1/lab-reports
```

使用標準 HTTPS 443。這是檢驗回報端點，**不是**一般使用紀錄的
`/collector/v1/events`，也不從 `NEXT_PUBLIC_COLLECTOR_ORIGIN` 推導。
workflow 沒有預設網址或 fallback；變數未設定時，既有 sender 判定院內未設定，
不發送回報，也不探測院內收件端。

## 前端合約（僅新增院內 64 MiB 上限）

- 僅 `site=vghtpe` 的回報 UI 提供「團隊和機構／僅機構／僅連線測試」；
  其他 site 維持團隊回報。這是 UI 條件，不是 Gateway 的身分驗證替代品。
- 院內 POST 使用 `Content-Type: application/json` 及 Firebase ID token 的
  `Authorization: Bearer …`；不傳 App Check token 或 `x-proxy-key`。
  這些團隊服務用的憑證不可加入院內設定。
- 院內請求不帶 cookies、不帶 referrer、不跟隨 redirect；網址不可包含
  帳密、query 或 fragment。公開 URL 會進入瀏覽器 bundle，不得放金鑰。
- 「僅連線測試」的 body 必須只有 `{"connectionTest":true}`，沒有病人、
  檢驗列或備註；收件端須回答 `{"success":true,"connectionTest":true}`，
  **不得新增或更新檢驗回報紀錄**。必要的安全／存取紀錄不可記錄 token 或 body。
- 正式回報使用既有 `LabDataReportPayload`（`features/lab-data-report/types.ts`）；
  有 WebCrypto 時附上精確 payload 的 SHA-256 `submissionKey`。
  收件端須依驗證後 UID 與 submissionKey 去重，成功回答
  `{"success":true,"reportId":"…"}`，重送回傳同一編號。
- 院內請求 body 上限為 **64 MiB = 67,108,864 bytes**，與 Gateway／nginx
  的明確合約一致。sender 在 fetch 前用 `Blob.size` 計算最終 wire JSON
  的實際 UTF-8 bytes，包含 `submissionKey`、JSON escaping 及附件；
  不能用 JavaScript 字串長度或只計未附 submissionKey 的原始 payload。
  等於上限仍送出；超過回 `{ok:false,status:413,reason:'payload_too_large'}`，
  不 fetch、不截斷、不改送團隊。此限制不套用到 team 流程。
  合法 5,000 列 raw 附件可能達約 36 MiB，不能再以初版 8 MiB 拒收。
- 「僅機構」不得送到團隊。「團隊和機構」仍依既有 UI 的目的地與揭露處理；
  院內未設定時目前只送團隊，UI 會說明。不要用這個選項替代院內連線驗證。
- 正式回報可能附檢驗數值／經既有過濾的 MediCloud 原始列，仍屬敏感資料；
  去除姓名、識別碼或日期不代表完全匿名。正式驗收前只用合成資料。

參考：`features/lab-data-report/utils/submit-lab-data-report.ts`、
`src/application/feedback/feedback-request-headers.ts`、
`__tests__/features/lab-data-report/LabDataReportDialog.delivery.test.tsx`。

## 發布順序與啟用門檻

1. **先部署 Gateway 到 VM**，接通上述端點及 nginx HTTPS 443 路由。
   驗證 Firebase 身分、Origin allowlist、schema、限速、容量保護、加密、
   去重及管理存取；確認不破壞既有 ICD 服務與使用紀錄收件。
2. 確認院內檢驗回報的保存期限與刪除政策。**保存期限仍待使用者確認**；
   不沿用使用紀錄的永久保存，不宣稱已核准 90 天。
   正式保存敏感資料前，Gateway 設定與文件必須一致。
3. 用合成資料先驗證 Gateway：授權連線測試成功但回報資料列數不變；
   未授權／不允許來源被拒；正式回報拿到 reportId，重送不新增第二份；
   院內 Dashboard 可在授權後查看合成回報。
4. 上述門檻完成且獲得正式啟用授權後，才在此 repository 的
   GitHub Settings → Secrets and variables → Actions → **Variables** 設定
   `NEXT_PUBLIC_LAB_REPORT_INSTITUTION_URL` 為已驗證的完整收件網址。
   workflow 使用 `mediprisma-site-publish` environment；若該 environment
   有同名變數，先確認它沒有覆蓋 repository 的預期值。
   本次程式修改**不執行**這一步，也不新增 secret。
5. 重新執行 `Sync app to mediprisma.tw/app` 的 master 發布流程。
   `NEXT_PUBLIC_*` 在建置時寫入 bundle；只改 GitHub 變數不會改到已發布的頁面。
   確認 workflow 與 mediprisma-site 的發布完成，再重新載入 `/app?site=vghtpe`。
6. 從另一台院內工作站先選「僅連線測試」：院內應顯示 Connected，
   Network body 只有 connectionTest，沒有檢驗報告新增。
   再以合成資料選「僅機構」，確認 Network 只送院內端點且 Dashboard 有一份回報。
   確認其他 site 未出現院內選項、正常 AI 摘要功能未受影響。

TLS 信任、瀏覽器區域網路存取權限及擴充套件阻擋需另行排查；
「Not set up — not contacted」表示沒有有效的建置設定，不是網路故障證據。

## 停用／回退

移除或清空實際生效的 `NEXT_PUBLIC_LAB_REPORT_INSTITUTION_URL` 變數後，
重新建置並發布 `/app`，再確認新 bundle 不再聯絡院內回報端點。
舊開啟的分頁可能仍有舊設定，需重新載入；此操作不刪除既有院內回報資料，
也不修改 `NEXT_PUBLIC_COLLECTOR_ORIGIN` 或任何 AI provider URL。
未設定時的 UI 行為維持既有說明：「團隊和機構」只送團隊，
「僅機構」不能送出。Gateway 自身的停止收件或資料保存操作另行管理。

## 本地回歸驗證（不連正式服務）

```powershell
$env:TZ = 'Asia/Taipei'
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath __tests__/release/institution-lab-report-workflow.test.ts __tests__/features/lab-data-report/submit-lab-data-report.test.ts __tests__/features/lab-data-report/LabDataReportDialog.delivery.test.tsx
node scripts/typecheck.mjs
node node_modules/eslint/bin/eslint.js __tests__/release/institution-lab-report-workflow.test.ts
```

workflow 測試只讀本地 YAML，檢查變數在 `/app` build env 中直接來自 `vars`、
沒有預設端點／secret，且一般 Collector 與 AI URL 綁定保持分開。
sender／dialog 測試使用 mock；通過不代表 VM 已部署或跨工作站收件已驗收。

### 初次本地結果（2026-10-04，64 MiB 修改與相依套件同步之前）

- 全部 `__tests__/features/lab-data-report` 加上述 workflow 測試：15 組、259 項通過。
- 新 workflow 測試的 ESLint 與獨立 TypeScript 檢查通過；`git diff --check` 通過。
- 全專案 `node scripts/typecheck.mjs` 未通過：本地已安裝的
  `@voho0000/personalized-care` 為 2.2.0，而此 revision 的 `package.json`
  要求 2.18.0，出現未改動 CDSS 檔案的型別／export 錯誤；另外 sandbox
  不允許寫入此 worktree 的 `tsconfig.tsbuildinfo`。未重裝套件或修改 lockfile，
  不宣稱全專案 typecheck 通過。正式合併前仍須由版本一致的 CI 環境確認。
- 未做正式 build、發布、GitHub 變數寫入或 VM 驗收。

### 64 MiB sender 回歸（2026-10-04）

- 院內上限下 1 byte、等於上限、超過 1 byte，使用 mock Blob.size 驗證，
  不配置 64 MiB fixture。超限不 fetch，不修改 payload、不轉送團隊。
- 小型中文／emoji／JSON escaping fixture 使用真正 Blob UTF-8 編碼，與
  Node `Buffer.byteLength` 比對；另外確認 submissionKey 的 bytes 也計入上限。
- team 請求不做此大小檢查，既有 headers、body 與送出結果保持不變。
- 本地 lab-data-report 加 workflow 測試：15 組、265 項通過。
  全專案 typecheck／build 的最新結果由主流程另行回報，本節不沿用初次
  node_modules 不一致的結果來判定目前狀態。保存政策仍待 owner 確認。

### 最終整合驗證（2026-10-04）

- 初次環境有9個直接相依版本落後，267項CDSS型別錯誤。依最新lockfile在隔離worktree `npm ci` 對齊後，完整 `node scripts/typecheck.mjs` 通過；package.json/lockfile與CDSS程式沒有變更。
- 最後sender版本以合成institution URL執行正式 `/app` 靜態建置通過；新URL可在產物中找到，不使用正式帳密或病人資料。static export不套用Next headers的警告是既有部署限制，正式站仍需沿用web server安全設定。
- sender與兩個新增／修改測試檔的ESLint、diff檢查通過。
- 依賴安裝仍回報既有24項audit findings（6low/1moderate/17high），未在本項升級相依；不能宣稱型別/建置通過等於安全風險清除。
- 未發布、未寫GitHub正式變數、未验收VM新endpoint。
