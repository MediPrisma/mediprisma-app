# HF CDSS user input 盤點：pilot/hmc

> 歷史盤點，基準為 2026-09-11 的 pilot/hmc。使用者於 2026-09-12 改要求對齊最新 origin/master；目前實作基準、已新增輸入與儲存欄位請見 [master 儲存欄位清單](CDSS-STORAGE-FIELD-CATALOG-2026-09-12.md)。下文「待新增」不代表 master 仍缺少該功能。

狀態：分支原始碼盤點，尚未修改 App、套件或 Firebase 程式。本文取代先前以目前工作區／node_modules 為基準的盤點。

## 核對基準

已更新並核對兩個遠端 `origin/pilot/hmc`：

- App `mediprisma-app`：`9a856dd24d8a606cf366405024923b738eb65048`。
- 規則／adapter 專案 `mediprisma-cdss`：`7e68816b42810a6b3467f6ace80a7da033571cda`。
- App `.github/workflows/deploy-hmc-preview.yml` 明確 checkout 兩個專案的 pilot/hmc，編譯 personalization 原始碼並 overlay HF；不能只根據 App package.json 或目前電腦 node_modules 的版本判斷 HMC 功能。
- 本輪核對分支與部署組裝方式，未核對線上 hmc-build.json，亦未以瀏覽器驗證已部署版；不宣稱線上版本已與這兩個 SHA 一致。

## 直接更正上一份盤點

| 項目 | pilot/hmc 實際狀態 |
|---|---|
| NYHA | 已有證據表 I–IV 按鈕，可取消選擇回未評估；輸入成為 physicianNyhaClass fact，部分症狀判讀已讀取 |
| 代償／失代償 | 已有主畫面控制與 compensationStatus 欄位；先前列為待新增不準確 |
| 代償答案是否影響規則 | App 寫入 physicianCompensationStatus，但核對的 HF 套件原始碼沒有讀取此 fact；不能說已完成臨床規則接線 |
| 心律 | ClinicVitals 沒有 rhythm 欄位或對應門診選擇介面；先前稱已有手動心律輸入不適用此分支 |
| 門診數值 | 目前表單只有收縮壓、舒張壓、心率、體重；沒有身高、K、Na、eGFR、NT-proBNP 的手動補填 |
| LVEF | 另在 phenotype-answer store 與分型控制補填數值、檢查日期，不是共用 ClinicVitals.entries |
| 處置記錄 | 這個 App 分支沒有 physician-decisions store 與對應 onRecordDecision 流程；不能將另一版本的「已開立／禁忌／暫緩」保存能力視為 HMC 已有 |
| 保存 | ClinicVitals 與 phenotype answer 目前為 session memory；phenotype 預留 async repository 介面，但預設不是 Firestore；evidence overrides 有本機保存 |

## 已有輸入，以及真正還缺什麼

| 輸入 | HMC 現有介面／資料 | 接下來的工作 |
|---|---|---|
| NYHA I–IV | 證據表可選；profile fact 有日期 | 各相關模組共用一份答案；補接 AMT，避免重複提問 |
| 呼吸困難、orthopnea、PND、bendopnea 等 | 症狀／證據列有有、無、未評估；主畫面另有群組快捷選擇，共用 signAnswers | 保留逐欄位日期並避免表單儲存清掉其他回答 |
| JVP、HJR、S3、rales、水腫、腹水、肝腫大 | 證據列的結構化回答 | 不要求每次全部填，未評估保持未知 |
| 代償／失代償 | 主畫面已可選，寫入 physicianCompensationStatus | 需由 pack 明確讀取並決定影響哪些結果；不能直接拿近期住院推導 fact 代替本次狀態 |
| HF 懷疑、LVEF 分型、HFpEF 確認 | phenotype-answer store 與 PhysicianInputRequestPanel | 接入共用保存服務；不同回答保留各自修改日期 |
| LVEF 數值＋檢查日期 | 分型介面可補填 | 多次歷史 EF 的補填與來源管理需擴充 |
| 血壓、心率、體重 | 門診量測表單可輸入 | 每個欄位分開日期、保存歷程；量測日與修改日分開 |
| 證據納入／排除 | 已有開關與本機保存 | 綁定實際證據來源並保存日期；開關不能當成陽性／陰性回答 |

