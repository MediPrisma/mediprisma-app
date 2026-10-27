# 發布管道：測試版與正式版

目前的設定是 master 的 CI 通過後，三個網址同時更新。正式版可以切回「先上測試版、手動推上正式版」，見〈切換正式版的上線方式〉。

| 管道 | 網址 | 何時更新 | CDSS 存檔送到 |
| --- | --- | --- | --- |
| 測試版 | `https://mediprisma.tw/app-staging/` | master 的 CI 通過後**自動**（`Sync app to mediprisma.tw/app-staging`） | 測試環境 `https://fhir.mediprisma.tw/staging`（只開放列名測試者；院內測試時可能含真實病人資料，無正式備份，見下文） |
| 正式版 | `https://mediprisma.tw/app/` | 預設：master 的 CI 通過後**自動**（`Sync app to mediprisma.tw/app`）。手動模式：有人手動推上正式版，且 `production` environment 核准 | 正式環境 |
| HMC 預覽 | `https://mediprisma.tw/app-hmc/` | master 的 CI 通過後**自動**合併進 `pilot/hmc` 並建置（`Sync master into pilot/hmc`）；直接改 `pilot/hmc` 時也照舊建置 | — |

GitHub Pages（`gh-pages.yml`）只放轉址頁，仍隨 master 自動更新。

## 切換正式版的上線方式

由 repository variable `PRODUCTION_PROMOTION` 決定，不需要改程式：

- 未設定（預設）：自動。master 的 CI 通過就發布 `/app`，不經過 `production` 核准。
- `manual`：手動。master 只會自動上測試版，正式版照下一節的步驟推送。

設定位置：GitHub → Settings → Secrets and variables → Actions → Variables，或執行 `gh variable set PRODUCTION_PROMOTION --body manual -R MediPrisma/mediprisma-app`。改回自動就刪除這個變數。

## HMC 預覽的自動同步

`Sync master into pilot/hmc` 在 master 的 CI 通過後，把該 commit 合併進 `pilot/hmc`、推送，並啟動 `HMC preview build`，之後由 `Publish HMC pilot preview` 照舊發布到 `/app-hmc`。`pilot/hmc` 仍是獨立分支，HMC 專用的修改照樣直接在上面做。

遇到下列情況不會推送，而是開一個標題為「HMC 自動同步需要處理」的 issue，處理完手動執行該 workflow，或等下一個 master commit 自動重試：

- 合併時與 `pilot/hmc` 上的修改衝突；
- 合併會刪除 `pilot/hmc` 上的檔案；
- master 的變更包含 `.github/workflows` 下的檔案（`GITHUB_TOKEN` 沒有推送 workflow 檔的權限），這時以一般帳號開 PR 把 master 合進 `pilot/hmc`；
- 合併後（或 `pilot/hmc` 早已包含該 commit 時）`package.json` 或 `package-lock.json` 與 master 不同。`pilot/hmc` 的套件版本必須跟 master 一致，臨床規則版本只在 master 更新。

## 手動模式：推上正式版

1. 在測試版確認要上線的版本：畫面左下角有「測試版：CDSS 存檔至測試環境」標示；只有 CDSS 存檔進測試環境，其餘見下文。
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
