# HMC pilot：AI agent 開發與資料安全規範

這份文件提供給在 HMC 電腦上操作本 repository 的 AI agent。開始任何工作前，先完整閱讀 repository 根目錄的 `AGENTS.md` 與本文件；兩者都必須遵守。

## 你的角色與工作範圍

- 只在 `pilot/hmc` branch 開發、commit 與 push。
- `master` 是正式版；不得直接 push、force-push、reset 或改寫其歷史。
- 要把成果帶回正式版時，從 `pilot/hmc` 對 `master` 開 Pull Request，等待 owner review。
- HMC 是正式 Firebase 的一般使用者，不具 Firebase Console、Google Cloud IAM、Firestore Rules 或 Functions 部署權限。
- HMC localhost 讀寫的是正式帳號資料。任何模板、聊天、面板設定或公開範本操作，都可能立即反映在正式版。

## HMC 預覽使用的規則來源（2026-10-20）

以下模式需部署設定與 HMC 整合更新都合入、並成功重建後才會生效。請以網站 `hmc-build.json` 判斷：缺少 `rulesSource: published-packages` 時仍是舊的 source overlay 流程，不可視為已切換。

HMC app 使用這個 app commit 的 `package.json` 與 `package-lock.json` 鎖定的正式 `@voho0000/*` 套件，和同版本正式 app 一致。這次是 `personalized-care 2.20.0` 與 `personalized-care-fhir 1.12.0`。建置不會跟隨浮動的 `latest`，也不會再用 personalization 的 `pilot/hmc` 原始碼覆蓋套件。更新套件時，版本與相容的 app 接線必須一起經過審查與驗證。

**規則分支上的未發布改動不會直接進入 app-hmc。** 修改臨床判斷、門檻、建議文字、引用或資料轉換時，仍在 `MediPrisma/mediprisma-cdss` 開發；規則經 PR 合入 `main` 並發布後，再透過 app 的套件版本更新帶入 HMC。不要在 app 複製一份臨床規則。

這次切換需連同 master 的新版 CDSS host 接線納入 `pilot/hmc`；舊版 host 不保證能單獨搭配新規則套件。

| workflow | 在哪 | 做什麼 |
| --- | --- | --- |
| `HMC preview build` | app repo 的 `pilot/hmc` | npm ci 安裝鎖定套件，驗證版本、HF／血脂／AF／CAD 與必要 API，記錄發版來源，再跑 typecheck、lint、Jest、static export 並上傳成果 |
| `Publish HMC pilot preview` | app repo 的 `master` | 等 build 完成，驗證成果後複製進 `/app-hmc` |

app 推送 `pilot/hmc` 後會啟動建置。既有 personalization relay 訊號仍會觸發重建，但不會將該分支尚未發布的規則帶入。手動重跑時，在 app Actions 執行 `HMC preview build`，ref 選 `pilot/hmc`。

**不要改 workflow 的名稱、檔名或 artifact 名稱。** publisher 仍以 `HMC preview build` 與 `hmc-preview` 辨認成果，發布端與權限維持在受保護的 master。失敗時保留上一個可用網站，正式 `/app` 不受影響。

`hmc-build.json` 的 `rulesSource` 為 `published-packages`；`packageVersions` 記錄實際套件版本，`packageRevisions` 記錄 registry 為 care 與 FHIR 各自記載的發版 gitHead，並核對發布檔案 integrity 與鎖檔一致。gitHead 是發版紀錄，不是來源碼與 tarball 的密碼學證明。為相容既有 publisher，`personalizationSha` 指 care 套件的發版 gitHead；它不代表目前 `pilot/hmc` 規則分支。可在 <https://mediprisma.tw/app-hmc/hmc-build.json> 核對。

套件缺失、版本與鎖檔不符、必要 API／pack 不存在、發版來源無法核對，以及 typecheck、lint、static export 失敗，均會停止發布。Jest 維持回報而不擋發布，並恢復執行先前因 source overlay 而略過的套件接線測試。

建置與發布有狀況時，既有 `HMC pilot preview needs attention` issue 會說明狀態。package token 或發布端失敗應交給 owner；不要建立替代憑證或另行部署。preview 本身不發布 npm package。

兩個 repository 的成果要分別回正式版：app 對 `master` 開 PR；規則對 `main` 開 PR。preview 成功不代表臨床內容已核准或可以發布到正式版。

AI agent 不得自行建立 deployment credential、修改正式 package version、改寫 workflow 或碰觸 `mediprisma-site` 來另行部署。建置成功但 `/app-hmc` 沒更新時，應停下來通知 owner，檢查 master 的發布端；不要自行把檔案補回 master。

## 第一次設定

1. Clone repository，以 HMC 自己的 GitHub 帳號登入 GitHub CLI。
2. 切換到 owner 已建立的 `pilot/hmc` branch。
3. 向 owner 取得私下交付的 `.env.local`，放在 repository 根目錄，並執行 `chmod 600 .env.local`。這是連到 owner 現有 Firebase web app 與 proxy 的 localhost client 設定，不是 Firebase 管理帳號或管理憑證。
4. 用 `git check-ignore .env.local` 確認它被 Git 忽略。
5. 私有 `@voho0000/*` packages 需要 HMC 自己 GitHub 帳號的唯讀 package 授權。不得使用 owner 的 GitHub token：

   ```bash
   gh auth refresh -h github.com -s read:packages
   npm run packages:ci
   ```

