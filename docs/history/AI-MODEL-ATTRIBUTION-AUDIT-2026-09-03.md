# 模型名稱、實際模型與回退提醒稽核

稽核日期：2026-09-03。版本：master `d88e37947f30cda4c1fcbbde05bce1d83b0842e6`。

範圍涵蓋 Gemini 回應 metadata、串流 middleware、Agent 多步驟、摘要重試、聊天歷史儲存、模型名稱與 ⓘ、執行紀錄。以下三項是上述版本的稽核發現，後續均已修正，修正方式與回歸測試見文末。

## 結果

發現三個可重現問題，均為 P2。一般單次請求的已確認回退、未回報提示，以及 metadata 到達後更新畫面的流程通過既有測試。

### 1. 只重跑失敗卡片，會抹掉保留卡片的模型來源

- 位置：[use-medical-summary.hook.ts:185–199](https://github.com/MediPrisma/mediprisma-app/blob/d88e37947f30cda4c1fcbbde05bce1d83b0842e6/src/application/hooks/medical-summary/use-medical-summary.hook.ts#L185)、[結果合併處:569–576](https://github.com/MediPrisma/mediprisma-app/blob/d88e37947f30cda4c1fcbbde05bce1d83b0842e6/src/application/hooks/medical-summary/use-medical-summary.hook.ts#L569)。
- 重現：使用者選 3.8，第一輪實際使用 Lite，部分卡片成功、用藥卡失敗。按重跑失敗卡片，第二輪只重跑用藥並回報 3.8。
- 實際：成功的 Lite 卡片內容保留，但整份摘要的 `actualModelIds` 只剩 `gemini-3.8-flash`。畫面因此顯示 3.8 並撤掉回退警告。執行紀錄也在新一輪開始時清除舊紀錄。
- 原因：每次 `run` 重新建立模型紀錄，沒有保留 `retryRequest.baseResult.generation.modelExecution`，結果卻合併前一輪內容。
- 建議：針對保留卡片保存並合併其來源；理想上使用每張卡片的模型紀錄，僅替換實際重跑卡片的來源。整份摘要的模型清單由目前保留的卡片彙整。
- 驗證：實際呼叫 `useMedicalSummary().retryFailedModules()`，以合成資料及模擬解析器隔離運輸；保留內容、重跑內容的斷言通過，保留 Lite 來源的斷言失敗。

### 2. 後一步有回報，會掩蓋前一步沒有回報

- 位置：[ai-model-execution.ts:9–18](https://github.com/MediPrisma/mediprisma-app/blob/d88e37947f30cda4c1fcbbde05bce1d83b0842e6/src/shared/utils/ai-model-execution.ts#L9)、[ModelExecutionNotice.tsx:9–10](https://github.com/MediPrisma/mediprisma-app/blob/d88e37947f30cda4c1fcbbde05bce1d83b0842e6/src/shared/components/ModelExecutionNotice.tsx#L9)。
- 重現：Gemini Agent 的第一個模型呼叫要求執行工具，但沒有回報 `modelVersion`；工具完成後，第二個模型呼叫回報 3.8 並產生答案。
- 實際：最終 `actualModelId` 為 3.8、`actualModelIds` 只有 3.8、提醒為 `null`，ⓘ 消失。前一個模型呼叫的身分仍未確認。
- 原因：資料結構只保存最後回報值與已確認模型清單，沒有保存「已完成但未回報」的步驟。
- 建議：區分呼叫開始、呼叫完成與模型回報；保留每一步確認狀態。前段仍有未確認模型時，名稱可維持最後已確認模型，但 ⓘ 應說明部分步驟未回報。不要把串流開始時暫時沒有 metadata 永久當成未回報。
- 驗證：使用真正的 Google AI SDK、`streamText`、兩步工具呼叫及模擬 HTTP SSE。兩次 HTTP 呼叫與最終答案均通過斷言，但預期保留不確定性提醒的斷言失敗。

### 3. 自訂模型未回報時，不會顯示使用者所選的模型名稱

- 位置：[ChatMessageList.tsx:430–433](https://github.com/MediPrisma/mediprisma-app/blob/d88e37947f30cda4c1fcbbde05bce1d83b0842e6/features/medical-chat/components/ChatMessageList.tsx#L430)、[ai-model-execution.ts:36–38](https://github.com/MediPrisma/mediprisma-app/blob/d88e37947f30cda4c1fcbbde05bce1d83b0842e6/src/shared/utils/ai-model-execution.ts#L36)。
- 重現：自訂端點選擇 `qwen2.5vl:7b`，回應沒有模型欄位，聊天元件已收到該 profile 對應的名稱。
- 實際：顯示 `OpenAI-compatible ⓘ`，而非 `qwen2.5vl:7b ⓘ`。
- 原因：有 `modelExecution` 時會跳過 `customModelDisplayNames`；共用名稱函式只取得邏輯 profile ID，拿不到實際選擇的 upstream 名稱。摘要與執行紀錄也使用相同函式。
- 建議：在請求開始時把所選模型的顯示名稱及 upstream ID 一併保存在不可變的執行紀錄。未回報時使用當次保存的名稱，避免日後修改端點設定連帶改掉歷史名稱。
- 驗證：渲染真正的 `ChatMessageList` 並提供 profile 名稱，預期所選名稱的斷言失敗；DOM 顯示 `OpenAI-compatible`。

## 原始稽核驗證

- 既有相關測試：12 個套件、89 個測試全部通過。
- 新增稽核重現：3 個缺陷斷言失敗；另有 ⓘ 點擊開啟的檢查通過。
- 全部使用合成資料與模擬 API，沒有真實病歷或額外模型費用。
- 沒有重跑正式站的實際 API 請求；前一輪已檢查基準版本的 320–1440 寬度、手機觸控與深色模式。

## 修正與回歸測試

1. 摘要保存每張卡片的模型來源；局部重跑只替換重跑卡片的來源，再由目前保留的卡片彙整模型清單。既有只有整份摘要來源的快取仍可讀取。局部重跑不再主動清空既有診斷紀錄，但紀錄數量仍遵循既有上限；完整重跑則建立新的來源清單。
2. 每次模型呼叫完成時，若沒有回報模型，保存 `hasUnreportedSteps`。之後步驟有回報也不會抹掉這項狀態。只有串流剛開始、尚未收到 metadata，不會永久標為未回報。部分步驟未回報時，顯示最後已確認模型並保留 ⓘ 說明。
3. 自訂端點在請求開始時保存當次 upstream 模型名稱 `customModelId`。未回報時顯示此名稱，日後修改 profile 不會改變已保存的歷史名稱；舊版缺少快照的聊天紀錄仍可使用目前可取得的 profile 名稱。

回歸檢查涵蓋 Lite 卡片保留、只替換重跑卡片、完整重跑移除舊來源、metadata 晚於卡片內容到達、真正 Google SDK 的兩步工具呼叫、ⓘ 互動、自訂名稱與歷史快照。

主要回歸測試：

```sh
npm test -- --runInBand \
  __tests__/application/hooks/medical-summary/summary-model-retry.test.tsx \
  __tests__/infrastructure/ai/model-reporting-multistep.test.ts \
  __tests__/shared/components/model-execution-info.test.tsx
```

驗證結果：38 個 Jest 套件、385 個測試、型別檢查、lint、正式版靜態建置全部通過。另以本機正式版執行兩個 Chromium 情境，檢查真實工具執行後的模型標示、桌面與手機寬度的 ⓘ，兩項均通過。

瀏覽器情境保留在 `e2e/tests/ai-chat-model-attribution.spec.ts`；全部使用合成資料及模擬 Gemini 回應，沒有產生實際模型費用，沒有測試正式站的實際 API 請求。
