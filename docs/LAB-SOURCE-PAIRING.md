# 院內／雲端檢驗顯示配對

來源內解析與去重由抓抓處理；院內與雲端的比較由 app 共用 clinical aggregate projection 處理，不改寫輸入 Bundle 或不可變 source graph。

本次範圍為雲端已關閉草稿 #35 的 FSH、E2、CA19-9。同一個已解析的病人、北榮機構、台北日期及檢驗項目，院內與雲端必須各只有一筆候選，再比較數值、等價單位拼法、比較符號、採檢時間、檢體、狀態及明確 metadata 衝突。不是只挑數值剛好相同的那一筆；多次採檢一律保留。

FSH/E2 只認已知北榮本地代碼與既有 LOINC 對應；明確 LOINC 優先，不以顯示名稱猜測。單位僅將 mIU/mL 與 m[iU]/mL 視為同一拼法，不換算數值或推定檢驗方法。雲端 Blood 的粗略檢體可與這三項北榮 serum 結果比較，Plasma、Urine 或缺少檢體不配對。

符合時以院內結果作為顯示列，保留雙方 note、可補足的 referenceRange／interpretation／method，以及 `clinicalSourceCopyKeys` 指向兩份原始來源。這是顯示配對，不是經 accession 證明的同一事件。原始報告、資源、時間與數值仍在 source graph；報告成員與引用共同指向顯示列，AI 檢驗內容不重複計算這個顯示列。來源報告本身不被刪除。

每次共用 projection 都重新計算。分批查詢後若發現第二筆候選，先前的合併會撤回，恢復各來源結果及原始 note。未知來源、病人引用未解析、跨病人、不同結果、不同日期、不同精確時間、修訂／衝突與有歧義的情況不配對。

驗證：`__tests__/infrastructure/fhir/mappers/lab-source-pairs.test.ts` 經真實 LocalBundleService、共用 projection 與 lab pivot，涵蓋三項檢驗、兩來源保留、報告引用、AI 計數、衝突、不同病人、多次採檢與增量資料撤回。
