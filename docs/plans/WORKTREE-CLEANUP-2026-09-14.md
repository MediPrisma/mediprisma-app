# 未提交變更整理清單（2026-09-14）

> 最新進度請看末尾「獨立 PR 進度」。原始分組保留作追溯；不能直接按原始分組提交。

## 盤點基準

開始整理時共 128 個變更檔案：82 個已追蹤檔案（含 1 個刪除），46 個新增檔案；無暫存變更。此清單本身不計入。
以下是根據差異與相依關係的初步分組，不代表已完成逐行審查。

## 處理方式

每次完成一組：確認目的與範圍 → 審查差異 → 必要修正 → 相關測試 → 視影響做 lint、正式建置及瀏覽器驗證 → 分組提交。
共用檔案按差異區塊拆分；不可按資料夾整批提交。保留所有既有工作。

## 優先事項

- CDSS 疾病清單：使用者於 2026-09-14 確認「只剩心衰竭就好」。保留 HF-only 與 HF 預設，移除暫時驗證註解，更新可見性紀錄與路由測試。提交時須包含 `Visible behaviour changes:`，明列 `/` 與所有 launch-query 路由不再提供 CKD 選項。
- 中英翻譯同時包含檢驗來源與範本市集，需分區塊處理。
- 範本市集涵蓋匯入、帳號同步、公開／私人、示範輸出與 E2E 設定，應再分小批；共享的 SharePromptDialog 不宜直接整檔提交。
- 用藥 FeatureCard 變更與用藥版面一起檢查；ICD 的兩個 hook 則歸到獨立修正。
- 刪除 local-bundle-scope.service.ts 目前未找到仍引用該路徑的程式；仍需以型別／建置確認。

## 已做驗證

- ICD 描述去重：既有新增測試 1 組、6 項通過；尚未做 hook 整合與瀏覽器驗證，未標為完成。
- git diff --check 通過（已追蹤差異）。
- HF-only 決定已記錄；移除過時註解並同步可見性測試。相關 2 組測試共 18 項通過，兩個程式／測試檔案 ESLint 通過。
- 尚未暫存或提交。此批未進行完整正式建置與瀏覽器驗證，提交前仍需完成適用檢查。

## 檔案分組

### 01 ICD 描述去重（4 檔）

- `M` `features/clinical-summary/medications/hooks/useMedicationRows.ts`
- `M` `features/clinical-summary/medications/timeline/hooks/useMedicationTimeline.ts`
- `M` `src/shared/utils/icd-lookup.ts`
- `??` `__tests__/shared/icd-description.test.ts`

### 02 用藥日期與版面（19 檔）

- `M` `__tests__/features/medications/MedicationItem-audience-density.test.tsx`
- `M` `features/clinical-summary/medications/MedListCard.tsx`
- `M` `features/clinical-summary/medications/components/MedicationItem.tsx`
- `M` `src/shared/components/FeatureCard.tsx`
- `??` `__tests__/features/medications/medication-end-date-fit.test.tsx`
- `??` `features/clinical-summary/medications/hooks/useMedicationEndDateFit.ts`
- `??` `scripts/experiments/medication-date-fit/README.md`
- `??` `scripts/experiments/medication-date-fit/RESULTS-OPTIMIZED.md`
- `??` `scripts/experiments/medication-date-fit/RESULTS.md`
- `??` `scripts/experiments/medication-date-fit/generate-fhir.mjs`
- `??` `scripts/experiments/medication-date-fit/measurement-control.tsx.template`
- `??` `scripts/experiments/medication-date-fit/metadata-optimized.json`
- `??` `scripts/experiments/medication-date-fit/metadata.json`
- `??` `scripts/experiments/medication-date-fit/page.tsx.template`
- `??` `scripts/experiments/medication-date-fit/prepare.mjs`
- `??` `scripts/experiments/medication-date-fit/results-optimized.csv`
- `??` `scripts/experiments/medication-date-fit/results-scroll-only.csv`
- `??` `scripts/experiments/medication-date-fit/results.csv`
- `??` `scripts/experiments/medication-date-fit/visual.tsx.template`

