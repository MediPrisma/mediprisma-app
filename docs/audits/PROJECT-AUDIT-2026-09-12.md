# MediPrisma 專案 audit — 2026-09-12

**優先改善臨床手動資料的時效、病人隔離、清除生命週期，以及發布版本的可追溯性。現有工作目錄未通過可發布驗證。**

審查範圍：分支 codex/release-v0.51.1，HEAD 5fd94c419df20bc59682096219952703fbd9f847，加上當時尚未提交的修改與實際安裝套件。本次沒有修改應用程式、套件或部署設定。以下是全專案的風險抽查，並非逐行審閱所有程式、正式滲透測試或臨床指引正確性的全面驗證。

P1：建議在下一次發布前解決。P2：排入近期改善。已重現、程式路徑確認、條件性風險分別標示，避免將所有失敗都當成正式站故障。

## 改善清單

| 編號 | 優先 | 問題 | 證據 |
|---|---|---|---|
| F1 | P1 | 手動數值永久視為最新，可能覆蓋後來的病歷 | 已用合成資料重現 |
| F2 | P1 | CDSS 手動輸入、證據開關及醫師判斷只依病人 ID 隔離 | 已重現儲存層碰撞；呼叫端確認 |
| F3 | P1 | CDSS 臨床資料以明文長期保留，未納入登出／清除流程 | 儲存與清除路徑確認 |
| F4 | P1 | 部署沒有固定使用通過 CI 的 commit | 工作流程與 GitHub 事件規則確認 |
| F5 | P1 | 開發套件與鎖定版本不一致，當前版本無法完整驗證 | 測試、型別、建置、瀏覽器確認 |
| F6 | P2 | 問題回報未寄出時，介面仍宣告成功並清空內容 | 前後端契約確認 |
| F7 | P2 | 整段聊天存入單一 Firestore 文件，長對話有硬上限 | 儲存路徑與官方限制確認 |
| F8 | P2 | 瀏覽器測試未成為發布門檻，coverage 門檻未在主 CI 執行 | 工作流程確認 |
| F9 | P2 | 依賴掃描有 12 個受影響套件項目，須按實際使用條件分流 | npm 官方資料庫掃描 |

### F1 — 手動數值沒有隨時間失效

位置：[手動數值套用與時效判定](<features/clinical-decision-support/utils/apply-clinic-vitals.ts:329>)；[LVEF 趨勢日期](<features/clinical-decision-support/utils/apply-clinic-vitals.ts:172>)。

applyClinicVitals 每次都讓手動值覆蓋 profile 的同名數值，且寫死 ageDays: 0、state: current。儲存資料可跨日甚至跨年還原，但此函式沒有依評估日重算有效期限，也沒有比較是否已有更新的病歷值。

**合成重現：**原始病歷 potassium = 6.1，日期 2026-09-12；舊手動值 potassium = 4.2，日期 2025-01-01。結果使用 4.2，日期保留 2025-01-01，卻標記 ageDays = 0、intervalDays = 90、state = current。這是資料時間處理錯誤；本次沒有聲稱已驗證所有下游治療建議會如何變動。

同一處另有 LVEF 日期不一致：2026-09-12 補登「2023-01-01 的 LVEF 35%」，單一 fact 日期是 2023，但趨勢卻追加「2026-09-12 35%」。既有 2025 年 60% 會被組成「2025 60% → 2026 35%」，把舊報告變成新變化。

**改善：**統一量測日期與登錄日期的用途，以評估日重算時效；明定新病歷與手動修正的優先規則；歷史 LVEF 依量測日期排序。過期修正應保留可追溯性，並要求重新確認才繼續覆蓋。
**驗收：**跨越 30／90／180 天、較新病歷到達、補登舊 LVEF 的案例，均保留正確日期、排序與失效狀態。

### F2 — 不同來源使用相同病人 ID 時，會共用臨床判斷

位置：[LiveFeature 的病人識別](<features/clinical-decision-support/LiveFeature.tsx:163>)；[手動數值儲存鍵](<features/clinical-decision-support/stores/clinic-vitals.store.ts:181>)；[證據開關](<features/clinical-decision-support/stores/evidence-overrides.store.ts:21>)；[醫師判斷](<features/clinical-decision-support/stores/physician-decisions.store.ts:20>)。