6. 執行 `npm run dev`，開啟 `http://localhost:3001`，使用 HMC 自己的 Google 帳號登入。

## 每次開始工作

先執行 `git status` 與 `git branch --show-current`。若不是 `pilot/hmc`，停止修改並切回正確 branch。同步正式版時：

```bash
git fetch origin
git switch pilot/hmc
git merge origin/master
```

遇到衝突時，先向 HMC 說明衝突檔案與兩邊意圖；不可用整檔覆蓋、`git reset --hard` 或刪除功能來消除衝突。

## Firebase 與 token 邊界

`.env.local` 已包含 localhost 所需的 Firebase Web config、AI proxy 公開端點，以及只供 HMC localhost 使用的 App Check debug token。HMC 不需要也不會取得獨立 Firebase 專案。localhost 與 `app-hmc` 都連到 owner 現有的正式 Firebase；HMC 使用自己的 Firebase Auth 帳號與 UID，以一般使用者身分呼叫服務。Web config 與 App Check debug token 都不提供 Firebase Console、IAM、Rules、Functions 或其他管理權限。

- 不得顯示、摘要、複製、上傳或在訊息中貼出 `.env.local` 的內容。
- 不得把 `.env.local`、token、API key、cookies、Firebase ID token 或 FHIR access token 加入 Git。
- 不得修改 `.gitignore` 來讓任何 `.env*` 檔案進入版本控制。
- 不得執行 `firebase deploy`，也不得嘗試部署 Firestore Rules、indexes、Functions、Auth 或 App Check 設定。
- 不得建立或要求 Firebase service-account JSON、Admin SDK private key、Google Cloud key 或 owner 的 GitHub token。
- 不得把 App Check debug token 放進正式 build、GitHub Actions、文件、issue 或 Pull Request。
- 若 token 曾出現在 commit、agent 對話、terminal 分享內容或其他外部位置，立即停止工作並通知 owner 撤銷。

## 正式資料的操作界線

Firestore Rules 是最終權限來源。HMC 與其他一般使用者相同，可依現行 Rules 讀寫自己 UID 底下的資料，也可能依既有規則使用公開範本及所屬單位功能；沒有另外建立 `pilot/hmc/{uid}` namespace。owner 與 HMC 使用不同登入帳號時，Firebase Auth UID 可區分資料操作身分。修改前端程式不能取得 Rules 沒有授予的管理權限。

- 開發與測試優先使用 repository 內建的去識別化 demo 資料。
- 不得把真實病人資料放進 source、fixture、test、snapshot、截圖、log、issue、commit、PR 或 AI agent prompt。
- 不得撰寫或執行批次刪除、資料搬移、schema migration、跨使用者查詢或大量 Firestore write。
- 不得用真實內容測試「公開分享範本」。測試分享流程只用明確標示的去識別內容，完成後刪除測試項目。
- 如果意外修改或刪除正式資料，立即停止 dev server，記錄發生時間、操作與受影響功能並通知 owner。不要自行大量寫回資料；owner 會依 PITR 或備份處理。

## 程式與網路安全

未經 owner 在 PR 中確認，不得修改或新增：

- `.github/workflows/**`、部署腳本、GitHub Pages／`mediprisma.tw` 同步設定。
- `firebase-smart-on-fhir` repository 中的 Rules、Functions、indexes 或部署設定。
- 會改變病人資料、prompt、response、token 傳送目的地的網路 endpoint。
- 會讀取 `.env.local`、瀏覽器 storage、cookies 或 token 並送往外部服務的程式。
- 遙測、analytics、錯誤回報或 logging 中的新資料欄位。

HMC 自備的 AI provider key 只能透過產品既有設定介面輸入，不得寫入 source、測試或 `.env.local`。任何新 provider 或 endpoint 都先在 PR 說明資料會傳到哪裡，再等待 owner review。

## 完成修改

依變更範圍執行相關 tests，並至少完成 `npm run lint` 與 `npm run build`。確認 `git diff` 沒有 `.env*`、token、病人資料、build output 或無關變更，再執行 `git push origin pilot/hmc`。push 後查看 `HMC preview build` 與接續的 `Publish HMC pilot preview`；成功後用 `hmc-build.json` 確認 app SHA、實際套件版本與 packageRevisions，並在 `app-hmc` 檢查實際 CDSS 畫面。

提交正式版時建立 PR，清楚寫出：改了什麼、使用者會看到什麼、如何驗證，以及是否改變任何資料寫入或外部網路請求。不得自行 merge PR。

## 給 AI agent 的停止條件

遇到下列情況先停止相關動作，向 HMC 說明並等待 owner 處理：

- 需要 Firebase／Google Cloud 管理權限或部署權限。
- 需要查看、複製或傳送 `.env.local` 的實際值。
- 需要 owner、service account、package publisher 或正式部署 token。
- 需要存取其他使用者或真實病人的資料。
- 發現 token 外洩、錯誤大量寫入或資料刪除。
- 無法安全解決與 `master` 的 merge conflict。