### 03 檢驗資料來源（19 檔）

- `M` `__tests__/core/utils/observation-provenance.utils.test.ts`
- `M` `__tests__/features/reports/LabDayGroupCard-source-program.test.tsx`
- `M` `__tests__/features/reports/lab-day-grouping.test.ts`
- `M` `__tests__/features/reports/useReportsData-source-program.test.ts`
- `M` `__tests__/infrastructure/fhir/mappers/fhir.mapper.test.ts`
- `M` `features/clinical-summary/reports/components/LabDayGroupCard.tsx`
- `M` `features/clinical-summary/reports/components/LabPivotTable.tsx`
- `M` `features/clinical-summary/reports/components/ReportRow.tsx`
- `M` `features/clinical-summary/reports/hooks/useOrphanObservations.ts`
- `M` `features/clinical-summary/reports/hooks/useReportsData.ts`
- `M` `features/clinical-summary/reports/types/index.ts`
- `M` `features/clinical-summary/reports/utils/lab-day-grouping.ts`
- `M` `src/core/entities/clinical-data.entity.ts`
- `M` `src/infrastructure/fhir/mappers/fhir.mapper.ts`
- `M` `src/shared/types/fhir.types.ts`
- `M` `src/shared/utils/lab-pivot.utils.ts`
- `M` `src/shared/utils/observation-provenance.utils.ts`
- `??` `__tests__/features/reports/NhiMedicloudSourceIndicator.test.tsx`
- `??` `features/clinical-summary/reports/components/NhiMedicloudSourceIndicator.tsx`

### 04 HFpEF 計算機（15 檔）

- `M` `__tests__/features/medical-calculator/autofill-loading-state.test.tsx`
- `M` `features/medical-calculator/autofill-compute.ts`
- `M` `features/medical-calculator/calculators/index.ts`
- `M` `features/medical-calculator/calculators/info.ts`
- `M` `features/medical-calculator/calculators/scoring.ts`
- `M` `features/medical-calculator/calculators/tags.ts`
- `M` `features/medical-calculator/components/CalculatorDetail.tsx`
- `M` `features/medical-calculator/hooks/use-lab-autofill.hook.ts`
- `M` `features/medical-calculator/types.ts`
- `??` `__tests__/features/medical-calculator/hfpef-clinical-autofill.test.ts`
- `??` `__tests__/features/medical-calculator/hfpef.test.ts`
- `??` `docs/medical-calculator/HFPEF-VALIDATION.md`
- `??` `features/medical-calculator/calculators/hfpef.ts`
- `??` `features/medical-calculator/echo-autofill.ts`
- `??` `features/medical-calculator/hfpef-clinical-autofill.ts`

### 05 心衰竭 CDSS 輸入與呈現（17 檔）

- `M` `__tests__/features/clinical-decision-support/apply-clinic-vitals.test.ts`
- `M` `__tests__/features/clinical-decision-support/clinic-vitals.store.test.ts`
- `M` `__tests__/features/clinical-decision-support/heart-failure-board.test.tsx`
- `M` `__tests__/features/clinical-decision-support/hf-inline-decisions.test.ts`
- `M` `__tests__/features/clinical-decision-support/hf-status-line-editing.test.tsx`
- `M` `features/clinical-decision-support/LiveFeature.tsx`
- `M` `features/clinical-decision-support/renderers/ClinicalDecisionSupportView.tsx`
- `M` `features/clinical-decision-support/renderers/EvidenceTablePanel.tsx`
- `M` `features/clinical-decision-support/renderers/HeartFailureStatusBoard.tsx`
- `M` `features/clinical-decision-support/renderers/heart-failure-board.ts`
- `M` `features/clinical-decision-support/stores/clinic-vitals.store.ts`
- `M` `features/clinical-decision-support/utils/apply-clinic-vitals.ts`
- `??` `__tests__/features/clinical-decision-support/hf-phenotype-gate-wiring.test.tsx`
- `??` `docs/plans/CDSS-PATIENT-HISTORY-SYNC-2026-09-11.md`
- `??` `docs/plans/CDSS-STORAGE-FIELD-CATALOG-2026-09-12.md`
- `??` `docs/plans/HF-CDSS-USER-INPUT-SURVEY-2026-09-11.md`
- `??` `features/clinical-decision-support/renderers/PhysicianInputRequestPanel.tsx`

