# 發布管道：測試版與正式版

新功能先上測試版，確認沒問題才推上正式版。

| 管道 | 網址 | 何時更新 | CDSS 存檔送到 |
| --- | --- | --- | --- |
| 測試版 | `https://mediprisma.tw/app-staging/` | master 的 CI 通過後**自動**（`Sync app to mediprisma.tw/app-staging`） | 測試環境 `https://fhir.mediprisma.tw/staging`（合成資料、只開放列名測試者） |
| 正式版 | `https://mediprisma.tw/app/` | 有人**手動推上正式版**（`Sync app to mediprisma.tw/app`），且 `production` environment 核准 | 正式環境 |
| HMC 預覽 | `https://mediprisma.tw/app-hmc/` | `pilot/hmc` 自己的流程，不受本文件影響 | — |

GitHub Pages（`gh-pages.yml`）只放轉址頁，仍隨 master 自動更新。

## 推上正式版

1. 在測試版確認要上線的版本：畫面左下角有「測試版」標示，CDSS 存檔會進測試環境。
2. GitHub → Actions → `Sync app to mediprisma.tw/app` → Run workflow。SHA 可留空，代表「推上目前測試版上的版本」；若填寫，必須等於測試版目前的版本。
3. `verify` 讀取 `https://mediprisma.tw/app-staging/deploy.json`（測試版建置時寫入的實際 commit），並確認三件事，任何一項不符就停止：
   - 要推的 commit 就是測試版目前提供的版本；
   - 這個 commit 在 master 上；
   - master 的 CI 對它通過。
4. 檢查通過後，`approve` 在 `production` environment 等待核准，畫面會顯示通過檢查的 commit；核准後才建置並發布 `/app`。

前置條件：`production` environment 必須設定 required reviewers，deployment branch 限定 master。workflow 本身無法確認是否已設定；沒有設定時不會要求核准。

只改文件的 commit（CI 的 paths-ignore 會跳過）不會跑 CI，也就不會上測試版或正式版，下一個程式 commit 會一併帶上。

正式版用的是同一個 commit，以正式設定重新建置。與測試版的差異：base path（`/app`）、CDSS API 位址，以及測試版標示、標題與 noindex。

## 測試版仍使用的正式資源

測試版與正式版同在 `https://mediprisma.tw`，除了 CDSS API 之外都沿用正式設定：

- 同源：瀏覽器的 localStorage、IndexedDB、Firebase 登入狀態與 Collector 瀏覽器識別碼兩邊共用。尚未測過的程式若改變本機儲存格式，可能影響同一瀏覽器上的正式版。
- Firebase、Collector、院內檢驗報告接收端（`NEXT_PUBLIC_LAB_REPORT_INSTITUTION_URL`）、AI proxy 都是正式後端；測試版的操作會寫進這些系統。Collector 會把測試版事件標成 `other`。
- 院內以擴充功能把真實病人資料送到 `/app-staging` 時，CDSS 存檔會進測試 FHIR 環境。該環境同在院內 VM，但沒有正式環境的備份。

## 測試版的建置差異

- `MEDIPRISMA_BASE_PATH=/app-staging`。
- `NEXT_PUBLIC_DEPLOY_CHANNEL=staging`：顯示「測試版」標示，標題加上「測試版」，並設定 noindex。
- `NEXT_PUBLIC_CDSS_API_ORIGIN`：repository 變數 `NEXT_PUBLIC_CDSS_API_ORIGIN_STAGING`；未設定時用 `https://fhir.mediprisma.tw/staging`。

雲端病歷擴充功能自 0.15.14 起接受所有 `/app…` 工作區，院內可直接把接收網址設為 `https://mediprisma.tw/app-staging/`。
