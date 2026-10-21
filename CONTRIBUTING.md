# 協作指南

先讀 [README](README.md)、[架構](docs/ARCHITECTURE.md) 與 [AGENTS.md](AGENTS.md)。目前使用 Node.js 24（與 CI 一致）、npm、GitHub CLI；現行文件從[文件索引](docs/README.md)進入，未完成工作見 [WIP](docs/WIP.md)。

## 本機啟動

取得此 repo 與 GitHub Packages 的讀取權限後，在 clone 內執行：

```bash
gh auth login -h github.com
npm run packages:ci
cp .env.example .env.local
git config core.hooksPath .githooks
npm run dev
```

開啟 http://localhost:3001。設定項目見 [環境範例](.env.example)，私有套件與權限見[私有套件說明](docs/personalization-private-packages.md)。請保留現有 `.env.local`；複製範例只適用於第一次設定。安裝包裝指令只把憑證交給 npm 子行程，不把金鑰寫入 repo。`NEXT_PUBLIC_` 值會公開在瀏覽器程式中。

## 分工與 WIP

一條工作線使用一個 `codex/` 開頭的 branch 與獨立 worktree；branch 名稱描述功能或修正目的。從確認過的已提交基準建立工作線，未提交變更不會自動跟著新 worktree 搬移。

接手前先查看 `git status` 與 [WIP](docs/WIP.md)。共用語系、registry 或文件中可能混有別人的變更；逐段核對歸屬，只加入自己負責的修改。既有 WIP 的搬移、還原及刪除須由負責人確認；不要為了讓工作目錄乾淨而清掉它。

- 現行規格放 `docs/`，歷史決策放 `docs/history/`，尚待議定的門診需求放 `docs/plans/outpatient/`。
- 實驗入口與執行條件見 [experiments](scripts/experiments/README.md)。實驗成功不代表已接入正式產品。
- 本機產物放 `output/` 或 `outputs/`；真實病歷測試資料使用已忽略的 `e2e/fixtures/local/`。分享測試案例使用合成資料。

## 依賴更新

更新既有第一方套件版本：

```bash
npm run bump:dep -- <package> <version>
npm run packages:ci
```

新增／移除套件或改變依賴樹時，使用 `npm run packages:install -- <package>`；移除則使用 `node scripts/npm-with-github-packages.mjs uninstall <package>`。不要直接執行 `npm install`，以免 macOS 重寫 lockfile 時遺失 Linux 平台項目。完成後執行 `npm run check:lockfile`；修復方式見 [AGENTS.md](AGENTS.md)。

## 驗證

依修改範圍執行檢查，並在 PR 寫明結果與未執行項目：

```bash
npx tsc --noEmit
npm run lint
npm test -- --ci --runInBand
npm run build:gh
```

`build:gh` 驗證 GitHub Pages 靜態匯出；`npm run build` 用於一般 Next 建置，`npm run build:mediprisma` 對應 `/app`。需要相應環境設定。瀏覽器測試使用 `npm run test:e2e`，前置條件見 [E2E](e2e/README.md)。純文件修改檢查相對連結、指令與索引即可；不要以空殼測試代替行為驗證。

修改介面前閱讀 [DESIGN.md](DESIGN.md) 與[介面 skill](.agents/skills/design-mediprisma-ui/SKILL.md)；疾病 status board 另讀[status board skill](.agents/skills/cdss-status-board/SKILL.md)。重要 UI 修改須包含相關測試、lint、正式建置及真實瀏覽器檢查。

## 作者署名與貢獻紀錄

專案作者與貢獻署名集中記錄於根目錄 [NOTICE](NOTICE)，授權條款見 [LICENSE](LICENSE)。新增或修正具名 credit 時，使用已確認的姓名或公開帳號與具體貢獻；作者所屬機構與著作權歸屬須分別確認。NOTICE 的說明不得新增或改寫 Apache 2.0 的授權條件。

保留第三方程式與資料隨附的授權及署名資訊。再散布來源或建置產物前，確認交付內容依 Apache 2.0 第 4 條包含授權副本、修改聲明及適用的署名；來源封裝保留根目錄 LICENSE 與 NOTICE，其他散布形式可依第 4(d) 條在允許的位置呈現 NOTICE 中適用的署名。

## PR 與發布

PR 說明先寫具體問題與修改後行為，再寫驗證及限制。文件應同步反映實作；只提交本工作線，不夾帶其他 WIP。推送 `master` 的程式變更通過 CI 後可能觸發正式部署，因此先以分支 PR 供審閱。

任何隱藏、停用或移除臨床 tab、pack、card、switch 的改動，須先向擁有者明列 surface 與 route，取得同意。相關 commit 包含 `Visible behaviour changes:`，逐行說明，或標示 `none`；同步更新 [LAUNCH-ROUTE-GATES](docs/LAUNCH-ROUTE-GATES.md)，測試仍保留功能的路徑。

Repo 清理的刪除依[審核單](docs/REPO-CLEANUP-REVIEW-2026-09-08.md)核准範圍執行；新增刪除候選須再次審核。

## Repo 清理的 localhost 驗證

擁有者要求：每群刪除完成後，先在目前工作目錄的 localhost 實際操作相關功能，確認正常後才繼續下一群。單元測試、lint 與 build 不能取代這一步。記錄測試路徑、資料、實際操作、畫面結果及限制；需要登入、外部服務或裝置權限而未完成的項目，須明列未驗證，不得宣稱通過或直接往下一群刪除。刪除授權仍按群取得。