### 06 範本市集與帳號同步（43 檔）

- `M` `.gitignore`
- `M` `__tests__/features/medical-chat/MedicalChat.model-privacy.test.tsx`
- `M` `__tests__/features/prompt-gallery/gallery-flow.test.tsx`
- `M` `__tests__/features/prompt-gallery/gallery-storage.test.ts`
- `M` `__tests__/features/prompt-gallery/prompt-specialty-controls.test.tsx`
- `M` `__tests__/features/prompt-gallery/prompt-specialty-filter.test.ts`
- `M` `__tests__/features/prompt-gallery/share-prompt-long-content.test.tsx`
- `M` `__tests__/features/prompt-gallery/tenant-prompts-flow.test.tsx`
- `M` `__tests__/features/right-feature-tour/guided-dialogs.test.tsx`
- `M` `docs/LAUNCH-ROUTE-GATES.md`
- `M` `docs/PROMPT_GALLERY.md`
- `M` `e2e/README.md`
- `M` `features/clinical-insights/components/CustomInsightModulesManager.tsx`
- `M` `features/medical-chat/components/MedicalChat.tsx`
- `M` `features/prompt-gallery/components/PromptCard.tsx`
- `M` `features/prompt-gallery/components/PromptGalleryDialog.tsx`
- `M` `features/prompt-gallery/components/PromptPreviewDialog.tsx`
- `M` `features/prompt-gallery/components/PromptTable.tsx`
- `M` `features/prompt-gallery/components/SharePromptDialog.tsx`
- `M` `features/prompt-gallery/services/prompt-gallery.service.ts`
- `M` `features/prompt-gallery/types/prompt.types.ts`
- `M` `features/right-feature-tour/right-feature-tour.steps.ts`
- `M` `features/settings/components/ChatTemplatesSettings.tsx`
- `M` `next.config.ts`
- `M` `src/application/providers/chat-templates.provider.tsx`
- `M` `src/application/providers/clinical-insights-config.provider.tsx`
- `M` `src/infrastructure/firebase/clinical-insights-sync.ts`
- `M` `src/infrastructure/firebase/template-sync.ts`
- `M` `tsconfig.json`
- `??` `__tests__/application/gallery-source-sync.test.ts`
- `??` `__tests__/application/gallery-template-import.test.tsx`
- `??` `__tests__/application/services/demo-example-context.service.test.ts`
- `??` `__tests__/features/prompt-gallery/gallery-import-workflow.test.tsx`
- `??` `__tests__/features/prompt-gallery/gallery-manager-import.test.tsx`
- `??` `__tests__/features/prompt-gallery/share-prompt-example-output.test.tsx`
- `??` `e2e/gallery/firebase.json`
- `??` `e2e/gallery/gallery-import.spec.ts`
- `??` `features/prompt-gallery/components/PromptVisibilityBadge.tsx`
- `??` `features/prompt-gallery/hooks/useDemoExampleOutput.ts`
- `??` `features/prompt-gallery/hooks/useGalleryImport.tsx`
- `??` `playwright.gallery.config.ts`
- `??` `src/application/services/demo-example-context.service.ts`
- `??` `src/shared/utils/gallery-template.utils.ts`

### 07 共用介面微調（4 檔）

- `M` `__tests__/layouts/LeftPanelLayout-performance.test.tsx`
- `M` `components/ui/label.tsx`
- `M` `features/medical-summary/Feature.tsx`
- `M` `src/layouts/LeftPanelLayout.tsx`

### 08 文件與資料整理（4 檔）