呼叫端直接使用 patient.id，三個 store 都只有 patientId 分區，沒有 FHIR server、匯入批次或使用者範圍。PatientMapper 也保留原始 FHIR id。因此 A 院 Patient/1 與 B 院 Patient/1，或兩份本地匯入使用相同 ID，都會命中相同鍵。這不只影響顯示，還包括已確認診斷與排除證據。

**合成重現：**將 LVEF 35 寫入 Patient-1，清空記憶體 store 後，以同一原始 ID 從儲存層讀取，舊數值會完整還原。LiveFeature 沒有傳入其他來源資訊來避免碰撞。

**改善：**建立共用的臨床資料範圍鍵，至少包含來源／匯入批次、病人、使用者範圍；所有 CDSS store 共用它。舊鍵無法確認來源時應要求重新確認，避免自動套用。
**驗收：**同 ID、不同醫院；同 ID、不同匯入；不同帳號；兩個分頁並行，均不互相污染。

### F3 — 清除病歷後，CDSS 輸入仍留在裝置

位置：[明文寫入](<features/clinical-decision-support/stores/clinic-vitals.store.ts:276>)；[登出清除流程](<src/application/providers/auth.provider.tsx:374>)；[AI 快取清除範圍](<src/infrastructure/cache/encrypted-session-cache.ts:131>)。

CDSS 的數值、症狀、NYHA 與 HFpEF 確認直接 JSON.stringify 後寫入 localStorage。沒有 TTL 或加密；登出只清理 SMART session、本地 bundle 及 mediprisma:ai-result: 快取。三個 CDSS store 沒有接上 bundle-change 的清除事件，且 cdss-* 鍵不在上述清除範圍內。

**影響：**在共用工作站清除病歷或登出後，仍留下與病人 ID 關聯的臨床資料；下次相同 ID 還可能恢復判斷。

**改善：**明定這些資料是暫存或正式紀錄。若為暫存，納入現有加密、到期、清除及記憶體重設機制；若需長期保存，使用有帳號權限與可追溯性的儲存，並明確告知保留方式。
**驗收：**登出、清除、過期後，此範圍的儲存與記憶體均不可再讀取，同時保留其他分頁獨立範圍的資料。

### F4 — CI 通過的版本不一定是部署的版本

位置：[GitHub Pages checkout](<.github/workflows/gh-pages.yml:27>)；[官網鏡像 checkout](<.github/workflows/sync-mediprisma-app.yml:33>)。

兩個部署流程由 CI 完成事件觸發，但 checkout 沒有指定觸發 CI 的 head_sha。GitHub 的 workflow_run 預設 SHA 指向預設分支的最新 commit，因此在 A 的成功事件觸發時若分支已到 B，可能建置 B，即使 B 尚未通過檢查。官網同步的 commit message 卻使用觸發事件 SHA，也可能使標示與內容不一致。[GitHub 官方事件文件](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)

**改善：**checkout 固定到 workflow_run.head_sha；手動發布也驗證所選版本的檢查結果。更完整的做法是部署 CI 產生並附來源 SHA 的成品。
**驗收：**模擬 A 通過、B 失敗／待驗證，部署只能使用 A，成品中的來源版本與發布紀錄相符。本次未觸發正式部署。

### F5 — 開發依賴與發布依賴分離不完整

位置：[套件宣告](<package.json:60>)；[臨時 HF-only 清單](<features/clinical-decision-support/guideline-packs/registry.ts:46>)；[KFRE 套件出口](<src/core/clinical-calculators/kfre.ts:22>)。

檢查時 node_modules 的數個第一方套件是指向旁邊 mediprisma-cdss 專案的 symlink。其中 personalized-care 實際為 1.13.0，lockfile 為 1.12.0；personalized-care-fhir 實際為 1.5.0，lockfile 為 1.4.2。實際套件缺少 CKD／KFRE 出口，部分檢查也遇到外部套件 dist 檔案不存在。

registry.ts 還留有 TEMP local verification，將原本 HF＋CKD 改成 HF-only。它使本機試驗需要改動正式功能清單，發布前必須確認這些是暫時修改還是獨立核准的產品變更。

