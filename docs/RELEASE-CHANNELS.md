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
4. `production` environment 要求核准；核准後才建置並發布 `/app`。

正式版用的是同一個 commit，以正式設定重新建置；與測試版只差三項：base path（`/app`）、CDSS API 位址、測試版標示。

## 測試版的建置差異

- `MEDIPRISMA_BASE_PATH=/app-staging`。
- `NEXT_PUBLIC_DEPLOY_CHANNEL=staging`：顯示「測試版」標示，標題加上「測試版」，並設定 noindex。
- `NEXT_PUBLIC_CDSS_API_ORIGIN`：repository 變數 `NEXT_PUBLIC_CDSS_API_ORIGIN_STAGING`；未設定時用 `https://fhir.mediprisma.tw/staging`。

雲端病歷擴充功能自 0.15.14 起接受所有 `/app…` 工作區，院內可直接把接收網址設為 `https://mediprisma.tw/app-staging/`。