- `D` `src/application/services/local-bundle-scope.service.ts`
- `??` `docs/UX-OPPORTUNITIES-AUDIT-2026-09-12.md`
- `??` `docs/audits/PROJECT-AUDIT-2026-09-12.md`
- `??` `scripts/align-reconstructed-fhir-bundle.mjs`

### 09 可見性設定：優先釐清（1 檔）

- `M` `features/clinical-decision-support/guideline-packs/registry.ts`

### 10 跨功能共用檔案（2 檔）

- `M` `src/shared/i18n/locales/en.ts`
- `M` `src/shared/i18n/locales/zh-TW.ts`

## 遠端核對更新（2026-09-14）

先前盤點僅以本機 HEAD 為準，不能當成尚未合併的工作。fetch 後，本機分支 codex/release-v0.51.1 與 origin/master 分歧：遠端獨有 46 個提交，本機獨有 10 個提交。

- 正式版 HF-only 已在遠端；PR #83 已於 2026-09-12 合併，且遠端規則與套件版本更晚，不能用本機舊測試覆蓋。
- ICD 描述去重的 3 個程式檔案及 1 個測試檔案均與 origin/master 完全相同，對應已合併 PR #63。無需重複 PR。
- HFpEF 計算機已有合併 PR #82，後续需按實際差異核對。
- 下一步先按遠端逐檔分類，再處理仍屬獨有的修改。不同不代表新增需求，也可能已被新版取代。

### 與遠端完全相同（53 檔）

- `__tests__/features/medical-calculator/autofill-loading-state.test.tsx`
- `__tests__/features/medications/MedicationItem-audience-density.test.tsx`
- `__tests__/features/prompt-gallery/prompt-specialty-controls.test.tsx`
- `__tests__/features/prompt-gallery/prompt-specialty-filter.test.ts`
- `__tests__/features/prompt-gallery/share-prompt-long-content.test.tsx`
- `__tests__/features/prompt-gallery/tenant-prompts-flow.test.tsx`
- `__tests__/features/right-feature-tour/guided-dialogs.test.tsx`
- `__tests__/layouts/LeftPanelLayout-performance.test.tsx`
- `components/ui/label.tsx`
- `features/clinical-summary/medications/MedListCard.tsx`
- `features/clinical-summary/medications/components/MedicationItem.tsx`
- `features/clinical-summary/medications/hooks/useMedicationRows.ts`
- `features/clinical-summary/medications/timeline/hooks/useMedicationTimeline.ts`
- `features/medical-calculator/autofill-compute.ts`
- `features/medical-calculator/calculators/index.ts`
- `features/medical-calculator/calculators/info.ts`
- `features/medical-calculator/calculators/scoring.ts`
- `features/medical-calculator/calculators/tags.ts`
- `features/medical-calculator/hooks/use-lab-autofill.hook.ts`
- `features/medical-calculator/types.ts`
- `features/prompt-gallery/components/PromptCard.tsx`
- `features/prompt-gallery/components/PromptPreviewDialog.tsx`
- `features/prompt-gallery/components/PromptTable.tsx`
- `features/prompt-gallery/types/prompt.types.ts`
- `features/right-feature-tour/right-feature-tour.steps.ts`
- `src/shared/components/FeatureCard.tsx`
- `src/shared/utils/icd-lookup.ts`
- `__tests__/application/services/demo-example-context.service.test.ts`
- `__tests__/features/medical-calculator/hfpef-clinical-autofill.test.ts`
- `__tests__/features/medical-calculator/hfpef.test.ts`
- `__tests__/features/medications/medication-end-date-fit.test.tsx`
- `__tests__/features/prompt-gallery/share-prompt-example-output.test.tsx`
- `__tests__/shared/icd-description.test.ts`
- `docs/medical-calculator/HFPEF-VALIDATION.md`
- `features/clinical-summary/medications/hooks/useMedicationEndDateFit.ts`
- `features/medical-calculator/calculators/hfpef.ts`
- `features/medical-calculator/hfpef-clinical-autofill.ts`
- `features/prompt-gallery/components/PromptVisibilityBadge.tsx`
- `features/prompt-gallery/hooks/useDemoExampleOutput.ts`
- `scripts/experiments/medication-date-fit/README.md`
- `scripts/experiments/medication-date-fit/RESULTS-OPTIMIZED.md`
- `scripts/experiments/medication-date-fit/RESULTS.md`
- `scripts/experiments/medication-date-fit/generate-fhir.mjs`
- `scripts/experiments/medication-date-fit/measurement-control.tsx.template`
- `scripts/experiments/medication-date-fit/metadata-optimized.json`
- `scripts/experiments/medication-date-fit/metadata.json`
- `scripts/experiments/medication-date-fit/page.tsx.template`
- `scripts/experiments/medication-date-fit/prepare.mjs`
- `scripts/experiments/medication-date-fit/results-optimized.csv`
- `scripts/experiments/medication-date-fit/results-scroll-only.csv`
- `scripts/experiments/medication-date-fit/results.csv`
- `scripts/experiments/medication-date-fit/visual.tsx.template`
- `src/application/services/demo-example-context.service.ts`