NYHA 仍應由臨床使用者根據活動限制與症狀選擇／確認，不能由 EF 或診斷碼直接推定。建議 I／II／III／IV／未評估並附簡短說明。[AHA NYHA 說明](https://www.heart.org/en/health-topics/heart-failure/heart-failure-explained)

## 優先補接：AMT 的「醫師填」目前並不等於真的能填

personalization 的 evidence-tables.ts：

- `highestToleratedDoseRow`（約 1460 行）仍固定 direction=unknown。
- `symptomaticRow`（約 1478 行）仍固定 direction=unknown，沒有讀取已有 NYHA fact。
- RAS 不耐受與特定自我認同族群列也仍為 physician-entered／unknown。

App 的 EvidenceTablePanel 只對 `congestion:nyha` 與已定義的症狀 term 提供答案控制；其他列走 include/exclude switch。因此，開啟「已達最高耐受劑量」那列不會把 unknown 轉成醫師明確回答的 yes。

要新增或補接的實際答案：

| 欄位 | 建議輸入 | 注意 |
|---|---|---|
| 各藥最高耐受劑量 | 已達／未達／未評估＋限制原因 | 按藥物／類別保存，不是一個全病人 boolean |
| 最佳治療下仍有症狀 | 共用 NYHA，再確認目前治療狀態 | NYHA 有症狀不代表已接受最佳治療 |
| ARNI／ACEI／ARB 不耐受 | 分藥物／類別記錄有、無、未知及原因 | 未開立不等於不能耐受 |
| 特定建議的族群條件 | 只在對應 hydralazine/ISDN 分支需要時詢問 | 不由姓名、國籍或外觀推定 |

## 需要新增：醫師才能提供或補足的資料

| 優先順序 | User input | 原因／接入方式 |
|---|---|---|
| 第一批 | 心律、相關觀察日期 | 規則會讀 ECG／AF 資料，但缺門診手動補填；需區分本次心律與 AF 病史 |
| 第一批 | 實際服藥、暫停／停用、劑量與頻次 | 處方資料不等同患者實際服用；先預填再核對 |
| 第一批 | 藥物禁忌、不耐受原因、症狀性低血壓／姿勢性不適 | 配合調藥與安全判讀；對應規則需逐項定義 |
| 第一批 | 身高、K、Na、eGFR、NT-proBNP 等數值與量測日期 | 缺資料時可補填；HMC 現在未提供完整輸入。身高尤其影響 BMI 與 H2FPEF 相關項目 |
| 第一批 | 乾重、容量狀態、利尿反應 | 已有代償選項不等同完整容量評估；可先提供結構化選擇，尿量／輸入輸出依情境補填 |
| 第一批 | 實際處置、暫緩原因、病人意願與追蹤計畫 | HMC 需新增結構化處置流程，並與實際用藥事實分開 |
| 相關情境 | HFpEF echo 指標：E/e′、LAVI、TR Vmax、PASP／RVSP、LVMI 等 | 先讀報告，缺漏且醫師手上有報告時補填；目前無完整手動表單 |
| 相關情境 | 近期惡化 HF 事件與日期 | 優先讀住院／急診等資料，缺漏才由醫師補充 |
| 相關情境 | ACEI 最後實際服用時間、換藥相關病史 | 若要完成換藥安全判讀，必須有對應輸入與驗證規則 |
| 相關情境 | 個別治療的禁忌、負擔／給付、意願 | 在相關治療卡才展開，不讓所有人填整張表單 |

HMC 已有 HFA-PEFF 與 H2FPEF 相關顯示；「規則會讀身高或 echo 指標」與「醫師有介面可補填」是兩件事，不可把前者算成輸入功能完成。

## 保存之前需先修正的 HMC 接線問題

1. ClinicValuesForm 儲存時只送出血壓、心率、體重、measuredOn，store 的 setVitals 是整份替換；原本 signAnswers、nyhaClass、compensationStatus 因而可能被清掉。需要改為欄位更新，或明確保留未編輯欄位。
2. ClinicVitals 仍共用一個 measuredOn，證據列回答還可能沿用現有 measuredOn；不符合使用者要求的每個欄位獨立修改日期。
3. phenotype answer 的 answeredOn 也是共用日期，需要分欄位保存。
4. 代償答案進 profile 卻未被 pack 消費；AMT 的手動列缺少真正的答案接線。
5. 目前沒有跨電腦還原與逐次修改歷程；需依已確認的「每日最新快照＋欄位修改歷程」設計接入。

## 建議實作順序

1. 修正現有表單覆蓋其他答案、日期共用的問題。
2. 補接現有 NYHA、代償狀態與 AMT 回答，使輸入確實能被規則使用。
3. 增加心律、必要量測補填、最高耐受劑量、藥物不耐受與服藥核對。
4. 加入處置與理由，再接入共用 Firebase 保存、回診帶入與逐欄位歷史。
5. HFpEF 報告補填及其他治療情境按相關卡片逐步擴充。ICD／CRT、鐵缺乏與進階 HF 需獨立規則工作，不列為本次已完成。

回診仍自動帶入先前值、保留原 modifiedAt。若值不變而本次再次確認，另記 confirmedAt。實際修改逐筆留下前後值與日期時間；同日每日快照只留最新一份。

## 可追溯程式位置

以下連結固定到本次核對的 SHA：

- [HMC 部署來源](https://github.com/MediPrisma/mediprisma-app/blob/9a856dd24d8a606cf366405024923b738eb65048/.github/workflows/deploy-hmc-preview.yml)
- [HMC ClinicVitals store](https://github.com/MediPrisma/mediprisma-app/blob/9a856dd24d8a606cf366405024923b738eb65048/features/clinical-decision-support/stores/clinic-vitals.store.ts)
- [HMC phenotype answer store](https://github.com/MediPrisma/mediprisma-app/blob/9a856dd24d8a606cf366405024923b738eb65048/features/clinical-decision-support/stores/phenotype-answer.store.ts)
- [HMC 門診表單與代償控制](https://github.com/MediPrisma/mediprisma-app/blob/9a856dd24d8a606cf366405024923b738eb65048/features/clinical-decision-support/renderers/HeartFailureStatusBoard.tsx)
- [HMC NYHA 與證據列控制](https://github.com/MediPrisma/mediprisma-app/blob/9a856dd24d8a606cf366405024923b738eb65048/features/clinical-decision-support/renderers/EvidenceTablePanel.tsx)
- [HMC 輸入轉 profile](https://github.com/MediPrisma/mediprisma-app/blob/9a856dd24d8a606cf366405024923b738eb65048/features/clinical-decision-support/utils/apply-clinic-vitals.ts)
- [HMC AMT 證據規則](https://github.com/MediPrisma/mediprisma-cdss/blob/7e68816b42810a6b3467f6ace80a7da033571cda/packages/personalized-care/src/clinical-modules/evidence-tables.ts)
- [HMC HFpEF／NYHA 規則](https://github.com/MediPrisma/mediprisma-cdss/blob/7e68816b42810a6b3467f6ace80a7da033571cda/packages/personalized-care/src/clinical-modules/hfpef-diagnosis.ts)