**實際結果：**
- Jest：18 suites 失敗、59 tests 失敗；其中多項是缺少 CKD／KFRE 出口或外部 dist，不能直接解讀成 59 個獨立產品缺陷。
- 型別檢查：16 個錯誤，包含套件出口與新 gallery 測試的兩個不安全轉型。
- 正式模式建置：44 個模組解析錯誤。
- 瀏覽器以示範資料打開 KFRE，出現「無法計算此分數（公式發生錯誤）」；錯誤提示本身清楚，沒有把錯誤當成正常結果。

**改善：**把跨專案開發套件放在獨立且可重現的工作環境，以成品 tarball 或鎖定的 workspace revision 整合；發布驗證使用乾淨安裝，增加套件版本／出口／必要 dist 檢查。不要以本次結果斷言正式站或 lockfile 鎖定的已發布套件也壞了。
**驗收：**在不依賴鄰近開發目錄的乾淨安裝中通過型別、測試、兩種正式靜態建置與 KFRE／CKD smoke test；依專案既有流程保護跨平台 lockfile。

### F6 — 問題回報會出現「假成功」

位置：[前端成功判斷](<features/feedback/components/FeedbackDialog.tsx:109>)；[後端未寄信回應](<app/api/feedback/route.ts:218>)。

Next API 未設定 Resend 或收件人時回傳 HTTP 200、success: true、emailSent: false，並沒有其他持久化。前端只看 response.ok，就顯示成功、清空輸入並關閉。此路徑適用於使用本專案 /api/feedback 的部署；正式 Functions 代理是否有相同契約，本次未驗證。

**改善：**前端驗證回應內容，未寄送／未持久化時保留草稿並顯示可恢復的錯誤；後端以明確不可用狀態回應。
**驗收：**模擬 200 + emailSent:false、429、500、網路中斷，均不誤報成功也不丟失草稿。不需實際寄信即可測試。

### F7 — 長對話最終會碰到單一文件上限

位置：[整段對話更新](<src/infrastructure/firebase/repositories/chat-session.repository.ts:175>)；[聊天清單讀取](<src/infrastructure/firebase/repositories/chat-session.repository.ts:240>)。