### 遠端有但內容不同（57 檔）

- `.gitignore`
- `__tests__/core/utils/observation-provenance.utils.test.ts`
- `__tests__/features/clinical-decision-support/apply-clinic-vitals.test.ts`
- `__tests__/features/clinical-decision-support/clinic-vitals.store.test.ts`
- `__tests__/features/clinical-decision-support/heart-failure-board.test.tsx`
- `__tests__/features/clinical-decision-support/pilot-pack-registry.test.ts`
- `__tests__/features/medical-chat/MedicalChat.model-privacy.test.tsx`
- `__tests__/features/prompt-gallery/gallery-flow.test.tsx`
- `__tests__/features/prompt-gallery/gallery-storage.test.ts`
- `__tests__/features/reports/LabDayGroupCard-source-program.test.tsx`
- `__tests__/features/reports/lab-day-grouping.test.ts`
- `__tests__/features/reports/useReportsData-source-program.test.ts`
- `__tests__/infrastructure/fhir/mappers/fhir.mapper.test.ts`
- `docs/LAUNCH-ROUTE-GATES.md`
- `docs/PROMPT_GALLERY.md`
- `e2e/README.md`
- `features/clinical-decision-support/LiveFeature.tsx`
- `features/clinical-decision-support/guideline-packs/registry.ts`
- `features/clinical-decision-support/renderers/ClinicalDecisionSupportView.tsx`
- `features/clinical-decision-support/renderers/EvidenceTablePanel.tsx`
- `features/clinical-decision-support/renderers/HeartFailureStatusBoard.tsx`
- `features/clinical-decision-support/renderers/heart-failure-board.ts`
- `features/clinical-decision-support/stores/clinic-vitals.store.ts`
- `features/clinical-decision-support/utils/apply-clinic-vitals.ts`
- `features/clinical-insights/components/CustomInsightModulesManager.tsx`
- `features/clinical-summary/reports/components/LabDayGroupCard.tsx`
- `features/clinical-summary/reports/components/LabPivotTable.tsx`
- `features/clinical-summary/reports/components/ReportRow.tsx`
- `features/clinical-summary/reports/hooks/useOrphanObservations.ts`
- `features/clinical-summary/reports/hooks/useReportsData.ts`
- `features/clinical-summary/reports/types/index.ts`
- `features/clinical-summary/reports/utils/lab-day-grouping.ts`
- `features/medical-calculator/components/CalculatorDetail.tsx`
- `features/medical-chat/components/MedicalChat.tsx`
- `features/medical-summary/Feature.tsx`
- `features/prompt-gallery/components/PromptGalleryDialog.tsx`
- `features/prompt-gallery/components/SharePromptDialog.tsx`
- `features/prompt-gallery/services/prompt-gallery.service.ts`
- `features/settings/components/ChatTemplatesSettings.tsx`
- `next.config.ts`
- `src/application/providers/chat-templates.provider.tsx`
- `src/application/providers/clinical-insights-config.provider.tsx`
- `src/application/services/local-bundle-scope.service.ts [本機刪除]`
- `src/core/entities/clinical-data.entity.ts`
- `src/infrastructure/fhir/mappers/fhir.mapper.ts`
- `src/infrastructure/firebase/clinical-insights-sync.ts`
- `src/infrastructure/firebase/template-sync.ts`
- `src/layouts/LeftPanelLayout.tsx`
- `src/shared/i18n/locales/en.ts`
- `src/shared/i18n/locales/zh-TW.ts`
- `src/shared/types/fhir.types.ts`
- `src/shared/utils/lab-pivot.utils.ts`
- `src/shared/utils/observation-provenance.utils.ts`
- `tsconfig.json`
- `features/clinical-decision-support/renderers/PhysicianInputRequestPanel.tsx`
- `features/medical-calculator/echo-autofill.ts`
- `playwright.gallery.config.ts`

