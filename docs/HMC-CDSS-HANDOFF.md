# MediPrisma CDSS 跨電腦交接

更新：2026-09-18（Asia/Taipei）。此文件記錄 HMC pilot 的工作現況與接續方式；不包含憑證或病人資料。先以 GitHub 最新分支與實際 workflow 核對版本，再開始修改。

## 1. 專案與目前交付

兩個 repo 必須配對使用，建議放在同一個父目錄。不要複製整個舊電腦的 node_modules、.next 或瀏覽器儲存。

| 專案 | 遠端 | 工作分支 | 負責內容 |
| --- | --- | --- | --- |
| App | https://github.com/MediPrisma/mediprisma-app | pilot/hmc | CDSS 畫面、輸入、醫學計算機 |
| 規則 | https://github.com/MediPrisma/mediprisma-cdss | pilot/hmc | 臨床事實、FHIR adapter、規則及引用 |

已交付的功能版本：

- App `47b30c38`：三區塊、診斷／追蹤切換、主訴與體重追蹤、高血脂診斷核對及 PREVENT 區塊。
- 規則 `77db017`：HF 模組分類與診斷／追蹤情境。
- 規則 `a30205d`：LDL 123 不再被自動當成未知；有可判讀數值時依 190 門檻比較，另列日期與治療前／歷史紀錄核對提醒，保留醫師覆核。
- 規則 `fe5d4ecdb04c538249ca7420ce2fd9062863e13e`：已合併 owner [PR #12「高血脂：對每位病人評估，並正式釋出」](https://github.com/MediPrisma/mediprisma-cdss/pull/12)。高血脂 pack 改為對每位病人評估，`enabled: true`；缺少診斷／嚴重血脂證據仍會標示限制，沒有放寬嚴重 LDL/TG 模組門檻。這不是 npm 發布，也不等於正式 main 已合併。

本文件會有自己的 App commit。不要把以上功能基準 SHA 當成永遠固定的分支 HEAD。

預覽：https://mediprisma.tw/app-hmc/
實際已發布的版本：https://mediprisma.tw/app-hmc/hmc-build.json

`pilot/hmc` 是 Git 分支，`/app-hmc/` 才是預覽網址。正式 `/app/` 不會因 pilot push 自動更新。

## 2. 接續 agent 的第一步

先閱讀兩個 repo 的 `AGENTS.md`、`docs/HMC-AI-AGENT-GUIDE.md`，以及規則 repo 的 `README.md`。UI 修改另讀 App `DESIGN.md`、`.agents/skills/design-mediprisma-ui/SKILL.md`；規則修改另讀規則 repo `.claude/skills/cdss-pack-authoring/SKILL.md`。

先執行下列單行命令（於共同父目錄執行）：

```text
git -C mediprisma-app status --short
git -C mediprisma-cdss status --short
git -C mediprisma-app branch --show-current
git -C mediprisma-cdss branch --show-current
```

有未提交變更時先辨認所有權，不覆蓋、不 reset。工作分支預期皆為 `pilot/hmc`；如果使用者另指定分支，先核對上下文。既有 AGENTS 對 pilot 的保護條文與 HMC guide 的角色指示有差異；本次合併與交付有使用者明確授權，不代表未來所有發布、merge 或正式版操作一律授權。不要修改部署 workflow、Firebase 規則或使用 owner 憑證來繞過限制。

只同步目前工作分支，乾淨工作樹才執行：

```text
git -C mediprisma-app pull --ff-only origin pilot/hmc
git -C mediprisma-cdss pull --ff-only origin pilot/hmc
```

若拒絕 fast-forward，先比較差異；不要 force-push 或用 reset 消除衝突。此次 PR #12 的授權只針對該筆，不包含 owner 其他指向 main 的 PR。

## 3. 新電腦準備

安裝 Git、GitHub CLI、Node.js 24 與 npm；用自己的 GitHub 帳號。需要兩個私人 repo 的讀寫權限，以及安裝既有私人 npm 套件的讀取權限。不要把 Token 寫進文件、shell 命令、Git remote URL 或聊天。

```text
gh auth login --hostname github.com --git-protocol https --web
gh auth setup-git
gh api user --jq .login
gh api repos/MediPrisma/mediprisma-cdss --jq .permissions.push
gh api repos/MediPrisma/mediprisma-app --jq .permissions.push
```

最後兩個命令應回傳 `true`。這次使用帳號是 `hmcheng0913`，另一位協作者請以自己的授權帳號為準。

若已是 collaborator 卻 403／404，而且 CLI 提示環境變數憑證覆蓋登入，先在**當前命令視窗**清除舊覆蓋，再登入；不要列印變數內容：

CMD：
```bat
set GITHUB_TOKEN=
set GH_TOKEN=
```

PowerShell：
```powershell
Remove-Item Env:GITHUB_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue
```

macOS/Linux：
```sh
unset GITHUB_TOKEN GH_TOKEN
```

清除只影響該 shell 及子程序；已啟動的 agent/app 不會同步更新環境。前次權限問題就是重新以使用者帳號授權後解決，不能因 403 就斷言 collaborator 邀請不存在。不要在無人值守 CI 任意清除部署所需憑證。

Clone（於共同父目錄；已存在的 repo 不重複 clone）：

```text
git clone --branch pilot/hmc https://github.com/MediPrisma/mediprisma-app.git
git clone --branch pilot/hmc https://github.com/MediPrisma/mediprisma-cdss.git
```

先前以舊名稱 clone 的資料夾（`medical-note-smart-on-fhir`、`mediprisma-personalization`）請在沒有開啟的程式時改名為 `mediprisma-app`、`mediprisma-cdss`，本文件的命令與第 4 節的程式都以新名稱找資料夾。舊 remote 網址 GitHub 會自動轉址，也可用 `git remote set-url origin <上面的新網址>` 更新。

App 的 `.env.local` 必須由 owner 透過既有安全方式提供或依 `.env.example` 設定。確認 `git check-ignore .env.local` 有輸出。不要複製到 handoff；不要讀出內容給 agent。localhost 使用既有正式帳號服務，測試只用內建合成 demo。

安裝規則 repo：進入 `mediprisma-cdss`，執行 `npm ci`，再 `npm run build`。安裝 App：進入 `mediprisma-app`，執行 `npm run packages:ci`；此既有 wrapper 使用 CLI 登入憑證，不需手動貼 Token。若套件讀取權限不足，依 GitHub CLI 提示補足自己的 `read:packages` 權限；若 Windows wrapper 回報 spawn/EINVAL，這是本機 Node/npm 執行問題，應記錄錯誤修復安裝流程，不要將憑證改寫成明文。

以上是新環境重建步驟；本次沒有在全新空白電腦重新跑完整安裝。任何安裝錯誤都要先解決，不可繼續假設套件已裝好。

## 4. 本機 App 載入 pilot 規則

**重要：單純 npm 安裝得到的是發佈版套件，不一定包含 pilot 修改。** 2026-09-18 的 App `.github/workflows/hmc-build.yml` 使用「完整 source package 注入」，包含 registry、bundled、HF、高血脂及知識來源；本機也要一致。舊父目錄 `sync-packs.ps1` 曾只做 HF 部分覆蓋，會漏掉高血脂契約。這些父目錄腳本不在這兩個 repo 裡，另一台電腦不一定有；先核對內容，不能直接沿用舊 overlay 假設。

先停止 dev server，再完成規則 `npm run build` 和 App 套件安裝。以下跨平台 Node 程式在 **App 根目錄**執行，可存為 repo 外的臨時 `.cjs` 後以 `node` 執行。只替換四個指定的產物套件，不修改 Git 追蹤的 package.json／lockfile。它會移除目標套件舊目錄以避免殘留檔案，所以先檢查來源 dist 完整且目標不是 symlink：

```javascript
const fs = require('node:fs');
const path = require('node:path');
const names = ['clinical-lab-normalization', 'personalization-sdk', 'personalized-care', 'personalized-care-fhir'];
const app = process.cwd();
if (JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8')).name !== 'mediprisma-app') throw new Error('Run from the App root');
const targetRoot = path.resolve(app, 'node_modules', '@voho0000');
const pairs = names.map(name => {
  const source = path.resolve(app, '..', 'mediprisma-cdss', 'packages', name);
  const target = path.resolve(targetRoot, name);
  if (path.dirname(target) !== targetRoot) throw new Error('Unexpected target');
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('Linked package: review installation before replacing');
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  if (manifest.name !== '@voho0000/' + name) throw new Error('Unexpected source');
  fs.accessSync(path.join(source, 'dist', 'index.js'));
  return { source, target };
});
for (const { source, target } of pairs) {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  fs.copyFileSync(path.join(source, 'package.json'), path.join(target, 'package.json'));
  fs.cpSync(path.join(source, 'dist'), path.join(target, 'dist'), { recursive: true });
}
console.log(require('@voho0000/personalized-care').CARE_PACKS.map(p => ({ id: p.id, enabled: p.enabled })));
```

應包含 `heart-failure-cdss` 與 `hyperlipidemia-cdss`；PR #12 合併後兩者 `enabled` 都應為 true。每次重裝 App dependencies 後需再次注入。若 workflow 將來改了，以最新受治理的來源契約為準，不能為了通過檢查複製臨床規則到 App。

這台 Windows/Dropbox 曾出現建置清理 dist 的 EPERM／EBUSY；待鎖定釋放後重跑通常可解決。必要時暫停同步，或改在不受同步的工作目錄開發。不要刪整個專案或略過 build。若某個 workspace build 失敗，後續測試的缺模組錯誤可能只是它的連帶結果。

## 5. 驗證、啟動與停止

規則 repo，PowerShell：
```powershell
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
npm run typecheck:tests
$env:TZ = 'Asia/Taipei'
npx jest --runInBand
npm run verify:evidence
```

macOS/Linux 可使用 `npm run verify`。Windows 的 npm test script 使用 POSIX `TZ=...`，應改用上述 `$env:TZ`。引用 PDF 若位於 App，依規則 README 指定 `MEDIPRISMA_PUBLIC_DIR`；區分真的通過與因缺檔略過。

App，PowerShell：
```powershell
npm run lint
npx tsc --noEmit
$env:TZ = 'Asia/Taipei'
npx jest --runInBand __tests__/features/clinical-decision-support __tests__/features/medical-calculator
npm run build
```

逐項確認成功，不要只看最後一個 exit code。material UI 另用合成 demo 檢查 320/390/430/768/1024/1440、深色與 200% reflow。build 前先停 dev，避免共用 .next 造成錯誤。

啟動：App 根目錄 `npm run dev`，網址 http://localhost:3001 。使用者自行在專用終端執行，可用 Ctrl+C 停止；agent 要背景啟動時在 Windows 使用隱藏視窗並將 log 放 repo 外。只停止自己啟動的 dev process，不要 kill 全部 Node 程序。

**本次交接保持 localhost 關閉，沒有自動重啟。** 新 agent 應在使用者需要本機預覽時才啟動。

載入 `public/demo/demo-bundle.json` 可檢查高血脂；HF 合成案例在 `public/demo/hfrEF/`。必要時設定中開啟 Beta，再到「個人化照護指引」。版面請選 **三區塊**；「新版流程」仍是舊的四步版面。舊瀏覽器會記住 `cdss-layout-preference`，所以看到舊畫面不一定是部署失敗。

## 6. 功能位置與限制

| 功能 | App 路徑（相對 repo 根目錄） |
| --- | --- |
| 三區塊分類／海報色塊 | features/clinical-decision-support/renderers/CdssModuleSections.tsx、cdss-sections.ts、cdss-poster.module.css |
| 診斷／追蹤切換 | 同上目錄 HeartFailureVisitFlow.tsx、HfDiagnosisConfirmation.tsx |
| 喘、沿用主訴、體重 | 同上目錄 HfFollowUpPriorities.tsx；utils/hf-follow-up.ts；stores/clinic-vitals.store.ts |
| 確診保存／提供規則事實 | stores/phenotype-answer.store.ts、utils/apply-phenotype-answer.ts |
| 高血脂診斷清單／分層依據 | renderers/NhiLipidCoverageSummary.tsx、ClinicalDecisionSupportView.tsx |
| PREVENT 呈現與資料確認 | renderers/PreventRiskSummary.tsx、utils/prevent-reading.ts |
| HF 預後模型接線介面 | features/medical-calculator/prognosis/ |

規則 repo 關鍵檔案：`packages/personalized-care/src/clinical-modules/hf-presentation.ts`、`nhi-lipid-review.ts`，以及 `guideline-packs/heart-failure-pack.ts`、`hyperlipidemia-pack.ts`。

- 已確診 HF 預設追蹤；標題可切診斷，不撤銷原確診。主訴變化與體重回報要當次確認，不能自動把上次狀態當今天。
- 三區塊外層（診斷／追蹤、治療、預後）皆預設收合；點標題各自展開，不互相排斥。收合時保留紅字待辦與優先安全提醒。展開後可切換診斷／追蹤；再次收合不清除輸入或覆核。
- 喘／主訴按鈕：惡化、穩定、進步；細節預設關閉。舊「已消失」紀錄仍可讀。
- 體重：增加、不變、減少是本次回報，與量測差值分開。紀錄預設關閉，展開有圖表、來源與新增量測。
- 過去體重不會冒充今日數值；原始主訴只從明確的主訴資料讀取，不把就診診斷碼冒充主訴。
- 高血脂診斷區列所有既有可核對條件；預後列健保分層依據與 PREVENT 說明，兩種風險概念不能混用。
- 高血脂三區塊的 01 標題提供「診斷／追蹤」切換，預設追蹤；這只是畫面選擇，不會宣告確診或修改臨床事實。追蹤列最新 LDL-C 與日期、治療標的、規則套件的達標判讀、最低已知分層與追蹤時程；判讀依據與引用預設收合。切回診斷保留既有人工覆核。病人或 pack 切換後重新使用預設畫面。
- 達標判讀沿用規則套件，App 不重新計算門檻、不將歷史低值自行標成今日達標；分層或檢驗未明時保留待補資料。相關畫面在 `renderers/LipidModuleSections.tsx` 及 `NhiLipidCoverageSummary.tsx`。
- **MAGGIC／SHFM／GWTG-HF 尚未實作預後公式**，目前只有模型資料與引用核對、型別介面；AI-SaMD 尚未連線，沒有死亡率輸出。PREVENT 是既有獨立計算流程，不能因此宣稱 HF 模型已能計算。
- HF 新增確認／主訴／體重使用既有病人分隔、同分頁 session key 的加密暫存，可重載；**不會跨電腦或新的瀏覽器 session 攜帶臨床輸入**。本 handoff 移轉的是程式與開發上下文，不是病人資料。伺服器跨次門診儲存仍待實作。
- NHI/PREVENT 人工覆核使用自己的既有 store；不要假設全部都有同樣的加密重載能力。

進一步說明：[診斷與追蹤](HF-DIAGNOSIS-FOLLOW-UP.md)、[HF 預後接線](HF-PROGNOSIS-CALCULATORS.md)。

## 7. 交付與預覽判定

未來 commit、push、merge 依當次使用者授權與 repo 規範執行。不同臨床改動不要借本文件取得 blanket approval。只推適當 pilot 分支，不發布 npm、不直接推 main/master、不更改部署機制。

需兩個 repo 協作時，先完成兩邊檢查，再推規則與 App。兩次訊號可能取消先前 build，應看**最新**的 run，不能只看第一筆。

```text
gh run list --repo MediPrisma/mediprisma-app --limit 8
gh run list --repo MediPrisma/mediprisma-cdss --limit 5
git -C mediprisma-app rev-parse HEAD
git -C mediprisma-cdss rev-parse HEAD
```

查 `HMC preview build`，再查 `Publish HMC pilot preview`。`Publish` 的 workflow 自 master 執行，headSha 不一定等於 App pilot SHA；最終要用 `hmc-build.json` 的 `appSha` 和 `personalizationSha` 核對。Publisher 顯示成功但版本沒變時，也可能只是前一個取消 build 的無發布流程，不能單憑綠勾宣稱上線。

合併 PR #12 前，上次線上已驗證版本是 App `47b30c38` + 規則 `a30205d`；PR #12 與本 handoff 發布後，須重新讀線上 JSON，不能沿用這個時間點的結論。

## 8. 貼給下一位 agent

> 請先閱讀 App 的 docs/HMC-CDSS-HANDOFF.md 與兩個 repo 的 AGENTS/HMC guide。這是 MediPrisma HMC pilot，App 與規則都以當前 pilot/hmc 為基礎；先查工作樹與最新遠端，不覆蓋未提交變更。PR #12 已合併，請保留三區塊、HF 確診追蹤、主訴／體重、LDL <190 的修正及所有引用。HF MAGGIC/SHFM/GWTG 只是待串接模型，沒有公式。先核對完整 source package 注入與線上兩個 SHA，再依我本次具體任務工作。不要讀出或攜帶憑證與病人資料，不要自動啟動 localhost，也不要把前次發布授權延伸到本次新任務。