每次更新把全部 messages（包含 agentStates 等中繼資訊）寫回單一 chat 文件。Firestore 每文件上限為 1 MiB；程式沒有分片、訊息子集合或寫入前容量處理。長篇中文病歷對話達到上限後會停止保存；歷史清單雖只轉成 metadata，仍讀取包含完整 messages 的文件。[Firestore 官方限制](https://firebase.google.com/docs/firestore/quotas)

**改善：**metadata 與 messages 分離，訊息分批載入與增量保存；保留穩定訊息 ID，並為舊資料提供讀取遷移。容量／儲存失敗時提供明確狀態及可匯出草稿。
**驗收：**合成超過 1 MiB 的對話仍可保存／還原；列清單不下載全部逐字稿。本次為結構與上限分析，未向正式 Firestore 寫入測試資料。

### F8 — 使用者完整流程還不能阻擋發布

位置：[E2E 觸發條件](<.github/workflows/e2e.yml:3>)；[主 CI 的單元測試](<.github/workflows/ci.yml:74>)；[Coverage 設定](<jest.config.js:73>)。

E2E 明確獨立於發布流程，只有 master push／手動觸發，失敗不會阻擋部署；主 CI 也沒有執行 coverage，因此已定義的 coverageThreshold 不會在一般測試命令中生效。這讓匯入、病人切換、跨分頁隔離、登出等端到端行為缺乏發布保障。

**改善：**先把少量穩定、合成資料且不連正式 AI／Firebase 的關鍵 smoke tests 納入同一 SHA 的發布門檻；再逐步納入其他 E2E。對病人隔離、資料時間與清除建立專屬測試，coverage 可先採夜間完整檢查、PR 檢查變更範圍。
**驗收：**刻意破壞病人切換或登出清除時，該版本必須無法發布。這次沒有執行整套 Playwright E2E，僅做有限瀏覽器 smoke check。

### F9 — 弱點掃描需更新，且要區分部署條件

位置：[依賴清單](<package.json:66>)；[Next 配置](<next.config.ts:39>)。

本次 npm audit --omit=dev --package-lock-only 回報 **12 個受影響套件項目：critical 1、high 3、moderate 2、low 6**。此數字包含傳遞依賴，不代表 12 個獨立漏洞或 12 條可利用的正式站路徑。

Next 鎖定 16.2.12；官方列出的兩項嚴重問題分別涉及 Windows 上的 Next server，以及 AVIF 影像最佳化，修補版本為 16.3.3。此專案主要部署為靜態匯出，且 images.unoptimized = true，所以不能據此宣稱正式靜態站已可遭遠端程式執行。[Windows 公告](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36) · [AVIF 公告](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4)

DOMPurify 掃描命中的問題要求 IN_PLACE 加特定移除 hook；目前看到的 narrative 路徑使用一般 sanitize(string)，沒有找到該配置，先列依賴更新而非已證實 XSS。[漏洞條件](https://github.com/advisories/GHSA-55q2-fjhq-7xh7)

**改善：**按實際部署條件處理 Next、sharp、PostCSS、DOMPurify 與 AI SDK 更新；以專案允許的套件管理流程更新並核對 lockfile，不直接執行 audit fix。若另有 Windows 的 Next server，優先級需提升。
**驗收：**受影響套件升級後重新掃描，保留每項可達性判斷，並通過靜態建置與核心操作測試。

## 驗證紀錄與限制

| 檢查 | 結果 |
|---|---|
| 全套 Jest，runInBand | 428 suites 通過、18 失敗、1 skipped；4,254 tests 通過、59 失敗、1 skipped |
| TypeScript，停用 incremental | 16 個錯誤 |
| 正式模式 Next build | 44 個模組解析錯誤；使用現有 MEDIPRISMA_GALLERY_E2E distDir 隔離，未執行發布 |
| 來源目錄 ESLint | 0 errors；1 個 useGalleryImport cleanup 警告，另有顯式列入已忽略 next-env.d.ts 的命令層警告 |
| 根目錄 ESLint | 原始命令已停止；排除 .next-gallery-e2e／tmp 後仍有 9 errors、5 warnings，全部位於另一個衍生目錄 .next-gallery-build/types；不可列為通過 |
| Lockfile 平台完整性 | 通過；此檢查不等於 node_modules 與 lockfile 相符 |
| npm 生產依賴弱點掃描 | 完成，12 個受影響套件項目 |
| 合成資料重現 | 手動值來源碰撞、明文儲存、過期值標為 current、LVEF 日期錯置 |
| 瀏覽器 | 本機首頁、示範資料、醫療摘要、KFRE；桌面約 1280px，手機 390／320px 的有限檢視 |

UI 審查以「醫療人員確認病人、閱讀來源、執行當前任務」為基準。有限畫面中，病人脈絡維持可見、KFRE 失敗有明確提示。320px 時部分分頁標籤截短，值得納入後續可用性檢查；本次沒有完成全部斷點、深色模式、鍵盤、200% zoom 或 WCAG 全面驗證，不能據此認定 UI 已全面合格。

Firebase Functions、正式 Firestore Rules、正式站 response headers 由外部環境／其他專案管理，本次沒有驗證其實際部署內容；沒有讀取或測試真實病歷、寄送回報或修改正式服務。

## 建議執行順序

1. 先固定依賴環境，使測試能穩定重現；同時修 F1／F2／F3，補時間推進、同 ID 跨來源與清除測試。
2. 固定發布 SHA，讓最小關鍵 E2E 跟同一版本一起阻擋發布。
3. 修回報契約、逐步遷移聊天儲存，再處理依賴更新。
4. 後續重構優先拆開 ClinicalDecisionSupportView（約 2,791 行）的決策整理與呈現，以及 generate-medical-summary use case（約 2,551 行）的資料準備／生成／驗證階段。檔案長度是維護成本訊號，本身不是功能缺陷。
5. 補 ESLint 對 .next-gallery-e2e、.next-gallery-build 等衍生目錄的排除，避免新增建置模式後讓品質檢查掃到產物。