### 遠端沒有（20 檔）

- `__tests__/features/clinical-decision-support/hf-inline-decisions.test.ts`
- `__tests__/features/clinical-decision-support/hf-status-line-editing.test.tsx`
- `__tests__/application/gallery-source-sync.test.ts`
- `__tests__/application/gallery-template-import.test.tsx`
- `__tests__/features/clinical-decision-support/hf-phenotype-gate-wiring.test.tsx`
- `__tests__/features/prompt-gallery/gallery-import-workflow.test.tsx`
- `__tests__/features/prompt-gallery/gallery-manager-import.test.tsx`
- `__tests__/features/reports/NhiMedicloudSourceIndicator.test.tsx`
- `docs/UX-OPPORTUNITIES-AUDIT-2026-09-12.md`
- `docs/audits/PROJECT-AUDIT-2026-09-12.md`
- `docs/plans/CDSS-PATIENT-HISTORY-SYNC-2026-09-11.md`
- `docs/plans/CDSS-STORAGE-FIELD-CATALOG-2026-09-12.md`
- `docs/plans/HF-CDSS-USER-INPUT-SURVEY-2026-09-11.md`
- `docs/plans/WORKTREE-CLEANUP-2026-09-14.md`
- `e2e/gallery/firebase.json`
- `e2e/gallery/gallery-import.spec.ts`
- `features/clinical-summary/reports/components/NhiMedicloudSourceIndicator.tsx`
- `features/prompt-gallery/hooks/useGalleryImport.tsx`
- `scripts/align-reconstructed-fhir-bundle.mjs`
- `src/shared/utils/gallery-template.utils.ts`

## 獨立 PR 進度

### 範本說明清空

- PR：https://github.com/MediPrisma/mediprisma-app/pull/95 （已提交並推送，待審查／CI）。

- 確認為最新主分支仍存在的 bug：`description: undefined` 被省略，Firestore 保留舊值。
- 從 `origin/master` 的 d48aaba9 建立 `codex/fix-gallery-description-clear`，工作目錄 `/private/tmp/mediprisma-gallery-description`。
- 提交 `91399bf3`，只改 2 個檔案：service 與 gallery-storage test。
- 回歸測試在原 service 重現失敗；修正後 15 組／90 項市集測試通過，相關 ESLint 與 diff check 通過。未跑完整 build／browser；重用原工作區依賴，鎖定依賴交由 CI 驗證。

### 下一批：範本匯入避免重複與帳號同步

- 遠端已有私人範本、示範輸出，不需要再帶入舊 SharePromptDialog／PromptGalleryDialog 差異。
- 獨有工作是 useGalleryImport、gallery-template.utils、兩個 provider 與 Firebase sourcePromptKey／sourcePromptFingerprint 保存、相關匯入流程及測試。
- 後續需从最新 master 拆出；涉及對話框，必須按 UI 規範實際瀏覽器驗證後發 PR。
- 檢驗來源標記仍為另一獨立批次。

### 保全

- 原工作區未清除、未切分支。備份在 `/private/tmp/mediprisma-cleanup-20260914/`：tracked.patch、untracked.tar.gz、source.json。
- 本機原分支仍有 10 個不在遠端歷史的提交，尚未逐一判定是否已被 squash 或替代，不可重設原分支。

## 範本重複匯入：PR #96 已提交

- PR：https://github.com/MediPrisma/mediprisma-app/pull/96
- 分支 `codex/gallery-import-dedup`，提交 `ab52f581`；工作目錄 `/private/tmp/mediprisma-gallery-import`。
- 從最新 master 拆出 19 個檔案，不帶入旧版聊天智慧標題與其他未提交功能。
- 行為：重複來源沿用已存版本；來源更新時選擇保留／更新／副本；來源資訊隨帳號同步。
- 全專案 487 組、4702 項測試通過，1 項原有測試略過；型別、全域 lint（1 原有 warning）及正式 Turbopack 靜態建置通過。
- Chromium 配合 Firebase 模擬器，三個匯入入口與既有市集發現／匯入測試通過；手機至桌面與橫向畫面已驗證。測試服務已關閉。
- 原工作區仍完整保留；PR 尚未合併。下一個待整理功能為健保雲端檢驗來源標記。

## 範本版本與驗收（2026-09-14）

- PR #96 後續已修正：完全相同範本帶入會顯示提醒，沒有成功帶入不增加使用次數；最新相關提交 `8f974a8c`。
- 範本版本 PR #97：https://github.com/MediPrisma/mediprisma-app/pull/97 ，基底為 PR #96 分支；工作目錄 `/private/tmp/mediprisma-template-versions`。
- App 提交 `56cb4317`、`ba2db9d4`：V1 基準、實質內容儲存升版、來源版本保存、表格獨立版本欄。使用者已在 localhost:3020 驗收通過；已 commit/push，尚未合併。
- Firebase PR #3：https://github.com/voho0000/firebase-smart-on-fhir/pull/3 ，提交 `a571113`、`afaccdc`。
- 過渡 Rules 已依使用者授權部署至 `smart-on-fhir-ac97d` 的 `mediprisma` 資料庫，發布後讀回比對相同。舊 app 無版本文件仍可新增/編輯；已版本化文件允許原版號編輯，避免正式舊版使用受阻。舊 app 不會自動升版，後續新版上線後再評估收緊。
- 正式資料未執行 V1 backfill。原始 dirty 工作區保全狀態不變。
- 下一批：核對健保雲端檢驗來源標記與最新 master 的實際差異，獨立整理，不將舊版內容整檔覆蓋新版。

## 健保雲端檢驗來源標記：PR #98

- PR：https://github.com/MediPrisma/mediprisma-app/pull/98 ，提交 `0af97bbe`，分支 `codex/nhi-lab-source-provenance`。
- 隔離工作目錄 `/private/tmp/mediprisma-nhi-lab-source`，基於 master `d48aaba9`。已 commit/push/PR，尚未合併。
- 報告列、日群組、累積檢驗顯示明確來源；院所缺少則標示未提供，不將健保署當檢驗院所。
- 混合來源不整組誤標；保留每筆來源與主線完整時間/performer/method 分組，不搬回 dirty 舊版退步。
- 4 組33項測試、tsc、lockfile check、正式build通過；lint 0 errors、1個既有warning。桌面/390/320實際元件與點擊說明檢查完成。
- 測試頁已移除、3031已停止，3019/3020保持不動。原工作區變更仍保留。
- 下一批候選：心衰竭 CDSS 輸入與呈現，需先比對最新主線與已合併 PR，不能照原始17檔直接移植。

## 心衰竭 CDSS 批次：核對完成，舊架構已被取代

- 2026-09-14 唯讀比對最新主線（核對過程由 b348ed6e 前進至 2e912f15）。本批不開 PR，不將舊版程式套回。
- 主線 #83/#84/#86 與後續修正已有看診流程、逐欄量測日/修改日、partial patch、加密暫存。另有 3cd912d5 的 HF 跨次保存；不應將其等同完整跨電腦同步與每日事件歷程。
- dirty clinic-vitals/apply-clinic-vitals 回退共用日期、整份儲存與 freshness age=0/current；移植會破壞新版時間與答案語義。
- PhysicianInputRequestPanel/phenotype tests 主線已有較完整流程及測試；echo-autofill 主線有 paired E/A velocity 防誤判修正，不帶回 dirty 舊碼。
- 三份 CDSS 同步/儲存/輸入調查文件仍保留為規劃資料，未授權在本批擴大實作跨電腦同步；未來需按新主線校準。
- 原有程式、測試、文件未刪除，原分支未重設。因無執行程式變更，本批不重跑測試與瀏覽器。

## 醫療摘要錯誤處理：逐項決策（2026-09-14）

- 第 11 項「窄側欄錯誤提示改上下排列、按鈕加高」：**不採用，已結案，從待辦排除**。使用者看過 Before/After 後選擇保留目前較省空間的左右排版；除非使用者重新提出需求，不再列為待處理。舊提交 95e75baa 中的此項變更不得移植。
- 第 6 項「全部標準摘要卡片同一錯誤時合併訊息」：使用者已授權 commit、push、PR。僅六張卡片全部有相同顯示錯誤時合併為醫療摘要；部分失敗、不同錯誤及額外 summaryError 保留原行為。
- 第 6 項隔離工作目錄：`/private/tmp/mediprisma-summary-error-dedup`，分支 `codex/summary-error-dedup`。兩組 12 項測試、相關 lint、TypeScript 及正式 webpack build 通過；未改 localhost:3020，未納入其餘摘要行為。
- 第 6 項已提交並推送：`f368ebe6`，PR #103：https://github.com/MediPrisma/mediprisma-app/pull/103 。尚未合併或部署。

- 第 9 項「容量超限時保留調整資料範圍操作」：主線已涵蓋，依使用者決策結案並從待辦排除，不另開 PR。

- 第 8 項不採用「AI 設定」入口；改為錯誤提示中的「切換模型」。依使用者決策，點擊後移至醫療摘要上方既有模型選擇器並直接展開，切換模型後仍由使用者按「重試」，不自動生成。隔離分支 `codex/summary-error-model-picker`，提交 `7f375ddc`，PR #106：https://github.com/MediPrisma/mediprisma-app/pull/106 。已 commit/push/PR，尚未合併或部署。

- 第 7 項「新模型失敗時保留上一版摘要並顯示本次錯誤」：使用者已同意實作。隔離工作目錄 `/private/tmp/mediprisma-summary-retained-errors`，分支 `codex/summary-retained-errors`，基於 master `d2c2b6df`。修改 2 個程式檔與 1 個測試檔；關鍵測試 41 項、相關 ESLint、TypeScript、lockfile check 與正式 Turbopack build 通過。提交 `de011788`，PR #107：https://github.com/MediPrisma/mediprisma-app/pull/107 。已 commit/push/PR，尚未合併或部署。B 成功卡片逐張顯示與只重試失敗卡片的既有流程不變。

- 第 10 項改為「安全警示錯誤與重試集中到摘要上方」：使用者看過安全警示單獨失敗及一般摘要／安全警示同時失敗的 Before/After 後核准。安全卡有舊成功內容時繼續顯示內容；首次失敗且沒有內容時不顯示空卡。上方錯誤區列出所有失敗卡片並只提供一個重試，既有精準重試只重跑失敗卡片。
- 第 10 項隔離工作目錄：`/private/tmp/mediprisma-summary-safety-retry`，分支 `codex/summary-safety-retry`，提交 `7babe5f1`，PR #109：https://github.com/MediPrisma/mediprisma-app/pull/109 。兩組 8 項測試與相關 ESLint 通過，試用資料瀏覽器檢查確認成功安全卡仍正常顯示。webpack 已完成編譯，但完整建置被最新主線既有的 CDSS `CdssCriterionSummary` 匯出型別錯誤阻擋；本分支未修改該檔案。
